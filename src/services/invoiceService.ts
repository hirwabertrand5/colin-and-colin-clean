const API_URL = import.meta.env.VITE_API_URL;

export interface Invoice {
  _id?: string;
  caseId: string;
  invoiceNo: string;
  date: string;
  amount: number;
  status: 'Paid' | 'Pending';

  // proof of payment (marks paid)
  proofUrl?: string;

  // ✅ NEW: uploaded invoice document (separate from proof)
  invoiceFileUrl?: string;

  notes?: string;
}

const getToken = () => localStorage.getItem('token');

const readErrorMessage = async (res: Response, fallback: string) => {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => ({}));
    return data?.message || fallback;
  }
  const text = await res.text().catch(() => '');
  return text || fallback;
};

export const getInvoicesForCase = async (caseId: string): Promise<Invoice[]> => {
  const res = await fetch(`${API_URL}/cases/${caseId}/invoices`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to fetch invoices'));
  return res.json();
};

export const addInvoiceToCase = async (
  caseId: string,
  invoice: { date: string; amount: number; notes?: string; file?: File | null }
): Promise<Invoice> => {
  const hasFile = Boolean(invoice.file);
  const body = hasFile
    ? (() => {
        const formData = new FormData();
        formData.append('date', invoice.date);
        formData.append('amount', String(invoice.amount));
        if (invoice.notes) formData.append('notes', invoice.notes);
        if (invoice.file) formData.append('file', invoice.file);
        return formData;
      })()
    : JSON.stringify({ date: invoice.date, amount: invoice.amount, notes: invoice.notes });

  const res = await fetch(`${API_URL}/cases/${caseId}/invoices`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(hasFile ? {} : { 'Content-Type': 'application/json' }),
    },
    body,
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to create invoice'));
  return res.json();
};

// ✅ NEW: upload invoice file (does NOT mark paid)
export const uploadInvoiceFile = async (invoiceId: string, file: File): Promise<Invoice> => {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_URL}/invoices/${invoiceId}/file`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });

  if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to upload invoice file'));
  return res.json();
};

// existing: upload proof of payment (marks Paid)
export const uploadProof = async (invoiceId: string, file: File): Promise<Invoice> => {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_URL}/invoices/${invoiceId}/proof`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });

  if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to upload proof'));
  return res.json();
};

// ✅ NEW: delete invoice
export const deleteInvoice = async (invoiceId: string): Promise<void> => {
  const res = await fetch(`${API_URL}/invoices/${invoiceId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to delete invoice'));
};

export type InvoiceWithCase = Invoice & {
  case?: { _id: string; caseNo: string; parties: string } | null;
};

export const getRecentInvoices = async (limit = 10): Promise<InvoiceWithCase[]> => {
  const res = await fetch(`${API_URL}/invoices/recent?limit=${limit}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to fetch recent invoices'));
  return res.json();
};

export const listInvoices = async (params?: {
  status?: 'Paid' | 'Pending';
  q?: string;
  caseId?: string;
  from?: string;
  to?: string;
}): Promise<InvoiceWithCase[]> => {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.q) qs.set('q', params.q);
  if (params?.caseId) qs.set('caseId', params.caseId);
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);

  const res = await fetch(`${API_URL}/invoices?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to fetch invoices'));
  return res.json();
};
