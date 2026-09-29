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
  executive_assistant: 3,
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

/** Case/space-insensitive member-name key used by every team resolver. */
export const normalizeMemberName = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** "Steven R." / "Steven - Associate" / "Steven (Associate)" → "steven". */
export const baseMemberName = (value: unknown) => {
  const normalized = normalizeMemberName(value);
  if (!normalized) return '';
  const withoutRole = normalized.split(' - ')[0] ?? '';
  return (withoutRole.split('(')[0] ?? '').trim();
};

/**
 * Role display titles that are sometimes stored as the team-member value
 * (for example "Managing Partner" instead of the person's name).
 */
export const TPA_ROLE_LABELS: Record<string, string> = {
  'managing director': 'managing_director',
  'managing partner': 'managing_partner',
  'executive managing partner': 'executive_managing_partner',
  'senior partner': 'senior_partner',
  partner: 'partner',
  'executive partner': 'executive_partner',
  'associate partner': 'associate_partner',
  'executive associate partner': 'executive_associate_partner',
  'senior executive assistant': 'senior_executive_assistant',
  'executive assistant': 'executive_assistant',
  'originating attorney': 'originating_attorney',
  'senior associate': 'senior_associate',
  associate: 'associate',
  'trainee associate': 'trainee_associate',
  intern: 'intern',
};

export type MemberTpaResolution = {
  tpaPercent: number;
  role: string | null;
  source: 'user-record' | 'role-label' | 'none';
};

/**
 * Name → role map shared by every team resolver. Keys are normalized
 * case/whitespace-insensitively and include the base name, so an assignment
 * like "Steven - Associate" still matches the "Steven" user record.
 */
export const buildRoleByName = (users: any[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const user of Array.isArray(users) ? users : []) {
    const role = String(user?.role || '').trim();
    if (!role) continue;
    for (const key of [normalizeMemberName(user?.name), baseMemberName(user?.name)]) {
      if (key && !map.has(key)) map.set(key, role);
    }
  }
  return map;
};

/**
 * Resolve a team member's TPA%. The user-role map is checked with a normalized
 * key (case/whitespace tolerant) and with the base name, then the member label
 * itself is treated as a role title ("Managing Partner" → 10%). This is the only
 * place team TPA is resolved so every surface agrees.
 */
export const resolveMemberTpa = (memberName: unknown, roleByName: Map<string, string>): MemberTpaResolution => {
  const candidates = [normalizeMemberName(memberName), baseMemberName(memberName)].filter(Boolean);
  for (const candidate of candidates) {
    const role = String(roleByName.get(candidate) || '').trim();
    const tpa = getTpaPercent(role);
    if (role && tpa > 0) return { tpaPercent: tpa, role, source: 'user-record' };
  }

  const labelKey = TPA_ROLE_LABELS[baseMemberName(memberName)];
  if (labelKey) return { tpaPercent: getTpaPercent(labelKey), role: labelKey, source: 'role-label' };

  const underscored = normalizeMemberName(memberName)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (getTpaPercent(underscored) > 0) {
    return { tpaPercent: getTpaPercent(underscored), role: underscored, source: 'role-label' };
  }

  return { tpaPercent: 0, role: null, source: 'none' };
};

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
 * A workflow step represents a key action in the template builder. When a
 * literal step percentage exists, it is authoritative and is returned exactly
 * as entered. Older templates that only have stage percentages retain their
 * historical equal-split behaviour.
 *
 * Staff earnings still use the configured stage percentage through
 * resolveTaskStageAllocation below.
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
    const literalPercentage = parsePercentage(step?.percentage);
    const stagePercentage = stagePercentages.get(stageKey) || 0;
    const stepsInStage = stepsByStage.get(stageKey) || 1;
    result.set(
      String(step?.key || ''),
      literalPercentage === undefined ? round2(stagePercentage / stepsInStage) : literalPercentage
    );
  }
  return result;
};

/**
 * Normalize the percentages already present on a template in place. Values are
 * literal and are never auto-filled, redistributed, or forced to total 100.
 */
export const normalizeTemplatePercentages = (template: any) => {
  if (!template) return template;
  for (const stage of Array.isArray(template.stages) ? template.stages : []) {
    const percentage = parsePercentage(stage?.percentage);
    if (percentage === undefined) delete stage.percentage;
    else stage.percentage = percentage;
  }
  for (const step of Array.isArray(template.steps) ? template.steps : []) {
    const percentage = parsePercentage(step?.percentage);
    if (percentage === undefined) delete step.percentage;
    else step.percentage = percentage;
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
