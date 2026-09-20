import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import WorkflowTemplate from '../models/workflowTemplateModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import Case from '../models/caseModel';
import Invoice from '../models/invoiceModel';
import Document from '../models/documentModel';
import Task from '../models/taskModel';
import User from '../models/userModel';
import { writeAudit } from '../services/auditService';
import { createNotification, sendSms } from '../services/notifyService';
import { sendEmailResend } from '../services/emailResendService';
import { buildInstanceSteps } from '../utils/workflowCompute';
import { resolveDeadlineDateTime } from '../utils/deadlineUtils';
import {
  computeCompletedPercentFromInstance,
  computeEarnedFee,
  computeStageBreakdownFromInstance,
  getTpaPercent,
  normalizeTemplatePercentages,
  parsePercentage,
} from '../utils/workflowPercentages';
import { getCaseUrgencyColor, isPublicYellowCase } from '../utils/caseVisibility';
import { caseMatchesAssignee } from '../utils/caseAssignments';
import { calculateCollectedKeyActionEarnings } from '../utils/keyActionEarnings';

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
const isAssociateLike = (role?: string) =>
  role === 'associate' ||
  role === 'trainee_associate' ||
  role === 'senior_associate' ||
  role === 'intern';

const actorFromReq = (req: AuthRequest) => ({
  actorName: req.user?.name || 'System',
  actorUserId: req.user?.id as string | undefined,
});

const normalizeIdentity = (value: unknown) => String(value || '').trim().toLowerCase();

const literalPercentage = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const text = String(value ?? '').trim().replace(/%$/, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * The template editor is the only UI that creates these payloads, but this
 * server-side guard keeps the global allocation rule true for direct API use
 * too. It deliberately never adjusts a submitted percentage.
 */
const allocationValidationError = (payload: any) => {
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  const stages = Array.isArray(payload?.stages) ? payload.stages : [];
  const stepValues = steps
    .map((step: any) => literalPercentage(step?.percentage))
    .filter((value: number | undefined): value is number => value !== undefined);

  for (const value of stepValues) {
    if (value < 0 || value > 100) return 'Each key-action percentage must be between 0% and 100%.';
  }

  // Legacy templates may have only stage allocations. New builder payloads
  // carry a literal percentage on every key-action/step instead.
  const values = stepValues.length
    ? stepValues
    : stages
        .map((stage: any) => literalPercentage(stage?.percentage))
        .filter((value: number | undefined): value is number => value !== undefined);
  const total = values.reduce((sum: number, value: number) => sum + value, 0);
  if (total > 100 + Number.EPSILON) {
    return `Workflow allocation exceeds 100% by ${Math.round((total - 100) * 100) / 100}%.`;
  }
  return '';
};

const publicationValidationError = (payload: any) => {
  if (!String(payload?.name || '').trim()) return 'Workflow name is required.';
  if (!String(payload?.matterType || '').trim()) return 'Matter type is required.';
  if (!['Transactional Cases', 'Litigation Cases', 'Labor Cases'].includes(String(payload?.caseType || '')))
    return 'A valid case type is required.';
  if (!Number.isFinite(Number(payload?.version)) || Number(payload.version) < 1)
    return 'Version must be a positive number.';

  const stages = Array.isArray(payload?.stages) ? payload.stages : [];
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  if (!stages.length) return 'Add at least one workflow stage.';
  if (!steps.length) return 'Add at least one key action.';

  const stageKeys = new Set<string>();
  for (const stage of stages) {
    const key = String(stage?.key || '').trim();
    if (!key) return 'Every stage needs a key.';
    if (!String(stage?.title || '').trim()) return 'Every stage needs a title.';
    if (stageKeys.has(key)) return `Duplicate stage key: ${key}.`;
    stageKeys.add(key);
  }

  const stepKeys = new Set<string>();
  for (const [index, step] of steps.entries()) {
    const key = String(step?.key || '').trim();
    if (!key) return `Key action ${index + 1} needs a key.`;
    if (stepKeys.has(key)) return `Duplicate key action key: ${key}.`;
    stepKeys.add(key);
    if (!String(step?.title || '').trim()) return `Key action ${index + 1} needs a description.`;
    if (!stageKeys.has(String(step?.stageKey || '').trim())) return `Key action ${index + 1} must belong to a stage.`;
  }

  return allocationValidationError(payload);
};

const buildUpdatedInstanceSteps = (existingSteps: any[] | undefined, template: any, startDate: Date) => {
  const builtSteps = buildInstanceSteps(template, startDate);
  const existingByKey = new Map((existingSteps || []).map((step: any) => [String(step.stepKey), step]));

  return builtSteps.map((nextStep: any, index: number) => {
    const previous = existingByKey.get(String(nextStep.stepKey));
    const mergedActions = (nextStep.actions || []).map((action: any, actionIndex: number) => {
      const previousAction = Array.isArray(previous?.actions) ? previous.actions[actionIndex] : undefined;
      return {
        text: String(action?.text || '').trim(),
        done: Boolean(previousAction?.done),
        ...(previousAction?.doneAt ? { doneAt: previousAction.doneAt } : {}),
      };
    });

    return {
      ...nextStep,
      status: previous?.status || nextStep.status,
      startAt: previous?.startAt || nextStep.startAt,
      dueAt: previous?.dueAt || nextStep.dueAt,
      completedAt: previous?.completedAt,
      extensionHistory: Array.isArray(previous?.extensionHistory) ? previous.extensionHistory : [],
      actions: mergedActions,
      outputs: nextStep.outputs,
    };
  });
};

const syncCaseWorkflowInstanceFromTemplate = async (caseId: string, template: any, wfStart: Date) => {
  const inst: any = await WorkflowInstance.findOne({ caseId });
  if (!inst) return null;

  const nextSteps = buildUpdatedInstanceSteps(inst.steps, template, wfStart);
  const currentStep = inst.currentStepKey ? nextSteps.find((step: any) => step.stepKey === inst.currentStepKey) : null;

  inst.templateId = template._id;
  inst.steps = nextSteps;
  if (currentStep) {
    inst.currentStepKey = currentStep.stepKey;
    if (currentStep.status === 'Completed') {
      const nextOpen = nextSteps.find((step: any) => step.status !== 'Completed');
      inst.currentStepKey = nextOpen?.stepKey || currentStep.stepKey;
    }
  } else {
    inst.currentStepKey = nextSteps[0]?.stepKey;
  }

  await inst.save();
  return inst;
};

const computeNextDueAt = (inst: any) => {
  const pending = (inst.steps || [])
    .filter((s: any) => s.status !== 'Completed')
    .slice()
    .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))[0];
  return pending?.dueAt;
};

