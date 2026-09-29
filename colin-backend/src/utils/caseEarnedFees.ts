import { calculateCollectedKeyActionEarnings } from './keyActionEarnings';
import {
  computeEarnedFee,
  getTpaPercent,
  computeStageBreakdownFromInstance,
  normalizeMemberName,
  parsePercentage,
  resolveMemberTpa,
} from './workflowPercentages';
import { resolveDeadlineDateTime } from './deadlineUtils';

/**
 * Central earned-fee engine for a single matter — the single source of truth
 * used by the Case Management tab, the Case Workspace and (through the shared
 * Firm Reports productivity engine) dashboards, billing and reports.
 *
 * The formula is:
 *   staff earned fee = Eligible Collected Value × TPA% × Timeliness% × Quality%
 * where:
 *   - Eligible Collected Value = Contract Value × completed Key Action %,
 *     capped by actual Paid invoice collections.
 *   - TPA comes from the staff member's system role (TASK_TPA_SHARES).
 *   - Timeliness uses the existing score logic (100 − % of SLA consumed).
 *   - Quality is the matter-level Quality Score entered through Case
 *     Management (Reviewer / Signer-Approver).
 *
 * Any value that is genuinely missing stays null so the UI can render "_"
 * instead of inventing a 0, 100 or any other value.
 *
 * Timeliness is the AVERAGE of the matter's checked Key Actions: each workflow
 * section scores on its own key-action timeline (submitted / last action
 * checked; late = 0) and a late section only lowers the average instead of
 * zeroing the whole matter. A member's own task scores apply to task-only
 * matters that have no scorable section.
 */

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

const normalizeName = (value: unknown) => normalizeMemberName(value);

const toScore = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number * 10) / 10 : null;
};

/**
 * Timeliness from a completed workflow step using the exact existing logic:
 * score = max(0, 100 − consumed%), where consumed% is the share of the due-at
 * window (startAt → dueAt) that had elapsed at completion. Returns null when
 * the required information is missing.
 */
export const computeStepTimelinessScore = (step: any): number | null => {
  if (!step || String(step?.status || '').toLowerCase() !== 'completed') return null;
  const startAt = resolveDeadlineDateTime(step?.startAt);
  const completedAt = resolveDeadlineDateTime(step?.completedAt);
  const dueAt = resolveDeadlineDateTime(step?.dueAt);
  if (!startAt || !completedAt || !dueAt) return null;
  const totalMs = dueAt.getTime() - startAt.getTime();
  if (!Number.isFinite(totalMs) || totalMs <= 0) return null;
  const usedMs = completedAt.getTime() - startAt.getTime();
  if (!Number.isFinite(usedMs)) return null;
  const consumed = Math.round((usedMs / totalMs) * 1000) / 10;
  return Math.min(100, Math.max(0, Math.round(100 - consumed)));
};

/** Timeliness of an explicit event inside a step's start → due window. */
export const computeStepTimelinessAt = (step: any, eventTime?: Date | null): number | null => {
  if (!eventTime) return null;
  const startAt = resolveDeadlineDateTime(step?.startAt);
  const dueAt = resolveDeadlineDateTime(step?.dueAt);
  if (!startAt || !dueAt) return null;
  const totalMs = dueAt.getTime() - startAt.getTime();
  if (!Number.isFinite(totalMs) || totalMs <= 0) return null;
  const usedMs = eventTime.getTime() - startAt.getTime();
  if (!Number.isFinite(usedMs)) return null;
  const consumed = Math.round((usedMs / totalMs) * 1000) / 10;
  return Math.min(100, Math.max(0, Math.round(100 - consumed)));
};

/**
 * The moment the WORK on a step was finished. Timeliness is based on this, so
 * a member's score never waits for the reviewer/signer to act:
 *   1. submittedAt   — the work was submitted for review
 *   2. latest doneAt — every Key Action is checked (the moment the last one was ticked)
 *   3. completedAt   — the step was completed without a submit event
 *   4. reviewedAt    — defensive fallback
 */
export const resolveStepWorkTime = (step: any): Date | null => {
  const submittedAt = resolveDeadlineDateTime(step?.submittedAt);
  if (submittedAt) return submittedAt;

  const actions = Array.isArray(step?.actions) ? step.actions : [];
  if (actions.length && actions.every((action: any) => Boolean(action?.done))) {
    const times = actions
      .map((action: any) => resolveDeadlineDateTime(action?.doneAt))
      .filter((date: Date | undefined): date is Date => Boolean(date));
    if (times.length) return new Date(Math.max(...times.map((date: Date) => date.getTime())));
  }

  return resolveDeadlineDateTime(step?.completedAt) || resolveDeadlineDateTime(step?.reviewedAt) || null;
};

/** Timeliness from when the Key Actions were checked / the work was submitted. */
export const computeStepWorkTimelinessScore = (step: any): number | null =>
  computeStepTimelinessAt(step, resolveStepWorkTime(step));

