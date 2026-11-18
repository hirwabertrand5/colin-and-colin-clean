import { navigationFetch as fetch } from './navigationRequest';
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

/** Pages from the latest twenty retained audit entries. */
export type AuditTrailPage = {
  items: AuditFeedItem[];
  total: number;
  page: number;
  pages: number;
  limit: number;
};

export const getRecentAuditFeed = async (limit = 10): Promise<AuditFeedItem[]> => {
  const res = await fetch(`${API_URL}/audit/recent?limit=${limit}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load activity feed');
  return res.json();
};

/**
 * The signed-in member's own activity trail (staff dashboards), newest first.
 *
 * Capped at twenty retained entries, with optional period filtering.
 */
export const getMyAuditTrail = async (params?: {
  limit?: number;
  page?: number;
  /** Same period windows as the staff dashboard summary. */
  range?: string;
  from?: string;
  to?: string;
  /** Server-side sort field: 'when' | 'action' | 'activity'. */
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}): Promise<AuditTrailPage> => {
  const qs = new URLSearchParams();
  qs.set('limit', String(Math.min(20, Math.max(1, params?.limit ?? 20))));
  qs.set('page', String(params?.page ?? 1));
  if (params?.range) qs.set('range', params.range);
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.sortBy) qs.set('sortBy', params.sortBy);
  if (params?.sortDir) qs.set('sortDir', params.sortDir);

  const res = await fetch(`${API_URL}/audit/mine?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load your activity trail');
  return res.json();
};