const previousActiveStatus = (status?: string) => {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized && normalized !== 'closed' ? status : 'In Progress';
};

export const updateCaseWorkflowProgress = async (c: any, inst: any, session?: mongoose.ClientSession) => {
  const nextDueAt = computeNextDueAt(inst);
  const currentStep = inst.currentStepKey
    ? (inst.steps || []).find((s: any) => s.stepKey === inst.currentStepKey)
    : null;
  const currentStepExtension = Array.isArray(currentStep?.extensionHistory) && currentStep.extensionHistory.length
    ? currentStep.extensionHistory[currentStep.extensionHistory.length - 1]
    : undefined;
  const existingPlannedAmount =
    typeof c.workflowProgress?.plannedValue?.amount === 'number'
      ? c.workflowProgress.plannedValue.amount
      : Number(String(c.budget || '').replace(/[^\d.]/g, '')) || 0;
  const existingCurrency = c.workflowProgress?.plannedValue?.currency || c.billingSettings?.currency || 'RWF';
  const actions = (inst.steps || []).flatMap((step: any) => (Array.isArray(step.actions) ? step.actions : []));
  const checkedActions = actions.filter((action: any) => Boolean(action?.done)).length;
  const actionTotal = actions.length;
  const actionPercent = actionTotal > 0 ? Math.round((checkedActions / actionTotal) * 100) : 0;

  // Stage-weighted completion percent — the source of truth for earned fees.
  // Completed steps are weighted by their stage's percentage of the workflow.
  const stageBreakdown = computeStageBreakdownFromInstance(inst?.steps || []);
  const stageWeightedPercent = computeCompletedPercentFromInstance(inst?.steps || []);
  // Fall back to the action-based percent for legacy instances without percentages.
  const percent = stageWeightedPercent > 0 ? stageWeightedPercent : actionPercent;
  const completedValueAmount = Math.round((existingPlannedAmount * percent) / 100);

  c.workflowProgress = {
    status: inst.status === 'Completed' ? 'Completed' : 'In Progress',
    currentStepKey: inst.currentStepKey,
    currentStepTitle: (() => {
      if (!inst.currentStepKey) return undefined;
      return currentStep?.title;
    })(),
    currentStepStartAt: (() => {
      if (!inst.currentStepKey) return undefined;
      return currentStep?.startAt;
    })(),
    currentStepDueAt: (() => {
      if (!inst.currentStepKey) return undefined;
      return currentStep?.dueAt;
    })(),
    currentStepExtension: currentStepExtension
      ? {
          days: currentStepExtension.days,
          reason: currentStepExtension.reason,
          grantedBy: currentStepExtension.grantedBy,
          grantedAt: currentStepExtension.grantedAt,
          previousDueAt: currentStepExtension.previousDueAt,
          newDueAt: currentStepExtension.newDueAt,
        }
      : undefined,
    percent,
    nextDueAt,
    stagePercent: stageBreakdown,
    plannedValue: { amount: existingPlannedAmount || undefined, currency: existingCurrency },
    completedValue: { amount: completedValueAmount || 0, currency: existingCurrency },
  };

  if (inst.status === 'Completed') {
    c.status = 'Closed';
  } else if (String(c.status || '').toLowerCase() === 'closed') {
    c.status = previousActiveStatus(c.workflowProgress?.status);
  }

  c.billingSettings = {
    ...(c.billingSettings || {}),
    currency: existingCurrency,
    prepaidTotal: 0,
    prepaidRemaining: 0,
    accruedUnbilled: completedValueAmount || 0,
  };

  const urgencyColor = getCaseUrgencyColor(c);
  if (urgencyColor !== 'yellow' && String(c?.takeRequestState?.status || '').trim().toLowerCase() !== 'idle') {
    c.takeRequestState = {
      ...(c.takeRequestState || {}),
      status: 'idle',
      requestId: undefined,
      requestedByUserId: undefined,
      requestedByName: undefined,
      requestedByRole: undefined,
      requestedAt: undefined,
      lockExpiresAt: undefined,
      claimedAt: undefined,
      decisionByUserId: undefined,
      decisionByName: undefined,
      decisionReason: undefined,
      lastUpdatedAt: new Date(),
    };
  }

  await c.save(session ? { session } : undefined);
};

