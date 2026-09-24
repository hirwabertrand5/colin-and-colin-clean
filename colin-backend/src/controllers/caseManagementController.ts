import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import WorkflowTemplate from '../models/workflowTemplateModel';
import Task from '../models/taskModel';
import Invoice from '../models/invoiceModel';
import User from '../models/userModel';
import { writeAudit } from '../services/auditService';
import { createNotification, findUserByAssigneeString, notifyUsersById } from '../services/notifyService';
import {
  computeCaseEarnedFees,
  computeStepTimelinessScore,
  getMatterQualityScore,
  normalizeEffectiveWorkflowSteps,
} from '../utils/caseEarnedFees';
import { getTpaPercent } from '../utils/workflowPercentages';
import { completeStepForCase } from './workflowController';

const isAdmin = (role?: string) =>
  role === 'managing_director' ||
  role === 'managing_partner' ||
  role === 'executive_managing_partner' ||
  role === 'senior_partner' ||
  role === 'partner' ||
  role === 'executive_partner' ||
  role === 'associate_partner' ||
  role === 'executive_associate_partner' ||
  role === 'senior_executive_assistant' ||
  role === 'originating_attorney' ||
  role === 'executive_assistant';

/**
 * Quality Score editing is restricted to the Reviewer of the case and to
 * Managing Partner / Partner / Executive Assistant roles. The Case Initiator is
 * never allowed to enter or edit the Quality Score.
 */
const isAllowedQualityScoreRole = (role?: string) =>
  role === 'managing_partner' ||
  role === 'executive_managing_partner' ||
  role === 'partner' ||
  role === 'executive_partner' ||
  role === 'executive_assistant';

const normalizeIdentity = (value: unknown) => String(value || '').trim().toLowerCase();

const actorFromReq = (req: AuthRequest) => ({
  actorName: req.user?.name || 'System',
  actorUserId: req.user?.id as string | undefined,
});

/** Case Management assignment slots (kept in sync with the Case model). */
const getCaseAssignments = (caseDoc: any) => {
  const raw = caseDoc?.caseAssignments || {};
  return {
    initiator: String(raw.initiator || caseDoc?.assignedTo || '').trim(),
    reviewer: String(raw.reviewer || '').trim(),
    approver: String(raw.signerApprover || '').trim(),
  };
};

/** Identity of the signed-in user on this matter: initiator/reviewer/approver/admin/none. */
const resolveMyCaseRole = (caseDoc: any, req: AuthRequest) => {
  if (isAdmin(req.user?.role)) return 'admin';
  const meName = normalizeIdentity(req.user?.name);
  const meEmail = normalizeIdentity(req.user?.email);
  const match = (value: string) => {
    const normalized = normalizeIdentity(value);
    return Boolean(normalized) && (normalized === meName || normalized === meEmail);
  };
  const assignments = getCaseAssignments(caseDoc);
  if (match(assignments.initiator)) return 'initiator';
  if (match(assignments.reviewer)) return 'reviewer';
  if (match(assignments.approver)) return 'approver';
  return 'none';
};

/**
 * Whether the signed-in user is the Case Initiator of this matter. This is
 * computed independently from `resolveMyCaseRole` because administrators that
 * are labelled as the initiator (e.g. a Managing Partner or Executive Assistant
 * who created the case) resolve to `admin` there, yet they must still be denied
 * Quality Score editing.
 */
const isCaseInitiator = (caseDoc: any, req: AuthRequest) => {
  const meName = normalizeIdentity(req.user?.name);
  const meEmail = normalizeIdentity(req.user?.email);
  if (!meName && !meEmail) return false;
  const match = (value: string) => {
    const normalized = normalizeIdentity(value);
    return Boolean(normalized) && (normalized === meName || normalized === meEmail);
  };
  const assignments = getCaseAssignments(caseDoc);
  return Boolean(assignments.initiator && match(assignments.initiator));
};

const allKeyActionsDone = (step: any) => {
  const actions = Array.isArray(step?.actions) ? step.actions : [];
  return actions.length === 0 || actions.every((action: any) => Boolean(action?.done));
};
const findAssignedUserIds = async (names: string[]) => {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const name of names.filter(Boolean)) {
    const user = await findUserByAssigneeString(name);
    if (user?._id && !seen.has(String(user._id))) {
      seen.add(String(user._id));
      ids.push(String(user._id));
    }
  }
  return ids;
};

/**
 * Combined Case Management state: the three assigned members, every Key Action
 * with its lifecycle, the matter Quality Score, and the earned-fees projection
 * (single source of truth = computeCaseEarnedFees).
 */
