import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import WorkflowTemplate from '../models/workflowTemplateModel';
import WorkflowInstance, { isStepWorkDone } from '../models/workflowInstanceModel';
import Case from '../models/caseModel';
import Invoice from '../models/invoiceModel';
import Document from '../models/documentModel';
import Task from '../models/taskModel';
import User from '../models/userModel';
import { writeAudit } from '../services/auditService';
import { createNotification, sendSms } from '../services/notifyService';
import { sendEmailResend } from '../services/emailResendService';
import { buildInstanceSteps, isStepChecklistReadyToAutoComplete } from '../utils/workflowCompute';
import { resolveDeadlineDateTime } from '../utils/deadlineUtils';
import {
  buildRoleByName,
  computeCompletedPercentFromInstance,
  computeEarnedFee,
  computeStageBreakdownFromInstance,
  getTpaPercent,
  normalizeTemplatePercentages,
  parsePercentage,
} from '../utils/workflowPercentages';
import { getCaseUrgencyColor, isPublicYellowCase } from '../utils/caseVisibility';
import { caseMatchesAssignee } from '../utils/caseAssignments';
import {
  canManageWorkflowStepsOfCase as canManageWorkflowStepsOfCaseFor,
  resolveAssignedSlot,
} from '../utils/caseAssignmentPermissions';
import { calculateCollectedKeyActionEarnings } from '../utils/keyActionEarnings';
import { computeCaseEarnedFees } from '../utils/caseEarnedFees';
import { normalizeTemplateActionText } from '../utils/workflowText';
import { alignInstanceStepsToTemplate, hasSupersededTemplateSteps } from '../utils/workflowAlignment';
import {
  buildCanonicalTemplateIndex,
  resolveCanonicalTemplateForCase,
  templateCanonicalGroupKey,
} from '../utils/workflowTemplateMatch';

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
  actorEmail: req.user?.email as string | undefined,
  actorRole: req.user?.role as string | undefined,
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

/** A completed workflow is a terminal matter state, even if an older write left
 * the instance status behind after every step had already been completed. */
export const isWorkflowInstanceCompleted = (inst: any) => {
  if (String(inst?.status || '').trim() === 'Completed') return true;
  const steps = Array.isArray(inst?.steps) ? inst.steps : [];
  return steps.length > 0 && steps.every((step: any) => String(step?.status || '') === 'Completed');
};

const isClosedCaseWorkflow = (caseDoc: any, inst?: any) =>
  String(caseDoc?.status || '').trim().toLowerCase() === 'closed' ||
  String(caseDoc?.workflowProgress?.status || '').trim() === 'Completed' ||
  isWorkflowInstanceCompleted(inst);

/**
 * Rebuild an instance's steps from the template WITHOUT discarding case data.
 *
 * Template edits are merged in place:
 * - key actions (checklists) are matched by TEXT, never by position, so a
 *   reorder in the template can never move a case's ticks to another action;
 * - key actions added on the case itself are kept;
 * - case steps that the template no longer defines are kept instead of being
 *   silently deleted;
 * - a percentage that is genuinely absent from the template never zeroes the
 *   value the case already stored (an intentional 0% is still honoured).
 */
export const buildUpdatedInstanceSteps = (existingSteps: any[] | undefined, template: any, startDate: Date) => {
  const builtSteps = buildInstanceSteps(template, startDate);
  const existingByKey = new Map((existingSteps || []).map((step: any) => [String(step.stepKey), step]));
  const templateStepByKey = new Map<string, any>(
    (Array.isArray(template?.steps) ? template.steps : []).map((step: any) => [String(step?.key || ''), step] as [string, any])
  );
  const templateStageByKey = new Map<string, any>(
    (Array.isArray(template?.stages) ? template.stages : []).map((stage: any) => [String(stage?.key || ''), stage] as [string, any])
  );

  const mergedSteps = builtSteps.map((nextStep: any) => {
    const previous = existingByKey.get(String(nextStep.stepKey));

    const templateStep = templateStepByKey.get(String(nextStep.stepKey));
    const templateStage = templateStageByKey.get(String(nextStep.stageKey));
    const templateStepPercentage = parsePercentage(templateStep?.percentage);
    const templateStagePercentage = parsePercentage(templateStage?.percentage);

    return {
      ...nextStep,
      percentage:
        templateStepPercentage === undefined && Number(previous?.percentage) > 0
          ? Number(previous.percentage)
          : nextStep.percentage,
      stagePercentage:
        templateStagePercentage === undefined && Number(previous?.stagePercentage) > 0
          ? Number(previous.stagePercentage)
          : nextStep.stagePercentage,
      status: previous?.status || nextStep.status,
      completedAt: previous?.completedAt,
      extensionHistory: Array.isArray(previous?.extensionHistory) ? previous.extensionHistory : [],
      actions: [],
      outputs: nextStep.outputs,
    };
  });

  // Steps the template no longer defines stay on the case with their progress.
  const builtKeys = new Set(builtSteps.map((step: any) => String(step?.stepKey)));
  const removedFromTemplate = (existingSteps || [])
    .filter((step: any) => !builtKeys.has(String(step?.stepKey)))
    .map((step: any) => ({ ...step }));

  return [...mergedSteps, ...removedFromTemplate].sort((a, b) => (a.order || 0) - (b.order || 0));
};

