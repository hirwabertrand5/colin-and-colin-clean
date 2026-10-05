const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

/** Which payments are allowed to fund the completed work. */
export type StaffEarningsCollectionScope = 'all' | 'period' | 'custom';

export type StaffEarningsRange = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'ytd' | 'custom';

/**
 * One staff member x one matter x one completed Key Action, with every input of
 * the calculation exposed so the figure can be defended.
 */
export type StaffEarningsRow = {
  key: string;
  caseId: string;
  matterNo: string;
  matterName: string;
  matterType: string | null;
  staffKey: string;
  staffName: string;
  systemRole: string | null;
  assignmentRole: string;
  tpaPercent: number;
  tpaSource: string | null;
  keyActionKey: string;
  keyActionTitle: string;
  stageKey: string | null;
  stageTitle: string | null;
  /** ISO-8601 instant the work was completed — this drives the period filter. */
  completionAt: string | null;
  completionSource: string | null;
  completionSourceLabel: string | null;
  completionAtLocal: string | null;
  timeZoneOffsetMinutes: number | null;
  timeZone: string | null;
  contractValue: number;
  keyActionPercent: number | null;
  grossActionValue: number;
  collectedAmount: number;
  eligibleCollectedBase: number;
  uncollectedActionValue: number;
  timelinessScore: number | null;
  qualityScore: number | null;
  /** Null means "not yet calculable" — never a silent zero. */
  earnedFee: number | null;
  currency: string;
  formula: string;
  status: 'ready' | 'awaiting-collection' | 'awaiting-input' | 'incomplete';
  statusNote: string | null;
  missingInputs: string[];
  paymentTimestamps: Array<{ invoiceNo: string; paidAt: string | null; amount: number }>;
  inPeriod: boolean;
  ledgerEntryKey?: string;
  ledgerRevision?: number | null;
};

export type StaffEarningsSummaryRow = {
  staffKey: string;
  staffName: string;
  systemRole: string | null;
  mattersCount: number;
  keyActionsCount: number;
  grossActionValue: number;
  eligibleCollectedBase: number;
  earnedFee: number | null;
  rowsAwaitingCollection: number;
  rowsAwaitingInput: number;
  currency: string;
};

export type StaffEarningsResponse = {
  period: {
    key: string;
    label: string;
    from: string;
    to: string;
    fromISO: string;
    toISO: string;
    basis: 'keyActionCompletion';
    basisLabel: string;
    timeZone: string | null;
  };
  collection: {
    scope: StaffEarningsCollectionScope;
    label: string;
    from: string | null;
    to: string | null;
    note: string;
  };
  filters: { staffKey: string | null; role: string | null; matterId: string | null };
  rows: StaffEarningsRow[];
  summary: StaffEarningsSummaryRow[];
  totals: { earnedFee: number | null; grossActionValue: number; eligibleCollectedBase: number };
  counts: {
    rowsInPeriod: number;
    rowsOutsidePeriod: number;
    rowsAwaitingCollection: number;
    rowsAwaitingInput: number;
    mattersEvaluated: number;
  };
  ledger: { persisted: number; created: number; superseded: number };
  staffOptions: Array<{ key: string; name: string; role: string | null }>;
  roles: string[];
  currency: string;
};

export const getStaffEarnings = async (params?: {
  range?: StaffEarningsRange;
  from?: string;
  to?: string;
  staffKey?: string;
  role?: string;
  matterId?: string;
  collectionScope?: StaffEarningsCollectionScope;
  collectionFrom?: string;
  collectionTo?: string;
  persist?: boolean;
}): Promise<StaffEarningsResponse> => {
  const qs = new URLSearchParams();
  if (params?.range) qs.set('range', params.range);
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.staffKey) qs.set('staffKey', params.staffKey);
  if (params?.role) qs.set('role', params.role);
  if (params?.matterId) qs.set('matterId', params.matterId);
  if (params?.collectionScope) qs.set('collectionScope', params.collectionScope);
  if (params?.collectionFrom) qs.set('collectionFrom', params.collectionFrom);
  if (params?.collectionTo) qs.set('collectionTo', params.collectionTo);
  if (params?.persist) qs.set('persist', 'true');

  const res = await fetch(`${API_URL}/reports/staff-earnings?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Failed to load the staff earnings report');
  return data as StaffEarningsResponse;
};