const buildCaseManagementState = async ({ caseDoc, template, inst, tasks, collectedAmount, roleByName, req }: any) => {
  const effectiveSteps = normalizeEffectiveWorkflowSteps(inst, template);
  const earnedFees = computeCaseEarnedFees({
    caseDoc,
    template,
    workflowInstance: { ...(inst || {}), steps: effectiveSteps },
    tasks,
    collectedAmount,
    roleByName,
  });

  const assignments = getCaseAssignments(caseDoc);
  const members = [
    { key: 'initiator', role: 'Initiator', name: assignments.initiator },
    { key: 'reviewer', role: 'Reviewer', name: assignments.reviewer },
    { key: 'approver', role: 'Signer/Approver', name: assignments.approver },
  ]
    .filter((member) => member.name)
    .map((member) => {
      const userRole = String(roleByName.get(normalizeIdentity(member.name)) || '').trim() || null;
      return { ...member, userRole, tpaPercent: getTpaPercent(userRole || '') };
    });

  const steps = effectiveSteps.map((step: any) => ({
    stepKey: String(step?.stepKey || ''),
    title: String(step?.title || step?.stepKey || 'Key Action'),
    stageKey: String(step?.stageKey || ''),
    stageTitle: String(step?.stageTitle || step?.stageKey || 'Stage'),
    stagePercentage: Number(step?.stagePercentage) || 0,
    percentage: Number(step?.percentage) || 0,
    order: Number(step?.order) || 0,
    status: String(step?.status || 'Not Started'),
    startAt: step?.startAt,
    dueAt: step?.dueAt,
    completedAt: step?.completedAt,
    submittedAt: step?.submittedAt,
    reviewedAt: step?.reviewedAt,
    timelinessScore: computeStepTimelinessScore(step),
    actions: Array.isArray(step?.actions)
      ? step.actions.map((action: any) => ({ text: action?.text, done: Boolean(action?.done) }))
      : [],
  }));

  const myRole = resolveMyCaseRole(caseDoc, req);
  const { qualityScore, qualityScoredBy, qualityScoredAt } = getMatterQualityScore(caseDoc);

  // Quality Score editing is available to the Reviewer of this case and to the
  // Managing Partner / Partner / Executive Assistant roles — never to the Case
  // Initiator (who may also hold one of those roles).
  const canEnterQualityScore =
    !isCaseInitiator(caseDoc, req) &&
    (myRole === 'reviewer' || isAllowedQualityScoreRole(req.user?.role));

  return {
    caseId: String(caseDoc?._id || ''),
    caseNo: String(caseDoc?.caseNo || ''),
    parties: String(caseDoc?.parties || ''),
    workflowStatus: String(inst?.status || 'Active'),
    currentStepKey: inst?.currentStepKey,
    members,
    myRole,
    canEnterQualityScore,
    qualityScore,
    qualityScoredBy,
    qualityScoredAt,
    steps,
    earnedFees,
  };
};

/** Shared loader for all Case Management handlers. */
const loadCaseManagementContext = async (req: AuthRequest) => {
  const { caseId } = req.params as any;
  const caseDoc: any = await Case.findById(caseId);
  if (!caseDoc) return { error: null as any, caseDoc: null as any };
  const inst: any = await WorkflowInstance.findOne({ caseId: new mongoose.Types.ObjectId(caseId) });
  const template: any = inst
    ? await WorkflowTemplate.findById(inst.templateId).lean()
    : null;
  const [tasks, paidInvoices] = await Promise.all([
    Task.find({ caseId }).lean(),
    Invoice.find({ caseId, status: 'Paid' }).select('amount').lean(),
  ]);
  const collectedAmount = (paidInvoices || []).reduce(
    (sum: number, invoice: any) => sum + Math.max(0, Number(invoice?.amount) || 0),
    0
  );
  const assignments = getCaseAssignments(caseDoc);
  const memberNames = [assignments.initiator, assignments.reviewer, assignments.approver].filter(Boolean);
  const users: any[] = memberNames.length
    ? await User.find({ name: { $in: memberNames } }).select('name email role').lean()
    : [];
  const roleByName = new Map<string, string>();
  for (const user of users || []) {
    const key = normalizeIdentity(user?.name);
    if (key && !roleByName.has(key)) roleByName.set(key, String(user?.role || ''));
  }
  return {
    error: null as any,
    caseDoc,
    inst,
    template,
    tasks,
    collectedAmount,
    roleByName,
  };
};
export const getCaseManagement = async (req: AuthRequest, res: Response) => {
  try {
    const ctx = await loadCaseManagementContext(req);
    if (ctx.error || !ctx.caseDoc) return res.status(404).json({ message: 'Case not found.' });
    const state = await buildCaseManagementState({ ...ctx, req });
    return res.json(state);
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || 'Failed to load Case Management.' });
  }
};