const completeStepInternal = async (req: AuthRequest, c: any, inst: any, stepKey: string) => {
  const step = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
  if (!step) throw new Error('Step not found.');

  // Enforce checklist completion if actions exist
  const actions = Array.isArray(step.actions) ? step.actions : [];
  const hasActions = actions.length > 0;
  const allActionsDone = !hasActions || actions.every((a: any) => a?.done === true);
  if (!allActionsDone) {
    const remaining = actions.filter((a: any) => !a?.done).map((a: any) => a?.text).filter(Boolean);
    const err: any = new Error('Cannot complete step. Pending key actions.');
    err.statusCode = 400;
    err.remainingActions = remaining;
    throw err;
  }

  const previousStepStatus = step.status;
  step.status = 'Completed';
  step.completedAt = new Date();

  const sorted = (inst.steps || []).slice().sort((a: any, b: any) => a.order - b.order);
  const idx = sorted.findIndex((x: any) => x.stepKey === stepKey);
  const next = sorted[idx + 1];

  if (next) {
    inst.currentStepKey = next.stepKey;
    const nextRef = inst.steps.find((x: any) => x.stepKey === next.stepKey);
    if (nextRef && nextRef.status === 'Not Started') nextRef.status = 'In Progress';
  } else {
    inst.status = 'Completed';
  }

  await inst.save();

  // Capture previous case workflow status for auditing
  const previousCaseWorkflowStatus = c.workflowProgress?.status;

  await updateCaseWorkflowProgress(c, inst);

  const actor = actorFromReq(req);

  // Include stage transition info when available
  const prevStage = (inst.steps || []).find((s: any) => s.stepKey === stepKey)?.stageKey || 'unknown';
  const newStage = (() => {
    if (!inst.currentStepKey) return undefined;
    const ref = (inst.steps || []).find((s: any) => s.stepKey === inst.currentStepKey);
    return ref?.stageKey;
  })();

  const stepDetailParts = [`${stepKey} • ${step.title}`];
  if (previousStepStatus) stepDetailParts.push(`from ${previousStepStatus} to ${step.status}`);
  if (prevStage && newStage && prevStage !== newStage) stepDetailParts.push(`stage: ${prevStage} → ${newStage}`);

  await writeAudit({
    caseId: String(c._id),
    actorName: actor.actorName,
    ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
    action: 'WORKFLOW_STEP_COMPLETED',
    message: 'Completed workflow step',
    detail: stepDetailParts.join(' • '),
  });

  // If the case workflow status changed, write a CASE_UPDATED audit entry
  const newCaseWorkflowStatus = c.workflowProgress?.status;
  if (previousCaseWorkflowStatus !== newCaseWorkflowStatus) {
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'CASE_UPDATED',
      message: 'Case workflow status updated',
      detail: `Workflow status: ${previousCaseWorkflowStatus || 'unknown'} → ${newCaseWorkflowStatus}`,
    });
  }

  // Notifications for ownership transfer approval (finalization)
  try {
    if (String(stepKey).toUpperCase() === 'VOT_12_OWNERSHIP_TRANSFER_APPROVAL') {
      // Find buyer & seller contacts on the case
      const contacts: any[] = Array.isArray(c.clientContacts) ? c.clientContacts : [];
      const emails = contacts.map((p: any) => String(p.email || '').trim()).filter(Boolean);
      const phones = contacts.map((p: any) => String(p.phone || '').trim()).filter(Boolean);

      const subject = 'Vehicle Ownership Transfer Completed';
      const plate = (c.parties || '') as string;
      const html = `<p>The ownership transfer has been completed for case ${String(c.caseNo || '')}.</p><p>Reference: ${String(c.caseNo || '')}</p>`;
      // Send emails (best-effort)
      if (emails.length) {
        try {
          await sendEmailResend(emails, subject, html);
        } catch {
          // ignore email send failures
        }
      }

      // Send SMS placeholder
      if (phones.length) {
        try {
          await sendSms(phones, `Ownership transfer completed for case ${String(c.caseNo || '')}.` , String(c._id));
        } catch {}
      }

      // In-app notification for internal staff roles
      try {
        await createNotification({
          type: 'WORKFLOW_NOTIFICATION',
          title: 'Ownership transfer approved',
          message: `Ownership transfer approved for case ${String(c.caseNo || '')}`,
          audienceRoles: ['executive_assistant', 'associate', 'partner', 'compliance_officer'],
          caseId: String(c._id),
        } as any);
      } catch {}
    }
  } catch (e) {
    // swallow notification errors to avoid breaking primary flow
  }

  return inst;
};

const ensureInstanceStepActions = async (inst: any, step: any) => {
  if (Array.isArray(step.actions) && step.actions.length > 0) return step.actions;

  const t: any = await WorkflowTemplate.findById(inst.templateId).lean();
  const templateStep = (t?.steps || []).find((x: any) => x.key === step.stepKey);
  step.actions = (templateStep?.actions || []).map((text: any) => ({
    text: String(text || '').trim(),
    done: false,
  }));
  return step.actions;
};

const canAssociateLikeAccessCase = async (req: AuthRequest, foundCase: any) => {
  if (!isAssociateLike(req.user?.role)) return false;

  if (isPublicYellowCase(foundCase)) return true;

  const meName = normalizeIdentity(req.user?.name);
  const meEmail = normalizeIdentity(req.user?.email);
  if (!meName && !meEmail) return false;

  if (caseMatchesAssignee(foundCase, meName) || caseMatchesAssignee(foundCase, meEmail)) return true;

  const tasks = await Task.find({ caseId: foundCase._id }).select('assignee supervisor taskStages').lean();
  return tasks.some((task: any) => {
    const assignee = normalizeIdentity(task?.assignee);
    const supervisor = normalizeIdentity(task?.supervisor);
    const stageMatch = (task?.taskStages || []).some((stage: any) => {
      const staffMember = normalizeIdentity(stage?.staffMember);
      return staffMember && [meName, meEmail].includes(staffMember);
    });
    return [assignee, supervisor].some((value) => value && (value === meName || value === meEmail)) || stageMatch;
  });
};

const canTaskContributorAccessCase = async (req: AuthRequest, foundCase: any) => {
  const meName = normalizeIdentity(req.user?.name);
  const meEmail = normalizeIdentity(req.user?.email);
  if (!meName && !meEmail) return false;

  const tasks = await Task.find({ caseId: foundCase._id }).select('assignee supervisor taskStages').lean();
  return tasks.some((task: any) => {
    const assignee = normalizeIdentity(task?.assignee);
    const supervisor = normalizeIdentity(task?.supervisor);
    const stageMatch = (task?.taskStages || []).some((stage: any) => {
      const staffMember = normalizeIdentity(stage?.staffMember);
      return staffMember && [meName, meEmail].includes(staffMember);
    });
    return [assignee, supervisor].some((value) => value && (value === meName || value === meEmail)) || stageMatch;
  });
};

