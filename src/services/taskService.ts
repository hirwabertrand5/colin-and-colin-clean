const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export type TaskApprovalStatus = 'Not Required' | 'Draft' | 'Pending' | 'Approved' | 'Rejected';
export type TaskStatus = 'Not Started' | 'In Progress' | 'Completed';
export type TaskPriority = 'High' | 'Medium' | 'Low';

export type TaskChecklistItem = {
  _id: string;
  item: string;
  completed: boolean;
};

export type TimeLog = {
  _id: string;
  taskId: string;
  caseId: string;
  userName: string;
  hours: number;
  note?: string;
  loggedAt: string;
  createdAt: string;
};

export interface TaskData {
  _id: string;
  caseId: string;

  title: string;
  priority: TaskPriority;
  status: TaskStatus;

  assignee: string;
  dueDate: string;
  description?: string;

  requiresApproval: boolean;
  approvalStatus: TaskApprovalStatus;
  submittedAt?: string;
  approvedAt?: string;
  completedAt?: string;
  approvedBy?: string;
  approvalComment?: string;

  estimatedHours?: number;
  assignedBy?: string;
  checklist?: TaskChecklistItem[];

  createdAt?: string;
  updatedAt?: string;
}

const authHeaders = (extra?: Record<string, string>) => ({
  ...(extra || {}),
  Authorization: `Bearer ${getToken()}`,
});

export const getTasksForCase = async (caseId: string): Promise<TaskData[]> => {
  const res = await fetch(`${API_URL}/cases/${caseId}/tasks`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to fetch tasks');
  return res.json();
};

export const addTaskToCase = async (
  caseId: string,
  task: Omit<TaskData, '_id' | 'caseId' | 'createdAt' | 'updatedAt'> & Partial<Pick<TaskData, 'caseId'>>
): Promise<TaskData> => {
  const res = await fetch(`${API_URL}/cases/${caseId}/tasks`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(task),
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to create task');
  return res.json();
};

export const getAllTasks = async (params?: {
  q?: string;
  status?: TaskStatus | 'all';
  priority?: TaskPriority | 'all';
  approvalStatus?: TaskApprovalStatus | 'all';
}): Promise<TaskData[]> => {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.status && params.status !== 'all') qs.set('status', params.status);
  if (params?.priority && params.priority !== 'all') qs.set('priority', params.priority);
  if (params?.approvalStatus && params.approvalStatus !== 'all')
    qs.set('approvalStatus', params.approvalStatus);

  const res = await fetch(`${API_URL}/tasks?${qs.toString()}`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to fetch tasks');
  return res.json();
};

export const getTaskById = async (taskId: string): Promise<TaskData> => {
  const res = await fetch(`${API_URL}/tasks/${taskId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to fetch task');
  return res.json();
};

export const updateTask = async (taskId: string, updates: Partial<TaskData>): Promise<TaskData> => {
  const res = await fetch(`${API_URL}/tasks/${taskId}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to update task');
  return res.json();
};

export const deleteTask = async (taskId: string): Promise<void> => {
  const res = await fetch(`${API_URL}/tasks/${taskId}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to delete task');
};

export const submitTaskForApproval = async (taskId: string): Promise<TaskData> => {
  const res = await fetch(`${API_URL}/tasks/${taskId}/submit`, { method: 'POST', headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to submit task');
  return res.json();
};

export const approveTask = async (taskId: string, comment?: string): Promise<TaskData> => {
  const res = await fetch(`${API_URL}/tasks/${taskId}/approve`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ comment: comment || '' }),
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to approve task');
  return res.json();
};

export const rejectTask = async (taskId: string, comment?: string): Promise<TaskData> => {
  const res = await fetch(`${API_URL}/tasks/${taskId}/reject`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ comment: comment || '' }),
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to reject task');
  return res.json();
};

export const addChecklistItem = async (taskId: string, item: string): Promise<TaskData> => {
  const res = await fetch(`${API_URL}/tasks/${taskId}/checklist`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ item }),
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to add checklist item');
  return res.json();
};

export const toggleChecklistItem = async (taskId: string, itemId: string): Promise<TaskData> => {
  const res = await fetch(`${API_URL}/tasks/${taskId}/checklist/${itemId}/toggle`, {
    method: 'PATCH',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to update checklist item');
  return res.json();
};

export const deleteChecklistItem = async (taskId: string, itemId: string): Promise<TaskData> => {
  const res = await fetch(`${API_URL}/tasks/${taskId}/checklist/${itemId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to delete checklist item');
  return res.json();
};

export const getTimeLogsForTask = async (
  taskId: string
): Promise<{ logs: TimeLog[]; totalHours: number }> => {
  const res = await fetch(`${API_URL}/tasks/${taskId}/time-logs`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to fetch time logs');
  return res.json();
};

export const addTimeLogToTask = async (
  taskId: string,
  payload: { hours: number; note?: string; loggedAt?: string }
): Promise<TimeLog> => {
  const res = await fetch(`${API_URL}/tasks/${taskId}/time-logs`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to log hours');
  return res.json();
};