export const requestReview = async (req: AuthRequest, res: Response) => {
  try {
    const { stepKey } = req.body || {};
    const ctx = await loadCaseManagementContext(req);
    if (!ctx.caseDoc) return res.status(404).json({ message: 'Case not found.' });
    if (!ctx.inst) return res.status(400).json({ message: 'No workflow instance for this case.' });

    const myRole = resolveMyCaseRole(ctx.caseDoc, req);
    if (myRole !== 'initiator' && myRole !== 'admin') {
      return res.status(403).json({ message: 'Only the Case Initiator can request a review.' });
    }

    const step: any = (ctx.inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Key Action not found.' });
    if (String(step.status || '').toLowerCase() === 'completed') {
      return res.status(400).json({ message: 'This Key Action is already completed.' });
    }
    if (!allKeyActionsDone(step)) {
      return res.status(400).json({ message: 'Complete all key actions before requesting a review.' });
    }

    step.status = 'Awaiting Review';
    step.submittedAt = new Date();
    await ctx.inst.save();

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(ctx.caseDoc._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'CASE_MANAGEMENT_REQUESTED_REVIEW',
      message: 'Requested review of completed work',
      detail: `${stepKey} • ${step.title || ''}`,
    });

    const assignments = getCaseAssignments(ctx.caseDoc);
    if (assignments.reviewer) {
      const reviewerIds = await findAssignedUserIds([assignments.reviewer]);
      await createNotification({
        type: 'CASE_MANAGEMENT_REVIEW_REQUESTED',
        title: 'Review requested',
        message: `${assignments.initiator || actor.actorName} submitted "${step.title || stepKey}" for your review on ${ctx.caseDoc.caseNo}.`,
        severity: 'warning',
        caseId: String(ctx.caseDoc._id),
        link: `/cases/${ctx.caseDoc._id}`,
        ...(reviewerIds.length ? { audienceUserIds: reviewerIds } : {}),
      });
      await notifyUsersById({
        userIds: reviewerIds,
        category: 'approvals',
        notification: {
          type: 'CASE_MANAGEMENT_REVIEW_REQUESTED',
          title: 'Review requested',
          message: `${assignments.initiator || actor.actorName} is waiting for your review of "${step.title || stepKey}".`,
          severity: 'warning',
          caseId: String(ctx.caseDoc._id),
          link: `/cases/${ctx.caseDoc._id}`,
        },
        email: {
          subject: `Review requested: ${ctx.caseDoc.caseNo}`,
          html: `<div style="font-family:Arial,sans-serif"><p>${assignments.initiator || actor.actorName} has submitted "${step.title || stepKey}" for review on ${ctx.caseDoc.caseNo}.</p></div>`,
        },
      });
    }

    const state = await buildCaseManagementState({ ...ctx, req });
    return res.json(state);
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || 'Failed to request review.' });
  }
};
export const requestApproval = async (req: AuthRequest, res: Response) => {
  try {
    const { stepKey } = req.body || {};
    const ctx = await loadCaseManagementContext(req);
    if (!ctx.caseDoc) return res.status(404).json({ message: 'Case not found.' });
    if (!ctx.inst) return res.status(400).json({ message: 'No workflow instance for this case.' });

    const myRole = resolveMyCaseRole(ctx.caseDoc, req);
    if (myRole !== 'reviewer' && myRole !== 'admin') {
      return res.status(403).json({ message: 'Only the Reviewer can request approval.' });
    }

    const step: any = (ctx.inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Key Action not found.' });
    if (String(step.status || '').toLowerCase() === 'completed') {
      return res.status(400).json({ message: 'This Key Action is already completed.' });
    }
    const current = String(step.status || '');
    if (current !== 'Awaiting Review' && current !== 'In Progress') {
      return res.status(400).json({ message: 'The work must be submitted for review before approval can be requested.' });
    }

    step.status = 'Awaiting Approval';
    step.reviewedAt = new Date();
    await ctx.inst.save();

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(ctx.caseDoc._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'CASE_MANAGEMENT_REQUESTED_APPROVAL',
      message: 'Requested approval of reviewed work',
      detail: `${stepKey} • ${step.title || ''}`,
    });

    const assignments = getCaseAssignments(ctx.caseDoc);
    if (assignments.approver) {
      const approverIds = await findAssignedUserIds([assignments.approver]);
      await createNotification({
        type: 'CASE_MANAGEMENT_APPROVAL_REQUESTED',
        title: 'Approval requested',
        message: `${assignments.reviewer || actor.actorName} reviewed "${step.title || stepKey}" and is waiting for your approval on ${ctx.caseDoc.caseNo}.`,
        severity: 'warning',
        caseId: String(ctx.caseDoc._id),
        link: `/cases/${ctx.caseDoc._id}`,
        ...(approverIds.length ? { audienceUserIds: approverIds } : {}),
      });
      await notifyUsersById({
        userIds: approverIds,
        category: 'approvals',
        notification: {
          type: 'CASE_MANAGEMENT_APPROVAL_REQUESTED',
          title: 'Approval requested',
          message: `${assignments.reviewer || actor.actorName} is waiting for your approval of "${step.title || stepKey}".`,
          severity: 'warning',
          caseId: String(ctx.caseDoc._id),
          link: `/cases/${ctx.caseDoc._id}`,
        },
        email: {
          subject: `Approval requested: ${ctx.caseDoc.caseNo}`,
          html: `<div style="font-family:Arial,sans-serif"><p>${assignments.reviewer || actor.actorName} reviewed "${step.title || stepKey}" and is waiting for your approval on ${ctx.caseDoc.caseNo}.</p></div>`,
        },
      });
    }

    const state = await buildCaseManagementState({ ...ctx, req });
    return res.json(state);
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || 'Failed to request approval.' });
  }
};
export const approveStep = async (req: AuthRequest, res: Response) => {
  try {
    const { stepKey } = req.body || {};
    const ctx = await loadCaseManagementContext(req);
    if (!ctx.caseDoc) return res.status(404).json({ message: 'Case not found.' });
    if (!ctx.inst) return res.status(400).json({ message: 'No workflow instance for this case.' });

    const myRole = resolveMyCaseRole(ctx.caseDoc, req);
    if (myRole !== 'approver' && myRole !== 'admin') {
      return res.status(403).json({ message: 'Only the Signer/Approver can approve completed work.' });
    }

    const step: any = (ctx.inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Key Action not found.' });
    if (String(step.status || '').toLowerCase() === 'completed') {
      return res.status(400).json({ message: 'This Key Action is already completed.' });
    }
    const current = String(step.status || '');
    if (current !== 'Awaiting Approval' && current !== 'Awaiting Review') {
      return res.status(400).json({ message: 'The work must be awaiting review or approval before it can be approved.' });
    }

    const actor = actorFromReq(req);
    await completeStepForCase(actor, ctx.caseDoc, ctx.inst, stepKey);

    const state = await buildCaseManagementState({ ...ctx, req });
    return res.json(state);
  } catch (e: any) {
    const status = typeof e?.statusCode === 'number' ? e.statusCode : 500;
    return res.status(status).json({
      message: e?.message || 'Failed to approve key action.',
      ...(Array.isArray(e?.remainingActions) ? { remainingActions: e.remainingActions } : {}),
    });
  }
};

export const setQualityScore = async (req: AuthRequest, res: Response) => {
  try {
    const { qualityScore } = req.body || {};
    const ctx = await loadCaseManagementContext(req);
    if (!ctx.caseDoc) return res.status(404).json({ message: 'Case not found.' });

    const myRole = resolveMyCaseRole(ctx.caseDoc, req);
    if (myRole === 'initiator' || isCaseInitiator(ctx.caseDoc, req) || (myRole !== 'reviewer' && !isAllowedQualityScoreRole(req.user?.role))) {
      return res.status(403).json({ message: 'Only the Reviewer, Managing Partner, Partner or Executive Assistant can enter the Quality Score. The Case Initiator cannot.' });
    }

    const score = Number(qualityScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return res.status(400).json({ message: 'Quality Score must be a number between 0 and 100.' });
    }

    const now = new Date();
    ctx.caseDoc.caseManagement = {
      ...(ctx.caseDoc.caseManagement || {}),
      qualityScore: Math.round(score),
      qualityScoredBy: req.user?.name || 'System',
      qualityScoredAt: now,
    };
    await ctx.caseDoc.save();

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(ctx.caseDoc._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'CASE_MANAGEMENT_QUALITY_SCORED',
      message: 'Quality Score entered through Case Management',
      detail: `${Math.round(score)}%`,
    });

    const state = await buildCaseManagementState({ ...ctx, req });
    return res.json(state);
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || 'Failed to save the Quality Score.' });
  }
};