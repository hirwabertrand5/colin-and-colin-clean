const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export type NotificationPreferences = {
  _id?: string;
  userId?: string;

  emailEnabled: boolean;

  deadlinesEnabled: boolean;
  taskAssignmentsEnabled: boolean;
  approvalsEnabled: boolean;
  pettyCashLowEnabled: boolean;

  taskDueReminderHours: number;
  eventReminderHours: number[];
};

const handleAuth = (res: Response) => {
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }
};

export const getMyNotificationPreferences = async (): Promise<NotificationPreferences> => {
  const res = await fetch(`${API_URL}/notifications/preferences/me`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  handleAuth(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Failed to load preferences');
  return data as NotificationPreferences;
};

export const updateMyNotificationPreferences = async (
  updates: Partial<NotificationPreferences>
): Promise<NotificationPreferences> => {
  const res = await fetch(`${API_URL}/notifications/preferences/me`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(updates),
  });
  handleAuth(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Failed to save preferences');
  return data as NotificationPreferences;
};