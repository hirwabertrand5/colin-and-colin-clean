const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export type FirmReportRange = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
export type FirmReportDateBasis = 'invoiceDate' | 'paymentDate' | 'taskDate';

export type FirmReportResponse = {
  range: { from: string; to: string };
  dateBasis: FirmReportDateBasis;
  selectedMember: {
    name: string;
    role: string;
    tasksCompleted: number;
    outstandingTasks: number;
    revenueGenerated: number;
    paymentsReceived: number;
    outstandingBalance: number;
    feesEarned: number;
    qualityReviewStatus: string;
  } | null;
  kpis: {
    activeCases: number;
    billed: number;
    collected: number;
    outstanding: number;
    billableHours: number;
    clientRelatedExpenses?: number;
    firmOperatingExpenses?: number;
    taxDataAvailable: boolean;
    taxMessage: string;
    qualityReviewAvailable: boolean;
    qualityReviewMessage: string;
  };
  ageingReport: Array<{ label: string; amount: number; color: string }>;
  team: Array<{
    id: string;
    name: string;
    role: string;
    earningRoleLabel?: string;
    earningSharePercent?: number;
    activeCases: number;
    tasksCompleted: number;
    assistantTasksCompleted?: number;
    prospectsCreated?: number;
    reportsGenerated?: number;
    billableHours: number;
    earnedFees?: number;
    grossFeesHandled?: number;
    firmRetainedEarnings?: number;
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
  expenseTypes?: Array<{ type: string; amount: number; count: number; clientRelatedAmount: number }>;
};

export const getFirmReports = async (params?: { range?: FirmReportRange; from?: string; to?: string; basis?: FirmReportDateBasis; teamMemberId?: string }) => {
  const qs = new URLSearchParams();
  if (params?.range) qs.set('range', params.range);
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.basis) qs.set('basis', params.basis);
  if (params?.teamMemberId) qs.set('teamMemberId', params.teamMemberId);

  const res = await fetch(`${API_URL}/reports/firm?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Failed to load firm reports');
  return data as FirmReportResponse;
};
