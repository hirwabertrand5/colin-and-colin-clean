/**
 * Workflow stage/step percentage engine + earned-fee formulas.
 *
 * Every workflow template can define a percentage weight (0–100) per stage.
 * Steps inside a stage derive their percentage automatically
 * (stagePercentage ÷ number of steps in the stage) so that completed steps can
 * be translated into a percentage of the matter's contract value.
 *
 * The earned-fee calculation mirrors the Firm Reports → Productivity formula:
 *   earnedFee = TaskFeeCollected × TPA% × Timeliness% × Quality%
 * where, for a matter, TaskFeeCollected = contractValue × workflowCompleted%.
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

/** Split 100 into `count` parts (largest-remainder method) so the parts always sum to 100. */
const distributeEvenly = (count: number): number[] => {
  if (count <= 0) return [];
  const exact = 100 / count;
  const base = Math.floor(exact * 100) / 100;
  const parts = new Array<number>(count).fill(base);
  let remainder = Math.round((100 - base * count) * 100);
  let cursor = 0;
  while (remainder > 0) {
    const index = cursor % count;
    parts[index] = round2((parts[index] ?? 0) + 0.01);
    remainder -= 1;
    cursor += 1;
  }
  return parts;
};
export const resolveStagePercentages = (template: any): Map<string, number> => {
  const stages: any[] = Array.isArray(template?.stages) ? template.stages : [];
  const result = new Map<string, number>();
  if (!stages.length) return result;

  const entries = stages.map((stage: any) => {
    const raw = Number(stage?.percentage);
    const valid = Number.isFinite(raw) && raw >= 0;
    return {
      key: String(stage?.key || ''),
      value: valid ? raw : 0,
      explicit: valid,
    };
  });

  const hasAnyExplicit = entries.some((entry) => entry.explicit);
  if (!hasAnyExplicit) {
    const shares = distributeEvenly(entries.length);
    entries.forEach((entry, index) => {
      result.set(entry.key, shares[index] ?? 0);
    });
    return result;
  }

  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  const scale = total > 0 ? 100 / total : 0;
  const scaled = entries.map((entry) => ({
    key: entry.key,
    value: round2(clamp(entry.value * scale)),
  }));

  // Fix rounding drift so the total equals exactly 100.
  const drift = 100 - scaled.reduce((sum, row) => sum + row.value, 0);
  if (scaled[0] && Math.abs(drift) >= 0.005) {
    scaled[0] = { key: scaled[0].key, value: round2(scaled[0].value + drift) };
  }

  scaled.forEach((row) => result.set(row.key, row.value));
  return result;
};
export const resolveStepPercentages = (template: any): Map<string, number> => {
  const steps: any[] = Array.isArray(template?.steps) ? template.steps : [];
  const stagePercentages = resolveStagePercentages(template);

  const stepsPerStage = new Map<string, number>();
  for (const step of steps) {
    const stageKey = String(step?.stageKey || '');
    stepsPerStage.set(stageKey, (stepsPerStage.get(stageKey) || 0) + 1);
  }

  const result = new Map<string, number>();
  for (const step of steps) {
    const stepKey = String(step?.key || '');
    const stageKey = String(step?.stageKey || '');
    const stagePercent = stagePercentages.get(stageKey) ?? 0;

    const explicit = Number(step?.percentage);
    if (Number.isFinite(explicit) && explicit >= 0 && explicit <= 100) {
      result.set(stepKey, round2(explicit));
    } else {
      const count = stepsPerStage.get(stageKey) || 1;
      result.set(stepKey, round2(count > 0 ? stagePercent / count : 0));
    }
  }
  return result;
};

/** Fill any missing percentages on a template in place. */
export const normalizeTemplatePercentages = (template: any) => {
  if (!template || !Array.isArray(template.stages)) return template;
  const stagePercentages = resolveStagePercentages(template);
  const stages: any[] = template.stages;
  for (const stage of stages) {
    const key = String(stage?.key || '');
    const resolved = stagePercentages.get(key);
    if (typeof resolved === 'number') stage.percentage = resolved;
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