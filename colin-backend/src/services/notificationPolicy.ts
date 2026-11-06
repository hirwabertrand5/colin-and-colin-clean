export type PrefCategory = 'deadlines' | 'taskAssignments' | 'approvals' | 'matters' | 'pettyCashLow' | 'pettyCashCreated' | 'pettyCashExpenses';
export const categoryForType = (type: string): PrefCategory | undefined => {
  if (['TASK_DUE_REMINDER', 'EVENT_REMINDER', 'DEADLINE_CHANGED', 'EVENT_CHANGED', 'RETAINER_REMINDER', 'INTAKE_REMINDER'].includes(type)) return 'deadlines';
  if (type === 'INTAKE_SUBMISSION') return 'taskAssignments';
  if (type === 'TASK_ASSIGNED') return 'taskAssignments';
  if (['TASK_APPROVAL_REQUESTED', 'CASE_MANAGEMENT_REVIEW_REQUESTED', 'CASE_MANAGEMENT_APPROVAL_REQUESTED', 'CASE_MANAGEMENT_CHANGES_REQUESTED', 'APPROVAL_COMPLETED'].includes(type)) return 'approvals';
  if (type === 'WORKFLOW_NOTIFICATION') return 'matters';
  if (type === 'PETTY_CASH_LOW') return 'pettyCashLow';
  if (type === 'PETTY_CASH_CREATED') return 'pettyCashCreated';
  if (['PETTY_CASH_EXPENSE', 'PETTY_CASH_REFUND', 'PETTY_CASH_DIGEST'].includes(type)) return 'pettyCashExpenses';
  return undefined;
};
export const prefAllows = (prefs: any, category: string, type = '') => {
  if (prefs?.emailEnabled === false || prefs?.[`${category}Enabled`] === false) return false;
  if (category === 'pettyCashExpenses') {
    const mode = prefs?.pettyCashExpenseMode || 'daily';
    return type === 'PETTY_CASH_DIGEST' ? mode === 'daily' : mode === 'immediate';
  }
  return true; // Missing preferences retain schema defaults for existing users.
};
export const notificationEmailEnabled = () => process.env.NOTIFICATION_EMAIL_ENABLED === 'true';
export const emailAllowedInRollout = (address: string) => {
  const list = String(process.env.NOTIFICATION_EMAIL_ALLOWLIST || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  return !list.length || list.includes(address.toLowerCase());
};
