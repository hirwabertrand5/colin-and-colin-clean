import { ISlaSpec, IWorkflowTemplate } from '../models/workflowTemplateModel';
import { parsePercentage, resolveStagePercentages } from './workflowPercentages';

export const normalizeCurrency = (raw: string | undefined) => {
  const value = (raw || '').trim().toUpperCase();
  if (!value) return undefined;
  return value === 'FRW' ? 'RWF' : value;
};

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

export const addMinutes = (start: Date, minutes: number | undefined) => {
  if (!minutes || minutes <= 0) return new Date(start);
  return new Date(start.getTime() + minutes * 60_000);
};

/**
 * Workflow templates no longer create fee amounts. A step's value is always
 * derived later from its Key Action percentage and the matter contract value.
 */
export const buildInstanceSteps = (template: IWorkflowTemplate | any, startDate: Date) => {
  const steps = (template?.steps || []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  const stagePercentages = resolveStagePercentages(template);
  const stagesByKey = new Map<string, any>(
    (Array.isArray(template?.stages) ? template.stages : []).map((stage: any) => [String(stage?.key || ''), stage])
  );
  let cursor = new Date(startDate);

  return steps.map((step: any, index: number) => {
    const sla = slaToMinutes(step.sla);
    const startAt = new Date(cursor);
    const dueAt = addMinutes(startAt, sla.minutes);
    cursor = new Date(dueAt);
    const stageKey = String(step?.stageKey || '');
    return {
      stepKey: step.key,
      title: step.title,
      stageKey,
      stageTitle: String(stagesByKey.get(stageKey)?.title || stageKey),
      stagePercentage: stagePercentages.get(stageKey) ?? 0,
      // Do not silently split a stage percentage across actions. A missing
      // Key Action percentage must remain visible and worth 0.
      percentage: parsePercentage(step?.percentage) ?? 0,
      order: step.order,
      status: index === 0 ? 'In Progress' : 'Not Started',
      startAt,
      dueAt,
      slaMinutes: typeof sla.minutes === 'number' ? sla.minutes : undefined,
      slaText: sla.text,
      responsibleRole: typeof step.responsibleRole === 'string' ? step.responsibleRole : undefined,
      actions: (step.actions || []).map((text: any) => ({ text: String(text || '').trim(), done: false })),
      outputs: (step.outputs || []).map((output: any) => ({
        key: output.key,
        name: output.name,
        required: Boolean(output.required),
        category: output.category,
      })),
    };
  });
};
