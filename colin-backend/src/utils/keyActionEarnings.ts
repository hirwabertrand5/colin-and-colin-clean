import { getContractValue } from './financialMetrics';

/** A completed workflow template step is a completed Key Action. */
export type CompletedKeyAction = {
  key: string;
  title: string;
  percentage: number;
  completedAt?: Date | string;
  source: 'workflow' | 'task';
};

export type KeyActionProgress = {
  key: string;
  title: string;
  /** Null distinguishes an unconfigured percentage from an intentional 0%. */
  percentage: number | null;
  resolvedPercentage: number;
  progressValue: number;
  coveredValue: number;
  completed: boolean;
};

export type KeyActionEarnings = {
  contractValue: number;
  collectedAmount: number;
  completedPercent: number;
  completedValue: number;
  eligibleCollectedValue: number;
  completedActions: CompletedKeyAction[];
  keyActions: KeyActionProgress[];
  missingKeyActionPercentages: Array<{ key: string; title: string }>;
};

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
const clampPercent = (value: unknown) => Math.max(0, Math.min(100, Number(value) || 0));
const literalPercentage = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').trim().replace(/%$/, ''));
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
};
const normalizedText = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

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
 * Resolve completed actions without ever manufacturing a missing percentage.
 * This keeps missing configuration visible and prevents an unallocated action
 * from adding value or staff earnings.
 */
export const resolveCompletedKeyActions = (template: any, workflowInstance?: any, tasks: any[] = []): CompletedKeyAction[] => {
  const templateSteps = Array.isArray(template?.steps) ? template.steps : [];
  const instanceSteps = Array.isArray(workflowInstance?.steps) ? workflowInstance.steps : [];
  const instanceByKey = new Map<string, any>(instanceSteps.map((step: any) => [String(step?.stepKey || ''), step]));
  const completedByTask = new Map<string, any>();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!isTaskChecklistComplete(task)) continue;
    const key = resolveTaskKeyActionKey(templateSteps, task);
    if (key && !completedByTask.has(key)) completedByTask.set(key, task);
  }

  const result: CompletedKeyAction[] = [];
  const knownKeys = new Set<string>();
  for (const templateStep of templateSteps) {
    const key = String(templateStep?.key || '').trim();
    if (!key) continue;
    knownKeys.add(key);
    const instanceStep = instanceByKey.get(key);
    const task = completedByTask.get(key);
    if (!isWorkflowStepComplete(instanceStep) && !task) continue;
    result.push({
      key,
      title: String(templateStep?.title || instanceStep?.title || key),
      percentage: clampPercent(literalPercentage(templateStep?.percentage)),
      completedAt: instanceStep?.completedAt || task?.completedAt || task?.updatedAt,
      source: isWorkflowStepComplete(instanceStep) ? 'workflow' : 'task',
    });
  }
  for (const step of instanceSteps) {
    const key = String(step?.stepKey || '').trim();
    if (!key || knownKeys.has(key) || !isWorkflowStepComplete(step)) continue;
    result.push({ key, title: String(step?.title || key), percentage: clampPercent(literalPercentage(step?.percentage)), completedAt: step?.completedAt, source: 'workflow' });
  }
  return result;
};

const resolveKeyActionProgress = (template: any, workflowInstance: any, completed: CompletedKeyAction[], contractValue: number): KeyActionProgress[] => {
  const templateSteps = Array.isArray(template?.steps) ? template.steps : [];
  const instanceSteps = Array.isArray(workflowInstance?.steps) ? workflowInstance.steps : [];
  const completeKeys = new Set(completed.map((action) => action.key));
  const seen = new Set<string>();
  const sourceSteps = templateSteps.length ? templateSteps : instanceSteps.map((step: any) => ({ key: step?.stepKey, title: step?.title, percentage: step?.percentage }));
  return sourceSteps.flatMap((step: any) => {
    const key = String(step?.key || '').trim();
    if (!key || seen.has(key)) return [];
    seen.add(key);
    const percentage = literalPercentage(step?.percentage);
    const resolvedPercentage = percentage ?? 0;
    const progressValue = roundMoney(contractValue * (resolvedPercentage / 100));
    const isCompleted = completeKeys.has(key);
    return [{ key, title: String(step?.title || key), percentage, resolvedPercentage, progressValue, coveredValue: isCompleted ? progressValue : 0, completed: isCompleted }];
  });
};

/**
 * Contract value × completed Key Action percentage is the matter progress
 * value. Staff earnings are then capped by Paid invoice collections.
 */
export const calculateCollectedKeyActionEarnings = ({ matter, template, workflowInstance, tasks = [], collectedAmount = 0 }: { matter: any; template: any; workflowInstance?: any; tasks?: any[]; collectedAmount?: number }): KeyActionEarnings => {
  const contractValue = roundMoney(getContractValue(matter));
  const completedActions = resolveCompletedKeyActions(template, workflowInstance, tasks);
  const completedPercent = Math.min(100, Math.round(completedActions.reduce((sum, action) => sum + action.percentage, 0) * 100) / 100);
  const completedValue = roundMoney(contractValue * (completedPercent / 100));
  const collected = roundMoney(Math.max(0, Number(collectedAmount) || 0));
  const keyActions = resolveKeyActionProgress(template, workflowInstance, completedActions, contractValue);
  return {
    contractValue,
    collectedAmount: collected,
    completedPercent,
    completedValue,
    eligibleCollectedValue: roundMoney(Math.min(completedValue, collected)),
    completedActions,
    keyActions,
    missingKeyActionPercentages: keyActions.filter((action) => action.percentage === null).map(({ key, title }) => ({ key, title })),
  };
};

export const allocateCollectedValueAcrossKeyActions = (earnings: KeyActionEarnings) => {
  if (earnings.completedValue <= 0 || earnings.eligibleCollectedValue <= 0) return new Map(earnings.completedActions.map((action) => [action.key, 0]));
  const ratio = Math.min(1, earnings.eligibleCollectedValue / earnings.completedValue);
  return new Map(earnings.completedActions.map((action) => [action.key, roundMoney(earnings.contractValue * (action.percentage / 100) * ratio)]));
};
