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

export const getMyTimeLogSummary = async (from: string, to: string): Promise<{ totalHours: number }> => {
  const res = await fetch(`${API_URL}/time-logs/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  handleAuth(res);

  if (!res.ok) {
    throw new Error((await res.json()).message || 'Failed to load time log summary');
  }

  return res.json();
};