// ---------- Templates ----------
export const listActiveTemplates = async (req: AuthRequest, res: Response) => {
  try {
    const templates = await WorkflowTemplate.find({ active: true })
      .sort({ matterType: 1, name: 1 })
      .lean();
    res.json(templates);
  } catch {
    res.status(500).json({ message: 'Failed to load workflow templates.' });
  }
};

export const listAllTemplates = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });
    const templates = await WorkflowTemplate.find({}).sort({ updatedAt: -1 }).lean();
    res.json(templates);
  } catch {
    res.status(500).json({ message: 'Failed to load workflow templates.' });
  }
};

export const getTemplateById = async (req: AuthRequest, res: Response) => {
  try {
    const { templateId } = req.params as any;
    const t = await WorkflowTemplate.findById(templateId);
    if (!t) return res.status(404).json({ message: 'Template not found.' });
    res.json(t);
  } catch {
    res.status(500).json({ message: 'Failed to load template.' });
  }
};

export const createTemplate = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const payload: any = { ...req.body };
    // Manual workflow fees are retired. Existing templates are safely migrated
    // when saved by removing legacy fee specifications from every section/action.
    payload.stages = Array.isArray(payload.stages)
      ? payload.stages.map(({ fee: _fee, ...stage }: any) => stage)
      : payload.stages;
    payload.steps = Array.isArray(payload.steps)
      ? payload.steps.map(({ fee: _fee, ...step }: any) => step)
      : payload.steps;
    if (payload.draft) payload.active = false;
    const validationError = payload.draft ? allocationValidationError(payload) : publicationValidationError(payload);
    if (validationError) return res.status(400).json({ message: validationError });

    // Preserve literal stage and key-action percentages exactly as supplied.
    normalizeTemplatePercentages(payload);

    const created = await WorkflowTemplate.create(payload);
    // NOTE: We avoid writing audit here because your audit log requires a caseId.
    res.status(201).json(created);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to create template.' });
  }
};

export const updateTemplate = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const { templateId } = req.params as any;
    const before = await WorkflowTemplate.findById(templateId).lean();

    const payload: any = { ...req.body };
    payload.stages = Array.isArray(payload.stages)
      ? payload.stages.map(({ fee: _fee, ...stage }: any) => stage)
      : payload.stages;
    payload.steps = Array.isArray(payload.steps)
      ? payload.steps.map(({ fee: _fee, ...step }: any) => step)
      : payload.steps;
    if (payload.draft) payload.active = false;
    const validationError = payload.draft ? allocationValidationError(payload) : publicationValidationError(payload);
    if (validationError) return res.status(400).json({ message: validationError });

    // Normalize literal percentages without redistributing them.
    normalizeTemplatePercentages(payload);

    const updated = await WorkflowTemplate.findByIdAndUpdate(templateId, payload, { new: true });
    if (!updated) return res.status(404).json({ message: 'Template not found.' });

    const affectedCases = await Case.find({ workflowTemplateId: templateId }).select('_id workflowStartDate createdAt').lean();
    await Promise.all((affectedCases as any[]).map(async (matter) => {
      const wfStart = resolveDeadlineDateTime(matter.workflowStartDate || matter.createdAt || new Date()) || new Date();
      const inst = await syncCaseWorkflowInstanceFromTemplate(String(matter._id), updated, wfStart);
      if (!inst) return;

      const caseDoc: any = await Case.findById(matter._id);
      if (!caseDoc) return;
      caseDoc.workflowTemplateId = updated._id as any;
      caseDoc.matterType = updated.matterType;
      caseDoc.workflowStartDate = wfStart;
      await updateCaseWorkflowProgress(caseDoc, inst);
    }));

    if (before && before.matterType !== updated.matterType) {
      // Keep the template metadata itself authoritative; the case sync above updates linked cases.
    }

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to update template.' });
  }
};

export const deleteTemplate = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });
    const { templateId } = req.params as any;

    const deleted = await WorkflowTemplate.findByIdAndDelete(templateId);
    if (!deleted) return res.status(404).json({ message: 'Template not found.' });

    res.json({ message: 'Template deleted.' });
  } catch {
    res.status(500).json({ message: 'Failed to delete template.' });
  }
};

// ---------- Instances ----------
export const getWorkflowForCase = async (req: AuthRequest, res: Response) => {
  try {
    const { caseId } = req.params as any;
    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    if (!isAdmin(req.user?.role)) {
      if (!isPublicYellowCase(c)) {
        const allowed = await canAssociateLikeAccessCase(req, c);
        if (!allowed && !(await canTaskContributorAccessCase(req, c))) {
          return res.status(403).json({ message: 'Forbidden.' });
        }
      }
    }

    const inst: any = await WorkflowInstance.findOne({ caseId: new mongoose.Types.ObjectId(caseId) });
    if (!inst) return res.status(404).json({ message: 'No workflow instance for this case.' });

    // Backfill step actions from template if missing (safe for older instances)
    try {
      const t: any = await WorkflowTemplate.findById(inst.templateId).lean();
      let changed = false;
      for (const step of inst.steps || []) {
        const hasActions = Array.isArray(step.actions) && step.actions.length > 0;
        if (hasActions) continue;
        const templateStep = (t?.steps || []).find((x: any) => x.key === step.stepKey);
        const actions = (templateStep?.actions || []).map((text: any) => ({ text: String(text || '').trim(), done: false }));
        if (actions.length) {
          step.actions = actions;
          changed = true;
        }
      }
      if (changed) await inst.save();
    } catch {
      // ignore backfill failures
    }

    res.json(inst.toObject());
  } catch {
    res.status(500).json({ message: 'Failed to load workflow.' });
  }
};

