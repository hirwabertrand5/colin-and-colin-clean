const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export type PerformanceSummary = {
  range: { from: string; to: string };
  user: { name: string };

  tasksCompleted: number;
  tasksTotal: number;
  billableHours: number;
  onTimeCompletionPct: number;
  deadlineBreakdown?: {
    early: number;
    onTime: number;
    late: number;
    overdue: number;
  };

  approvals: {
    pending: number;
    approved: number;
    rejected: number;
    approvalRatePct: number;
  };

  rating: {
    value: 1 | 2 | 3 | 4 | 5;
    productivityScore: number;
    qualityScore: number;
    reliabilityScore: number;
  };

  monthly: { month: string; tasksCompleted: number; hours: number }[];
  byStatus: { label: string; completed: number; total: number; hours: number }[];
  byPriority: { label: string; completed: number; total: number; hours: number }[];
};

const apiGet = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Request failed');
  return data as T;
};

export const getMyPerformance = async (params?: { from?: string; to?: string }): Promise<PerformanceSummary> => {
  const qs = new URLSearchParams();
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);

  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet<PerformanceSummary>(`/performance/me${suffix}`);
};

// Optional: MD team ranking
export type TeamPerformanceRow = {
  name: string;
  role: string;
  rating: number;
  tasksCompleted: number;
  tasksTotal: number;
  billableHours: number;
  onTimeCompletionPct: number;
  approvals: { pending: number; approved: number; rejected: number; approvalRatePct: number };
  scores: { productivity: number; quality: number; reliability: number };
};

export const getTeamPerformance = async (params?: { from?: string; to?: string; role?: string }) => {
  const qs = new URLSearchParams();
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.role) qs.set('role', params.role);

  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet<{ range: { from: string; to: string }; results: TeamPerformanceRow[] }>(
    `/performance/team${suffix}`
  );
};
