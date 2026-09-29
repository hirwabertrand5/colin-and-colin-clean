const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export type WorkflowTemplate = {
  _id: string;
  createdAt?: string;
  updatedAt?: string;
  name: string;
  matterType: string;
  caseType: 'Transactional Cases' | 'Litigation Cases' | 'Labor Cases';
  version: number;
  active: boolean;
  /** Draft templates are kept in the same template collection but are never active. */
  draft?: boolean;
  stages: Array<{
    _id?: string;
    key: string;
    name?: string;
    order: number;
    title?: string;
    description?: string;
    percentage?: number;
    legalBasis?: Array<{
      text: string;
    }>;
    outputs?: Array<{
      key: string;
      name: string;
      required: boolean;
      category?: string;
    }>;
    sla?: WorkflowSlaSpec;
    steps?: string[];
  }>;
  steps: Array<{
    _id?: string;
    key: string;
    title: string;
    stageKey: string;
    order: number;
    description?: string;
    responsibleRole?: string;
    actions?: string[];
    percentage?: number;
    sla?: WorkflowSlaSpec;
    outputs?: Array<{
      key: string;
      name: string;
      required: boolean;
      category?: string;
    }>;
    legalBasis?: Array<{
      text: string;
    }>;
  }>;
};

export type WorkflowSlaSpec = {
  days?: number;
  hours?: number;
  unit?: 'hours' | 'days' | 'weeks';
  min?: number;
  max?: number;
  text?: string;
};

const normalizeTemplateMatchValue = (value: unknown) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * A matter type + case type can exist more than once in the templates
 * collection (older seeds, versioned re-imports). Picking the first document
 * found made the Case Workspace show one template's Key Actions while Templates
 * settings showed another. The canonical copy is always the published, newest,
 * most recently updated document — the same rule the backend applies.
 */
const workflowTemplateRank = (template: WorkflowTemplate): [number, number, number] => [
  template.active && !template.draft ? 1 : 0,
  Number(template.version) || 0,
  new Date(template.updatedAt || template.createdAt || 0).getTime() || 0,
];

const compareWorkflowTemplateRank = (a: WorkflowTemplate, b: WorkflowTemplate) => {
  const rankA = workflowTemplateRank(a);
  const rankB = workflowTemplateRank(b);
  for (let index = 0; index < rankA.length; index += 1) {
    const valueA = rankA[index] ?? 0;
    const valueB = rankB[index] ?? 0;
    if (valueA !== valueB) return valueA > valueB ? -1 : 1;
  }
  return 0;
};

export const findMatchingWorkflowTemplate = (
  templates: WorkflowTemplate[],
  matterType: string,
  caseType: WorkflowTemplate['caseType']
) =>
  (Array.isArray(templates) ? templates : [])
    .filter(
      (template) =>
        normalizeTemplateMatchValue(template.matterType) === normalizeTemplateMatchValue(matterType) &&
        template.caseType === caseType
    )
    .sort(compareWorkflowTemplateRank)[0];

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
