const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export type WorkflowInstance = {
  _id: string;
  caseId: string;
  templateId: string;
  status: 'Active' | 'Completed';
  currentStepKey?: string;
  steps: Array<{
    stepKey: string;
    title: string;
    stageKey: string;
    order: number;
    status: 'Not Started' | 'In Progress' | 'Completed';
    startAt?: string;
    dueAt?: string;
    completedAt?: string;

    actions?: Array<{
      text: string;
      done: boolean;
      doneAt?: string;
    }>;

    feeAmount?: number;
    feeCurrency?: string;
    feeText?: string;
    feeRangeMin?: number;
    feeRangeMax?: number;
    feeInputRequired?: boolean;
    feeSetByUser?: boolean;

    slaMinutes?: number;
    slaText?: string;

    responsibleRole?: string;
    outputs: Array<{
      key: string;
      name: string;
      required: boolean;
      category?: string;
      documentId?: string;
      uploadedAt?: string;
    }>;
  }>;
};

export const getWorkflowForCase = async (caseId: string): Promise<WorkflowInstance> => {
  const res = await fetch(`${API_URL}/workflows/cases/${caseId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load workflow');
  return res.json();
};

export const completeWorkflowStep = async (caseId: string, stepKey: string): Promise<WorkflowInstance> => {
  const res = await fetch(`${API_URL}/workflows/cases/${caseId}/steps/${stepKey}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to complete step');
  return res.json();
};

export const reopenWorkflowStep = async (caseId: string, stepKey: string): Promise<WorkflowInstance> => {
  const res = await fetch(`${API_URL}/workflows/cases/${caseId}/steps/${stepKey}/reopen`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to reopen step');
  return res.json();
};

export const extendWorkflowStepDeadline = async (
  caseId: string,
  stepKey: string,
  extendDays: number,
  reason?: string
): Promise<WorkflowInstance> => {
  const res = await fetch(`${API_URL}/workflows/cases/${caseId}/steps/${stepKey}/extend-deadline`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ extendDays, reason }),
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to extend deadline');
  return res.json();
};

export const toggleWorkflowStepAction = async (
  caseId: string,
  stepKey: string,
  index: number
): Promise<WorkflowInstance> => {
  const res = await fetch(`${API_URL}/workflows/cases/${caseId}/steps/${stepKey}/actions/${index}/toggle`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Failed to update key action');
  return data;
};

export const setWorkflowStepFeeAmount = async (
  caseId: string,
  stepKey: string,
  amount: number,
  currency?: string
): Promise<WorkflowInstance> => {
  const res = await fetch(`${API_URL}/workflows/cases/${caseId}/steps/${stepKey}/fee`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ amount, ...(currency ? { currency } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Failed to set step fee');
  return data;
};
