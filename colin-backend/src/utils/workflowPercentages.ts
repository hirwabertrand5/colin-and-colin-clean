/**
 * Workflow stage/step percentage engine + earned-fee formulas.
 *
 * Every workflow template carries MANUAL percentages on its stages. A stage
 * value is a literal percentage of the matter contract value: entering 5 or
 * 5% means exactly five percent, never a proportion to be re-scaled.
 *
 * The earned-fee calculation mirrors the Firm Reports → Productivity formula:
 *   earnedFee = TaskFeeCollected × TPA% × Timeliness% × Quality%
 * where, for a matter, TaskFeeCollected = contractValue × workflow-stage %.
 */

export type StagePercentRow = {
  stageKey: string;
  title: string;
  percentage: number;
  completedSteps: number;
  totalSteps: number;
};

/**
 * TPA (Task Participation Allocation) by user role — single source of truth,
 * kept in sync with firmReportsController.ts.
 */
export const TASK_TPA_SHARES: Record<string, number> = {
  intern: 1,
  trainee_associate: 3,
  associate: 5,
  executive_assistant: 5,
  senior_associate: 6,
  senior_executive_assistant: 6,
  partner: 8,
  executive_partner: 8,
  associate_partner: 8,
  executive_associate_partner: 8,
  senior_partner: 8,
  originating_attorney: 8,
  managing_partner: 10,
  executive_managing_partner: 10,
  managing_director: 10,
};

export const getTpaPercent = (role?: string) =>
  TASK_TPA_SHARES[String(role || '').toLowerCase()] ?? 0;

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** Accept the UI forms people naturally use: 5, "5", and "5%". */
export const parsePercentage = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? clamp(value) : undefined;
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const numeric = raw.endsWith('%') ? raw.slice(0, -1).trim() : raw;
  if (!/^\d+(?:\.\d+)?$/.test(numeric)) return undefined;
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? clamp(parsed) : undefined;
};

const normalizedText = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

export type TaskStageAllocation = {
  stageKey: string;
  stageTitle: string;
  percentage: number;
};

/**
 * Manual percentages of every stage (0–100). The value entered on the template
 * is returned as-is (clamped); stages without a value return 0. Nothing is
 * auto-distributed and totals are never forced.
 */
export const resolveStagePercentages = (template: any): Map<string, number> => {
  const stages: any[] = Array.isArray(template?.stages) ? template.stages : [];
  const result = new Map<string, number>();
  for (const stage of stages) {
    result.set(String(stage?.key || ''), parsePercentage(stage?.percentage) ?? 0);
  }
  return result;
};

/**
 * A workflow step represents a portion of its stage. This is used only for
 * workflow-completion displays; staff earnings always use the full configured
 * stage percentage through resolveTaskStageAllocation below.
 */
export const resolveStepPercentages = (template: any): Map<string, number> => {
  const steps: any[] = Array.isArray(template?.steps) ? template.steps : [];
  const stagePercentages = resolveStagePercentages(template);
  const stepsByStage = new Map<string, number>();
  for (const step of steps) {
    const stageKey = String(step?.stageKey || '');
    stepsByStage.set(stageKey, (stepsByStage.get(stageKey) || 0) + 1);
  }

  const result = new Map<string, number>();
  for (const step of steps) {
    const stageKey = String(step?.stageKey || '');
    const stagePercentage = stagePercentages.get(stageKey) || 0;
    const stepsInStage = stepsByStage.get(stageKey) || 1;
    result.set(String(step?.key || ''), round2(stagePercentage / stepsInStage));
  }
  return result;
};

/**
 * Normalize the percentages already present on a template in place. Values are
 * literal and are never auto-filled, redistributed, or forced to total 100.
 */
export const normalizeTemplatePercentages = (template: any) => {
  if (!template || !Array.isArray(template.stages)) return template;
  for (const stage of template.stages) {
    const percentage = parsePercentage(stage?.percentage);
    if (percentage === undefined) delete stage.percentage;
    else stage.percentage = percentage;
  }
  return template;
};

/**
 * Finds the workflow stage for a task. New tasks persist the selected stage or
 * step key. Older tasks still work when their title matches a template step or
 * one of that step's key actions (for example, "Write letter").
 */
