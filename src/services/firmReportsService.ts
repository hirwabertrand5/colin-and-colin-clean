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
    totalContractValue?: number;
    contractValue?: number;
    totalBilled?: number;
    billed: number;
    totalCollected?: number;
    collected: number;
    progressValue?: number;
    outstanding: number;
    totalDirectMatterCosts?: number;
    directMatterCosts?: number;
    grossProfit?: number;
    grossProfitMargin?: number;
    firmOperatingExpenses?: number;
    netProfit?: number;
    netProfitMargin?: number;
    clientRelatedExpenses?: number;
    taxDataAvailable: boolean;
    taxMessage: string;
    qualityReviewAvailable: boolean;
    qualityReviewMessage: string;
  };
  ageingReport: Array<{ label: string; amount: number; color: string }>;
  productivitySummary?: {
    completedTasks: number;
    totalTaskFeeCollected?: number;
    totalTaskFee: number;
    totalFeeEarned: number;
    pendingQualityScores: number;
    averageQualityScore: number | null;
    averageTimelinessScore: number | null;
  };
  productivityRows?: Array<{
    id: string;
    staffId?: string;
    completedAt: string | null;
    staff: string;
    role: string;
    matter: string;
    task: string;
    taskFeeCollected?: number;
    taskFee: number;
    tpaPercent: number;
    timelinessScore: number | null;
    timelinessConsumedPercent: number | null;
    qualityScore: number | null;
    formula: string;
    feeEarned: number | null;
    keyActionsCompleted: number;
    keyActionsTotal: number;
    taskProgressPercent: number;
    timelinessStatus: string;
  }>;
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
    invoicePaymentsReceived?: number;
    earnedFees?: number;
    grossFeesHandled?: number;
    firmRetainedEarnings?: number;
    revenueAttributed?: number;
    contributionMargin?: number;
    contributionRatio?: number;
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
  clientProfitability: Array<{
    partyName: string;
    matterCount: number;
    activeMatters: number;
    completedMatters: number;
    contractValue: number;
    totalBilled: number;
    collected: number;
    outstanding: number;
    directMatterCosts: number;
    grossProfit: number;
    grossProfitMargin: number;
    collectionPeriodDays: number | null;
    retainerValue: number;
    primaryPracticeArea?: string;
    matterDetails?: Array<{
      id: string;
      recordType: 'Matter' | 'Prospect';
      recordLabel: string;
      matterNo: string;
      status: string;
      practiceArea: string;
      contractValue: number;
      totalBilled: number;
      collected: number;
      outstanding: number;
      directMatterCosts: number;
      grossProfit: number;
      grossProfitMargin: number;
      assignedLawyer: string;
      nextDeadline: string | null;
    }>;
    revenueByPracticeArea: Array<{
      type: string;
      amount: number;
    }>;
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

export type MyProductivityEarningsResponse = Pick<
  FirmReportResponse,
  'range' | 'dateBasis' | 'selectedMember' | 'productivitySummary' | 'productivityRows' | 'team'
>;

export const getMyProductivityEarningsReport = async (params?: {
  range?: FirmReportRange;
  from?: string;
  to?: string;
  basis?: FirmReportDateBasis;
}): Promise<MyProductivityEarningsResponse> => {
  const qs = new URLSearchParams();
  if (params?.range) qs.set('range', params.range);
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.basis) qs.set('basis', params.basis);

  const res = await fetch(`${API_URL}/reports/my-productivity?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Failed to load productivity earnings report');
  return data as MyProductivityEarningsResponse;
};

