import { navigationFetch as fetch } from './navigationRequest';
const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');
export type EmailDeliveryStatusData = {
  configuration: { configured: boolean; message: string };
  enabled: boolean; webhookConfigured: boolean; queueErrors: number;
  counts: Array<{ _id: string; count: number }>;
  recent: Array<{ _id: string; to: string; subject: string; status: string; attempts: number; lastCode?: string; lastError?: string }>;
};
export const getEmailDeliveryStatus = async (): Promise<EmailDeliveryStatusData> => {
  const res = await fetch(`${API_URL}/admin/email/status`, { headers: { Authorization: `Bearer ${getToken()}` } });
  handleAuth(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Failed to load email status.');
  return data;
};

const handleAuth = (res: Response) => {
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }
};

export const sendTestEmail = async (to?: string) => {
  const res = await fetch(`${API_URL}/admin/email/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ to: to || '' }),
  });

  handleAuth(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Failed to send test email');
  return data as { message: string };
};
