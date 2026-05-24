const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export type FirmReportRange = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type FirmReportResponse = {
  range: { from: string; to: string };
  kpis: {
    activeCases: number;
    billed: number;
    collected: number;
    outstanding: number;
    billableHours: number;
  };
  team: Array<{
    name: string;
    role: string;
    activeCases: number;
    tasksCompleted: number;
    billableHours: number;
    earnedFees?: number;
    earlyTasks?: number;
    onTimeTasks?: number;
    lateTasks?: number;
    overdueTasks?: number;
    excellentTasks?: number;
    goodTasks?: number;
    delayedTasks?: number;
    riskTasks?: number;
    averageTimeUsedPercent?: number | null;
  }>;
  caseTypes: Array<{
    type: string;
    active: number;
    closed: number;
    avgDurationDays: number | null;
    revenueBilled: number;
  }>;
  months: Array<{ month: string; billed: number; collected: number }>;
};

export const getFirmReports = async (params?: { range?: FirmReportRange; from?: string; to?: string }) => {
  const qs = new URLSearchParams();
  if (params?.range) qs.set('range', params.range);
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);

  const res = await fetch(`${API_URL}/reports/firm?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Failed to load firm reports');
  return data as FirmReportResponse;
};
