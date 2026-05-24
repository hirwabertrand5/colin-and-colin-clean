const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export type AuditLogItem = {
  _id: string;
  caseId: string;
  actorName: string;
  action: string;
  message: string;
  detail?: string;
  createdAt: string;
};

export const getAuditForCase = async (caseId: string): Promise<AuditLogItem[]> => {
  const res = await fetch(`${API_URL}/cases/${caseId}/audit`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load audit log');
  return res.json();
};

export type AuditFeedItem = {
  _id: string;
  caseId: string;
  actorName: string;
  action: string;
  message: string;
  detail?: string;
  createdAt: string;
  case?: { _id: string; caseNo: string; parties: string } | null;
};

export const getRecentAuditFeed = async (limit = 10): Promise<AuditFeedItem[]> => {
  const res = await fetch(`${API_URL}/audit/recent?limit=${limit}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load activity feed');
  return res.json();
};