import { getContractValue } from './financialMetrics';
import { resolveStepPercentages } from './workflowPercentages';

/**
 * A workflow-template step is the billable Key Action.  The template's
 * percentage is its literal share of the matter contract value.
 *
 * Earnings can only be calculated from cash which has actually been collected
 * for the matter.  Outstanding invoices and billing/progress values are never
 * used as an earnings base.
 */
export type CompletedKeyAction = {
  key: string;
  title: string;
  percentage: number;
  completedAt?: Date | string;
  source: 'workflow' | 'task';
};

export type KeyActionEarnings = {
  contractValue: number;
  collectedAmount: number;
  completedPercent: number;
  completedValue: number;
  eligibleCollectedValue: number;
  completedActions: CompletedKeyAction[];
};

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
const clampPercent = (value: unknown) => Math.max(0, Math.min(100, Number(value) || 0));

const normalizedText = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const isWorkflowStepComplete = (step: any) => {
  if (String(step?.status || '').toLowerCase() === 'completed') return true;
  const actions = Array.isArray(step?.actions) ? step.actions : [];
  return actions.length > 0 && actions.every((action: any) => Boolean(action?.done));
};

const isTaskChecklistComplete = (task: any) => {
  if (String(task?.status || '').toLowerCase() === 'completed') return true;
  const checklist = Array.isArray(task?.checklist) ? task.checklist : [];
  return checklist.length > 0 && checklist.every((item: any) => Boolean(item?.completed));
};

/**
 * Resolve a task to a template Key Action.  New tasks store workflowStepKey;
 * title matching is retained only for legacy tasks.  We deliberately do not
 * match a nested checklist item to a whole Key Action, because one checked
 * sub-item must not earn the percentage for the entire action.
 */
const resolveTaskKeyActionKey = (templateSteps: any[], task: any) => {
  const explicit = String(task?.workflowStepKey || '').trim();
  if (explicit && templateSteps.some((step) => String(step?.key || '') === explicit)) return explicit;

  const candidates = [normalizedText(task?.title), normalizedText(task?.description)].filter(Boolean);
  for (const candidate of candidates) {
    const matches = templateSteps.filter((step) => normalizedText(step?.title) === candidate);
    if (matches.length === 1) return String(matches[0]?.key || '');
  }
  return '';
};

/**
 * Return completed, unique Key Actions from the Case Workspace workflow and
 * linked task-detail checklists.  A Case Workspace completion and a task
 * completion of the same template action are intentionally counted once.
 */
export const resolveCompletedKeyActions = (
  template: any,
  workflowInstance?: any,
  tasks: any[] = []
): CompletedKeyAction[] => {
  const templateSteps = Array.isArray(template?.steps) ? template.steps : [];
  const percentageByKey = resolveStepPercentages(template);
  const instanceSteps = Array.isArray(workflowInstance?.steps) ? workflowInstance.steps : [];
  const instanceByKey = new Map<string, any>(
    instanceSteps.map((step: any) => [String(step?.stepKey || ''), step])
  );
  const completedByTask = new Map<string, any>();

  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!isTaskChecklistComplete(task)) continue;
    const key = resolveTaskKeyActionKey(templateSteps, task);
    if (key && !completedByTask.has(key)) completedByTask.set(key, task);
  }

  const actions: CompletedKeyAction[] = [];
  const knownKeys = new Set<string>();
  for (const templateStep of templateSteps) {
    const key = String(templateStep?.key || '').trim();
    if (!key) continue;
    knownKeys.add(key);
    const instanceStep = instanceByKey.get(key);
    const task = completedByTask.get(key);
    if (!isWorkflowStepComplete(instanceStep) && !task) continue;
    actions.push({
      key,
      title: String(templateStep?.title || instanceStep?.title || key),
      percentage: clampPercent(percentageByKey.get(key)),
      completedAt: instanceStep?.completedAt || task?.completedAt || task?.updatedAt,
      source: isWorkflowStepComplete(instanceStep) ? 'workflow' : 'task',
    });
  }

  // Preserve visible earnings for a legacy instance whose template is missing.
  for (const step of instanceSteps) {
    const key = String(step?.stepKey || '').trim();
    if (!key || knownKeys.has(key) || !isWorkflowStepComplete(step)) continue;
    actions.push({
      key,
      title: String(step?.title || key),
      percentage: clampPercent(step?.percentage),
      completedAt: step?.completedAt,
      source: 'workflow',
    });
  }

  return actions;
};

/**
 * Calculate the common, collection-safe base used by every earnings screen.
 * Example: a 4% completed Key Action on a 5,000 contract is worth 200.  If
 * 200+ has been collected it contributes 200; if only 100 has been collected,
 * the total eligible base is capped at the actual 100 received.
 */
export const calculateCollectedKeyActionEarnings = ({
  matter,
  template,
  workflowInstance,
  tasks = [],
  collectedAmount = 0,
}: {
  matter: any;
  template: any;
  workflowInstance?: any;
  tasks?: any[];
  collectedAmount?: number;
}): KeyActionEarnings => {
  const contractValue = roundMoney(getContractValue(matter));
  const completedActions = resolveCompletedKeyActions(template, workflowInstance, tasks);
  const completedPercent = Math.min(
    100,
    Math.round(completedActions.reduce((sum, action) => sum + action.percentage, 0) * 100) / 100
  );
  const completedValue = roundMoney(contractValue * (completedPercent / 100));
  const collected = roundMoney(Math.max(0, Number(collectedAmount) || 0));

  return {
    contractValue,
    collectedAmount: collected,
    completedPercent,
    completedValue,
    eligibleCollectedValue: roundMoney(Math.min(completedValue, collected)),
    completedActions,
  };
};

/** Allocate a collection-safe aggregate base across completed Key Actions. */
export const allocateCollectedValueAcrossKeyActions = (earnings: KeyActionEarnings) => {
  const completedValue = earnings.completedValue;
  if (completedValue <= 0 || earnings.eligibleCollectedValue <= 0) {
    return new Map(earnings.completedActions.map((action) => [action.key, 0]));
  }

  const ratio = Math.min(1, earnings.eligibleCollectedValue / completedValue);
  return new Map(
    earnings.completedActions.map((action) => [
      action.key,
      roundMoney(earnings.contractValue * (action.percentage / 100) * ratio),
    ])
  );
};
