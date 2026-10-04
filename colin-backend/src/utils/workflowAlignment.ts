/**
 * Align a live case workflow with its canonical template.
 *
 * This is the repair path used when a case was created against a template that
 * has since been deleted, replaced or duplicated. The case checklist is
 * rebuilt from the template so the Case Workspace always shows exactly the Key
 * Actions defined in Templates settings, while nothing that carries progress is
 * destroyed:
 *
 * - a step keeps its own deadline, status, completion stamp and extensions;
 * - the per-step sub-checklist is retired: every stored checklist item leaves
 *   the active checklist; when it was ticked, its record (text, tick and
 *   timestamp) is returned so the caller archives it on the instance instead of
 *   losing the finished work;
 * - an unticked leftover of an older checklist is simply dropped;
 * - a whole step that is not in the template is ARCHIVED, not listed: it leaves
 *   the active checklist (so the Case Workspace, Case Management and the earned
 *   fees only ever show the current template's stages and Key Actions) while the
 *   full record is returned so it can be stored on `archivedSteps` and is never
 *   destroyed. Carrying it in the active list is what used to double-count a
 *   superseded template against the contract value;
 * - percentages absent from the template never zero a value the case already
 *   stores (the same rule the normal template sync applies).
 */

import { buildInstanceSteps } from './workflowCompute';
import { parsePercentage } from './workflowPercentages';
import { stripManualNumberPrefix } from './workflowText';

const actionKey = (value: unknown) =>
  stripManualNumberPrefix(value).replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A ticked checklist item taken off the active checklist when the per-step
 * sub-checklist was retired. The caller stores these records on the instance
 * so finished work is never destroyed.
 */
export type ArchivedActionRecord = {
  stepKey: string;
  stepTitle: string;
  text: string;
  done: boolean;
  doneAt?: any;
  reason: 'sub-checklist-retired';
};

export type WorkflowAlignmentSummary = {
  templateSteps: number;
  matchedSteps: number;
  addedTemplateSteps: number;
  addedActions: number;
  droppedSteps: string[];
  droppedActions: string[];
  keptLegacySteps: string[];
  /** Ticked checklist items archived off the checklist (labels). */
  archivedLegacyActions: string[];
};

export type WorkflowAlignmentResult = {
  /** The active checklist — exactly the template's stages and Key Actions. */
  steps: any[];
  /** Superseded steps, preserved so the caller can archive rather than lose them. */
  archivedSteps: any[];
  /** Ticked checklist items, preserved so the caller can archive them. */
  archivedActions: ArchivedActionRecord[];
  summary: WorkflowAlignmentSummary;
};

/**
 * True when the case carries a step the template no longer defines. A matter can
 * drift like this while still being linked to the canonical template (an earlier
 * alignment kept the old steps), so this is what lets the repair run again.
 */
export const hasSupersededTemplateSteps = (existingSteps: any[] | undefined, template: any): boolean => {
  const templateKeys = new Set(
    (Array.isArray(template?.steps) ? template.steps : []).map((step: any) => String(step?.key || ''))
  );
  if (!templateKeys.size) return false;
  return (Array.isArray(existingSteps) ? existingSteps : []).some(
    (step: any) => !templateKeys.has(String(step?.stepKey || ''))
  );
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
    archivedLegacyActions: [],
  };

  const archivedActions: ArchivedActionRecord[] = [];

  const steps: any[] = builtSteps.map((templateStep: any) => {
    const previous: any = previousByKey.get(String(templateStep.stepKey));
    if (previous) summary.matchedSteps += 1;
    else summary.addedTemplateSteps += 1;

    // The per-step sub-checklist is retired: every checklist item the case
    // stores leaves the active checklist. Ticked work is never lost — its
    // record (text, tick and timestamp) is returned for the caller to archive.
    for (const action of Array.isArray(previous?.actions) ? previous.actions : []) {
      const text = stripManualNumberPrefix(String(action?.text || ''));
      const key = actionKey(text);
      if (!text || !key) continue;
      summary.droppedActions.push(`${templateStep.stepKey} :: ${text}`);
      if (!action?.done || !keepLegacyProgress) continue;
      archivedActions.push({
        stepKey: String(templateStep.stepKey),
        stepTitle: String(templateStep.title || ''),
        text,
        done: true,
        ...(action?.doneAt ? { doneAt: action.doneAt } : {}),
        reason: 'sub-checklist-retired',
      });
      summary.archivedLegacyActions.push(`${templateStep.stepKey} :: ${text}`);
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
      actions: [],
      outputs: templateStep.outputs,
    };
  });

  // Steps the template no longer defines are removed from the active checklist
  // and returned separately so the caller can archive them. `keepLegacyProgress`
  // decides whether superseded work that carries progress is archived (the
  // default) or dropped outright (opt-in pruning) — either way it never stays on
  // the checklist.
  const builtKeys = new Set(builtSteps.map((step: any) => String(step?.stepKey || '')));
  const archivedSteps: any[] = [];
  for (const step of Array.isArray(existingSteps) ? existingSteps : []) {
    const stepKey = String(step?.stepKey || '');
    if (builtKeys.has(stepKey)) continue;
    const label = `${stepKey} :: ${String(step?.title || '')}`.trim();
    const hasCompletedAction = (Array.isArray(step?.actions) ? step.actions : []).some((action: any) => action?.done);
    const isCompleted = String(step?.status || '') === 'Completed';
    if (!hasCompletedAction && !isCompleted) {
      summary.droppedSteps.push(label);
      continue;
    }
    if (!keepLegacyProgress) {
      summary.droppedSteps.push(label);
      continue;
    }
    archivedSteps.push({ ...step, archivedFromTemplate: true, archivedAt: new Date() });
    summary.keptLegacySteps.push(label);
  }

  return { steps, archivedSteps, archivedActions, summary };
};

