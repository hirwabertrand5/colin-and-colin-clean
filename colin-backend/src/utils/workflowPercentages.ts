/**
 * Workflow stage/step percentage engine + earned-fee formulas.
 *
 * Every workflow template carries MANUAL percentages — a percentage on each
 * stage and a percentage on each step, typed by the firm (they represent how
 * much of the matter's fee that stage/step is worth). Nothing is auto-derived
 * and percentages never need to total 100.
 *
 * The earned-fee calculation mirrors the Firm Reports → Productivity formula:
 *   earnedFee = TaskFeeCollected × TPA% × Timeliness% × Quality%
 * where, for a matter, TaskFeeCollected = contractValue × completed step %.
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

/**
 * Manual percentages of every stage (0–100). The value entered on the template
 * is returned as-is (clamped); stages without a value return 0. Nothing is
 * auto-distributed and totals are never forced.
 */
export const resolveStagePercentages = (template: any): Map<string, number> => {
  const stages: any[] = Array.isArray(template?.stages) ? template.stages : [];
  const result = new Map<string, number>();
  for (const stage of stages) {
    const raw = Number(stage?.percentage);
    const valid = Number.isFinite(raw) && raw >= 0;
    result.set(String(stage?.key || ''), valid ? clamp(raw) : 0);
  }
  return result;
};

/**
 * Manual percentage of every step (0–100). The value entered on the template
 * is returned as-is (clamped); steps without a value return 0. Step
 * percentages are NOT derived from their stage — each step keeps the worth the
 * firm typed for it.
 */
export const resolveStepPercentages = (template: any): Map<string, number> => {
  const steps: any[] = Array.isArray(template?.steps) ? template.steps : [];
  const result = new Map<string, number>();
  for (const step of steps) {
    const raw = Number(step?.percentage);
    const valid = Number.isFinite(raw) && raw >= 0 && raw <= 100;
    result.set(String(step?.key || ''), valid ? raw : 0);
  }
  return result;
};

/**
 * Clamp the manual percentages already present on a template in place.
 * Manual values are preserved — nothing is auto-filled or forced to total 100.
 */
export const normalizeTemplatePercentages = (template: any) => {
  if (!template || !Array.isArray(template.stages)) return template;
  for (const stage of template.stages) {
    const raw = Number(stage?.percentage);
    if (Number.isFinite(raw) && raw >= 0) stage.percentage = clamp(raw);
  }
  if (Array.isArray(template.steps)) {
    for (const step of template.steps) {
      const raw = Number(step?.percentage);
      if (Number.isFinite(raw) && raw >= 0) step.percentage = clamp(raw);
    }
  }
  return template;
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