/** Matter-level Quality Score entered through the Case Management tab. */
export const getMatterQualityScore = (caseDoc: any): { qualityScore: number | null; qualityScoredBy: string | null; qualityScoredAt: Date | string | null } => {
  const cm = caseDoc?.caseManagement || {};
  const qualityScore = toScore(cm?.qualityScore);
  return {
    qualityScore,
    qualityScoredBy: String(cm?.qualityScoredBy || '').trim() || null,
    qualityScoredAt: cm?.qualityScoredAt || null,
  };
};
export type CaseTeamEarnedFee = {
  key: 'initiator' | 'reviewer' | 'approver';
  role: string;
  name: string;
  userRole: string | null;
  tpaPercent: number;
  /** Where the TPA came from: the user record, the label itself, or nowhere. */
  tpaSource: 'user-record' | 'role-label' | 'none';
  timelinessScore: number | null;
  qualityScore: number | null;
  taskFeeCollected: number;
  earnedFee: number | null;
};

/**
 * Shared team/earned-fee resolution. Used by the workflow earned-fees endpoint
 * and the Case Management endpoint so every surface shows the same numbers.
 * `roleByName` maps a normalized member name to its system role for TPA.
 */
export const computeCaseTeamEarnedFees = ({
  caseDoc,
  workflowInstance,
  tasks = [],
  roleByName,
  matterQualityScore = null,
  baseValue = 0,
}: {
  caseDoc: any;
  workflowInstance?: any;
  tasks?: any[];
  roleByName: Map<string, string>;
  matterQualityScore?: number | null;
  baseValue?: number;
}): CaseTeamEarnedFee[] => {
  const assignments: any = caseDoc?.caseAssignments || {};
  const teamSpecs = [
    { key: 'initiator', label: 'Initiator', name: String(assignments.initiator || caseDoc?.assignedTo || '').trim() },
    { key: 'reviewer', label: 'Reviewer', name: String(assignments.reviewer || '').trim() },
    { key: 'approver', label: 'Signer/Approver', name: String(assignments.signerApprover || '').trim() },
  ].filter((spec) => spec.name);

  const allTasks = Array.isArray(tasks) ? tasks : [];
  const steps: any[] = Array.isArray(workflowInstance?.steps) ? workflowInstance.steps : [];

  const averageScore = (values: Array<number | null>) => {
    const scores = values.filter((value): value is number => value !== null && Number.isFinite(value));
    return scores.length
      ? Math.round((scores.reduce((a: number, b: number) => a + b, 0) / scores.length) * 10) / 10
      : null;
  };

  // Per-section key-action timeliness. Every checked section scores on its own
  // (late = 0, on time = its normal value) so one late section can never zero
  // the whole matter — all samples are averaged below.
  const sectionTimelinessScores = steps
    .map((step: any) => computeStepWorkTimelinessScore(step))
    .filter((value): value is number => value !== null);

  return teamSpecs.map((spec) => {
    const me = normalizeName(spec.name);
    const mine = allTasks.filter((task: any) => {
      const assignee = normalizeName(task?.assignee);
      const supervisor = normalizeName(task?.supervisor || task?.supervisorReviewer);
      const stageMembers = Array.isArray(task?.taskStages)
        ? task.taskStages.map((st: any) => normalizeName(st?.staffMember)).filter(Boolean)
        : [];
      return assignee === me || supervisor === me || stageMembers.includes(me);
    });
    const completedMine = mine.filter((task: any) => String(task?.status || '').toLowerCase() === 'completed');

    // Timeliness: average of the member's completed-task stage scores / task
    // scores; falls back to the completed Key Action step timeliness (the
    // Case Management flow), then to null.
    const timelinessScores: number[] = [];
    for (const task of completedMine) {
      const stageScores = Array.isArray(task?.taskStages)
        ? task.taskStages
            .map((st: any) => Number(st?.timelinessScore))
            .filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 100)
        : [];
      if (stageScores.length) {
        timelinessScores.push(Math.round(stageScores.reduce((a: number, b: number) => a + b, 0) / stageScores.length));
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
          timelinessScores.push(Math.min(100, Math.max(0, Math.round(100 - consumed))));
        }
      }
    }
    // Timeliness is the average of this matter's checked Key Actions: every
    // section scores on its own deadline (late = 0, on time = its value), so a
    // late section only lowers the average instead of zeroing the whole matter.
    // The member's own task scores apply to task-only matters with no section.
    const sampleScores = sectionTimelinessScores.length ? sectionTimelinessScores : timelinessScores;
    const timelinessScore = averageScore(sampleScores);

    // Quality: the matter-level Case Management Quality Score when entered;
    // otherwise the member's own completed-task scores (real data), else null.
    const ownQualityScores = completedMine
      .map((task: any) => Number(task?.qualityScore))
      .filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 100);
    const qualityScore = matterQualityScore !== null
      ? matterQualityScore
      : ownQualityScores.length
        ? Math.round((ownQualityScores.reduce((a: number, b: number) => a + b, 0) / ownQualityScores.length) * 10) / 10
        : null;

    // TPA always follows the role-based table: the user record first (matched
    // case/whitespace-insensitively), then the member label itself when it is a
    // role title such as "Managing Partner".
    const tpa = resolveMemberTpa(spec.name, roleByName);
    const userRole = tpa.role || String(roleByName.get(me) || '').trim() || null;
    const tpaPercent = tpa.tpaPercent;
    const earnedFee = computeEarnedFee(baseValue, tpaPercent, timelinessScore, qualityScore);

    return {
      key: spec.key as 'initiator' | 'reviewer' | 'approver',
      role: spec.label,
      name: spec.name,
      userRole,
      tpaPercent,
      tpaSource: tpa.source,
      timelinessScore,
      qualityScore,
      taskFeeCollected: baseValue,
      earnedFee,
    };
  });
};
export type CaseEarnedFeesResult = {
  contractValue: number;
  currency: string;
  completedPercent: number;
  completedValue: number;
  collectedAmount: number;
  eligibleCollectedValue: number;
  earnedValue: number;
  completedKeyActions: number;
  keyActions: ReturnType<typeof calculateCollectedKeyActionEarnings>['keyActions'];
  missingKeyActionPercentages: Array<{ key: string; title: string }>;
  stages: ReturnType<typeof computeStageBreakdownFromInstance>;
  qualityScore: number | null;
  qualityScoredBy: string | null;
  qualityScoredAt: Date | string | null;
  team: CaseTeamEarnedFee[];
  staffEarnedTotal: number | null;
  firmFee: number;
};

