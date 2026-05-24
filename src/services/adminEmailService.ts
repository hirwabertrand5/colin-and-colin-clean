const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

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