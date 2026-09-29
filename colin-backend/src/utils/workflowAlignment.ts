/**
 * Align a live case workflow with its canonical template.
 *
 * This is the repair path used when a case was created against a template that
 * has since been deleted, replaced or duplicated. The case checklist is
 * rebuilt from the template so the Case Workspace always shows exactly the Key
 * Actions defined in Templates settings, while nothing that carries progress is
 * destroyed:
 *
 * - completed ticks follow their action TEXT (never a position), so a reorder
 *   or re-wording can never move finished work to another key action;
 * - a step keeps its own deadline, status, completion stamp and extensions;
 * - a Key Action that exists only on the case survives when it is ticked;
 * - an unticked leftover of an older template is dropped — that leftover is
 *   exactly the drift this alignment removes;
 * - a whole step that is not in the template survives when it was completed or
 *   has ticked actions, so historical/earned work is never deleted;
 * - percentages absent from the template never zero a value the case already
 *   stores (the same rule the normal template sync applies).
 */

import { buildInstanceSteps } from './workflowCompute';
import { parsePercentage } from './workflowPercentages';
import { stripManualNumberPrefix } from './workflowText';

const actionKey = (value: unknown) =>
  stripManualNumberPrefix(value).replace(/\s+/g, ' ').trim().toLowerCase();

export type WorkflowAlignmentSummary = {
  templateSteps: number;
  matchedSteps: number;
  addedTemplateSteps: number;
  addedActions: number;
  droppedSteps: string[];
  droppedActions: string[];
  keptLegacySteps: string[];
  keptLegacyActions: string[];
};

export type WorkflowAlignmentResult = {
  steps: any[];
  summary: WorkflowAlignmentSummary;
};

export const alignInstanceStepsToTemplate = (
  existingSteps: any[] | undefined,
  template: any,
  startDate: Date,
  options: { keepLegacyProgress?: boolean } = {}
): WorkflowAlignmentResult => {
  const keepLegacyProgress = options.keepLegacyProgress !== false;
  const builtSteps = buildInstanceSteps(template, startDate);
  const previousByKey = new Map<string, any>(
    (Array.isArray(existingSteps) ? existingSteps : []).map((step: any) => [String(step?.stepKey || ''), step])
  );
  const templateStepByKey = new Map<string, any>(
    (Array.isArray(template?.steps) ? template.steps : []).map((step: any) => [String(step?.key || ''), step])
  );
  const templateStageByKey = new Map<string, any>(
    (Array.isArray(template?.stages) ? template.stages : []).map((stage: any) => [String(stage?.key || ''), stage])
  );

  const summary: WorkflowAlignmentSummary = {
    templateSteps: builtSteps.length,
    matchedSteps: 0,
    addedTemplateSteps: 0,
    addedActions: 0,
    droppedSteps: [],
    droppedActions: [],
    keptLegacySteps: [],
    keptLegacyActions: [],
  };

  const steps: any[] = builtSteps.map((templateStep: any) => {
    const previous: any = previousByKey.get(String(templateStep.stepKey));
    if (previous) summary.matchedSteps += 1;
    else summary.addedTemplateSteps += 1;

    // Queue previous ticks per normalized action text so repeated checklist
    // items keep their own tick.
    const remaining = new Map<string, any[]>();
    for (const action of Array.isArray(previous?.actions) ? previous.actions : []) {
      const key = actionKey(action?.text);
      if (!key) continue;
      const queue = remaining.get(key) || [];
      queue.push(action);
      remaining.set(key, queue);
    }

    const mergedActions: any[] = (templateStep.actions || []).map((action: any) => {
      const text = stripManualNumberPrefix(action?.text);
      const key = actionKey(text);
      const queue = remaining.get(key) || [];
      const matched = queue.shift();
      if (!matched) summary.addedActions += 1;
      if (queue.length) remaining.set(key, queue);
      else remaining.delete(key);
      return {
        text,
        done: Boolean(matched?.done),
        ...(matched?.doneAt ? { doneAt: matched.doneAt } : {}),
      };
    });

    for (const queue of remaining.values()) {
      for (const action of queue) {
        const text = String(action?.text || '').trim();
        if (!text) continue;
        if (!action?.done || !keepLegacyProgress) {
          summary.droppedActions.push(`${templateStep.stepKey} :: ${text}`);
          continue;
        }
        mergedActions.push({ text, done: true, ...(action?.doneAt ? { doneAt: action.doneAt } : {}) });
        summary.keptLegacyActions.push(`${templateStep.stepKey} :: ${text}`);
      }
    }

    const templateStepPercentage = parsePercentage(templateStepByKey.get(String(templateStep.stepKey))?.percentage);
    const templateStagePercentage = parsePercentage(templateStageByKey.get(String(templateStep.stageKey))?.percentage);

    return {
      ...templateStep,
      // A live step keeps its own deadline; only brand-new steps get fresh ones.
      startAt: previous?.startAt ? new Date(previous.startAt) : templateStep.startAt,
      dueAt: previous?.dueAt ? new Date(previous.dueAt) : templateStep.dueAt,
      percentage:
        templateStepPercentage === undefined && Number(previous?.percentage) > 0
          ? Number(previous.percentage)
          : templateStep.percentage,
      stagePercentage:
        templateStagePercentage === undefined && Number(previous?.stagePercentage) > 0
          ? Number(previous.stagePercentage)
          : templateStep.stagePercentage,
      status: previous?.status || templateStep.status,
      completedAt: previous?.completedAt,
      submittedAt: previous?.submittedAt,
      reviewedAt: previous?.reviewedAt,
      extensionHistory: Array.isArray(previous?.extensionHistory) ? previous.extensionHistory : [],
      actions: mergedActions,
      outputs: templateStep.outputs,
    };
  });

  // Steps the template no longer defines: only those with real progress stay
  // (unless the caller explicitly prunes completed legacy work too).
  const builtKeys = new Set(builtSteps.map((step: any) => String(step?.stepKey || '')));
  let nextOrder = steps.length;
  for (const step of Array.isArray(existingSteps) ? existingSteps : []) {
    if (builtKeys.has(String(step?.stepKey || ''))) continue;
    const hasCompletedAction = (Array.isArray(step?.actions) ? step.actions : []).some((action: any) => action?.done);
    const isCompleted = String(step?.status || '') === 'Completed';
    if (!keepLegacyProgress || (!hasCompletedAction && !isCompleted)) {
      summary.droppedSteps.push(`${String(step?.stepKey || '')} :: ${String(step?.title || '')}`.trim());
      continue;
    }
    nextOrder += 1;
    steps.push({ ...step, order: nextOrder });
    summary.keptLegacySteps.push(`${String(step?.stepKey || '')} :: ${String(step?.title || '')}`.trim());
  }

  return { steps, summary };
};