// ---------- Earned fees (Firm Reports → Productivity formula per matter) ----------
export const getCaseEarnedFees = async (req: AuthRequest, res: Response) => {
  try {
    const { caseId } = req.params as any;
    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    if (!isAdmin(req.user?.role)) {
      if (!isPublicYellowCase(c)) {
        const allowed = await canAssociateLikeAccessCase(req, c);
        if (!allowed && !(await canTaskContributorAccessCase(req, c))) {
          return res.status(403).json({ message: 'Forbidden.' });
        }
      }
    }

    const inst: any = await WorkflowInstance.findOne({
      caseId: new mongoose.Types.ObjectId(caseId),
    }).lean();
    const template: any = inst
      ? await WorkflowTemplate.findById(inst.templateId).lean()
      : null;

    const currency = String(
      c.workflowProgress?.plannedValue?.currency || c.billingSettings?.currency || 'RWF'
    );

    // Legacy instances (created before percentages existed) store no
    // percentage on their steps — derive them from the template so percentages
    // and earned values are still correct everywhere.
    let effectiveSteps: any[] = Array.isArray(inst?.steps) ? inst.steps : [];
    if (template && !effectiveSteps.some((step: any) => Number(step?.percentage) > 0)) {
      const templateStepsByKey = new Map<string, any>(
        (template.steps || []).map((templateStep: any) => [String(templateStep?.key || ''), templateStep])
      );
      const stagePercentages: any = (template.stages || []).reduce(
        (map: any, stage: any) => map.set(String(stage?.key || ''), stage),
        new Map<string, any>()
      );
      effectiveSteps = effectiveSteps.map((step: any) => {
        const stageKey = String(step?.stageKey || '');
        const stage = stagePercentages.get(stageKey);
        return {
          ...step,
          percentage: parsePercentage(templateStepsByKey.get(String(step?.stepKey || ''))?.percentage) ?? 0,
          stagePercentage: typeof stage?.percentage === 'number' ? stage.percentage : 0,
          stageTitle: String(stage?.title || step?.stageTitle || stageKey || 'Stage'),
        };
      });
    }

    const [tasks, paidInvoices] = await Promise.all([
      Task.find({ caseId }).lean(),
      Invoice.find({ caseId, status: 'Paid' }).select('amount').lean(),
    ]);
    const collectedAmount = (paidInvoices || []).reduce(
      (sum: number, invoice: any) => sum + Math.max(0, Number(invoice?.amount) || 0),
      0
    );
    const keyActionEarnings = calculateCollectedKeyActionEarnings({
      matter: c,
      template,
      workflowInstance: { ...(inst || {}), steps: effectiveSteps },
      tasks,
      collectedAmount,
    });
    const contractValue = keyActionEarnings.contractValue;
    const completedPercent = keyActionEarnings.completedPercent;
    const completedValue = keyActionEarnings.completedValue;
    // This is the sole base for TPA/timeliness/quality. It is zero until cash
    // is collected, and it can never exceed either the completed action value
    // or actual paid invoices for the matter.
    const earnedValue = keyActionEarnings.eligibleCollectedValue;
    const stages = computeStageBreakdownFromInstance(effectiveSteps);

    const assignments: any = c.caseAssignments || {};
    const teamSpecs = [
      {
        key: 'initiator',
        label: 'Initiator',
        name: String(assignments.initiator || c.assignedTo || '').trim(),
      },
      {
        key: 'reviewer',
        label: 'Reviewer',
        name: String(assignments.reviewer || '').trim(),
      },
      {
        key: 'approver',
        label: 'Approver',
        name: String(assignments.signerApprover || '').trim(),
      },
    ].filter((spec) => spec.name);

    // Resolve each member's system role so TPA follows the role-based table.
    const names = teamSpecs.map((spec) => spec.name);
    const users: any[] = await User.find({ name: { $in: names } })
      .select('name email role')
      .lean();
    const roleByName = new Map<string, string>();
    for (const user of users || []) {
      const key = String(user?.name || '').trim().toLowerCase();
      if (key && !roleByName.has(key)) roleByName.set(key, String(user?.role || ''));
    }

    const team = teamSpecs.map((spec) => {
      const role = roleByName.get(spec.name.toLowerCase()) || '';
      const me = spec.name.toLowerCase();
      const mine = (tasks || []).filter((task: any) => {
        const assignee = String(task?.assignee || '').trim().toLowerCase();
        const supervisor = String(task?.supervisor || task?.supervisorReviewer || '').trim().toLowerCase();
        const stageMembers = Array.isArray(task?.taskStages)
          ? task.taskStages.map((st: any) => String(st?.staffMember || '').trim().toLowerCase())
          : [];
        return assignee === me || supervisor === me || stageMembers.includes(me);
      });
      const completedMine = mine.filter(
        (task: any) => String(task?.status || '').toLowerCase() === 'completed'
      );

      // Timeliness: average computed timeliness of completed tasks (0–100), mirroring
      // the productivity report (score = 100 − % of SLA consumed).
      const timelinessScores: number[] = [];
      for (const task of completedMine) {
        const stageScores = Array.isArray(task?.taskStages)
          ? task.taskStages
              .map((st: any) => Number(st?.timelinessScore))
              .filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 100)
          : [];
        if (stageScores.length) {
          timelinessScores.push(
            Math.round(stageScores.reduce((a: number, b: number) => a + b, 0) / stageScores.length)
          );
          continue;
        }
        const assignedAt = resolveDeadlineDateTime(task?.startDate || task?.createdAt || task?.updatedAt);
        const completedAt = resolveDeadlineDateTime(task?.completedAt || task?.updatedAt);
        const dueAt = resolveDeadlineDateTime(task?.dueDate);
        if (assignedAt && completedAt && dueAt && dueAt.getTime() > assignedAt.getTime()) {
          const totalMs = dueAt.getTime() - assignedAt.getTime();
          const usedMs = completedAt.getTime() - assignedAt.getTime();
          if (totalMs > 0) {
            const consumed = Math.round((usedMs / totalMs) * 1000) / 10;
            timelinessScores.push(Math.max(0, Math.round(100 - consumed)));
          }
        }
      }

      const qualityScores = completedMine
        .map((task: any) => Number(task?.qualityScore))
        .filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 100);

      const timelinessScore = timelinessScores.length
        ? Math.round((timelinessScores.reduce((a: number, b: number) => a + b, 0) / timelinessScores.length) * 10) / 10
        : null;
      const qualityScore = qualityScores.length
        ? Math.round((qualityScores.reduce((a: number, b: number) => a + b, 0) / qualityScores.length) * 10) / 10
        : null;

      const tpaPercent = getTpaPercent(role);
      // Missing scores never punish the team member — productivity formula default.
      const effectiveTimeliness = timelinessScore ?? 100;
      const effectiveQuality = qualityScore ?? 100;
      const earnedFee = computeEarnedFee(earnedValue, tpaPercent, effectiveTimeliness, effectiveQuality);

      return {
        key: spec.key,
        role: spec.label,
        name: spec.name,
        userRole: role || null,
        tpaPercent,
        timelinessScore,
        qualityScore,
        taskFeeCollected: earnedValue,
        earnedFee,
      };
    });

    return res.json({
      contractValue,
      currency,
      completedPercent,
      earnedValue,
      completedValue,
      collectedAmount: keyActionEarnings.collectedAmount,
      eligibleCollectedValue: keyActionEarnings.eligibleCollectedValue,
      completedKeyActions: keyActionEarnings.completedActions.length,
      keyActions: keyActionEarnings.keyActions,
      missingKeyActionPercentages: keyActionEarnings.missingKeyActionPercentages,
      stages: stages.map((stage) => ({
        ...stage,
        title: stage.title || stage.stageKey || 'Stage',
      })),
      team,
    });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || 'Failed to compute earned fees.' });
  }
};

