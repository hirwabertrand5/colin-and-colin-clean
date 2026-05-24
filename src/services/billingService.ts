const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export type BillingSummary = {
  from: string;
  to: string;
  billed: number;
  collected: number;
  outstanding: number;
  collectionRate: number;
  months: { month: string; billed: number; collected: number }[];
};

export const getBillingSummary = async (params?: { from?: string; to?: string }) => {
  const qs = new URLSearchParams();
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);

  const res = await fetch(`${API_URL}/billing/summary?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load billing summary');
  return res.json() as Promise<BillingSummary>;
};