const syncCaseWorkflowInstanceFromTemplate = async (caseId: string, template: any, wfStart: Date) => {
  const inst: any = await WorkflowInstance.findOne({ caseId });
  if (!inst) return null;

  // A completed matter is an immutable workflow snapshot. A later edit to the
  // shared template must never append work to it or make it active again.
  if (isWorkflowInstanceCompleted(inst)) return inst;

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

/**
 * Template lookups used on every case-workspace read.
 *
 * Reconciling an instance with its canonical template needs the linked template
 * plus the canonical template of its matter type. Both used to be separate
 * queries on EVERY workflow / Case Management read, which is exactly the
 * latency users felt when opening a matter. The template collection is small
 * (dozens of documents) and only changes when an administrator edits it, so it
 * is cached for a short window and invalidated by the template endpoints.
 */
const TEMPLATE_INDEX_TTL_MS = 30_000;
let templateIndexCache: {
  at: number;
  all: any[];
  byId: Map<string, any>;
  canonical: Map<string, any>;
} | null = null;

const invalidateTemplateIndexCache = () => {
  templateIndexCache = null;
};

const loadTemplateIndex = async () => {
  if (templateIndexCache && Date.now() - templateIndexCache.at < TEMPLATE_INDEX_TTL_MS) {
    return templateIndexCache;
  }
  const templates: any[] = await WorkflowTemplate.find({})
    .select('_id name matterType caseType version active draft updatedAt')
    .lean();
  templateIndexCache = {
    at: Date.now(),
    all: templates,
    byId: new Map(templates.map((template: any) => [String(template._id), template])),
    canonical: buildCanonicalTemplateIndex(templates),
  };
  return templateIndexCache;
};

/**
 * Re-link a case workflow to its canonical template and align the checklist.
 *
 * Cases keep whatever template they were created with. When that template is
 * deleted, replaced by a re-import (new _id) or shadowed by a duplicate, the
 * Case Workspace would keep showing the old Key Actions while Templates
 * settings shows the maintained one â€” the exact mismatch reported for matters
 * such as Civil Litigation. This resolver always points the case at the single
 * canonical template for its matter type + case type (published, newest
 * version, most recently updated) and rebuilds the checklist from it without
 * losing ticks, deadlines or completed work.
 *
 * Returns null when nothing needed to change (or the matter is closed).
 * `dryRun` reports the plan without writing; `force` also cleans drift on a
 * case that already follows the canonical template; `pruneLegacy` additionally
 * removes completed work that belonged to the old template (opt-in, audited).
 */
export const reconcileInstanceTemplateWithCanonical = async (
  caseDoc: any,
  inst: any,
  options: { force?: boolean; dryRun?: boolean; pruneLegacy?: boolean } = {}
) => {
  if (!caseDoc || !inst) return null;
  // A completed matter is an immutable workflow snapshot.
  if (isClosedCaseWorkflow(caseDoc, inst)) return null;

  const templateIndex = await loadTemplateIndex();
  const linkedId = inst.templateId ? String(inst.templateId) : '';
  const linked: any = linkedId ? templateIndex.byId.get(linkedId) || null : null;

  let targetId = '';
  if (linked) {
    const canonical: any = templateIndex.canonical.get(
      templateCanonicalGroupKey(linked.matterType, linked.caseType)
    );
    targetId = canonical && String(canonical._id) !== linkedId ? String(canonical._id) : linkedId;
    // Already canonical: still repair when the case carries steps the template no
    // longer defines. A matter drifts exactly like this when an earlier alignment
    // kept the old template's steps; without this check the stale entries stay on
    // the checklist forever.
    if (targetId === linkedId && !options.force && !hasSupersededTemplateSteps(inst.steps, linked)) {
      return null;
    }
  } else {
    const target: any =
      resolveCanonicalTemplateForCase(templateIndex.all, {
        matterType: caseDoc.workflow,
        caseType: caseDoc.caseType,
      }) ||
      resolveCanonicalTemplateForCase(templateIndex.all, {
        matterType: caseDoc.matterType,
        caseType: caseDoc.caseType,
      }) ||
      resolveCanonicalTemplateForCase(templateIndex.all, { name: caseDoc.workflow, caseType: caseDoc.caseType });
    if (!target) return null;
    targetId = String(target._id);
  }

  const template: any = await WorkflowTemplate.findById(targetId).lean();
  if (!template) return null;

  const wfStart =
    resolveDeadlineDateTime(caseDoc.workflowStartDate || caseDoc.createdAt || new Date()) || new Date();
  const { steps, archivedSteps, archivedActions, summary } = alignInstanceStepsToTemplate(inst.steps, template, wfStart, {
    keepLegacyProgress: !options.pruneLegacy,
  });

  // Preserve any previously archived work and merge the newly superseded steps,
  // keyed by stepKey, so repeated repairs can never lose a record.
  const archivedByKey = new Map<string, any>();
  for (const step of Array.isArray(inst.archivedSteps) ? inst.archivedSteps : []) {
    const key = String(step?.stepKey || '');
    if (key) archivedByKey.set(key, step);
  }
  for (const step of archivedSteps) {
    const key = String(step?.stepKey || '');
    if (key && !archivedByKey.has(key)) archivedByKey.set(key, step);
  }
  const mergedArchivedSteps = Array.from(archivedByKey.values());

  // The same safety net for checklist items the template no longer defines: a
  // ticked case-only Key Action is archived by step + text, so repeated repairs
  // can never lose or duplicate the record of the finished work.
  const archivedActionKey = (action: any) =>
    `${String(action?.stepKey || '')}::${String(action?.text || '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
  const archivedActionsByKey = new Map<string, any>();
  for (const action of Array.isArray(inst.archivedActions) ? inst.archivedActions : []) {
    const key = archivedActionKey(action);
    if (key !== '::') archivedActionsByKey.set(key, action);
  }
  for (const action of archivedActions) {
    const key = archivedActionKey(action);
    if (key !== '::' && !archivedActionsByKey.has(key)) archivedActionsByKey.set(key, action);
  }
  const mergedArchivedActions = Array.from(archivedActionsByKey.values());

  const changed =
    String(inst.templateId || '') !== String(targetId) ||
    summary.addedTemplateSteps > 0 ||
    summary.addedActions > 0 ||
    summary.droppedSteps.length > 0 ||
    summary.droppedActions.length > 0 ||
    archivedSteps.length > 0 ||
    archivedActions.length > 0;
  if (!changed) return null;
  if (options.dryRun) {
    return { template, summary, changed, steps, archivedSteps: mergedArchivedSteps, archivedActions: mergedArchivedActions };
  }

  const tracked = inst.currentStepKey
    ? steps.find((step: any) => step.stepKey === inst.currentStepKey)
    : null;
  // A tracked step that has just been archived must not remain the current step.
  const nextCurrentStepKey =
    tracked && tracked.status !== 'Completed'
      ? tracked.stepKey
      : steps.find((step: any) => step.status !== 'Completed')?.stepKey || steps[0]?.stepKey;

  inst.templateId = template._id;
  inst.steps = steps;
  inst.currentStepKey = nextCurrentStepKey;
  await inst.save();
  // Written explicitly as well: the archives are the safety net for work that is
  // no longer on the checklist, so they must never depend on schema casting to land.
  await inst.collection.updateOne(
    { _id: inst._id },
    { $set: { archivedSteps: mergedArchivedSteps, archivedActions: mergedArchivedActions } }
  );
  inst.archivedSteps = mergedArchivedSteps;
  inst.archivedActions = mergedArchivedActions;

  caseDoc.workflowTemplateId = template._id;
  caseDoc.matterType = template.matterType;
  caseDoc.caseType = template.caseType;
  caseDoc.workflow = template.matterType;
  if (!caseDoc.workflowStartDate) caseDoc.workflowStartDate = wfStart;
  await updateCaseWorkflowProgress(caseDoc, inst);

  await writeAudit({
    caseId: String(caseDoc._id),
    actorName: 'System',
    action: 'WORKFLOW_TEMPLATE_ALIGNED',
    message: 'Workflow checklist aligned with the current template',
    detail:
      `${String(template.name || template.matterType)} â€¢ ` +
      `${summary.addedTemplateSteps} new step(s), -${summary.droppedSteps.length} stale step(s), ` +
      `-${summary.droppedActions.length} stale key action(s)` +
      (summary.keptLegacySteps.length || summary.archivedLegacyActions.length
        ? `, archived ${summary.keptLegacySteps.length} superseded step(s) and ${summary.archivedLegacyActions.length} superseded completed key action(s)`
        : '') +
      (options.pruneLegacy && (summary.droppedSteps.length || summary.droppedActions.length)
        ? `, pruned legacy work: ${[...summary.droppedSteps, ...summary.droppedActions].slice(0, 12).join(' | ')}`
        : ''),
  });

  return { template, summary, steps, archivedSteps: mergedArchivedSteps, archivedActions: mergedArchivedActions };
};


const computeNextDueAt = (inst: any) => {
  const pending = (inst.steps || [])
    .filter((s: any) => s.status !== 'Completed')
    .slice()
    .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))[0];
  return pending?.dueAt;
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
  // Progress reflects the ACTIVE checklist only. Steps that belonged to a
  // superseded template are no longer part of the workflow, so counting their
  // ticks here is exactly what made the bar report progress while the visible
  // checklist showed nothing ticked.
  const activeSteps = (inst.steps || []).filter((step: any) => !step?.archivedFromTemplate);
  const actions = activeSteps.flatMap((step: any) => (Array.isArray(step.actions) ? step.actions : []));
  const checkedActions = actions.filter((action: any) => Boolean(action?.done)).length;
  const actionTotal = actions.length;
  const actionPercent = actionTotal > 0 ? Math.round((checkedActions / actionTotal) * 100) : 0;

  // Stage-weighted completion percent â€” the source of truth for earned fees.
  // Completed steps are weighted by their stage's percentage of the workflow.
  const stageBreakdown = computeStageBreakdownFromInstance(activeSteps);
  const stageWeightedPercent = computeCompletedPercentFromInstance(activeSteps);
  // Completed steps (stage-weighted) are the source of truth on their own: the
  // per-step sub-checklist is retired, so a completed step earns its value even
  // though no checklist ticks exist.
  const percent = stageWeightedPercent > 0 ? stageWeightedPercent : checkedActions > 0 ? actionPercent : 0;
  const completedValueAmount = Math.round((existingPlannedAmount * percent) / 100);

  // Once the case itself is closed, preserve that terminal state. The explicit
  // reopen-step endpoint changes the case back to In Progress before calling
  // this function, so normal synchronization can never reopen it by accident.
  const workflowCompleted =
    isWorkflowInstanceCompleted(inst) ||
    String(c?.status || '').trim().toLowerCase() === 'closed' ||
    String(c?.workflowProgress?.status || '').trim() === 'Completed';
  c.workflowProgress = {
    status: workflowCompleted ? 'Completed' : 'In Progress',
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

  if (workflowCompleted) {
    c.status = 'Closed';
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

const completeStepInternal = async (
  actor: { actorName: string; actorUserId?: string | undefined; actorEmail?: string | undefined; actorRole?: string | undefined },
  c: any,
  inst: any,
  stepKey: string,
  options?: { finalApproval?: boolean }
) => {
  const step = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
  if (!step) throw new Error('Step not found.');

  // Ticking a Key Action records that the WORK IS DONE - it is neither an
  // approval nor a submission. Without a distinct 'Done' state a tick either
  // jumped straight past the review chain (leaving the Reviewer nothing to do)
  // or could not be sent to the Reviewer at all. Now the Initiator can submit a
  // ticked Key Action, the Reviewer forwards it to the Signer/Approver, and only
  // an approval writes 'Completed'.
  const previousStepStatus = step.status;

  const finalApproval = Boolean(options?.finalApproval);
  const orderedSteps = (inst.steps || []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

  if (finalApproval) {
    // Signed off by the Approver.
    step.status = 'Completed';
    step.completedAt = new Date();
  } else {
    // Work ticked as done by the assigned member; ready to be submitted.
    step.status = 'Done';
    step.completedAt = undefined;
  }

  // `currentStepKey` tracks the action still in flight through the review chain:
  // it stays on the ticked action until it is APPROVED, then moves on. Ticking
  // does not have to wait for the Reviewer or Approver - the next Key Action
  // unlocks immediately, because "work done" (what ticking records) is checked
  // separately from "approved" when deciding what may be ticked next.
  if (step.status === 'Completed') {
    const nextOpen = orderedSteps.find((candidate: any) => String(candidate.status || '') !== 'Completed');
    if (nextOpen) {
      inst.currentStepKey = nextOpen.stepKey;
      if (nextOpen.status === 'Not Started') nextOpen.status = 'In Progress';
      inst.status = 'Active';
    } else {
      inst.currentStepKey = undefined;
      inst.status = 'Completed';
    }
  } else {
    inst.status = 'Active';
    inst.currentStepKey = stepKey;
  }

  await inst.save();

  // Capture previous case workflow status for auditing
  const previousCaseWorkflowStatus = c.workflowProgress?.status;

  await updateCaseWorkflowProgress(c, inst);

  // Include stage transition info when available
  const prevStage = (inst.steps || []).find((s: any) => s.stepKey === stepKey)?.stageKey || 'unknown';
  const newStage = (() => {
    if (!inst.currentStepKey) return undefined;
    const ref = (inst.steps || []).find((s: any) => s.stepKey === inst.currentStepKey);
    return ref?.stageKey;
  })();

  const stepDetailParts = [`${stepKey} â€¢ ${step.title}`];
  if (previousStepStatus) stepDetailParts.push(`from ${previousStepStatus} to ${step.status}`);
  if (prevStage && newStage && prevStage !== newStage) stepDetailParts.push(`stage: ${prevStage} â†’ ${newStage}`);

  await writeAudit({
    caseId: String(c._id),
    actorName: actor.actorName,
    ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
    action: 'WORKFLOW_STEP_COMPLETED',
    message: 'Completed workflow step',
    detail: stepDetailParts.join(' â€¢ '),
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
      detail: `Workflow status: ${previousCaseWorkflowStatus || 'unknown'} â†’ ${newCaseWorkflowStatus}`,
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

/**
 * Completes, in workflow order, every section whose checklist is fully ticked.
 *
 * This is the automatic version of the big completion checkbox on the Case
 * Workspace Overview: as soon as every Key Action of a section is ticked the
 * section is marked complete, so members who may tick Key Actions but cannot
 * tick the section checkbox (interns, trainees, associates) can still finish a
 * section â€” and unlock the next one. The ordered walk also clears any earlier
 * section left fully ticked but pending, and stops at the first section that
 * still has pending Key Actions or is awaiting review/approval.
 *
 * Returns the stepKeys that were completed by this pass.
 */
export const autoCompleteFullyCheckedSteps = async (
  actor: { actorName: string; actorUserId?: string | undefined },
  c: any,
  inst: any
): Promise<string[]> => {
  const ordered = (inst.steps || []).slice().sort((a: any, b: any) => (a?.order || 0) - (b?.order || 0));
  const completedKeys: string[] = [];
  for (const step of ordered) {
    if (String(step?.status || '') === 'Completed') continue;
    if (!isStepChecklistReadyToAutoComplete(step)) break;
    await completeStepInternal(actor, c, inst, step.stepKey);
    completedKeys.push(String(step?.stepKey || ''));
  }
  return completedKeys;
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

/**
 * Overview-tab write permission (tick a Key Action, amend a deadline).
 * Delegates to the shared predicate so the API and the Case Workspace UI can
 * never disagree about who may do this.
 */
const canManageWorkflowStepsOfCase = (req: AuthRequest, foundCase: any) =>
  canManageWorkflowStepsOfCaseFor(foundCase, req.user);

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

    // Keep the stored Key Action text clean: remove any manually entered
    // numbering from the actions/titles before persisting.
    normalizeTemplateActionText(payload);

    // Preserve literal stage and key-action percentages exactly as supplied.
    normalizeTemplatePercentages(payload);

    const created = await WorkflowTemplate.create(payload);
    invalidateTemplateIndexCache();
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
    if (!before) return res.status(404).json({ message: 'Template not found.' });

    // Templates are submitted as a complete document. Without a revision
    // check, an older browser tab can overwrite key actions and percentages
    // that somebody else saved in the meantime. The editor sends the value it
    // originally loaded, so reject stale saves instead of silently losing data.
    const { expectedUpdatedAt, ...submittedPayload } = req.body || {};
    if (!expectedUpdatedAt) {
      return res.status(409).json({ message: 'This workflow is out of date. Refresh it before saving.' });
    }
    const expectedUpdatedAtMs = new Date(String(expectedUpdatedAt)).getTime();
    if (!Number.isFinite(expectedUpdatedAtMs) || expectedUpdatedAtMs !== new Date((before as any).updatedAt).getTime()) {
      return res.status(409).json({ message: 'This workflow was changed by someone else. Refresh it before saving.' });
    }

    const payload: any = { ...submittedPayload };
    payload.stages = Array.isArray(payload.stages)
      ? payload.stages.map(({ fee: _fee, ...stage }: any) => stage)
      : payload.stages;
    payload.steps = Array.isArray(payload.steps)
      ? payload.steps.map(({ fee: _fee, ...step }: any) => step)
      : payload.steps;
    if (payload.draft) payload.active = false;
    const validationError = payload.draft ? allocationValidationError(payload) : publicationValidationError(payload);
    if (validationError) return res.status(400).json({ message: validationError });

    // Keep the stored Key Action text clean: remove any manually entered
    // numbering from the actions/titles before persisting.
    normalizeTemplateActionText(payload);

    // Normalize literal percentages without redistributing them.
    normalizeTemplatePercentages(payload);

    const updated = await WorkflowTemplate.findOneAndUpdate(
      { _id: templateId, updatedAt: new Date(expectedUpdatedAtMs) },
      payload,
      { new: true, runValidators: true }
    );
    if (!updated) {
      return res.status(409).json({ message: 'This workflow was changed by someone else. Refresh it before saving.' });
    }
    invalidateTemplateIndexCache();

    // Drafts are allowed to be incomplete, so they must never rewrite the
    // workflows of live cases. Cases are synced when the workflow is published.
    if (!updated.draft) {
      const affectedCases = await Case.find({ workflowTemplateId: templateId })
        .select('_id workflowStartDate createdAt status workflowProgress')
        .lean();
      await Promise.all((affectedCases as any[]).map(async (matter) => {
        // Do not synchronize a completed/closed case from a mutable shared
        // template. This was the path that turned closed matters back into
        // active matters and made their old due dates appear overdue.
        if (isClosedCaseWorkflow(matter)) return;
        const wfStart = resolveDeadlineDateTime(matter.workflowStartDate || matter.createdAt || new Date()) || new Date();
        const inst = await syncCaseWorkflowInstanceFromTemplate(String(matter._id), updated, wfStart);
        if (!inst) return;

        if (isWorkflowInstanceCompleted(inst)) return;

        const caseDoc: any = await Case.findById(matter._id);
        if (!caseDoc) return;
        if (isClosedCaseWorkflow(caseDoc, inst)) return;
        caseDoc.workflowTemplateId = updated._id as any;
        caseDoc.matterType = updated.matterType;
        caseDoc.workflow = updated.matterType;
        caseDoc.workflowStartDate = wfStart;
        await updateCaseWorkflowProgress(caseDoc, inst);
      }));
    }

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
    invalidateTemplateIndexCache();

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

    // âœ… Self-heal: a case created against a template that was later deleted,
    // re-imported or replaced by a duplicate is re-linked to the canonical
    // template here, so the checklist always matches Templates settings.
    try {
      await reconcileInstanceTemplateWithCanonical(c, inst);
    } catch {
      // A reconciliation failure must never block reading the workflow.
    }

    res.json(inst.toObject());
  } catch {
    res.status(500).json({ message: 'Failed to load workflow.' });
  }
};

// ---------- Earned fees (Firm Reports â†’ Productivity formula per matter) ----------
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
    // percentage on their steps â€” derive them from the template so percentages
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

    // Resolve each member's system role so TPA follows the role-based table.
    // The users collection is small and is loaded whole: matching by name with
    // a case-sensitive `$in` used to leave members without their TPA whenever
    // their stored name differed in case, spacing or carried a role suffix.
    const users: any[] = await User.find({}).select('name role').lean();
    const roleByName = buildRoleByName(users);

    const result = computeCaseEarnedFees({
      caseDoc: c,
      template,
      workflowInstance: { ...(inst || {}), steps: effectiveSteps },
      tasks,
      collectedAmount,
      roleByName,
    });

    return res.json({
      ...result,
      stages: result.stages.map((stage) => ({
        ...stage,
        title: String(stage.title || stage.stageKey || 'Stage'),
      })),
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
      detail: `${stepKey} â€¢ ${outputKey} â€¢ ${doc.name || 'Document'}`,
    });

    res.json(inst);
  } catch {
    res.status(500).json({ message: 'Failed to attach output document.' });
  }
};

// Key-action completion is also used by Case Management (Signer/Approver
// approval) so the same timeline, progress and audit path is kept.
export { completeStepInternal as completeStepForCase };

// Complete a step (admin only)
export const completeStep = async (req: AuthRequest, res: Response) => {
  try {
    const { caseId, stepKey } = req.params as any;

    // Complete a Key Action (admin, or the matter's assigned members).
    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    if (!canManageWorkflowStepsOfCase(req, c)) {
      return res.status(403).json({ message: 'Only the members assigned to this matter can complete its Key Actions.' });
    }

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });

    // The Overview controls the visible, stage-by-stage sequence. Completion
    // here deliberately does not impose a second order guard: a tick must not
    // be rejected merely because a template stores interleaved step orders.
    const updated = await completeStepInternal(actorFromReq(req), c, inst, stepKey);
    res.json(updated);
  } catch (e: any) {
    const status = typeof e?.statusCode === 'number' ? e.statusCode : 500;
    res.status(status).json({
      message: e?.message || 'Failed to complete step.',
      ...(Array.isArray(e?.remainingActions) ? { remainingActions: e.remainingActions } : {}),
    });
  }
};

// Reopen a completed step (admin, or the matter's assigned members)
export const reopenStep = async (req: AuthRequest, res: Response) => {
  try {
    const { caseId, stepKey } = req.params as any;

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    if (!canManageWorkflowStepsOfCase(req, c)) {
      return res.status(403).json({ message: 'Only the members assigned to this matter can reopen its Key Actions.' });
    }

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });

    const wasCompletedMatter = isClosedCaseWorkflow(c, inst);
    const step = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Step not found.' });
    // Reopening applies to any ticked Key Action: 'Done' (work recorded but not
    // yet approved) as well as 'Completed'. Checking only 'Completed' made a
    // freshly ticked action impossible to undo.
    if (!isStepWorkDone(step)) return res.status(400).json({ message: 'This Key Action has not been ticked as done yet.' });

    // Reopen the step
    step.status = 'In Progress';
    step.completedAt = undefined;
    step.submittedAt = undefined;
    step.reviewedAt = undefined;

    // Update current step to this one
    inst.currentStepKey = stepKey;

    // If workflow was completed, set it back to Active
    if (inst.status === 'Completed') {
      inst.status = 'Active';
    }

    await inst.save();
    // Reopening a step is the one explicit operation that may reopen a
    // completed matter. All regular template/case saves preserve Closed.
    if (wasCompletedMatter) c.status = 'In Progress';
    await updateCaseWorkflowProgress(c, inst);

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_STEP_REOPENED',
      message: 'Reopened workflow step',
      detail: `${stepKey} â€¢ ${step.title}`,
    });

    res.json(inst);
  } catch {
    res.status(500).json({ message: 'Failed to reopen step.' });
  }
};

// Amend a workflow step deadline (admin, or the matter's assigned members)
export const extendStepDeadline = async (req: AuthRequest, res: Response) => {
  try {
    const { caseId, stepKey } = req.params as any;
    const { extendDays, newDueAt, reason } = req.body || {};

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    if (!canManageWorkflowStepsOfCase(req, c)) {
      return res.status(403).json({ message: 'Only the members assigned to this matter can amend its deadlines.' });
    }

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
      detail: `${stepKey} â€¢ ${dayOffset}d${reason ? ` â€¢ ${String(reason).trim()}` : ''}`,
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
    if (isClosedCaseWorkflow(c, inst)) {
      return res.status(400).json({ message: 'Reopen the workflow step before changing a completed matter.' });
    }

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
      detail: `${stepKey} â€¢ ${actionText}`,
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
    if (isClosedCaseWorkflow(c, inst)) {
      return res.status(400).json({ message: 'Reopen the workflow step before changing a completed matter.' });
    }

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
      detail: `${stepKey} â€¢ ${actionText}`,
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
    if (isClosedCaseWorkflow(c, inst)) {
      return res.status(400).json({ message: 'Reopen the workflow step before changing a completed matter.' });
    }

    const step: any = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Step not found.' });
    if (step.status === 'Completed') return res.status(400).json({ message: 'Cannot modify key actions on a completed step.' });

    const actions = await ensureInstanceStepActions(inst, step);
    if (actionIndex >= actions.length) {
      return res.status(404).json({ message: 'Action not found.' });
    }

    const removed = actions.splice(actionIndex, 1)[0];

    // Deleting a pending Key Action can leave the section's checklist fully
    // ticked: run the same ordered auto-complete pass as ticking the last Key
    // Action, so the big completion checkbox on the Case Workspace Overview is
    // checked automatically. A section left without any Key Action is never
    // auto-completed â€” nothing proves the work is done.
    const actor = actorFromReq(req);
    const autoCompletedKeys = await autoCompleteFullyCheckedSteps(actor, c, inst);
    if (autoCompletedKeys.length > 0) {
      await writeAudit({
        caseId: String(c._id),
        actorName: actor.actorName,
        ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
        action: 'WORKFLOW_STEP_ACTION_DELETED',
        message: 'Deleted workflow key action',
        detail: `${stepKey} â€¢ ${removed?.text || 'Action removed'}`,
      });
      return res.json(inst);
    }

    await inst.save();
    await updateCaseWorkflowProgress(c, inst);

    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_STEP_ACTION_DELETED',
      message: 'Deleted workflow key action',
      detail: `${stepKey} â€¢ ${removed?.text || 'Action removed'}`,
    });

    return res.json(inst);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to delete step action.' });
  }
};

const scanWorkflowMismatches = async () => {
  const cases: any[] = await Case.find({})
    .select('_id caseNo parties status workflowProgress')
    .lean();
  const caseIds = cases.map((caseDoc: any) => caseDoc._id);
  const instances: any[] = caseIds.length
    ? await WorkflowInstance.find({ caseId: { $in: caseIds } }).lean()
    : [];
  const instanceByCaseId = new Map(instances.map((inst: any) => [String(inst.caseId), inst]));
  const mismatches: any[] = [];

  for (const caseDoc of cases) {
    const inst = instanceByCaseId.get(String(caseDoc._id));
    const caseMarkedComplete =
      String(caseDoc.status || '').trim().toLowerCase() === 'closed' ||
      String(caseDoc.workflowProgress?.status || '').trim() === 'Completed';
    if (!inst) {
      if (caseMarkedComplete) {
        mismatches.push({
          caseId: String(caseDoc._id), caseNo: caseDoc.caseNo, parties: caseDoc.parties,
          issue: 'Case is closed/completed but has no workflow instance', canAutoFix: false,
        });
      }
      continue;
    }

    const allStepsCompleted = Array.isArray(inst.steps) && inst.steps.length > 0 &&
      inst.steps.every((step: any) => String(step?.status || '') === 'Completed');
    if (String(inst.status || '') === 'Completed' && !caseMarkedComplete) {
      mismatches.push({
        caseId: String(caseDoc._id), caseNo: caseDoc.caseNo, parties: caseDoc.parties,
        issue: 'Workflow instance is completed but the case is not closed', canAutoFix: true,
      });
    } else if (allStepsCompleted && String(inst.status || '') !== 'Completed') {
      mismatches.push({
        caseId: String(caseDoc._id), caseNo: caseDoc.caseNo, parties: caseDoc.parties,
        issue: 'All workflow steps are completed but the instance is still active', canAutoFix: true,
      });
    } else if (caseMarkedComplete && String(inst.status || '') !== 'Completed') {
      mismatches.push({
        caseId: String(caseDoc._id), caseNo: caseDoc.caseNo, parties: caseDoc.parties,
        issue: 'Case is closed/completed but its workflow instance is still active', canAutoFix: false,
      });
    }
  }
  return mismatches;
};

export const auditCaseWorkflowMismatches = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });
    const mismatches = await scanWorkflowMismatches();
    return res.json({ count: mismatches.length, mismatches });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to audit mismatches.' });
  }
};

export const fixCaseWorkflowMismatches = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });
    const mismatches = await scanWorkflowMismatches();
    const repaired: any[] = [];
    const skipped: any[] = [];

    for (const mismatch of mismatches) {
      if (!mismatch.canAutoFix) {
        skipped.push(mismatch);
        continue;
      }
      const [caseDoc, inst] = await Promise.all([
        Case.findById(mismatch.caseId),
        WorkflowInstance.findOne({ caseId: mismatch.caseId }),
      ]);
      if (!caseDoc || !inst) {
        skipped.push({ ...mismatch, issue: `${mismatch.issue} (record no longer exists)` });
        continue;
      }

      if (String(inst.status || '') !== 'Completed') {
        inst.status = 'Completed';
        await inst.save();
      }
      await updateCaseWorkflowProgress(caseDoc, inst);
      repaired.push({ caseId: mismatch.caseId, caseNo: caseDoc.caseNo, issue: mismatch.issue });
    }

    return res.json({ repairedCount: repaired.length, repaired, skippedCount: skipped.length, skipped });
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
    if (isClosedCaseWorkflow(c, inst)) {
      return res.status(400).json({ message: 'Reopen the workflow step before changing a completed matter.' });
    }

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
    target.done = nextDone;
    target.doneAt = nextDone ? new Date() : undefined;

    if (step.status === 'Not Started') step.status = 'In Progress';
    if (!nextDone) {
      step.status = 'In Progress';
      step.completedAt = undefined;
      step.submittedAt = undefined;
      step.reviewedAt = undefined;
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
      detail: `${stepKey} â€¢ ${target.text} â€¢ ${nextDone ? 'done' : 'not done'}`,
    });

    // Ticking Key Actions can complete a section: when every Key Action of a
    // section is ticked, the big completion checkbox on the Case Workspace
    // Overview is checked automatically â€” this is what unlocks the next
    // section. The ordered pass also clears any earlier section left fully
    // ticked but pending, because members without matter-management permission
    // (interns/associates) cannot tick that checkbox themselves.
    // Case Management keeps autoComplete:false so its review â†’ approval chain
    // still runs before the section completes.
    const allowAutoComplete = (req.body as any)?.autoComplete !== false;
    if (nextDone && allowAutoComplete) {
      const autoCompletedKeys = await autoCompleteFullyCheckedSteps(actor, c, inst);
      if (autoCompletedKeys.length > 0) {
        return res.json(inst);
      }
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