// Admin endpoint (rarely needed if case creation already initializes)
export const initWorkflowForCase = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const { caseId } = req.params as any;
    const { templateId } = req.body || {};

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    const exists = await WorkflowInstance.findOne({ caseId: c._id });
    if (exists) return res.status(400).json({ message: 'Workflow already exists for this case.' });

    const tId = templateId || c.workflowTemplateId;
    if (!tId) return res.status(400).json({ message: 'Missing templateId.' });

    const template: any = await WorkflowTemplate.findById(tId).lean();
    if (!template) return res.status(404).json({ message: 'Template not found.' });

    const wfStart = resolveDeadlineDateTime((c as any).workflowStartDate || c.createdAt || new Date()) || new Date();
    const steps = buildInstanceSteps(template, wfStart);

    const inst = await WorkflowInstance.create({
      caseId: c._id,
      templateId: template._id,
      status: 'Active',
      currentStepKey: steps[0]?.stepKey,
      steps,
    });

    c.workflowTemplateId = template._id;
    c.workflowInstanceId = inst._id;
    c.matterType = template.matterType;

    await updateCaseWorkflowProgress(c, inst);

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_INSTANCE_CREATED',
      message: 'Workflow initialized from template',
      detail: template.name,
    });

    res.status(201).json(inst);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to initialize workflow.' });
  }
};

// Attach a document to a specific output slot (any case-access user can do this)
export const attachOutputDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { caseId, stepKey, outputKey } = req.params as any;
    const { documentId } = req.body || {};
    if (!documentId) return res.status(400).json({ message: 'Missing documentId' });

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    if (!isAdmin(req.user?.role)) {
      const allowed = await canAssociateLikeAccessCase(req, c);
      if (!allowed) return res.status(403).json({ message: 'Forbidden.' });
    }

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });

    const step = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Step not found.' });

    const out = (step.outputs || []).find((o: any) => o.key === outputKey);
    if (!out) return res.status(404).json({ message: 'Output not found.' });

    const doc: any = await Document.findById(documentId);
    if (!doc) return res.status(404).json({ message: 'Document not found.' });

    out.documentId = doc._id;
    out.uploadedAt = new Date();

    doc.workflowInstanceId = inst._id;
    doc.stepKey = stepKey;
    doc.outputKey = outputKey;
    await doc.save();

    await inst.save();

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_OUTPUT_UPLOADED',
      message: 'Attached deliverable to workflow output',
      detail: `${stepKey} • ${outputKey} • ${doc.name || 'Document'}`,
    });

    res.json(inst);
  } catch {
    res.status(500).json({ message: 'Failed to attach output document.' });
  }
};

// Complete a step (admin only)
export const completeStep = async (req: AuthRequest, res: Response) => {
  try {
    const { caseId, stepKey } = req.params as any;

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    if (!isAdmin(req.user?.role)) {
      const allowed = await canAssociateLikeAccessCase(req, c);
      if (!allowed && !(await canTaskContributorAccessCase(req, c))) {
        return res.status(403).json({ message: 'Forbidden.' });
      }
    }

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });
    const updated = await completeStepInternal(req, c, inst, stepKey);
    res.json(updated);
  } catch (e: any) {
    const status = typeof e?.statusCode === 'number' ? e.statusCode : 500;
    res.status(status).json({
      message: e?.message || 'Failed to complete step.',
      ...(Array.isArray(e?.remainingActions) ? { remainingActions: e.remainingActions } : {}),
    });
  }
};

// Reopen a completed step (admin only)
export const reopenStep = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const { caseId, stepKey } = req.params as any;

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });

    const step = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Step not found.' });
    if (step.status !== 'Completed') return res.status(400).json({ message: 'Step is not completed.' });

    // Reopen the step
    step.status = 'In Progress';
    step.completedAt = undefined;

    // Update current step to this one
    inst.currentStepKey = stepKey;

    // If workflow was completed, set it back to Active
    if (inst.status === 'Completed') {
      inst.status = 'Active';
    }

    await inst.save();
    await updateCaseWorkflowProgress(c, inst);

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_STEP_REOPENED',
      message: 'Reopened workflow step',
      detail: `${stepKey} • ${step.title}`,
    });

    res.json(inst);
  } catch {
    res.status(500).json({ message: 'Failed to reopen step.' });
  }
};

