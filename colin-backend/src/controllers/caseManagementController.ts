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
  computeStepWorkTimelinessScore,
  getMatterQualityScore,
  normalizeEffectiveWorkflowSteps,
} from '../utils/caseEarnedFees';
import { buildRoleByName, resolveMemberTpa } from '../utils/workflowPercentages';
import { canEnterQualityScore, isAllowedQualityScoreRole } from '../utils/caseAssignmentPermissions';
import { completeStepForCase, reconcileInstanceTemplateWithCanonical } from './workflowController';

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
 * Quality Score editing is restricted to the Reviewer and Approver of the case
 * and to Managing Partner / Partner / Executive Assistant roles. The Case
 * Initiator is never allowed to enter or edit the Quality Score. The rule lives
 * in `canEnterQualityScore` so this handler and the state builder agree.
 */
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

/**
 * Single source of truth for Quality Score permission: the Reviewer and the
 * Approver of the matter, plus the senior supervisory roles — never the Case
 * Initiator. Used both when building the Case Management state (to decide
 * whether the input is shown) and when saving the score, so the UI can never
 * offer an action the API refuses.
 */
const canEnterQualityScoreFor = (caseDoc: any, req: AuthRequest, myRole?: string) => {
  if (isCaseInitiator(caseDoc, req)) return false;
  return canEnterQualityScore(caseDoc, req.user, myRole as any);
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
      // Same resolver as the Case Workspace: user record first, then the label
      // itself when it is a role title ("Managing Partner").
      const tpa = resolveMemberTpa(member.name, roleByName);
      return { ...member, userRole: tpa.role, tpaPercent: tpa.tpaPercent, tpaSource: tpa.source };
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
    timelinessScore: computeStepWorkTimelinessScore(step),
  }));

  const myRole = resolveMyCaseRole(caseDoc, req);
  const { qualityScore, qualityScoredBy, qualityScoredAt } = getMatterQualityScore(caseDoc);

  // Quality Score editing is available to the Reviewer and the Approver of this
  // matter, and to the Managing Partner / Partner / Executive Assistant roles —
  // never to the Case Initiator (who may also hold one of those roles).
  const canEnterQualityScore = canEnterQualityScoreFor(caseDoc, req, myRole);

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

  // Same self-heal as the Case Workspace workflow endpoint: keep the matter on
  // its canonical template so Case Management shows the same checklist as the
  // Overview tab (and Templates settings). Never blocks loading on failure.
  if (inst) {
    try {
      await reconcileInstanceTemplateWithCanonical(caseDoc, inst);
    } catch {
      // A reconciliation failure must never block Case Management.
    }
  }

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
  // Loaded whole and keyed case/whitespace-insensitively so every assigned
  // member resolves to their system role (and therefore their TPA).
  const users: any[] = await User.find({}).select('name role').lean();
  const roleByName = buildRoleByName(users);
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

    // The Reviewer and the Approver of the matter enter the Quality Score, as
    // do the Managing Partner / Partner / Executive Assistant roles. The Case
    // Initiator is never allowed to, even when they also hold one of those
    // roles.
    const myRole = resolveMyCaseRole(ctx.caseDoc, req);
    if (myRole === 'initiator' || isCaseInitiator(ctx.caseDoc, req) || !canEnterQualityScoreFor(ctx.caseDoc, req, myRole)) {
      return res.status(403).json({ message: 'Only the Reviewer or Approver of this matter, or a Managing Partner, Partner or Executive Assistant, can enter the Quality Score. The Case Initiator cannot.' });
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