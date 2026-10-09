import { ISlaSpec } from '../models/workflowTemplateModel';

const UNIT_TO_MINUTES: Record<string, number> = {
  hour: 60,
  hours: 60,
  hr: 60,
  hrs: 60,
  h: 60,
  day: 60 * 24,
  days: 60 * 24,
  d: 60 * 24,
  week: 60 * 24 * 7,
  weeks: 60 * 24 * 7,
  w: 60 * 24 * 7,
};

/**
 * Shared SLA parser — the single home for this logic.
 * `workflowCompute` re-exports it for backwards compatibility.
 */
export const slaToMinutes = (sla: ISlaSpec | undefined): { minutes?: number; text?: string } => {
  if (!sla) return {};
  const numericValue = typeof sla.max === 'number' ? sla.max : typeof sla.min === 'number' ? sla.min : undefined;
  if (typeof numericValue === 'number' && sla.unit) {
    const multiplier = UNIT_TO_MINUTES[String(sla.unit)];
    if (multiplier) return { minutes: Math.max(0, Math.round(numericValue * multiplier)), ...(sla.text ? { text: sla.text } : {}) };
  }

  const text = (sla.text || '').trim();
  if (!text) return {};
  if (/^\d+(\.\d+)?$/.test(text)) return { minutes: Math.round(Number(text) * 60), text };

  let minutes = 0;
  let matched = false;
  const matcher = /(\d+(\.\d+)?)\s*(weeks?|w|days?|d|hours?|hrs?|hr|h)\b/g;
  let item: RegExpExecArray | null;
  while ((item = matcher.exec(text.toLowerCase()))) {
    const amount = Number(item[1]);
    const unit = item[3];
    const multiplier = unit ? UNIT_TO_MINUTES[unit] : undefined;
    if (Number.isFinite(amount) && multiplier) {
      minutes += amount * multiplier;
      matched = true;
    }
  }
  return matched ? { minutes: Math.max(0, Math.round(minutes)), text } : { text };
};

/** Calendar-time offset preserving the existing date convention (no mutation of the input). */
export const addMinutes = (start: Date, minutes: number | undefined) => {
  if (!minutes || minutes <= 0) return new Date(start);
  return new Date(start.getTime() + minutes * 60_000);
};

/**
 * Authoritative stage-sequential workflow schedule.
 *
 * Durations belong to stages/sections, not to individual Key Actions. The
 * workflow instance keeps one Key Action row per template step (the Key Action
 * IS the instance step), so every action that inherits its stage duration must
 * share that stage's planned deadline:
 *
 * - Stage 1 window = workflow start + Stage 1 duration.
 * - Stage 2 window = end of Stage 1 + Stage 2 duration.
 * - Stage 3 window = end of Stage 2 + Stage 3 duration, and so on.
 *
 * A Key Action keeps an explicit per-action schedule only when its template
 * SLA is genuinely different from its stage SLA. A step SLA that merely
 * repeats/copies the stage SLA is treated as inherited (shared stage
 * deadline), which is exactly the duplication pattern present in the seeded
 * templates (e.g. Appeal Workflow stores `{max:10,days}` on the Intake stage
 * and again on each of the 3 Intake Key Actions).
 *
 * Date arithmetic preserves the existing convention (calendar time via
 * millisecond offsets, `max` preferred over `min`, unparseable/missing
 * durations mean "no planned movement": dueAt === startAt).
 */
export type WorkflowScheduledStep = {
  key: string;
  order: number;
  title: string;
  stageKey: string;
  stageOrder: number;
  startAt: Date;
  dueAt: Date;
  slaMinutes?: number;
  slaText?: string;
  hasExplicitDuration: boolean;
};

const slaSignature = (sla: ISlaSpec | undefined): string => {
  if (!sla) return 'none';
  const minutes = slaToMinutes(sla).minutes;
  const unit = String((sla as { unit?: unknown }).unit || '').toLowerCase();
  const min = typeof sla.min === 'number' ? sla.min : '';
  const max = typeof sla.max === 'number' ? sla.max : '';
  const text = String((sla as { text?: unknown }).text || '').trim().toLowerCase();
  return [typeof minutes === 'number' ? minutes : 'nan', unit, min, max, text].join('|');
};

export const isExplicitStepDuration = (stepSla: ISlaSpec | undefined, stageSla: ISlaSpec | undefined): boolean => {
  const step = slaToMinutes(stepSla).minutes;
  if (typeof step !== 'number' || step <= 0) return false;
  const stage = slaToMinutes(stageSla).minutes;
  if (typeof stage !== 'number' || stage <= 0) return true;
  if (step === stage) return slaSignature(stepSla) !== slaSignature(stageSla);
  return true;
};