// Amend a workflow step deadline (admin only)
export const extendStepDeadline = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const { caseId, stepKey } = req.params as any;
    const { extendDays, newDueAt, reason } = req.body || {};

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });

    const step = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Step not found.' });
    if (!step.dueAt) return res.status(400).json({ message: 'Step has no due date to extend.' });
    if (step.status === 'Completed') return res.status(400).json({ message: 'Cannot extend a completed step.' });

    const shiftDate = (value?: Date, offsetMs = 0) => {
      if (!value) return undefined;
      const next = new Date(value.getTime() + offsetMs);
      return Number.isFinite(next.getTime()) ? next : undefined;
    };

    const orderedSteps = (inst.steps || []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
    const currentIndex = orderedSteps.findIndex((s: any) => s.stepKey === stepKey);
    const downstreamSteps = currentIndex >= 0 ? orderedSteps.slice(currentIndex + 1) : [];

    const oldDue = new Date(step.dueAt);
    const hasExactDue = Boolean(String(newDueAt || '').trim());
    const exactDue = hasExactDue ? new Date(newDueAt) : undefined;
    const newDue = hasExactDue ? exactDue : shiftDate(oldDue, Math.round(Number(extendDays)) * 24 * 60 * 60 * 1000);
    if (!newDue || !Number.isFinite(newDue.getTime())) {
      return res.status(400).json({ message: 'Resulting due date is invalid.' });
    }
    const dayOffset = (newDue.getTime() - oldDue.getTime()) / (24 * 60 * 60 * 1000);
    step.dueAt = newDue;
    step.extensionHistory = Array.isArray(step.extensionHistory) ? step.extensionHistory : [];
    step.extensionHistory.push({
      previousDueAt: oldDue,
      newDueAt: newDue,
      days: Math.round(dayOffset * 100) / 100,
      reason: String(reason || '').trim(),
      grantedBy: req.user?.name || 'System',
      grantedAt: new Date(),
    });

    const deltaMs = newDue.getTime() - oldDue.getTime();
    for (const downstream of downstreamSteps) {
      if (downstream.startAt) downstream.startAt = shiftDate(downstream.startAt, deltaMs) || downstream.startAt;
      if (downstream.dueAt) downstream.dueAt = shiftDate(downstream.dueAt, deltaMs) || downstream.dueAt;
    }

    await inst.save();
    await updateCaseWorkflowProgress(c, inst);

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_STEP_DEADLINE_EXTENDED',
      message: 'Updated workflow step deadline',
      detail: `${stepKey} • ${dayOffset}d${reason ? ` • ${String(reason).trim()}` : ''}`,
    });

    res.json(inst);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to amend deadline.' });
  }
};

// ---- Stub/placeholder handlers for admin workflow maintenance endpoints ----
// These are intentionally minimal to avoid server startup errors when route
// files import them. Implementations can be expanded later as needed.
export const addStep = async (req: AuthRequest, res: Response) => {
  try {
    // Admin-only: add a step to a workflow instance. Not implemented yet.
    return res.status(501).json({ message: 'Not implemented: addStep' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to add step.' });
  }
};

export const addStepAction = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const { caseId, stepKey } = req.params as any;
    const { text, position } = req.body || {};
    const actionText = String(text || '').trim();
    if (!actionText) {
      return res.status(400).json({ message: 'Action text is required.' });
    }

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });

    const step: any = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Step not found.' });
    if (step.status === 'Completed') return res.status(400).json({ message: 'Cannot modify key actions on a completed step.' });

    const actions = await ensureInstanceStepActions(inst, step);
    const insertAt = Number(position);
    const normalizedPosition = Number.isInteger(insertAt) ? Math.max(0, Math.min(actions.length, insertAt)) : actions.length;
    actions.splice(normalizedPosition, 0, { text: actionText, done: false });

    await inst.save();
    await updateCaseWorkflowProgress(c, inst);

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_STEP_ACTION_ADDED',
      message: 'Added workflow key action',
      detail: `${stepKey} • ${actionText}`,
    });

    return res.json(inst);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to add step action.' });
  }
};

export const updateStep = async (req: AuthRequest, res: Response) => {
  try {
    return res.status(501).json({ message: 'Not implemented: updateStep' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to update step.' });
  }
};

export const deleteStep = async (req: AuthRequest, res: Response) => {
  try {
    return res.status(501).json({ message: 'Not implemented: deleteStep' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to delete step.' });
  }
};

export const updateStepAction = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const { caseId, stepKey, index } = req.params as any;
    const actionIndex = Number(index);
    if (!Number.isInteger(actionIndex) || actionIndex < 0) {
      return res.status(400).json({ message: 'Invalid action index.' });
    }

    const { text } = req.body || {};
    const actionText = String(text || '').trim();
    if (!actionText) {
      return res.status(400).json({ message: 'Action text is required.' });
    }

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });

    const step: any = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Step not found.' });
    if (step.status === 'Completed') return res.status(400).json({ message: 'Cannot modify key actions on a completed step.' });

    const actions = await ensureInstanceStepActions(inst, step);
    const target = actions[actionIndex];
    if (!target) return res.status(404).json({ message: 'Action not found.' });

    target.text = actionText;

    await inst.save();
    await updateCaseWorkflowProgress(c, inst);

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_STEP_ACTION_UPDATED',
      message: 'Updated workflow key action',
      detail: `${stepKey} • ${actionText}`,
    });

    return res.json(inst);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to update step action.' });
  }
};

