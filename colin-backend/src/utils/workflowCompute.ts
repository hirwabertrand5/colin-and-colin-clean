import { ISlaSpec, IWorkflowTemplate } from '../models/workflowTemplateModel';
import { SINGLE_CURRENCY } from './currency';
import { parsePercentage, resolveStagePercentages } from './workflowPercentages';

export const normalizeCurrency = (_raw?: string) => SINGLE_CURRENCY;

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
 *
 * The per-step sub-checklist (template `actions`) is retired: a case checklist
 * shows only the template's stages and Key Actions (steps). Legacy checklist
 * items stored on live instances are archived by the alignment pass.
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
      actions: [],
      outputs: (step.outputs || []).map((output: any) => ({
        key: output.key,
        name: output.name,
        required: Boolean(output.required),
        category: output.category,
      })),
    };
  });
};

/**
 * Whether a section is ready to be completed automatically because its whole
 * checklist is ticked.
 *
 * The Case Workspace Overview shows one big completion checkbox per section,
 * but only members with matter-management permission may tick it — interns and
 * associates can only tick Key Actions. Ticking the last Key Action therefore
 * completes the section for them: `toggleStepAction` runs this rule on every
 * tick and the repair script (`npm run autocomplete:steps`) applies it to the
 * matters that were already fully checked before the rule existed.
 *
 * Rules:
 * - the section must really have Key Actions (an empty checklist is never
 *   auto-completed — nothing proves the work is done);
 * - every Key Action must be ticked;
 * - the section must still be in the working lifecycle: 'Not Started' or
 *   'In Progress'. Sections awaiting review/approval stay with the Reviewer /
 *   Signer, and Completed sections are never touched.
 */
export const isStepChecklistReadyToAutoComplete = (step: any): boolean => {
  const actions = Array.isArray(step?.actions) ? step.actions : [];
  if (actions.length === 0) return false;
  if (!actions.every((action: any) => action?.done === true)) return false;
  const status = String(step?.status || '').trim().toLowerCase();
  return status === 'not started' || status === 'in progress';
};

