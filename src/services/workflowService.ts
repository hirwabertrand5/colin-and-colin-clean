const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export type WorkflowTemplate = {
  _id: string;
  name: string;
  matterType: string;
  caseType: 'Transactional Cases' | 'Litigation Cases' | 'Labor Cases';
  version: number;
  active: boolean;
  stages: Array<{
    _id?: string;
    key: string;
    name: string;
    order: number;
    fee?: {
      amount: number;
      currency: string;
    };
    sla?: {
      days: number;
      hours?: number;
    };
    steps?: string[];
  }>;
  steps: Array<{
    _id?: string;
    key: string;
    title: string;
    stageKey: string;
    order: number;
    description?: string;
    actions?: string[];
    fee?: {
      amount: number;
      currency: string;
    };
    sla?: {
      days: number;
      hours?: number;
    };
    outputs?: Array<{
      key: string;
      name: string;
      required: boolean;
      category?: string;
    }>;
  }>;
};

export const listActiveWorkflowTemplates = async (): Promise<WorkflowTemplate[]> => {
  const res = await fetch(`${API_URL}/workflows/templates/active`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load workflow templates');
  return res.json();
};

export const listAllWorkflowTemplates = async (): Promise<WorkflowTemplate[]> => {
  const res = await fetch(`${API_URL}/workflows/templates`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load workflow templates');
  return res.json();
};

export const createWorkflowTemplate = async (payload: Partial<WorkflowTemplate>): Promise<WorkflowTemplate> => {
  const res = await fetch(`${API_URL}/workflows/templates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to create template');
  return res.json();
};

export const updateWorkflowTemplate = async (templateId: string, payload: any): Promise<WorkflowTemplate> => {
  const res = await fetch(`${API_URL}/workflows/templates/${templateId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to update template');
  return res.json();
};

export const deleteWorkflowTemplate = async (templateId: string): Promise<void> => {
  const res = await fetch(`${API_URL}/workflows/templates/${templateId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to delete template');
};

export const getWorkflowTemplateById = async (templateId: string): Promise<WorkflowTemplate> => {
  const res = await fetch(`${API_URL}/workflows/templates/${templateId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load workflow template');
  return res.json();
};