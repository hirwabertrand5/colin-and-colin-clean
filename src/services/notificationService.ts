const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export type NotificationType =
  | 'PETTY_CASH_LOW'
  | 'PETTY_CASH_CREATED'
  | 'PETTY_CASH_EXPENSE'
  | 'TASK_ASSIGNED'
  | 'TASK_APPROVAL_REQUESTED'
  | 'TASK_DUE_REMINDER'
  | 'EVENT_REMINDER';

export interface AppNotification {
  _id: string;
  type: NotificationType;
  title: string;
  message: string;
  severity: NotificationSeverity;

  // linking/targets
  caseId?: string;
  taskId?: string;
  eventId?: string;

  fundId?: string;
  expenseId?: string;

  link?: string;        // ✅ new
  dedupeKey?: string;   // optional

  createdAt: string;
  isReadBy: string[];
}

const handleAuth = (res: Response) => {
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }
};

export const listNotifications = async (filter: string = 'all'): Promise<AppNotification[]> => {
  const res = await fetch(`${API_URL}/notifications?filter=${encodeURIComponent(filter)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  handleAuth(res);
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to fetch notifications');
  return res.json();
};

export const markAllNotificationsRead = async (): Promise<void> => {
  const res = await fetch(`${API_URL}/notifications/read-all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  handleAuth(res);
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to mark all as read');
};

export const markNotificationRead = async (id: string): Promise<AppNotification> => {
  const res = await fetch(`${API_URL}/notifications/${id}/read`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  handleAuth(res);
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to mark as read');
  return res.json();
};

export const getUnreadNotificationCount = async (): Promise<number> => {
  const res = await fetch(`${API_URL}/notifications/unread-count`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  handleAuth(res);

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Failed to fetch unread count');

  return Number(data?.unread || 0);
};