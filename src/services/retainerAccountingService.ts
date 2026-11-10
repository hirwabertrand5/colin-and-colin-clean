import { API_URL } from './apiConfig';
export type Department = 'Dispute Resolution' | 'Transaction & Advisory';
export type RetainerContributor = { userId: string; name: string; role: string; share: number; tpaPercent: number; production: number; allocatedRevenue: number; earnedTpa: number };
export type RetainerWork = { _id: string; caseId: string; matterNo: string; actionKey: string; title: string; performedOn: string; ordinaryFee: number; department: Department; contributors: RetainerContributor[]; approvedBy: string; allocatedRevenue: number; voidedAt?: string };
export type RetainerAllocation = {
  fixedFee: number; actualReceived: number; workValue: number; allocableRevenue: number; firmUnutilisedRevenue: number;
  outstanding: number; overpayment: number; utilisation: number; utilisationStatus: string; excessServiceValue: number;
  substantialOverutilisation: boolean; staffTpa: number; retainedAfterTpa: number; mattersCount: number; servicesCount: number;
  departments: { department: Department; ordinaryValue: number; share: number; allocatedRevenue: number }[]; services: RetainerWork[];
};
export type RetainerPeriod = { _id: string; retainerId: string; retainerNo: string; clientName: string; month: string; fixedFee: number; dueDate: string; status: 'Open' | 'Closed';
  services: RetainerWork[]; allocation: RetainerAllocation;
  receipts: { _id: string; reference: string; receivedOn: string; amount: number; sourceInvoiceId?: string; voidedAt?: string }[];
  history: { action: string; reason?: string; actor: string; at: string }[];
};
export type RetainerPerformance = { billed: number; collected: number; workValue: number; staffTpa: number; outstanding: number; unutilisedRevenue: number;
  statements: (RetainerPeriod & { workInRange: number; cashInRange: number; tpaInRange: number; feeInRange: number; cashAllocation: RetainerAllocation })[] };
export type WorkCandidate = { caseId: string; matterNo: string; actionKey: string; title: string; performedOn: string; ordinaryFee: number; department?: Department | null; assignedStaff: string[] };
export async function retainerAccounting<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/retainers/${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Unable to load retainer accounting.');
  return data;
}
