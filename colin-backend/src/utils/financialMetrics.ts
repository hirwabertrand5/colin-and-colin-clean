type MoneySource = {
  amount?: number | string | null;
  currency?: string;
};

type CaseLike = {
  budget?: string | number | null;
  updatedAt?: Date | string;
  workflowProgress?: {
    percent?: number | null;
    plannedValue?: MoneySource | null;
    completedValue?: MoneySource | null;
  } | null;
  billingSettings?: {
    accruedUnbilled?: number | string | null;
  } | null;
};

type ExpenseLike = {
  amount?: number | string | null;
  refundAmount?: number | string | null;
  chargeType?: 'internal' | 'client' | string | null;
  caseId?: unknown;
  date?: string | Date | null;
};

export const parseMoneyValue = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.-]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

export const getNegotiatedPlannedValue = (matter: CaseLike): number => {
  const planned = parseMoneyValue(matter.workflowProgress?.plannedValue?.amount);
  if (planned > 0) return planned;
  return parseMoneyValue(matter.budget);
};

export const getCollectedValueFromProgress = (matter: CaseLike): number => {
  const completed = parseMoneyValue(matter.workflowProgress?.completedValue?.amount);
  if (completed > 0) return completed;

  const planned = getNegotiatedPlannedValue(matter);
  const percent = Number(matter.workflowProgress?.percent) || 0;
  if (planned > 0 && percent > 0) {
    return Math.round((planned * percent) / 100);
  }

  const accrued = parseMoneyValue(matter.billingSettings?.accruedUnbilled);
  return accrued > 0 ? accrued : 0;
};

export const getDirectMatterCost = (expense: ExpenseLike): number => {
  const gross = parseMoneyValue(expense.amount);
  const refunded = parseMoneyValue(expense.refundAmount);
  return Math.max(0, gross - refunded);
};

export const isCaseLinkedExpense = (expense: ExpenseLike) => Boolean(expense.caseId);