export const resolveTaskStageAllocation = (template: any, task: any): TaskStageAllocation | null => {
  if (!template) return null;

  const stages: any[] = Array.isArray(template.stages) ? template.stages : [];
  const steps: any[] = Array.isArray(template.steps) ? template.steps : [];
  const stageByKey = new Map(stages.map((stage) => [String(stage?.key || ''), stage]));
  let stageKey = String(task?.workflowStageKey || '').trim();

  if (!stageKey) {
    const stepKey = String(task?.workflowStepKey || '').trim();
    const linkedStep = stepKey ? steps.find((step) => String(step?.key || '') === stepKey) : undefined;
    stageKey = String(linkedStep?.stageKey || '').trim();
  }

  if (!stageKey) {
    const taskTitle = normalizedText(task?.title);
    const taskDescription = normalizedText(task?.description);
    const matchedStageKeys = new Set<string>();
    for (const step of steps) {
      const candidates = [step?.title, ...(Array.isArray(step?.actions) ? step.actions : [])]
        .map(normalizedText)
        .filter(Boolean);
      if (taskTitle && candidates.includes(taskTitle)) matchedStageKeys.add(String(step?.stageKey || ''));
      if (taskDescription && candidates.includes(taskDescription)) matchedStageKeys.add(String(step?.stageKey || ''));
    }
    if (matchedStageKeys.size === 1) stageKey = Array.from(matchedStageKeys)[0] || '';
  }

  const stage = stageByKey.get(stageKey);
  if (!stage || !stageKey) return null;
  return {
    stageKey,
    stageTitle: String(stage?.title || stageKey),
    percentage: resolveStagePercentages(template).get(stageKey) ?? 0,
  };
};
/**
 * Build the per-stage breakdown from a workflow *instance*.
 * Instance steps carry stageKey/stageTitle/stagePercentage/percentage
 * (copied from the template when the instance was built).
 */
export const computeStageBreakdownFromInstance = (instanceSteps: any[]): StagePercentRow[] => {
  const byStage = new Map<string, StagePercentRow>();
  for (const step of instanceSteps || []) {
    const stageKey = String(step?.stageKey || 'unknown');
    const existing = byStage.get(stageKey);
    if (!existing) {
      byStage.set(stageKey, {
        stageKey,
        title: String(step?.stageTitle || stageKey),
        percentage: round2(Number(step?.stagePercentage) || 0),
        completedSteps: String(step?.status || '') === 'Completed' ? 1 : 0,
        totalSteps: 1,
      });
    } else {
      existing.totalSteps += 1;
      if (String(step?.status || '') === 'Completed') existing.completedSteps += 1;
      if (!existing.title || existing.title === existing.stageKey) {
        existing.title = String(step?.stageTitle || stageKey);
      }
    }
  }
  return Array.from(byStage.values());
};

/**
 * Percentage of the workflow that is completed, weighted by step percentages.
 * Falls back to a simple completed-steps/total-steps ratio when the instance
 * carries no percentages (legacy instances).
 */
export const computeCompletedPercentFromInstance = (instanceSteps: any[]): number => {
  const steps = Array.isArray(instanceSteps) ? instanceSteps : [];
  const totalWeight = steps.reduce((sum, step) => sum + (Number(step?.percentage) || 0), 0);

  if (totalWeight > 0) {
    const completedWeight = steps
      .filter((step) => String(step?.status || '') === 'Completed')
      .reduce((sum, step) => sum + (Number(step?.percentage) || 0), 0);
    return round2(Math.max(0, Math.min(100, completedWeight)));
  }

  if (!steps.length) return 0;
  const completed = steps.filter((step) => String(step?.status || '') === 'Completed').length;
  return Math.round((completed / steps.length) * 100);
};

/**
 * Productive-earned-fee formula (mirrors Firm Reports → Productivity):
 *   taskFeeCollected × (TPA / 100) × (Timeliness / 100) × (Quality / 100)
 * Returns null when any multiplier is missing (no data) or zero.
 */
export const computeEarnedFee = (
  taskFeeCollected: number,
  tpaPercent: number,
  timelinessScore: number | null | undefined,
  qualityScore: number | null | undefined
): number | null => {
  const tpa = Number(tpaPercent);
  const timeliness = Number(timelinessScore);
  const quality = Number(qualityScore);

  if (
    !Number.isFinite(tpa) ||
    tpa <= 0 ||
    !Number.isFinite(timeliness) ||
    timeliness <= 0 ||
    !Number.isFinite(quality) ||
    quality <= 0
  ) {
    return null;
  }
  const value = taskFeeCollected * (tpa / 100) * (timeliness / 100) * (quality / 100);
  return round2(Math.max(0, value));
};
