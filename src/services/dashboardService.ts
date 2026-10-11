const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

const authHeaders = () => ({
  Authorization: `Bearer ${getToken()}`,
});

export type ExecutiveDashboardResponse = {
  stats: {
    casesCreatedMTD: number;
    documentsUploadedMTD: number;
    scheduledEventsMTD: number;
    tasksCoordinatedMTD: number;
  };
  today: {
    dateISO: string;
    label: string;
  };
  todaySchedule: {
    id: string;
    time: string;
    title: string;
    type: string;
    description?: string;
  }[];
  pendingFollowUp: {
    id: string;
    type: string;
    title: string;
    assignedTo: string;
    status: string;
    dueDate: string;
    priority?: string;
    /** Matter the follow-up belongs to — links open its Case Management tab. */
    caseId?: string;
    /** Workflow section the task belongs to, focused when the matter opens. */
    workflowStepKey?: string;
  }[];
  recentCases: {
    id: string;
    name: string;
    status: string;
    client: string;
    createdDate: string;
  }[];
};

export const getExecutiveAssistantDashboard = async (): Promise<ExecutiveDashboardResponse> => {
  const res = await fetch(`${API_URL}/dashboard/executive-assistant`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load dashboard');
  return res.json();
};

export type StaffDashboardMatterRow = {
  caseId: string;
  caseNo: string;
  parties: string;
  status: string;
  role: string;
  tpaPercent: number;
  timelinessScore: number | null;
  qualityScore: number | null;
  /** Planned contract value of the matter, as shown in its Case Workspace. */
  contractValue: number;
  collectedBase: number;
  earnedFee: number | null;
  completed: boolean;
  outstanding: boolean;
  overdueSections: number;
  /**
   * True when the matter had activity inside the selected period. Present only
   * when a period was requested — the all-time view lists every assigned matter.
   */
  inPeriod?: boolean;
  /** Present when a period was requested — collected value received in the period. */
  collectedBaseInPeriod?: number;
  /** Present when a period was requested — earned fee from the period's payments. */
  earnedFeeInPeriod?: number | null;
};

/** Same window options as Firm Reports so both pages speak one language. */
export type StaffDashboardPeriodRange =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'ytd'
  | 'this_month'
  | 'custom';

export type StaffDashboardPeriod = {
  key: string;
  label: string;
  from: string;
  to: string;
  feesEarned: number | null;
  collectedValue: number;
  keyActionsChecked: number;
  sectionsCompleted: number;
  tasksCompleted: number;
  mattersCompleted: number;
  /** Your matters that had any activity inside the period. */
  mattersWithActivity: number;
  /** Matters assigned to you that were created inside the period (entry date). */
  mattersCreatedInPeriod: number;
  averageTimelinessScore: number | null;
  averageQualityScore: number | null;
};

export type StaffDashboardSummaryResponse = {
  user: { name: string };
  tpaPercent: number;
  currency: string;
  /** Matters the signed-in user is assigned to (Initiator / Reviewer / Signer-Approver). */
  mattersAssigned: number;
  /** Assigned matters whose Key Actions are not all checked yet. */
  mattersOutstanding: number;
  /** Assigned matters whose workflow is completed. */
  mattersCompleted: number;
  /** Workflow sections (steps) past their deadline in open matters. */
  overdueSections: number;
  /** Average of the user's Timeliness rows in each matter's Earned Fees table. */
  averageTimelinessScore: number | null;
  /** Average of the user's Quality rows in each matter's Earned Fees table. */
  averageQualityScore: number | null;
  /** Sum of the user's "Earned fee" column across the matters they are assigned to. */
  feesEarnedTotal: number | null;
  collectedBaseTotal: number;
  rows: StaffDashboardMatterRow[];
  /** Period-scoped figures — returned only when range/from/to were requested. */
  period?: StaffDashboardPeriod;
};

export const getStaffDashboardSummary = async (params?: {
  range?: StaffDashboardPeriodRange;
  from?: string;
  to?: string;
}): Promise<StaffDashboardSummaryResponse> => {
  const qs = new URLSearchParams();
  if (params?.range) qs.set('range', params.range);
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await fetch(`${API_URL}/dashboard/staff-summary${suffix}`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load staff dashboard');
  return res.json();
};