const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

const authHeaders = (extra?: Record<string, string>) => ({
  ...(extra || {}),
  Authorization: `Bearer ${getToken()}`,
});

export type ClientContact = {
  name?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
};

export type ClientReportRun = {
  _id: string;
  caseId: string;
  trigger: 'manual' | 'weekly' | 'monthly' | 'update';
  status: 'Draft' | 'Sent' | 'Failed';
  periodStart: string;
  periodEnd: string;
  subject: string;
  recipients: ClientContact[];
  contentHtml: string;
  generatedBy?: string;
  createdAt?: string;
};

export const listReportsForCase = async (caseId: string): Promise<ClientReportRun[]> => {
  const res = await fetch(`${API_URL}/cases/${caseId}/reports`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load reports');
  return res.json();
};

export const generateReportForCase = async (
  caseId: string,
  payload?: { periodDays?: number }
): Promise<ClientReportRun> => {
  const res = await fetch(`${API_URL}/cases/${caseId}/reports/generate`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload || {}),
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to generate report');
  return res.json();
};

export const getReportById = async (reportId: string): Promise<ClientReportRun> => {
  const res = await fetch(`${API_URL}/reports/${reportId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load report');
  return res.json();
};

// ✅ NEW: download PDF as blob
export const downloadReportPdf = async (reportId: string): Promise<Blob> => {
  const res = await fetch(`${API_URL}/reports/${reportId}/pdf`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to download PDF');
  return res.blob();
};