export const deleteStepAction = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const { caseId, stepKey, index } = req.params as any;
    const actionIndex = Number(index);
    if (!Number.isInteger(actionIndex) || actionIndex < 0) {
      return res.status(400).json({ message: 'Invalid action index.' });
    }

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });

    const step: any = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Step not found.' });
    if (step.status === 'Completed') return res.status(400).json({ message: 'Cannot modify key actions on a completed step.' });

    const actions = await ensureInstanceStepActions(inst, step);
    if (actionIndex >= actions.length) {
      return res.status(404).json({ message: 'Action not found.' });
    }

    const removed = actions.splice(actionIndex, 1)[0];

    // If the step is now fully satisfied, keep workflow progress consistent.
    const allDone = actions.length === 0 || actions.every((a: any) => a?.done === true);
    if (allDone && step.status !== 'Completed') {
      const updated = await completeStepInternal(req, c, inst, stepKey);
      const actor = actorFromReq(req);
      await writeAudit({
        caseId: String(c._id),
        actorName: actor.actorName,
        ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
        action: 'WORKFLOW_STEP_ACTION_DELETED',
        message: 'Deleted workflow key action',
        detail: `${stepKey} • ${removed?.text || 'Action removed'}`,
      });
      return res.json(updated);
    }

    await inst.save();
    await updateCaseWorkflowProgress(c, inst);

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_STEP_ACTION_DELETED',
      message: 'Deleted workflow key action',
      detail: `${stepKey} • ${removed?.text || 'Action removed'}`,
    });

    return res.json(inst);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to delete step action.' });
  }
};

export const auditCaseWorkflowMismatches = async (req: AuthRequest, res: Response) => {
  try {
    return res.status(501).json({ message: 'Not implemented: auditCaseWorkflowMismatches' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to audit mismatches.' });
  }
};

export const fixCaseWorkflowMismatches = async (req: AuthRequest, res: Response) => {
  try {
    return res.status(501).json({ message: 'Not implemented: fixCaseWorkflowMismatches' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to fix mismatches.' });
  }
};

// Toggle a key action checkbox (admin only)
export const toggleStepAction = async (req: AuthRequest, res: Response) => {
  try {
    const { caseId, stepKey, index } = req.params as any;
    const actionIndex = Number(index);
    if (!Number.isInteger(actionIndex) || actionIndex < 0) {
      return res.status(400).json({ message: 'Invalid action index.' });
    }

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    if (!isAdmin(req.user?.role)) {
      if (!isPublicYellowCase(c)) {
        const allowed = await canAssociateLikeAccessCase(req, c);
        if (!allowed && !(await canTaskContributorAccessCase(req, c))) {
          return res.status(403).json({ message: 'Forbidden.' });
        }
      }
    }

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });

    const step: any = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Step not found.' });

    // Backfill actions from template if needed
    if (!Array.isArray(step.actions) || step.actions.length === 0) {
      const t: any = await WorkflowTemplate.findById(inst.templateId).lean();
      const templateStep = (t?.steps || []).find((x: any) => x.key === stepKey);
      step.actions = (templateStep?.actions || []).map((text: any) => ({ text: String(text || '').trim(), done: false }));
    }

    const actions = Array.isArray(step.actions) ? step.actions : [];
    const target = actions[actionIndex];
    if (!target) return res.status(404).json({ message: 'Action not found.' });

    const nextDone = !Boolean(target.done);
    if (nextDone) {
      const orderedSteps = (inst.steps || []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
      const flatActions = orderedSteps.flatMap((orderedStep: any) =>
        (orderedStep.actions || []).map((action: any, idx: number) => ({
          step: orderedStep,
          action,
          idx,
          key: orderedStep.stepKey,
        }))
      );
      const currentFlatIndex = flatActions.findIndex((item: any) => item.key === stepKey && item.idx === actionIndex);
      const previousIncomplete = flatActions.slice(0, currentFlatIndex).find((item: any) => !item.action?.done);
      if (previousIncomplete) {
        return res.status(400).json({ message: 'Complete the previous key action first.' });
      }
    }

    target.done = nextDone;
    target.doneAt = nextDone ? new Date() : undefined;

    if (step.status === 'Not Started') step.status = 'In Progress';
    if (!nextDone) {
      const orderedSteps = (inst.steps || []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
      const stepIndex = orderedSteps.findIndex((orderedStep: any) => orderedStep.stepKey === stepKey);
      for (const orderedStep of orderedSteps.slice(stepIndex)) {
        const actionsToReset = orderedStep.stepKey === stepKey
          ? (orderedStep.actions || []).slice(actionIndex + 1)
          : (orderedStep.actions || []);
        for (const action of actionsToReset) {
          action.done = false;
          action.doneAt = undefined;
        }
        if (orderedStep.stepKey === stepKey) {
          orderedStep.status = 'In Progress';
          orderedStep.completedAt = undefined;
        } else {
          orderedStep.status = 'Not Started';
          orderedStep.completedAt = undefined;
        }
      }
      inst.status = 'Active';
      inst.currentStepKey = stepKey;
    }

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_STEP_ACTION_TOGGLED',
      message: 'Updated workflow key action',
      detail: `${stepKey} • ${target.text} • ${nextDone ? 'done' : 'not done'}`,
    });

    // If all key actions are done, auto-complete the step (and update case progress/billing)
    const allDone = actions.length === 0 || actions.every((a: any) => a?.done === true);
    if (allDone && step.status !== 'Completed') {
      const updated = await completeStepInternal(req, c, inst, stepKey);
      return res.json(updated);
    }

    await inst.save();
    await updateCaseWorkflowProgress(c, inst);
    res.json(inst);
  } catch (e: any) {
    const status = typeof e?.statusCode === 'number' ? e.statusCode : 500;
    res.status(status).json({
      message: e?.message || 'Failed to update key action.',
      ...(Array.isArray(e?.remainingActions) ? { remainingActions: e.remainingActions } : {}),
    });
  }
};
