import { CaseEarnedFees } from './workflowInstanceService';

const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export type CaseManagementMember = {
  key: 'initiator' | 'reviewer' | 'approver';
  role: string;
  name: string;
  userRole: string | null;
  tpaPercent: number;
};

export type CaseManagementStep = {
  stepKey: string;
  title: string;
  stageKey: string;
  stageTitle: string;
  stagePercentage: number;
  percentage: number;
  order: number;
  status: 'Not Started' | 'In Progress' | 'Awaiting Review' | 'Awaiting Approval' | 'Completed';
  startAt?: string;
  dueAt?: string;
  completedAt?: string;
  submittedAt?: string;
  reviewedAt?: string;
  timelinessScore: number | null;
  actions: Array<{ text?: string; done: boolean }>;
};

export type CaseManagementState = {
  caseId: string;
  caseNo: string;
  parties: string;
  workflowStatus: string;
  currentStepKey?: string;
  members: CaseManagementMember[];
  myRole: 'initiator' | 'reviewer' | 'approver' | 'admin' | 'none';
  canEnterQualityScore: boolean;
  qualityScore: number | null;
  qualityScoredBy: string | null;
  qualityScoredAt: string | null;
  steps: CaseManagementStep[];
  earnedFees: CaseEarnedFees;
};

const jsonHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${getToken()}`,
});

const parse = async (res: Response) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Case Management request failed');
  return data;
};

export const getCaseManagement = async (caseId: string): Promise<CaseManagementState> => {
  const res = await fetch(`${API_URL}/case-management/cases/${caseId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  return parse(res);
};

export const requestReview = async (caseId: string, stepKey: string): Promise<CaseManagementState> => {
  const res = await fetch(`${API_URL}/case-management/cases/${caseId}/request-review`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ stepKey }),
  });
  return parse(res);
};

export const requestApproval = async (caseId: string, stepKey: string): Promise<CaseManagementState> => {
  const res = await fetch(`${API_URL}/case-management/cases/${caseId}/request-approval`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ stepKey }),
  });
  return parse(res);
};

export const approveKeyAction = async (caseId: string, stepKey: string): Promise<CaseManagementState> => {
  const res = await fetch(`${API_URL}/case-management/cases/${caseId}/approve`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ stepKey }),
  });
  return parse(res);
};

export const saveCaseQualityScore = async (caseId: string, qualityScore: number): Promise<CaseManagementState> => {
  const res = await fetch(`${API_URL}/case-management/cases/${caseId}/quality-score`, {
    method: 'PUT',
    headers: jsonHeaders(),
    body: JSON.stringify({ qualityScore }),
  });
  return parse(res);
};