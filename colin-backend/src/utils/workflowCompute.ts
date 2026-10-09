import { IWorkflowTemplate } from '../models/workflowTemplateModel';
import { SINGLE_CURRENCY } from './currency';
import { parsePercentage, resolveStagePercentages } from './workflowPercentages';
import { buildWorkflowSchedule, slaToMinutes } from './workflowSchedule';

export const normalizeCurrency = (_raw?: string) => SINGLE_CURRENCY;

export { slaToMinutes, addMinutes } from './workflowSchedule';

/**
 * Workflow templates no longer create fee amounts. A step's value is always
 * derived later from its Key Action percentage and the matter contract value.
 *
 * The per-step sub-checklist (template `actions`) is retired: a case checklist
 * shows only the template's stages and Key Actions (steps). Legacy checklist
 * items stored on live instances are archived by the alignment pass.
 *
 * Deadlines come from the authoritative stage-sequential schedule
 * (`buildWorkflowSchedule`): every Key Action that inherits its stage duration
 * shares that stage's planned deadline, and stages run consecutively in the
 * template's stage order.
 */
export const buildInstanceSteps = (template: IWorkflowTemplate | any, startDate: Date) => {
  const scheduled = buildWorkflowSchedule(template, startDate);
  const byKey = new Map(scheduled.map((item) => [item.key, item]));
  const steps = (template?.steps || []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  const stagePercentages = resolveStagePercentages(template);
  const stagesByKey = new Map<string, any>(
    (Array.isArray(template?.stages) ? template.stages : []).map((stage: any) => [String(stage?.key || ''), stage])
  );

  return steps.map((step: any, index: number) => {
    const plan = byKey.get(String(step?.key || ''));
    const startAt = plan ? new Date(plan.startAt) : new Date(startDate);
    const dueAt = plan ? new Date(plan.dueAt) : new Date(startAt);
    const slaMinutes = plan && typeof plan.slaMinutes === 'number' ? plan.slaMinutes : undefined;
    const stageKey = String(step?.stageKey || '');
    const slaText = plan?.slaText ?? slaToMinutes(step.sla).text;
    return {
      stepKey: step.key,
      title: step.title,
      stageKey,
      stageTitle: String(stagesByKey.get(stageKey)?.title || stageKey),
      stageOrder: typeof plan?.stageOrder === 'number' ? plan.stageOrder : index,
      stagePercentage: stagePercentages.get(stageKey) ?? 0,
      // Do not silently split a stage percentage across actions. A missing
      // Key Action percentage must remain visible and worth 0.
      percentage: parsePercentage(step?.percentage) ?? 0,
      order: step.order,
      status: index === 0 ? 'In Progress' : 'Not Started',
      startAt,
      dueAt,
      slaMinutes,
      slaText,
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