/**
 * Full matter earned-fees projection — the single source of truth consumed by
 * the Case Workspace (Earned Fees) and the Case Management tab.
 */
export const computeCaseEarnedFees = ({
  caseDoc,
  template,
  workflowInstance,
  tasks = [],
  collectedAmount = 0,
  roleByName,
}: {
  caseDoc: any;
  template: any;
  workflowInstance?: any;
  tasks?: any[];
  collectedAmount?: number;
  roleByName: Map<string, string>;
}): CaseEarnedFeesResult => {
  const earnings = calculateCollectedKeyActionEarnings({
    matter: caseDoc,
    template,
    workflowInstance,
    tasks,
    collectedAmount,
  });
  const earnedValue = earnings.eligibleCollectedValue; // never exceeds completed value or paid invoices

  const currency = String(
    caseDoc?.workflowProgress?.plannedValue?.currency || caseDoc?.billingSettings?.currency || 'RWF'
  );
  const stages = computeStageBreakdownFromInstance(Array.isArray(workflowInstance?.steps) ? workflowInstance.steps : []);
  const { qualityScore, qualityScoredBy, qualityScoredAt } = getMatterQualityScore(caseDoc);

  const team = computeCaseTeamEarnedFees({
    caseDoc,
    workflowInstance,
    tasks,
    roleByName,
    matterQualityScore: qualityScore,
    baseValue: earnedValue,
  });

  const knownEarned = team.map((member: CaseTeamEarnedFee) => member.earnedFee).filter((value) => value !== null) as number[];
  const staffEarnedTotal = knownEarned.length ? roundMoney(knownEarned.reduce((a: number, b: number) => a + b, 0)) : null;
  const firmFee = roundMoney(Math.max(0, earnedValue - (staffEarnedTotal || 0)));

  return {
    contractValue: earnings.contractValue,
    currency,
    completedPercent: earnings.completedPercent,
    completedValue: earnings.completedValue,
    collectedAmount: earnings.collectedAmount,
    eligibleCollectedValue: earnings.eligibleCollectedValue,
    earnedValue,
    completedKeyActions: earnings.completedActions.length,
    keyActions: earnings.keyActions,
    missingKeyActionPercentages: earnings.missingKeyActionPercentages,
    stages,
    qualityScore,
    qualityScoredBy,
    qualityScoredAt,
    team,
    staffEarnedTotal,
    firmFee,
  };
};
/**
 * Legacy instances (created before percentages existed) store no percentage on
 * their steps — derive them from the template so percentages and earned values
 * stay correct everywhere (Case Workspace, Case Management, firm reports).
 */
export const normalizeEffectiveWorkflowSteps = (inst: any, template: any): any[] => {
  const effectiveSteps: any[] = Array.isArray(inst?.steps) ? inst.steps : [];
  if (!template || effectiveSteps.some((step: any) => Number(step?.percentage) > 0)) return effectiveSteps;
  const templateStepsByKey = new Map<string, any>(
    (template.steps || []).map((templateStep: any) => [String(templateStep?.key || ''), templateStep])
  );
  const stagePercentages = new Map<string, any>(
    (template.stages || []).map((stage: any) => [String(stage?.key || ''), stage])
  );
  return effectiveSteps.map((step: any) => {
    const stageKey = String(step?.stageKey || '');
    const stage = stagePercentages.get(stageKey);
    return {
      ...step,
      percentage: parsePercentage(templateStepsByKey.get(String(step?.stepKey || ''))?.percentage) ?? 0,
      stagePercentage: typeof stage?.percentage === 'number' ? stage.percentage : 0,
      stageTitle: String(stage?.title || step?.stageTitle || stageKey || 'Stage'),
    };
  });
};