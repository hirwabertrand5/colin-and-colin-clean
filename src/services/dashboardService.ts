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
  collectedBase: number;
  earnedFee: number | null;
  completed: boolean;
  outstanding: boolean;
  overdueSections: number;
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
};

export const getStaffDashboardSummary = async (): Promise<StaffDashboardSummaryResponse> => {
  const res = await fetch(`${API_URL}/dashboard/staff-summary`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load staff dashboard');
  return res.json();
};