const API_URL = import.meta.env.VITE_API_URL;

export type CaseType = 'Transactional Cases' | 'Litigation Cases' | 'Labor Cases';

export type ClientContact = {
  name?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
};

export type LegalServicePathItem = {
  id: string;
  label: string;
};

export interface CaseData {
  _id?: string;
  caseNo: string;
  parties: string;
  caseType: CaseType;
  status: string;
  priority: string;
  assignedTo: string;
  description?: string;
  legalServicePath?: LegalServicePathItem[];

  clientContacts?: ClientContact[];
  reporting?: {
    weeklyEnabled?: boolean;
    monthlyEnabled?: boolean;
    onUpdateEnabled?: boolean;
    lastGeneratedAt?: string;
    lastSentAt?: string;
  };

  workflow?: string;
  estimatedDuration?: string;
  budget?: string;

  // ✅ workflow fields
  matterType?: string;
  workflowTemplateId?: string;
  workflowInstanceId?: string;
  workflowStartDate?: string;
  workflowProgress?: {
    status?: 'Not Started' | 'In Progress' | 'Completed';
    currentStepKey?: string;
    currentStepTitle?: string;
    currentStepStartAt?: string;
    currentStepDueAt?: string;
    percent?: number;
    nextDueAt?: string;
    plannedValue?: { amount?: number; currency?: string };
    completedValue?: { amount?: number; currency?: string };
  };

  billingSettings?: {
    paymentMode?: 'prepaid' | 'postpaid';
    currency?: string;
    prepaidTotal?: number;
    prepaidRemaining?: number;
    accruedUnbilled?: number;
  };

  initialWorkflowActions?: Record<string, number[]>;

  createdAt?: string;
  updatedAt?: string;
}

const getToken = () => localStorage.getItem('token');

export const getAllCases = async (): Promise<CaseData[]> => {
  const res = await fetch(`${API_URL}/cases`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to fetch cases');
  return res.json();
};

export const createCase = async (caseData: CaseData): Promise<CaseData> => {
  const res = await fetch(`${API_URL}/cases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(caseData),
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to create case');
  return res.json();
};

export const getCaseById = async (id: string): Promise<CaseData> => {
  const res = await fetch(`${API_URL}/cases/${id}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to fetch case');
  return res.json();
};

export const updateCase = async (caseId: string, updates: Partial<CaseData>): Promise<CaseData> => {
  const res = await fetch(`${API_URL}/cases/${caseId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to update case');
  return res.json();
};

export const deleteCase = async (caseId: string): Promise<void> => {
  const res = await fetch(`${API_URL}/cases/${caseId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to delete case');
};

export const getActiveCasesCount = async () => {
  const res = await fetch(`${API_URL}/cases/stats/active`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load active cases count');
  return res.json();
};