export const buildWorkflowSchedule = (
  template: { stages?: unknown; steps?: unknown } | null | undefined,
  startDate: Date
): WorkflowScheduledStep[] => {
  const rawStages = Array.isArray((template as { stages?: unknown } | null | undefined)?.stages)
    ? ((template as { stages?: Array<Record<string, unknown>> }).stages as Array<Record<string, unknown>>)
    : [];
  const rawSteps = Array.isArray((template as { steps?: unknown } | null | undefined)?.steps)
    ? ((template as { steps?: Array<Record<string, unknown>> }).steps as Array<Record<string, unknown>>)
    : [];
  const stages = rawStages
    .slice()
    .sort((a, b) => Number(a?.order ?? 0) - Number(b?.order ?? 0))
    .map((stage, index) => ({
      key: String(stage?.key || ''),
      order: Number(stage?.order ?? 0) || index,
      sla: stage?.sla as ISlaSpec | undefined,
    }));
  const stageByKey = new Map(stages.map((stage) => [stage.key, stage]));
  const stageRank = new Map(stages.map((stage, index) => [stage.key, index]));
  const steps = rawSteps.slice().sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
    const aKey = String(a?.stageKey || '');
    const bKey = String(b?.stageKey || '');
    const rankA = stageRank.has(aKey) ? Number(stageRank.get(aKey)) : Number.MAX_SAFE_INTEGER;
    const rankB = stageRank.has(bKey) ? Number(stageRank.get(bKey)) : Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return Number(a?.order ?? 0) - Number(b?.order ?? 0);
  });
  const orphanOrder = new Map<string, number>();
  steps.forEach((step) => {
    const key = String(step?.stageKey || '');
    if (!stageByKey.has(key) && !orphanOrder.has(key)) orphanOrder.set(key, orphanOrder.size);
  });
  const rankOf = (stageKey: string): number =>
    stageRank.has(stageKey) ? Number(stageRank.get(stageKey)) : stages.length + Number(orphanOrder.get(stageKey) ?? 0);
  const stageDurationMinutes = new Map<string, number | undefined>(
    stages.map((stage) => [stage.key, slaToMinutes(stage.sla).minutes])
  );
  const orderedStageKeys = Array.from(new Set(steps.map((step) => String(step?.stageKey || '')))).sort(
    (a, b) => rankOf(a) - rankOf(b)
  );
  const stepsByStage = new Map<string, Array<Record<string, unknown>>>();
  steps.forEach((step) => {
    const key = String(step?.stageKey || '');
    const list = stepsByStage.get(key) || [];
    list.push(step);
    stepsByStage.set(key, list);
  });
  const result: WorkflowScheduledStep[] = [];
  let cursor = new Date(startDate);
  orderedStageKeys.forEach((stageKey) => {
    const stageSteps = (stepsByStage.get(stageKey) || [])
      .slice()
      .sort((a, b) => Number(a?.order ?? 0) - Number(b?.order ?? 0));
    if (!stageSteps.length) {
      const idle = stageDurationMinutes.get(stageKey);
      if (typeof idle === 'number' && idle > 0) cursor = addMinutes(cursor, idle);
      return;
    }
    const stageSla = stageByKey.get(stageKey)?.sla;
    const stageMinutes = slaToMinutes(stageSla).minutes;
    const stageRankValue = rankOf(stageKey);
    const stageStart = new Date(cursor);
    const stageEnd = addMinutes(stageStart, stageMinutes);
    const explicitEnds: Date[] = [];
    stageSteps.forEach((step) => {
      const explicit = isExplicitStepDuration(step?.sla as ISlaSpec | undefined, stageSla);
      const stepMinutes = explicit ? slaToMinutes(step?.sla as ISlaSpec | undefined).minutes : undefined;
      const startAt = new Date(stageStart);
      const dueAt = explicit ? addMinutes(startAt, stepMinutes) : new Date(stageEnd);
      if (explicit) explicitEnds.push(new Date(dueAt));
      const resolved = slaToMinutes(step?.sla as ISlaSpec | undefined);
      result.push({
        key: String(step?.key || ''),
        order: Number(step?.order ?? 0) || 0,
        title: String(step?.title || ''),
        stageKey,
        stageOrder: stageRankValue,
        startAt,
        dueAt,
        ...(typeof (explicit ? stepMinutes : stageMinutes) === 'number'
          ? { slaMinutes: (explicit ? stepMinutes : stageMinutes) as number }
          : {}),
        ...(resolved.text ? { slaText: resolved.text } : {}),
        hasExplicitDuration: explicit,
      });
    });
    let nextCursor = new Date(stageEnd);
    explicitEnds.forEach((end) => {
      if (end.getTime() > nextCursor.getTime()) nextCursor = new Date(end);
    });
    cursor = nextCursor;
  });
  return result;
};

export const selectNextScheduledStepKey = (
  steps: Array<{ stepKey?: string; status?: string; stageOrder?: number; order?: number }> | undefined
): string | undefined => {
  const ordered = (Array.isArray(steps) ? steps : []).slice().sort((a, b) => {
    const aHasStage = typeof a?.stageOrder === 'number' && Number.isFinite(a.stageOrder);
    const bHasStage = typeof b?.stageOrder === 'number' && Number.isFinite(b.stageOrder);
    if (aHasStage && bHasStage && (a.stageOrder as number) !== (b.stageOrder as number)) {
      return (a.stageOrder as number) - (b.stageOrder as number);
    }
    if (aHasStage !== bHasStage) return aHasStage ? -1 : 1;
    return Number(a?.order ?? 0) - Number(b?.order ?? 0);
  });
  return ordered.find((step) => String(step?.status || '') !== 'Completed')?.stepKey;
};
