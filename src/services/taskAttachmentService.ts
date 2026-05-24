const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export interface TaskAttachment {
  _id: string;
  taskId: string;
  caseId: string;

  name: string;
  originalName: string;

  uploadedBy: string;
  uploadedDate: string;
  size: string;
  url: string;

  note?: string;

  createdAt: string;
}

const handleAuth = (res: Response) => {
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }
};

export const listTaskAttachments = async (taskId: string): Promise<TaskAttachment[]> => {
  const res = await fetch(`${API_URL}/tasks/${taskId}/attachments`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  handleAuth(res);
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to fetch task attachments');
  return res.json();
};

export const uploadTaskAttachment = async (
  taskId: string,
  payload: { name?: string; note?: string; file: File }
): Promise<TaskAttachment> => {
  const form = new FormData();
  if (payload.name) form.append('name', payload.name);
  if (payload.note) form.append('note', payload.note);
  form.append('file', payload.file);

  const res = await fetch(`${API_URL}/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });

  handleAuth(res);
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to upload attachment');
  return res.json();
};

export const deleteTaskAttachment = async (attachmentId: string): Promise<void> => {
  const res = await fetch(`${API_URL}/task-attachments/${attachmentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  handleAuth(res);
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to delete attachment');
};