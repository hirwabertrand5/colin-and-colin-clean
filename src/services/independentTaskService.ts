const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const getToken = () => localStorage.getItem('token');

export type IndependentTaskPriority = 'Low' | 'Medium' | 'High' | 'Critical';
export type IndependentTaskStatus =
  | 'Created'
  | 'Assigned'
  | 'Acknowledged'
  | 'In Progress'
  | 'Awaiting Review'
  | 'Awaiting External Action'
  | 'Completed'
  | 'Closed';

export interface IndependentTaskMatter {
  _id: string;
  caseNo?: string;
  parties?: string;
  status?: string;
  assignedTo?: string;
}

export interface IndependentTaskHistory {
  _id: string;
  taskId: string;
  action: string;
  message: string;
  detail?: string;
  actorName: string;
  createdAt: string;
}

export interface IndependentTaskComment {
  _id: string;
  taskId: string;
  parentCommentId?: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface IndependentTaskAttachment {
  _id: string;
  taskId: string;
  fileName: string;
  originalName: string;
  fileSize: string;
  uploadedBy: string;
  uploadedDate: string;
  url: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IndependentTask {
  _id: string;
  taskNumber: string;
  title: string;
  description?: string;
  relatedMatterId?: string | null;
  relatedMatterLabel?: string;
  relatedMatter?: IndependentTaskMatter | null;
  relatedClient?: string;
  assignee: string;
  supervisor: string;
  priority: IndependentTaskPriority;
  status: IndependentTaskStatus;
  startDate: string;
  dueDate: string;
  completedAt?: string;
  closedAt?: string;
  createdBy?: string;
  assignedBy?: string;
  lastActionBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface IndependentTaskListResponse {
  items: IndependentTask[];
  total: number;
  page: number;
  limit: number;
}

export interface IndependentTaskDashboard {
  summary: {
    totalTasks: number;
    openTasks: number;
    inProgress: number;
    awaitingReview: number;
    awaitingExternalAction: number;
    completed: number;
    closed: number;
    overdueTasks: number;
    criticalTasks: number;
  };
  priorityDistribution: { priority: IndependentTaskPriority; count: number }[];
  recentActivities: IndependentTaskHistory[];
  upcomingDeadlines: IndependentTask[];
  assignedToMe: IndependentTask[];
  tasksDueToday: IndependentTask[];
}

const authHeaders = (extra?: Record<string, string>) => ({
  ...(extra || {}),
  Authorization: `Bearer ${getToken()}`,
});

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || 'Request failed');
  }
  return res.json();
};

export const getIndependentTaskDashboard = async (): Promise<IndependentTaskDashboard> => {
  const res = await fetch(`${API_URL}/independent-tasks/dashboard`, { headers: authHeaders() });
  return json<IndependentTaskDashboard>(res);
};

export const listIndependentTasks = async (params?: {
  q?: string;
  status?: IndependentTaskStatus | 'all';
  priority?: IndependentTaskPriority | 'all';
  assignee?: string;
  supervisor?: string;
  matterId?: string;
  page?: number;
  limit?: number;
  sortBy?: 'dueDate' | 'createdAt' | 'priority' | 'status' | 'taskNumber';
  sortDir?: 'asc' | 'desc';
}): Promise<IndependentTaskListResponse> => {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.status && params.status !== 'all') qs.set('status', params.status);
  if (params?.priority && params.priority !== 'all') qs.set('priority', params.priority);
  if (params?.assignee) qs.set('assignee', params.assignee);
  if (params?.supervisor) qs.set('supervisor', params.supervisor);
  if (params?.matterId) qs.set('matterId', params.matterId);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.sortBy) qs.set('sortBy', params.sortBy);
  if (params?.sortDir) qs.set('sortDir', params.sortDir);
  const res = await fetch(`${API_URL}/independent-tasks?${qs.toString()}`, { headers: authHeaders() });
  return json<IndependentTaskListResponse>(res);
};

export const getIndependentTask = async (taskId: string): Promise<IndependentTask> => {
  const res = await fetch(`${API_URL}/independent-tasks/${taskId}`, { headers: authHeaders() });
  return json<IndependentTask>(res);
};

export const createIndependentTask = async (payload: Partial<IndependentTask> & Record<string, any>): Promise<IndependentTask> => {
  const res = await fetch(`${API_URL}/independent-tasks`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return json<IndependentTask>(res);
};

export const updateIndependentTask = async (taskId: string, payload: Partial<IndependentTask> & Record<string, any>): Promise<IndependentTask> => {
  const res = await fetch(`${API_URL}/independent-tasks/${taskId}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return json<IndependentTask>(res);
};

export const transitionIndependentTask = async (taskId: string, status: IndependentTaskStatus): Promise<IndependentTask> => {
  const res = await fetch(`${API_URL}/independent-tasks/${taskId}/transition`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status }),
  });
  return json<IndependentTask>(res);
};

export const deleteIndependentTask = async (taskId: string): Promise<void> => {
  const res = await fetch(`${API_URL}/independent-tasks/${taskId}`, { method: 'DELETE', headers: authHeaders() });
  await json<void>(res);
};

export const getIndependentTaskHistory = async (taskId: string): Promise<IndependentTaskHistory[]> => {
  const res = await fetch(`${API_URL}/independent-tasks/${taskId}/history`, { headers: authHeaders() });
  return json<IndependentTaskHistory[]>(res);
};

export const listIndependentTaskComments = async (taskId: string): Promise<IndependentTaskComment[]> => {
  const res = await fetch(`${API_URL}/independent-tasks/${taskId}/comments`, { headers: authHeaders() });
  return json<IndependentTaskComment[]>(res);
};

export const addIndependentTaskComment = async (taskId: string, payload: { body: string; parentCommentId?: string | null }) => {
  const res = await fetch(`${API_URL}/independent-tasks/${taskId}/comments`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return json<IndependentTaskComment>(res);
};

export const listIndependentTaskAttachments = async (taskId: string): Promise<IndependentTaskAttachment[]> => {
  const res = await fetch(`${API_URL}/independent-tasks/${taskId}/attachments`, { headers: authHeaders() });
  return json<IndependentTaskAttachment[]>(res);
};

export const uploadIndependentTaskAttachment = async (
  taskId: string,
  payload: { file: File; fileName?: string; note?: string }
): Promise<IndependentTaskAttachment> => {
  const formData = new FormData();
  formData.append('file', payload.file);
  if (payload.fileName) formData.append('fileName', payload.fileName);
  if (payload.note) formData.append('note', payload.note);
  const res = await fetch(`${API_URL}/independent-tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  return json<IndependentTaskAttachment>(res);
};

export const deleteIndependentTaskAttachment = async (attachmentId: string): Promise<void> => {
  const res = await fetch(`${API_URL}/independent-task-attachments/${attachmentId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await json<void>(res);
};
