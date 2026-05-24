const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export type FundStatus = 'active' | 'closed';

export interface PettyCashFund {
  _id: string;
  name: string;
  description?: string;
  currency: string;

  initialAmount: number;
  spentAmount: number;
  remainingAmount: number;

  status: FundStatus;

  lowBalancePercent: number;
  lowBalanceNotifiedAt?: string | null;
  topUps?: Array<{
    amount: number;
    note?: string;
    addedByName: string;
    addedAt: string;
  }>;

  createdByName: string;
  createdAt: string;
}

export interface PettyCashExpense {
  _id: string;
  fundId: string;
  date: string;
  title: string;
  category?: string;
  vendor?: string;

  chargeType?: 'internal' | 'client';
  caseId?: string;
  caseNoSnapshot?: string;
  partiesSnapshot?: string;
  amount: number;
  note?: string;
  receiptRef?: string;
  refundAmount?: number;
  refundedBy?: string;
  refundDate?: string;
  refundNote?: string;
  receiptUrl?: string; // single receipt (deprecated)
  receiptUrls?: string[]; // multiple receipts
  createdByName: string;
  createdAt: string;
}

const handleAuth = async (res: Response) => {
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Request failed');
  }
};

export const getActivePettyCashFund = async (): Promise<PettyCashFund | null> => {
  const res = await fetch(`${API_URL}/petty-cash/funds/active`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  await handleAuth(res);
  return res.json();
};

export const listPettyCashFunds = async (): Promise<PettyCashFund[]> => {
  const res = await fetch(`${API_URL}/petty-cash/funds`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  await handleAuth(res);
  return res.json();
};

export const createPettyCashFund = async (payload: {
  name: string;
  description?: string;
  initialAmount: number;
}): Promise<PettyCashFund> => {
  const res = await fetch(`${API_URL}/petty-cash/funds`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(payload),
  });
  await handleAuth(res);
  return res.json();
};

export const closeActivePettyCashFund = async (): Promise<void> => {
  const res = await fetch(`${API_URL}/petty-cash/funds/close`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  await handleAuth(res);
};

export const topUpActivePettyCashFund = async (payload: { amount: number; note?: string }): Promise<PettyCashFund> => {
  const res = await fetch(`${API_URL}/petty-cash/funds/top-up`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(payload),
  });
  await handleAuth(res);
  return res.json();
};

export const listExpensesForFund = async (fundId: string): Promise<PettyCashExpense[]> => {
  const res = await fetch(`${API_URL}/petty-cash/funds/${fundId}/expenses`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  await handleAuth(res);
  return res.json();
};

export const listExpensesForCase = async (caseId: string): Promise<PettyCashExpense[]> => {
  const res = await fetch(`${API_URL}/petty-cash/cases/${caseId}/expenses`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  await handleAuth(res);
  return res.json();
};

export const addExpenseToFund = async (
  fundId: string,
  payload: {
    date: string;
    title: string;
    amount: number;
    category?: string;
    vendor?: string;
    chargeType?: 'internal' | 'client';
    caseId?: string;
    note?: string;
    receiptRef?: string;
    refundAmount?: number;
    refundedBy?: string;
    receiptFiles?: File[];
  }
): Promise<void> => {
  const form = new FormData();
  form.append('date', payload.date);
  form.append('title', payload.title);
  form.append('amount', String(payload.amount));
  if (payload.category) form.append('category', payload.category);
  if (payload.vendor) form.append('vendor', payload.vendor);
  if (payload.chargeType) form.append('chargeType', payload.chargeType);
  if (payload.caseId) form.append('caseId', payload.caseId);
  if (payload.note) form.append('note', payload.note);
  if (payload.receiptRef) form.append('receiptRef', payload.receiptRef);
  if (payload.refundAmount) form.append('refundAmount', String(payload.refundAmount));
  if (payload.refundedBy) form.append('refundedBy', payload.refundedBy);
  if (payload.receiptFiles && payload.receiptFiles.length > 0) {
    payload.receiptFiles.forEach((file, index) => {
      form.append('files', file);
    });
  }

  const res = await fetch(`${API_URL}/petty-cash/funds/${fundId}/expenses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
  await handleAuth(res);
};

export const deleteExpense = async (expenseId: string): Promise<void> => {
  const res = await fetch(`${API_URL}/petty-cash/expenses/${expenseId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  await handleAuth(res);
};

export const addRefundToExpense = async (
  expenseId: string,
  payload: {
    refundAmount: number;
    refundedBy: string;
    date: string;
    note?: string;
  }
): Promise<void> => {
  const res = await fetch(`${API_URL}/petty-cash/expenses/${expenseId}/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(payload),
  });
  await handleAuth(res);
};
