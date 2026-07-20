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

export type IntakeAutomationConfig = {
  googleFormBaseUrl: string;
  googleFormEntryId: string;
};

export const getIntakeAutomationConfig = async (): Promise<IntakeAutomationConfig> => {
  const res = await fetch(`${API_URL}/intake-automation-config`, {
    headers: {
      Authorization: `Bearer ${getToken()}`,
    },
  });

  handleAuth(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Failed to load intake automation config');
  return data as IntakeAutomationConfig;
};

export const updateIntakeAutomationConfig = async (updates: Partial<IntakeAutomationConfig>): Promise<IntakeAutomationConfig> => {
  const res = await fetch(`${API_URL}/intake-automation-config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(updates),
  });

  handleAuth(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Failed to update intake automation config');
  return data as IntakeAutomationConfig;
};
