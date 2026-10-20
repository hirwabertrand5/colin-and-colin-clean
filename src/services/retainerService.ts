const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });

export type RetainerBillingModel = 'prepaid' | 'monthly' | 'hybrid';
export type RetainerStatus = 'Draft' | 'Active' | 'Paused' | 'Closed';

export interface Retainer {
  _id: string;
  retainerNo: string;
  name: string;
  clientName: string;
  billingModel: RetainerBillingModel;
  status: RetainerStatus;
  effectiveStatus: RetainerStatus | 'Expired';
  isUsable: boolean;
  currency: 'RWF';
  startDate: string;
  endDate?: string;
  renewalDate?: string;
  billingDay?: number;
  monthlyFee: number;
  contractValue: number;
  /** Legacy API field; mirrored from contractValue during migration. */
  totalFunded: number;
  availableBalance: number;
  /** Always zero for shared retainer subscriptions. */
  reservedAmount: number;
  scope?: string;
  responsiblePartner?: string;
  notes?: string;
  linkedCaseCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type RetainerPayload = Omit<
  Partial<Retainer>,
  '_id' | 'retainerNo' | 'effectiveStatus' | 'isUsable' | 'currency' | 'totalFunded' | 'availableBalance' | 'reservedAmount'
> & {
  name: string;
  clientName: string;
  billingModel: RetainerBillingModel;
  status: RetainerStatus;
  startDate: string;
  contractValue?: number;
  monthlyFee?: number;
};

export interface RetainerActivity {
  _id: string;
  type: 'CONTRACT_VALUE_SET' | 'CONTRACT_VALUE_ADJUSTED' | 'CASE_LINKED' | 'CASE_UNLINKED' | 'OPENING_BALANCE' | 'TOP_UP' | 'CASE_RESERVED' | 'CASE_RELEASED' | 'ADJUSTMENT';
  amount: number;
  balanceAfter: number;
  note?: string;
  createdBy?: string;
  createdAt: string;
  case?: { _id: string; caseNo: string; parties: string } | null;
}

const readError = async (res: Response, fallback: string) => {
  const body = await res.json().catch(() => ({}));
  return body?.message || fallback;
};

export const listRetainers = async (params?: { status?: string; q?: string }): Promise<Retainer[]> => {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.q) query.set('q', params.q);
  const res = await fetch(`${API_URL}/retainers${query.toString() ? `?${query}` : ''}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res, 'Failed to fetch retainers.'));
  return res.json();
};

export const listActiveRetainers = async (): Promise<Retainer[]> => {
  const res = await fetch(`${API_URL}/retainers/active`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res, 'Failed to fetch active retainers.'));
  return res.json();
};

export const getRetainer = async (retainerId: string): Promise<Retainer> => {
  const res = await fetch(`${API_URL}/retainers/${retainerId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res, 'Failed to fetch retainer.'));
  return res.json();
};

export const createRetainer = async (payload: RetainerPayload): Promise<Retainer> => {
  const res = await fetch(`${API_URL}/retainers`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res, 'Failed to create retainer.'));
  return res.json();
};

export const updateRetainer = async (retainerId: string, payload: RetainerPayload): Promise<Retainer> => {
  const res = await fetch(`${API_URL}/retainers/${retainerId}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res, 'Failed to update retainer.'));
  return res.json();
};

export const deleteRetainer = async (retainerId: string): Promise<void> => {
  const res = await fetch(`${API_URL}/retainers/${retainerId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res, 'Failed to delete retainer.'));
};

export const adjustRetainerContractValue = async (retainerId: string, amount: number, note?: string): Promise<Retainer> => {
  const res = await fetch(`${API_URL}/retainers/${retainerId}/contract-value-adjustments`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, note }),
  });
  if (!res.ok) throw new Error(await readError(res, 'Failed to adjust retainer contract value.'));
  return res.json();
};

export type RetainerCase = {
  _id: string;
  caseNo: string;
  parties: string;
  status: string;
  contractValue: number;
  totalBilled: number;
  totalCollected: number;
  outstanding: number;
  directMatterCosts: number;
  grossProfit: number;
  profitStatus: 'Profitable' | 'Loss' | 'Break-even';
  updatedAt?: string;
};

export type RetainerCaseSummary = {
  caseCount: number;
  contractValue: number;
  totalBilled: number;
  totalCollected: number;
  outstanding: number;
  directMatterCosts: number;
  grossProfit: number;
  profitableCases: number;
  lossMakingCases: number;
};

export const getRetainerCases = async (retainerId: string): Promise<{ cases: RetainerCase[]; summary: RetainerCaseSummary }> => {
  const res = await fetch(`${API_URL}/retainers/${retainerId}/cases`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res, 'Failed to fetch retainer cases.'));
  return res.json();
};

export const getRetainerActivity = async (retainerId: string): Promise<RetainerActivity[]> => {
  const res = await fetch(`${API_URL}/retainers/${retainerId}/activity`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res, 'Failed to fetch retainer activity.'));
  return res.json();
};

export const setCaseRetainer = async (caseId: string, retainerId?: string) => {
  const res = await fetch(`${API_URL}/retainers/cases/${caseId}/link`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ retainerId }),
  });
  if (!res.ok) throw new Error(await readError(res, 'Failed to update case retainer coverage.'));
  return res.json();
};
