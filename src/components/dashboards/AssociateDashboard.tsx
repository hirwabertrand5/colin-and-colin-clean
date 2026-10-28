import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  BarChart3,
  Briefcase,
  Calendar as CalendarIcon,
  CheckCircle2,
  CheckSquare,
  Clock,
  DollarSign,
  Handshake,
  History,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { UserRole } from '../../App';
import usePageTitle from '../../hooks/usePageTitle';
import { caseMatchesAssigneeCanonical } from '../../utils/caseAssignments';
import { getAllCases, CaseData } from '../../services/caseService';
import {
  getStaffDashboardSummary,
  StaffDashboardPeriodRange,
  StaffDashboardSummaryResponse,
  StaffDashboardMatterRow,
} from '../../services/dashboardService';
import { getFirmEvents, FirmCalendarEvent } from '../../services/eventService';
import { getMyPerformance, PerformanceSummary } from '../../services/performanceService';
import { getAllProspects, Prospect } from '../../services/prospectService';
import { listIndependentTasks, IndependentTask } from '../../services/independentTaskService';
import { getCaseManagement, CaseManagementState } from '../../services/caseManagementService';
import { getStageDueAt, getStageUrgencyColor } from '../../utils/prospectStageConfig';
import { identityMatches } from '../../utils/caseAssignments';
import { getAllTasks, TaskData } from '../../services/taskService';
import { getMyAuditTrail, AuditFeedItem } from '../../services/auditService';
import { buildCaseManagementLink } from '../../utils/caseWorkspaceLinks';
import {
  formatDeadlineDateTime,
  getUrgencyColorForDueDate,
  resolveDeadlineDateTime,
  type UrgencyColor,
} from '../../utils/workflowDeadline';
import { baseNameFromLabel } from '../../utils/productivity';
import { sortRows, toggleSortKey } from '../../utils/tableSort';
import type { SortDir } from '../../utils/tableSort';
import SortableHeader from '../ui/SortableHeader';
import './AssociateDashboard.css';

/** Every table on this dashboard lists 10 rows per page, like the report tables. */
const PAGE_SIZE = 10;
/** The My Activity Trail also lists 10 rows per page. */
const AUDIT_PAGE_SIZE = PAGE_SIZE;

type Tone = 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'purple';
type FinancialScope = 'own' | 'matter' | 'portfolio' | 'client';

type RoleProfile = {
  title: string;
  purpose: string;
  tpa: number;
  financialScope: FinancialScope;
  visible: {
    team: boolean;
    business: boolean;
    matterFinancials: boolean;
  };
  labels: {
    overview: string;
    matters: string;
    team: string;
    performance: string;
    earnings: string;
    risk: string;
  };
};

type StatCard = {
  label: string;
  value: string;
  helper?: string;
  icon: React.ComponentType<any>;
  tone?: Tone;
  href?: string;
};

type MatterRow = CaseData & {
  progress: number;
  contractValue: number;
  earnedValue: number;
  nextDeadline: string;
  openTasks: number;
  warningTasks: number;
  poorTasks: number;
};

/**
 * One countable unit of assigned work for the staff dashboard.
 *
 * The whole matter is the PARENT task; every open Key Action inside a matter
 * the member is assigned to is a SUB-TASK. Legacy matter tasks, independent
 * (standalone) tasks and intake/prospect stages are sibling work items, so
 * every card below counts from this single list — never from ad-hoc filters.
 */
type WorkItemKind = 'key-action' | 'matter-task' | 'independent-task' | 'prospect';

type UnifiedWorkItem = {
  id: string;
  kind: WorkItemKind;
  title: string;
  status: string;
  priority: string;
  dueAt?: Date;
  dueLabel: string;
  urgency: UrgencyColor;
  overdue: boolean;
  /** Review queue the item is parked in (review vs approval vs external). */
  queue: 'review' | 'approval' | 'external' | 'none';
  /** Kanban column the item belongs to. */
  column: 'Not Started' | 'In Progress' | 'Completed' | 'Awaiting Review' | 'Awaiting External Action';
  /** Deep link — key actions open their Case Management section. */
  href: string;
  matterId?: string;
  matterNo?: string;
  matterParties?: string;
  roleLabel: string;
  /** True when the approval queue is caused by client / third-party wait. */
  waitingOnClient: boolean;
};

type TeamRow = {
  name: string;
  assigned: number;
  completed: number;
  overdue: number;
  quality: number | null;
};

const partnerRoles: UserRole[] = [
  'senior_partner',
  'partner',
  'executive_partner',
  'associate_partner',
  'executive_associate_partner',
  'originating_attorney',
];

const roleProfiles: Record<string, RoleProfile> = {
  intern: {
    title: 'Intern Dashboard',
    purpose: 'Read-and-act dashboard for assigned work, matter support, learning, reviews, and own earnings.',
    tpa: 1,
    financialScope: 'own',
    visible: { team: false, business: false, matterFinancials: false },
    labels: {
      overview: 'My Work',
      matters: 'My Matters',
      team: 'Team Workload',
      performance: 'My Performance',
      earnings: 'My Earnings',
      risk: 'Notifications & Deadline Alerts',
    },
  },
  trainee_associate: {
    title: 'Trainee Associate Dashboard',
    purpose: 'Execute work, develop professional competence, and take growing matter responsibility.',
    tpa: 3,
    financialScope: 'own',
    visible: { team: false, business: false, matterFinancials: false },
    labels: {
      overview: 'My Work',
      matters: 'My Matters',
      team: 'Team Workload',
      performance: 'Performance',
      earnings: 'My Financial Contribution',
      risk: 'Risk & Notifications',
    },
  },
  associate: {
    title: 'Associate Dashboard',
    purpose: 'Manage work, matters, quality, productivity, capacity, and authorised financial contribution.',
    tpa: 5,
    financialScope: 'matter',
    visible: { team: true, business: true, matterFinancials: true },
    labels: {
      overview: 'My Overview',
      matters: 'Matter Portfolio',
      team: 'Team Workload',
      performance: 'Performance',
      earnings: 'My Remuneration',
      risk: 'Risk & Compliance',
    },
  },
  senior_associate: {
    title: 'Senior Associate Dashboard',
    purpose: 'Manage matters, supervise people, control quality, control delivery, and protect profitability.',
    tpa: 6,
    financialScope: 'portfolio',
    visible: { team: true, business: true, matterFinancials: true },
    labels: {
      overview: 'Senior Associate Overview',
      matters: 'Matter Portfolio',
      team: 'Team Workload',
      performance: 'Team Performance',
      earnings: 'Remuneration',
      risk: 'Senior Associate Alerts',
    },
  },
  partner: {
    title: 'Partner Dashboard',
    purpose: 'Manage clients, matters, revenue, profitability, team delivery, and business development.',
    tpa: 8,
    financialScope: 'client',
    visible: { team: true, business: true, matterFinancials: true },
    labels: {
      overview: 'Partner Overview',
      matters: 'Client & Matter Portfolio',
      team: 'Team Management',
      performance: 'Team Management',
      earnings: 'Partner Remuneration',
      risk: 'Partner Alerts',
    },
  },
};

const profileForRole = (role?: UserRole) => {
  if (role && roleProfiles[role]) return roleProfiles[role];
  if (role && partnerRoles.includes(role)) return roleProfiles.partner;
  if (role === 'senior_executive_assistant') return roleProfiles.senior_associate;
  // Executive Assistant: associate-style dashboard with the firm's 3% TPA.
  if (role === 'executive_assistant') {
    return { ...roleProfiles.associate, title: 'Executive Assistant Dashboard', tpa: 3 };
  }
  return roleProfiles.associate;
};

const roleLabel = (role?: string) =>
  String(role || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const isoToday = () => new Date().toISOString().slice(0, 10);

const addDaysISO = (baseISO: string, days: number) => {
  const d = new Date(`${baseISO}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Normalise any date-ish string to a local YYYY-MM-DD calendar day, or ''. */
const dayKey = (raw?: string) => {
  if (!raw) return '';
  const d = resolveDeadlineDateTime(raw);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const safeNum = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const formatRwf = (value: number) => `RWF ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatFees = (value: number) => `RWF ${Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-US')}`;

const getMatterContractValue = (matter: CaseData) => {
  const planned = safeNum(matter.workflowProgress?.plannedValue?.amount);
  const budget = safeNum(matter.budget);
  return planned > 0 ? planned : budget;
};

const getMatterEarnedValue = (matter: CaseData) => {
  const completed = safeNum(matter.workflowProgress?.completedValue?.amount);
  if (completed > 0) return completed;
  const contractValue = getMatterContractValue(matter);
  const progress = safeNum(matter.workflowProgress?.percent);
  if (contractValue > 0 && progress > 0) return Math.round((contractValue * progress) / 100);
  return safeNum(matter.billingSettings?.accruedUnbilled);
};

const getTaskDate = (raw?: string) => {
  if (!raw) return null;
  const parsed = resolveDeadlineDateTime(raw);
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
};

const toneClasses: Record<Tone, { icon: string; text: string; chip: string; bar: string }> = {
  slate: { icon: 'bg-gray-100 text-gray-700', text: 'text-gray-900', chip: 'bg-gray-100 text-gray-700', bar: 'bg-gray-700' },
  green: { icon: 'bg-green-100 text-green-700', text: 'text-green-700', chip: 'bg-green-100 text-green-700', bar: 'bg-green-600' },
  amber: { icon: 'bg-yellow-100 text-yellow-700', text: 'text-amber-700', chip: 'bg-yellow-100 text-yellow-700', bar: 'bg-yellow-500' },
  red: { icon: 'bg-red-100 text-red-700', text: 'text-red-700', chip: 'bg-red-100 text-red-700', bar: 'bg-red-600' },
  blue: { icon: 'bg-blue-100 text-blue-700', text: 'text-blue-700', chip: 'bg-blue-100 text-blue-700', bar: 'bg-blue-600' },
  purple: { icon: 'bg-purple-100 text-purple-700', text: 'text-purple-700', chip: 'bg-purple-100 text-purple-700', bar: 'bg-purple-600' },
};

const priorityChip = (priority: string) => {
  if (priority === 'High') return 'bg-red-100 text-red-700';
  if (priority === 'Medium') return 'bg-yellow-400 text-black';
  if (priority === 'Low') return 'bg-green-100 text-green-700';
  return 'bg-gray-100 text-gray-700';
};

/** Platform deadline-urgency pill shared by every card on this dashboard. */
const urgencyChip = (urgency?: string) => {
  if (urgency === 'red') return 'bg-rose-100 text-rose-700';
  if (urgency === 'yellow') return 'bg-amber-100 text-amber-700';
  if (urgency === 'green') return 'bg-emerald-100 text-emerald-700';
  if (urgency === 'blue') return 'bg-blue-100 text-blue-700';
  return 'bg-gray-100 text-gray-600';
};

// ---- Activity trail (audit) helpers ---------------------------------------

/** Plain-language labels for the audit actions recorded against a member's account. */
const auditActionLabels: Record<string, string> = {
  CASE_CREATED: 'Matter created',
  CASE_UPDATED: 'Matter updated',
  CASE_DELETED: 'Matter deleted',
  CASE_TAKE_REQUESTED: 'Matter take-over requested',
  CASE_TAKE_REQUEST_APPROVED: 'Take-over approved',
  CASE_TAKE_REQUEST_DENIED: 'Take-over denied',
  CASE_MANAGEMENT_REQUESTED_REVIEW: 'Review requested',
  CASE_MANAGEMENT_REQUESTED_APPROVAL: 'Approval requested',
  CASE_MANAGEMENT_APPROVED: 'Matter approved',
  CASE_MANAGEMENT_QUALITY_SCORED: 'Quality scored',
  TASK_CREATED: 'Task created',
  TASK_UPDATED: 'Task updated',
  TASK_DELETED: 'Task deleted',
  EVENT_CREATED: 'Calendar event created',
  EVENT_UPDATED: 'Calendar event updated',
  EVENT_DELETED: 'Calendar event deleted',
  DOCUMENT_UPLOADED: 'Document uploaded',
  DOCUMENT_DELETED: 'Document deleted',
  INVOICE_CREATED: 'Invoice created',
  INVOICE_UPDATED: 'Invoice updated',
  INVOICE_PAID: 'Invoice paid',
  INVOICE_DELETED: 'Invoice deleted',
  WORKFLOW_INSTANCE_CREATED: 'Workflow started',
  WORKFLOW_OUTPUT_UPLOADED: 'Workflow output uploaded',
  WORKFLOW_STEP_COMPLETED: 'Key Action completed',
  WORKFLOW_STEP_REOPENED: 'Key Action reopened',
  WORKFLOW_STEP_ACTION_TOGGLED: 'Key Action checked',
  WORKFLOW_STEP_FEE_SET: 'Key Action fee set',
  WORKFLOW_STEP_DEADLINE_EXTENDED: 'Deadline extended',
  WORKFLOW_STEP_ADDED: 'Workflow step added',
  WORKFLOW_STEP_UPDATED: 'Workflow step updated',
  WORKFLOW_STEP_DELETED: 'Workflow step deleted',
  WORKFLOW_STEP_ACTION_ADDED: 'Key Action added',
  WORKFLOW_STEP_ACTION_UPDATED: 'Key Action updated',
  WORKFLOW_STEP_ACTION_DELETED: 'Key Action deleted',
  WORKFLOW_TEMPLATE_CREATED: 'Workflow template created',
  WORKFLOW_TEMPLATE_UPDATED: 'Workflow template updated',
  WORKFLOW_TEMPLATE_DELETED: 'Workflow template deleted',
  WORKFLOW_TEMPLATE_ALIGNED: 'Workflow template aligned',
  INDEPENDENT_TASK_CREATED: 'Standalone task created',
  INDEPENDENT_TASK_UPDATED: 'Standalone task updated',
  INDEPENDENT_TASK_DELETED: 'Standalone task deleted',
  INDEPENDENT_TASK_STATUS_CHANGED: 'Standalone task status changed',
  INDEPENDENT_TASK_ASSIGNED: 'Standalone task assigned',
  INDEPENDENT_TASK_COMMENTED: 'Standalone task commented',
  INDEPENDENT_TASK_ATTACHMENT_UPLOADED: 'Task attachment uploaded',
  INDEPENDENT_TASK_ATTACHMENT_DELETED: 'Task attachment deleted',
  CLIENT_EXPERIENCE_TEMPLATE_CREATED: 'Client experience template created',
  CLIENT_EXPERIENCE_REQUEST_CREATED: 'Client experience request created',
  CLIENT_EXPERIENCE_ASSESSMENT_SUBMITTED: 'Client experience assessment submitted',
  CLIENT_EXPERIENCE_RED_FLAG_CREATED: 'Client experience red flag',
  CLIENT_EXPERIENCE_COMPLAINT_LOGGED: 'Client complaint logged',
};

const auditActionLabel = (action?: string) => {
  const key = String(action || '').trim();
  if (!key) return 'Activity';
  if (auditActionLabels[key]) return auditActionLabels[key];
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

const auditActionChip = (action?: string) => {
  const key = String(action || '').toUpperCase();
  if (key.includes('DELETED') || key.includes('DENIED') || key.includes('RED_FLAG') || key.includes('COMPLAINT')) {
    return 'bg-red-100 text-red-700';
  }
  if (key.startsWith('INVOICE')) return 'bg-green-100 text-green-700';
  if (key.includes('QUALITY') || key.includes('APPROVED')) return 'bg-purple-100 text-purple-700';
  if (key.startsWith('WORKFLOW')) return 'bg-amber-100 text-amber-700';
  if (key.includes('TASK') || key.startsWith('DOCUMENT')) return 'bg-blue-100 text-blue-700';
  return 'bg-gray-100 text-gray-700';
};

/** Audit timestamp in the firm's display format: 01 Oct 2026, 09:32. */
const formatAuditTimestamp = (iso?: string) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

function StatCardView({ stat, loading }: { stat: StatCard; loading: boolean }) {
  const Icon = stat.icon;
  const tone = toneClasses[stat.tone || 'slate'];
  const card = (
    <div className="h-full bg-white border border-gray-200 rounded-lg p-5">
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${tone.icon}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className={`text-2xl font-semibold ${loading ? 'text-gray-900' : tone.text}`}>{loading ? '…' : stat.value}</div>
      <div className="mt-1 text-sm text-gray-600">
        <span>{stat.label}</span>
      </div>
      {stat.helper ? <div className="mt-2 text-xs text-gray-500">{stat.helper}</div> : null}
    </div>
  );

  return stat.href ? (
    <Link to={stat.href} className="block h-full hover:shadow-sm">
      {card}
    </Link>
  ) : (
    card
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-semibold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </div>
  );
}

function Pagination({ page, pages, total, onChange }: { page: number; pages: number; total: number; onChange: (page: number) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-4 text-sm text-gray-600">
      <span>
        Showing {total ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, total)} of {total}
      </span>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(Math.max(1, page - 1))}
          className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40"
        >
          Previous
        </button>
        {Array.from({ length: pages }, (_, index) => index + 1).map((number) => (
          <button
            type="button"
            key={number}
            onClick={() => onChange(number)}
            className={`rounded border px-3 py-1.5 ${number === page ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white'}`}
          >
            {number}
          </button>
        ))}
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onChange(Math.min(pages, page + 1))}
          className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default function AssociateDashboard({ userRole }: { userRole?: UserRole }) {
  const me = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null') as { _id?: string; id: string; name: string; email: string; role: UserRole } | null;
    } catch {
      return null;
    }
  }, []);

  const effectiveRole = userRole || me?.role || 'associate';
  const profile = useMemo(() => profileForRole(effectiveRole), [effectiveRole]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [events, setEvents] = useState<FirmCalendarEvent[]>([]);
  const [performance, setPerformance] = useState<PerformanceSummary | null>(null);
  const [staffSummary, setStaffSummary] = useState<StaffDashboardSummaryResponse | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [independentTasks, setIndependentTasks] = useState<IndependentTask[]>([]);
  /**
   * Per-matter Case Management state (Key Actions = sub-tasks).
   *
   * Fetched for the member's authorised matters only, after the matters load.
   * Each matter is the PARENT task; its open Key Actions are the counted
   * sub-tasks, coloured by the same platform urgency as every other surface.
   */
  const [caseManagementByMatter, setCaseManagementByMatter] = useState<Record<string, CaseManagementState>>({});
  // Activity trail is server-paginated: `auditItems` is the current page, and
  // `auditTotal`/`auditPages` come from the backend so a long period is never
  // silently truncated or presented as complete.
  const [auditItems, setAuditItems] = useState<AuditFeedItem[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPages, setAuditPages] = useState(1);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');

  // Fee breakdown by matter — sorting + pagination.
  const [feePage, setFeePage] = useState(1);
  const [feeSortKey, setFeeSortKey] = useState('');
  const [feeSortDir, setFeeSortDir] = useState<SortDir>('asc');

  // My Activity Trail — sorting + pagination.
  const [auditPage, setAuditPage] = useState(1);
  const [auditSortKey, setAuditSortKey] = useState('');
  const [auditSortDir, setAuditSortDir] = useState<SortDir>('asc');

  // ---- Reporting period (same windows as Firm Reports) ----
  // The dropdown selection and the *applied* period are tracked SEPARATELY so a
  // half-typed or reversed custom range can never silently show all-time figures
  // under a "Custom Range" label. Named presets apply the moment they are
  // chosen; a custom range is applied only via the explicit Apply button once
  // both dates are present and ordered. Until then the previously-applied period
  // stays on screen, clearly marked, and a validation message explains why.
  const [periodRange, setPeriodRange] = useState<'all' | StaffDashboardPeriodRange>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  type AppliedPeriod = {
    key: string;
    params?: { range?: StaffDashboardPeriodRange; from?: string; to?: string };
  };
  const [appliedPeriod, setAppliedPeriod] = useState<AppliedPeriod>({ key: 'all' });
  const [customError, setCustomError] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);

  usePageTitle(profile.title);

  const today = useMemo(() => isoToday(), []);
  const next30Days = useMemo(() => addDaysISO(today, 30), [today]);
  const meName = useMemo(() => baseNameFromLabel(me?.name), [me?.name]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setError('');

        const [taskResult, caseResult, eventResult, performanceResult, summaryResult, prospectResult, independentResult, auditResult] = await Promise.allSettled([
          getAllTasks(),
          getAllCases(),
          getFirmEvents({ from: today, to: next30Days, type: 'all' }),
          getMyPerformance(),
          getStaffDashboardSummary(),
          getAllProspects({ includeTerminal: true }),
          listIndependentTasks({ limit: 200 }),
          getMyAuditTrail({ limit: AUDIT_PAGE_SIZE, page: 1 }),
        ]);

        if (!mounted) return;
        if (taskResult.status === 'fulfilled') setTasks(taskResult.value);
        if (caseResult.status === 'fulfilled') setCases(caseResult.value);
        if (eventResult.status === 'fulfilled') setEvents(eventResult.value);
        if (performanceResult.status === 'fulfilled') setPerformance(performanceResult.value);
        if (summaryResult.status === 'fulfilled') setStaffSummary(summaryResult.value);
        if (prospectResult.status === 'fulfilled') setProspects(prospectResult.value);
        if (independentResult.status === 'fulfilled') setIndependentTasks(independentResult.value?.items || []);
        if (auditResult.status === 'fulfilled') {
          const page = auditResult.value;
          setAuditItems(page.items || []);
          setAuditTotal(page.total || 0);
          setAuditPages(page.pages || 1);
          setAuditPage(page.page || 1);
        }
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load dashboard.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [next30Days, today]);

  // Resolve the currently-APPLIED period into request parameters.
  //
  // `params === undefined` means "no reporting-period restriction" (All Time).
  // The effect below keys off `appliedPeriod.key` — a stable string — so React
  // never refetches for two selections that resolve to the same window, and a
  // request for one period can never overwrite the figures of a later one.
  const periodRequest = useMemo<{
    key: string;
    params: { range?: StaffDashboardPeriodRange; from?: string; to?: string } | undefined;
  }>(
    () => ({
      key: appliedPeriod.key,
      params: appliedPeriod.params,
    }),
    [appliedPeriod]
  );

  // Fetch the summary for the applied period. `signal` guards against a slower
  // older request overwriting a newer period's figures; `scope` records which
  // period the response belongs to as a second line of defence.
  const fetchSummaryForPeriod = async (signal?: { cancelled: boolean }) => {
    try {
      setSummaryLoading(true);
      setError('');
      const summary = await getStaffDashboardSummary(periodRequest.params);
      if (!signal?.cancelled) setStaffSummary(summary);
    } catch (e: any) {
      if (!signal?.cancelled) setError(e?.message || 'Failed to update the dashboard for the selected period.');
    } finally {
      if (!signal?.cancelled) setSummaryLoading(false);
    }
  };

  // The activity trail follows the same period as the rest of the dashboard, so
  // it always shows the actions performed inside the window being reviewed. It
  // is fetched server-paginated and resets to page 1 for a new period.
  const fetchAuditForPeriod = async (signal?: { cancelled: boolean }, pageOverride?: number) => {
    try {
      setAuditLoading(true);
      setAuditError('');
      const page = await getMyAuditTrail({
        limit: AUDIT_PAGE_SIZE,
        // A period change always reads page 1, even if the user was deep in the
        // previous period's pages — this avoids a flash of a stale page number.
        page: pageOverride ?? auditPage,
        // No explicit column = the dashboard default, newest first.
        sortBy: auditSortKey || 'when',
        sortDir: auditSortKey ? auditSortDir : 'desc',
        ...(periodRequest.params || {}),
      });
      if (!signal?.cancelled) {
        setAuditItems(page.items || []);
        setAuditTotal(page.total || 0);
        setAuditPages(page.pages || 1);
        setAuditPage(page.page || 1);
      }
    } catch (e: any) {
      // A failed refresh must not be mistaken for an empty trail; surface it.
      if (!signal?.cancelled) setAuditError(e?.message || 'Failed to update your activity trail.');
    } finally {
      if (!signal?.cancelled) setAuditLoading(false);
    }
  };

  const periodEffectMounted = useRef(false);
  useEffect(() => {
    // The initial dashboard load already fetched the all-time summary and trail.
    if (!periodEffectMounted.current) {
      periodEffectMounted.current = true;
      return;
    }
    const signal = { cancelled: false };
    void fetchSummaryForPeriod(signal);
    void fetchAuditForPeriod(signal, 1);
    return () => {
      signal.cancelled = true;
    };
    // `appliedPeriod.key` is the stable identity of the applied window; the
    // params object is recreated on every render and must not retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedPeriod.key]);

  // Re-fetch the trail when the user pages or sorts it, but keep the summary
  // untouched (the period has not changed).
  const auditViewMounted = useRef(false);
  useEffect(() => {
    if (!auditViewMounted.current) {
      auditViewMounted.current = true;
      return;
    }
    const signal = { cancelled: false };
    void fetchAuditForPeriod(signal);
    return () => {
      signal.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditPage, auditSortKey, auditSortDir]);

  const refreshSummary = async () => {
    await Promise.all([fetchSummaryForPeriod(), fetchAuditForPeriod()]);
  };

  // ---- Reporting-period selection handlers ---------------------------------
  // Named presets and All Time apply immediately. A custom range is only ever
  // applied through `applyCustomRange`, which validates both dates and their
  // order first; an invalid selection keeps the previous figures on screen and
  // shows why — it never silently reverts to All Time.
  const handlePeriodChange = (value: 'all' | StaffDashboardPeriodRange) => {
    setPeriodRange(value);
    setCustomError('');
    if (value === 'custom') return; // wait for the Apply button
    setAppliedPeriod(
      value === 'all' ? { key: 'all', params: undefined } : { key: `range:${value}`, params: { range: value } }
    );
  };

  const applyCustomRange = () => {
    if (!customFrom || !customTo) {
      setCustomError('Select both a From and a To date to apply the custom range.');
      return;
    }
    if (customFrom > customTo) {
      setCustomError('The From date must be on or before the To date.');
      return;
    }
    setCustomError('');
    setAppliedPeriod({ key: `custom:${customFrom}:${customTo}`, params: { from: customFrom, to: customTo } });
  };

  // ---- Reporting-period window (drives the task list, bands and matter list) -
  // The authoritative `period` block tells us the exact dates on screen. For a
  // finite period we scope the "My Work" and "My Matters" lists to activity that
  // happened inside those dates; for All Time every assigned matter/task shows.
  // `asOfISO` is the reference date used for timeliness: the period end when a
  // past window is selected, otherwise today — so "late" is judged at the right
  // point in time rather than always against the present moment.
  const periodWindow = useMemo(() => {
    const p = staffSummary?.period;
    if (!p || p.isAllTime || !p.from || !p.to) return null;
    return { from: dayKey(p.from), to: dayKey(p.to) };
  }, [staffSummary?.period]);

  const asOfISO = useMemo(() => (periodWindow ? periodWindow.to : today), [periodWindow, today]);

  // A task qualifies for the selected period when it was COMPLETED inside the
  // window, or it is still open and its deadline fell inside the window. All
  // Time (no window) includes every task. Uses the completion event, never the
  // task's creation date, so a task finished outside the period is not counted.
  const taskInPeriod = (task: TaskData) => {
    if (!periodWindow) return true;
    const completed = dayKey(task.completedAt);
    if (task.status === 'Completed' && completed) {
      return completed >= periodWindow.from && completed <= periodWindow.to;
    }
    const due = dayKey(task.dueDate);
    if (task.status !== 'Completed') {
      return due >= periodWindow.from && due <= periodWindow.to;
    }
    // Completed but no completion timestamp: fall back to its last update.
    const updated = dayKey((task as any).updatedAt);
    return updated >= periodWindow.from && updated <= periodWindow.to;
  };

  const ownTasks = useMemo(
    () =>
      tasks.filter((task) => {
        if (!meName && !me?.email) return true;
        const matchesMe = (value?: string) =>
          identityMatches(value, meName) || identityMatches(value, me?.email || '');
        // The API rightly returns work where the member is the assignee,
        // supervisor or active staged contributor. Keep all three on the
        // dashboard too; the prior assignee of a completed stage is excluded
        // from open work after a handover.
        return (
          matchesMe(task.assignee) ||
          matchesMe(task.supervisor) ||
          (Array.isArray(task.taskStages) &&
            task.taskStages.some(
              (stage) =>
                matchesMe(stage.staffMember) &&
                String(stage.status || '').toLowerCase() !== 'completed'
            ))
        );
      }),
    [me?.email, meName, tasks],
  );

  // Only matters where the signed-in user is an assignee (Initiator, Reviewer,
  // Signer/Approver or assignedTo) — this keeps the dashboard cards and the
  // matter list in line with the staff summary endpoint.
  const authorisedCases = useMemo(
    () =>
      cases.filter(
        (matter) => caseMatchesAssigneeCanonical(matter, meName) || caseMatchesAssigneeCanonical(matter, me?.email),
      ),
    [cases, me?.email, meName],
  );

  // The ids of the matters this member is genuinely assigned to. Used to scope
  // calendar items to the same set the intern dashboard shows, so every
  // associate-like role reads one identical "Upcoming calendar items" figure.
  const authorisedCaseIds = useMemo(
    () => new Set(authorisedCases.map((matter) => String(matter._id || '')).filter(Boolean)),
    [authorisedCases],
  );

  const currentRolesForMatter = (matter?: CaseData) => {
    const matchesMe = (value?: string) => identityMatches(value, meName) || identityMatches(value, me?.email || '');
    const assignments = matter?.caseAssignments || {};
    return {
      initiator: matchesMe(assignments.initiator || matter?.assignedTo),
      reviewer: matchesMe(assignments.reviewer),
      approver: matchesMe(assignments.signerApprover),
    };
  };

  /**
   * Per-matter Key Actions (sub-tasks) for the unified My Work list.
   *
   * One batched fetch per authorised matter runs after the matters load — not
   * inside any render loop — and failures resolve to an empty map so the cards
   * still render from the other sources (legacy tasks, independent tasks,
   * prospects, calendar).
   */
  const authorisedCaseKey = useMemo(
    () => authorisedCases.map((matter) => String(matter._id || '')).filter(Boolean).sort().join('|'),
    [authorisedCases],
  );
  useEffect(() => {
    let mounted = true;
    const ids = authorisedCaseKey ? authorisedCaseKey.split('|') : [];
    if (!ids.length) {
      setCaseManagementByMatter({});
      return () => {
        mounted = false;
      };
    }
    (async () => {
      const entries = await Promise.all(
        ids.slice(0, 60).map(async (id) => {
          try {
            const state = await getCaseManagement(id);
            return [id, state] as const;
          } catch {
            return null;
          }
        })
      );
      if (!mounted) return;
      const next: Record<string, CaseManagementState> = {};
      entries.forEach((entry) => {
        if (entry) next[entry[0]] = entry[1];
      });
      setCaseManagementByMatter(next);
    })();
    return () => {
      mounted = false;
    };
  }, [authorisedCaseKey]);

  const tasksByCase = useMemo(() => {
    const map = new Map<string, TaskData[]>();
    ownTasks.forEach((task) => {
      const caseId = String(task.caseId || '');
      if (!caseId) return;
      map.set(caseId, [...(map.get(caseId) || []), task]);
    });
    return map;
  }, [ownTasks]);

  const periodTasks = useMemo(() => ownTasks.filter(taskInPeriod), [ownTasks, periodWindow]);

  // Unified workload (chunk 1/4): helper + Key-Action sub-tasks.
  // The whole matter is the PARENT task; every open Key Action is a SUB-TASK
  // coloured by its own deadline with the platform urgency rule (red = overdue
  // or ≤48h left, yellow = ≤7d, green = ≤21d, blue = beyond). Later chunks add
  // legacy tasks, independent tasks and prospects to the same list.
  const myWorkItems = useMemo<UnifiedWorkItem[]>(() => {
    const items: UnifiedWorkItem[] = [];
    const asOf = resolveDeadlineDateTime(asOfISO) || new Date();
    const caseById = new Map(authorisedCases.map((matter) => [String(matter._id || ''), matter]));

    Object.values(caseManagementByMatter).forEach((state) => {
      const matter = caseById.get(String(state.caseId || ''));
      if (!matter) return;
      const myRoles = currentRolesForMatter(matter);
      (state.steps || []).forEach((step) => {
        const stepStatus = String(step.status || '');
        if (stepStatus === 'Completed') return;
        // A handover has a clear next action: the Initiator owns work that is
        // not yet submitted, the Reviewer owns the review queue, and the
        // Signer/Approver owns approval. This prevents a former owner (or a
        // reviewer waiting for a submission) from being shown someone else's
        // unfinished delivery work as their task.
        const roleLabel =
          (stepStatus === 'Awaiting Review' && myRoles.reviewer && 'Reviewer') ||
          (stepStatus === 'Awaiting Approval' && myRoles.approver && 'Signer/Approver') ||
          (!['Awaiting Review', 'Awaiting Approval'].includes(stepStatus) && myRoles.initiator && 'Initiator');
        if (!roleLabel) return;
        const dueAt = resolveDeadlineDateTime(step.dueAt);
        const startAt = resolveDeadlineDateTime(step.startAt);
        const urgency = getUrgencyColorForDueDate(step.dueAt, step.startAt, asOf);
        const overdue = dueAt ? dueAt.getTime() < asOf.getTime() : false;
        const queue = stepStatus === 'Awaiting Approval' ? 'approval' : stepStatus === 'Awaiting Review' ? 'review' : 'none';
        const column = stepStatus === 'Awaiting Review' ? 'Awaiting Review' : stepStatus === 'In Progress' || stepStatus === 'Done' ? 'In Progress' : 'Not Started';
        items.push({
          id: `key-action:${state.caseId}:${step.stepKey}`,
          kind: 'key-action',
          title: step.title,
          status: stepStatus,
          priority: overdue || urgency === 'red' ? 'High' : urgency === 'yellow' ? 'Medium' : 'Low',
          dueAt: dueAt || undefined,
          dueLabel: step.dueAt ? formatDeadlineDateTime(step.dueAt) : 'No deadline',
          urgency,
          overdue,
          queue,
          column,
          href: buildCaseManagementLink(state.caseId, step.stepKey),
          matterId: String(state.caseId || ''),
          matterNo: state.caseNo || matter?.caseNo,
          matterParties: state.parties || matter?.parties,
          roleLabel,
          waitingOnClient: false,
        });
      });
    });

    // Unified workload (chunk 2/4): legacy matter tasks assigned to me.
    // Same urgency rule as every other surface; review/external queues feed
    // the Notifications card from this same list.
    periodTasks.forEach((task) => {
      // Workflow-linked task rows are an implementation/audit record. Their
      // live Key Action is already represented above from Case Management, so
      // showing both would duplicate one piece of work on the dashboard.
      if (task.workflowStepKey) return;
      if (String(task.status || '') === 'Completed' || String(task.workflowStage || '') === 'Closed') return;
      const dueAt = resolveDeadlineDateTime(task.dueDate);
      const urgency = getUrgencyColorForDueDate(task.dueDate, task.startDate, asOf);
      const overdue = dueAt ? dueAt.getTime() < asOf.getTime() : false;
      const queue =
        task.workflowStage === 'Awaiting External Action'
          ? 'external'
          : task.workflowStage === 'Awaiting Review' || (task.requiresApproval && task.approvalStatus === 'Pending')
            ? 'review'
            : 'none';
      const column =
        task.workflowStage === 'Awaiting Review'
          ? 'Awaiting Review'
          : task.workflowStage === 'Awaiting External Action'
            ? 'Awaiting External Action'
            : task.status === 'In Progress' || task.workflowStage === 'In Progress'
              ? 'In Progress'
              : 'Not Started';
      const matter = caseById.get(String(task.caseId || ''));
      items.push({
        id: `matter-task:${task._id}`,
        kind: 'matter-task',
        title: task.title,
        status: String(task.workflowStage && task.workflowStage !== 'Assigned' ? task.workflowStage : task.status),
        priority: task.priority,
        dueAt: dueAt || undefined,
        dueLabel: formatDeadlineDateTime(task.dueDate),
        urgency,
        overdue,
        queue,
        column,
        href: buildCaseManagementLink(task.caseId, task.workflowStepKey),
        matterId: String(task.caseId || ''),
        matterNo: matter?.caseNo,
        matterParties: matter?.parties || task.relatedClient,
        roleLabel: task.supervisor ? `Supervisor: ${task.supervisor}` : 'Assigned',
        waitingOnClient: queue === 'external',
      });
    });

    // Unified workload (chunk 3/4): standalone tasks + intake stages I own.
    independentTasks
      .filter((task) => {
        if (String(task.status || '') === 'Completed' || String(task.status || '') === 'Closed') return false;
        if (!meName && !me?.email) return true;
        return (
          identityMatches(task.assignee, meName) ||
          identityMatches(task.assignee, me?.email || '') ||
          identityMatches(task.supervisor, meName) ||
          identityMatches(task.supervisor, me?.email || '')
        );
      })
      .forEach((task) => {
        const dueAt = resolveDeadlineDateTime(task.dueDate);
        const urgency = getUrgencyColorForDueDate(task.dueDate, task.startDate, asOf);
        const overdue = dueAt ? dueAt.getTime() < asOf.getTime() : false;
        const queue = task.status === 'Awaiting External Action' ? 'external' : task.status === 'Awaiting Review' ? 'review' : 'none';
        const column =
          task.status === 'Awaiting Review'
            ? 'Awaiting Review'
            : task.status === 'Awaiting External Action'
              ? 'Awaiting External Action'
              : task.status === 'In Progress'
                ? 'In Progress'
                : 'Not Started';
        items.push({
          id: `independent:${task._id}`,
          kind: 'independent-task',
          title: task.title,
          status: task.status,
          priority: task.priority,
          dueAt: dueAt || undefined,
          dueLabel: formatDeadlineDateTime(task.dueDate),
          urgency,
          overdue,
          queue,
          column,
          href: `/matters/independent-tasks/${task._id}`,
          matterId: task.relatedMatterId || undefined,
          matterNo: task.relatedMatter?.caseNo,
          matterParties: task.relatedMatter?.parties || task.relatedClient,
          roleLabel:
            identityMatches(task.supervisor, meName) || identityMatches(task.supervisor, me?.email || '')
              ? 'Supervisor'
              : 'Assigned',
          waitingOnClient: queue === 'external',
        });
      });

    prospects
      .filter((prospect) => {
        if (['Converted', 'Non-Converted'].includes(String(prospect.stage || ''))) return false;
        const responsible = [prospect.responsibleAssociate, prospect.responsiblePartner, prospect.assignedTo]
          .map((value) => (typeof value === 'string' ? value : (value as any)?.name || ''))
          .filter(Boolean);
        if (!responsible.length) return false;
        if (!meName && !me?.email) return true;
        return responsible.some((name) => identityMatches(name, meName) || identityMatches(name, me?.email || ''));
      })
      .forEach((prospect) => {
        const dueAt = getStageDueAt(prospect as any);
        const urgency = getStageUrgencyColor(prospect as any, asOf);
        const overdue = dueAt ? dueAt.getTime() < asOf.getTime() : false;
        const waitingOn = String((prospect as any).waitingOn || 'Firm');
        const waitingOnClient = waitingOn === 'Client' || waitingOn === 'Third Party';
        items.push({
          id: `prospect:${prospect._id}`,
          kind: 'prospect',
          title: `${prospect.clientName || prospect.parties || 'Prospect'} — ${prospect.stage}`,
          status: String((prospect as any).stageStatus || prospect.stage || 'In Progress'),
          priority: overdue || urgency === 'red' ? 'High' : urgency === 'yellow' ? 'Medium' : 'Low',
          dueAt: dueAt || undefined,
          dueLabel: dueAt ? formatDeadlineDateTime(dueAt) : 'No deadline',
          urgency,
          overdue,
          queue: waitingOnClient ? 'external' : 'none',
          column: waitingOnClient ? 'Awaiting External Action' : 'In Progress',
          href: `/matters/intake-prospects/${prospect._id}`,
          roleLabel: 'Intake owner',
          waitingOnClient,
        });
      });

    // Unified workload (chunk 4/4): period scoping. All Time counts everything
    // open; a reporting window counts open items whose deadline falls inside
    // it plus items completed inside it. Key Actions carry no completion stamp
    // here — they are always open, so only their deadline decides.
    if (periodWindow) {
      return items.filter((item) => {
        if (!item.dueAt) return true;
        const key = dayKey(item.dueAt.toISOString());
        return key >= periodWindow.from && key <= periodWindow.to;
      });
    }
    return items;
  }, [authorisedCases, caseManagementByMatter, periodTasks, periodWindow, independentTasks, prospects, asOfISO, meName, me?.email]);

  // My Work signals derived from THE SAME unified list as every card below:
  // platform urgency bands (red/yellow/green/blue), review/external queues,
  // and urgent actions. Counts always reconcile with My Matters because both
  // read myWorkItems — never ad-hoc task filters.
  const workSignals = useMemo(() => {
    const bandCounts = { blue: 0, green: 0, yellow: 0, red: 0, overdue: 0, untracked: 0 };
    myWorkItems.forEach((item) => {
      if (item.urgency === 'gray') bandCounts.untracked += 1;
      else bandCounts[item.urgency] += 1;
      if (item.overdue) bandCounts.overdue += 1;
    });
    const awaitingReview = myWorkItems.filter((item) => item.queue === 'review');
    const awaitingApproval = myWorkItems.filter((item) => item.queue === 'approval');
    const awaitingExternal = myWorkItems.filter((item) => item.queue === 'external');
    const urgent = myWorkItems
      .filter((item) => item.overdue || item.urgency === 'red')
      .sort((a, b) => (a.dueAt?.getTime() || 0) - (b.dueAt?.getTime() || 0));
    return { bandCounts, awaitingReview, awaitingApproval, awaitingExternal, urgent };
  }, [myWorkItems]);

  // Matters that had qualifying activity in the selected period (or all assigned
  // matters for All Time). Derived from THE SAME unified work list as My Work,
  // plus matters created inside the window, so the cards always agree.
  const periodMatterIds = useMemo(() => {
    if (!periodWindow) return null; // null = no filtering (All Time)
    const ids = new Set<string>();
    myWorkItems.forEach((item) => {
      if (item.matterId) ids.add(String(item.matterId));
    });
    authorisedCases.forEach((matter) => {
      const created = dayKey((matter as any).createdAt);
      if (created && created >= periodWindow.from && created <= periodWindow.to) {
        ids.add(String(matter._id || ''));
      }
    });
    return ids;
  }, [periodWindow, myWorkItems, authorisedCases]);

  // My Matters rows derived from THE SAME unified list: open work per matter
  // (Key-Action sub-tasks + legacy tasks + standalone + intake), so the per-
  // matter "Open tasks" and urgency pressure always sum to the My Work bands.
  const workByMatter = useMemo(() => {
    const map = new Map<string, UnifiedWorkItem[]>();
    myWorkItems.forEach((item) => {
      if (!item.matterId) return;
      map.set(item.matterId, [...(map.get(item.matterId) || []), item]);
    });
    return map;
  }, [myWorkItems]);

  const matterRows = useMemo<MatterRow[]>(() => {
    return authorisedCases
      .filter((matter) => !periodMatterIds || periodMatterIds.has(String(matter._id || '')))
      .map((matter) => {
        const unified = workByMatter.get(String(matter._id || '')) || [];
        const matterTasks = (tasksByCase.get(String(matter._id || '')) || []).filter(taskInPeriod);
        const openTasks = unified.length;
        const earliestDueMs =
          unified
            .map((item) => item.dueAt?.getTime() || 0)
            .filter(Boolean)
            .sort((a, b) => a - b)[0] || 0;
        const nextDeadline = earliestDueMs ? new Date(earliestDueMs).toISOString() : matter.workflowProgress?.nextDueAt || '—';
        const progress =
          safeNum(matter.workflowProgress?.percent) ||
          (matterTasks.length ? Math.round((matterTasks.filter((task) => task.status === 'Completed').length / matterTasks.length) * 100) : 0);
        const warningTasks = unified.filter((item) => item.urgency === 'yellow').length;
        const poorTasks = unified.filter((item) => item.urgency === 'red' || item.overdue).length;

        return {
          ...matter,
          progress,
          contractValue: getMatterContractValue(matter),
          earnedValue: getMatterEarnedValue(matter),
          nextDeadline,
          openTasks,
          warningTasks,
          poorTasks,
        };
      })
      .sort((a, b) => b.warningTasks + b.poorTasks - (a.warningTasks + a.poorTasks));
  }, [authorisedCases, workByMatter, tasksByCase, periodMatterIds, periodWindow]);

  // Matter Financial Status reflects the SAME qualifying matter set as the rest
  // of the dashboard: all assigned matters for All Time, only the matters worked
  // on inside the selected window otherwise. Computed from `matterRows` so it
  // stays consistent with the My Matters cards, the headline Total Contract Value
  // and the fee table. Planned/completed/outstanding value are properties of the
  // matter, not period cash flows.
  const financials = useMemo(() => {
    const contractValue = matterRows.reduce((sum, matter) => sum + matter.contractValue, 0);
    const earnedValue = matterRows.reduce((sum, matter) => sum + matter.earnedValue, 0);
    const outstanding = Math.max(0, contractValue - earnedValue);
    return { contractValue, earnedValue, outstanding };
  }, [matterRows]);

  const teamRows = useMemo<TeamRow[]>(() => {
    const map = new Map<string, { assigned: number; completed: number; overdue: number; quality: number[] }>();
    tasks.forEach((task) => {
      const name = String(task.assignee || 'Unassigned').trim() || 'Unassigned';
      const row = map.get(name) || { assigned: 0, completed: 0, overdue: 0, quality: [] };
      row.assigned += 1;
      if (task.status === 'Completed') row.completed += 1;
      if (task.status !== 'Completed' && ((getTaskDate(task.dueDate)?.getTime() ?? 0) < Date.now())) row.overdue += 1;
      if (Number.isFinite(Number(task.qualityScore))) row.quality.push(safeNum(task.qualityScore));
      map.set(name, row);
    });

    return Array.from(map.entries())
      .map(([name, row]) => ({
        name,
        assigned: row.assigned,
        completed: row.completed,
        overdue: row.overdue,
        quality: row.quality.length ? Math.round(row.quality.reduce((sum, value) => sum + value, 0) / row.quality.length) : null,
      }))
      .sort((a, b) => b.assigned - a.assigned || b.overdue - a.overdue)
      .slice(0, 8);
  }, [tasks, today]);

  const businessStats = useMemo(() => {
    const ownProspects = prospects.filter((prospect) => {
      if (!meName) return true;
      const assignedTo = typeof prospect.assignedTo === 'object' ? prospect.assignedTo?.name : prospect.assignedTo;
      const associate = typeof prospect.responsibleAssociate === 'object' ? prospect.responsibleAssociate?.name : prospect.responsibleAssociate;
      const partner = typeof prospect.responsiblePartner === 'object' ? prospect.responsiblePartner?.name : prospect.responsiblePartner;
      return [assignedTo, associate, partner].some((value) => baseNameFromLabel(value) === meName);
    });
    const open = ownProspects.filter((prospect) => !['Converted', 'Non-Converted'].includes(String(prospect.stage)));
    const converted = ownProspects.filter((prospect) => prospect.stage === 'Converted');
    const lost = ownProspects.filter((prospect) => prospect.stage === 'Non-Converted');
    const terminal = converted.length + lost.length;
    return {
      leads: ownProspects.length,
      opportunities: open.length,
      pipelineValue: open.reduce((sum, prospect) => sum + safeNum(prospect.estimatedFeeValue || prospect.estimatedMatterValue), 0),
      conversionRate: terminal ? Math.round((converted.length / terminal) * 100) : 0,
      newClients: converted.length,
      lostClients: lost.length,
    };
  }, [meName, prospects]);

  const upcomingEvents = useMemo(
    () => events
      // "Upcoming calendar items" must describe the SAME scope for every
      // associate-like role. The events endpoint returns firm-wide events to
      // partner-level roles, so scope to the member's own authorised matters
      // here — exactly the set an intern already sees — so the card matches
      // across Trainee Associate, Associate, Senior Associate and Associate
      // Partner instead of inflating for partners.
      .filter((event) => authorisedCaseIds.has(String(event.caseId)))
      .filter((event) => String(event.date) >= today)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, 6),
    [authorisedCaseIds, events, today]
  );

  const summary = staffSummary;
  // My Performance — completion + timeliness rooted in THE SAME unified list.
  // On-time = green/blue urgency; at-risk = yellow; late = red/overdue.
  const workPerformance = useMemo(() => {
    const total = myWorkItems.length;
    const onTime = myWorkItems.filter((item) => !item.overdue && (item.urgency === 'blue' || item.urgency === 'green')).length;
    const atRisk = myWorkItems.filter((item) => !item.overdue && item.urgency === 'yellow').length;
    const late = myWorkItems.filter((item) => item.overdue || item.urgency === 'red').length;
    const completionPct = total ? Math.round((onTime / total) * 100) : null;
    return { total, onTime, atRisk, late, completionPct };
  }, [myWorkItems]);
  /** The reporting block — ALWAYS present (All Time when no window was applied). */
  const period = summary?.period;
  // A real date window is applied (not All Time). The fee table, earnings labels
  // and activity-trail wording all key off THIS, not off `period` existing —
  // otherwise All Time would be treated as if a period were selected.
  const hasWindow = Boolean(period && !period.isAllTime);
  // Per-matter rows straight from the Case Workspace → Earned Fees tables.
  // When a period window is selected, only the matters that actually had
  // activity inside it are listed, so every row on screen belongs to the period.
  const allMatterFeeRows = summary?.rows || [];
  const matterFeeRows = useMemo(
    () => (hasWindow ? allMatterFeeRows.filter((row) => row.inPeriod) : allMatterFeeRows),
    [allMatterFeeRows, hasWindow]
  );
  // "Matters with Earned Fees" must describe the SAME scope as the table:
  // in-period rows use the in-period earned fee, so a matter only counts when it
  // actually earned a (non-pending) fee inside the selected window — never just
  // because it has an all-time earned fee.
  const feeScoredMatters = matterFeeRows.filter((row) =>
    hasWindow ? row.earnedFeeInPeriod != null : row.earnedFee != null
  );
  // Table totals are ALWAYS recalculated from the full filtered set, never from
  // the visible page, so they reconcile with the summary cards.
  const feeTotals = useMemo(() => {
    const sum = (pick: (row: StaffDashboardMatterRow) => number | null | undefined) =>
      round2(
        matterFeeRows.reduce((total, row) => {
          const value = pick(row);
          return total + (value == null ? 0 : value);
        }, 0)
      );
    return {
      collected: hasWindow ? sum((row) => row.collectedBaseInPeriod) : sum((row) => row.collectedBase),
      // A null (pending) earned fee is not a zero — exclude it from the sum and
      // let the "Pending" indicator speak for itself.
      earned: hasWindow ? sum((row) => row.earnedFeeInPeriod) : sum((row) => row.earnedFee),
    };
  }, [matterFeeRows, hasWindow]);
  // Matters Completion Rate follows the reporting period: for a selected window
  // it is the matters whose workflow completed in the period over the matters
  // worked on in that period; for All Time it is the all-time completion rate.
  const summaryCompletionRate = useMemo(() => {
    if (hasWindow && period) {
      if (!period.mattersWithActivity) return null;
      return Math.round((period.mattersCompleted / period.mattersWithActivity) * 100);
    }
    return summary && summary.mattersAssigned > 0
      ? Math.round((summary.mattersCompleted / summary.mattersAssigned) * 100)
      : null;
  }, [hasWindow, period, summary]);

  // ---- Fee breakdown by matter — sorting + pagination (10 rows per page) ----
  const sortedMatterFeeRows = useMemo(
    () =>
      sortRows(matterFeeRows, feeSortKey, feeSortDir, (row) => {
        switch (feeSortKey) {
          case 'matter':
            return `${row.caseNo || ''} ${row.parties || ''}`;
          case 'parties':
            return row.parties || '';
          case 'role':
            return row.role || '';
          case 'tpa':
            return row.tpaPercent ?? null;
          case 'timeliness':
            return row.timelinessScore ?? null;
          case 'quality':
            return row.qualityScore ?? null;
          case 'contract':
            return row.contractValue ?? null;
          case 'collected':
            return row.collectedBase ?? null;
          case 'earned':
            return row.earnedFee ?? null;
          case 'collectedPeriod':
            return row.collectedBaseInPeriod ?? null;
          case 'earnedPeriod':
            return row.earnedFeeInPeriod ?? null;
          default:
            return '';
        }
      }),
    [feeSortDir, feeSortKey, matterFeeRows]
  );
  const feePages = Math.max(1, Math.ceil(sortedMatterFeeRows.length / PAGE_SIZE));
  const feePageClamped = Math.min(feePage, feePages);
  const feePageRows = sortedMatterFeeRows.slice((feePageClamped - 1) * PAGE_SIZE, feePageClamped * PAGE_SIZE);

  const handleFeeSort = (column: string) => {
    const next = toggleSortKey(feeSortKey, feeSortDir, column);
    setFeeSortKey(next.key);
    setFeeSortDir(next.dir);
    setFeePage(1);
  };

  // A different reporting period reloads the rows, so start again on page 1 —
  // for both the fee breakdown and the activity trail. Keyed on the APPLIED
  // period, so an unapplied (invalid) custom selection cannot reset the pages.
  useEffect(() => {
    setFeePage(1);
    setAuditPage(1);
  }, [appliedPeriod.key]);

  // ---- My Activity Trail — server-paginated, newest first ------------------
  // The trail is paginated and sorted on the backend, so every page reflects the
  // same period window and no page is ever a truncated "complete" list. The
  // current page is `auditItems`; totals come from the server response.
  const auditPageClamped = Math.min(auditPage, auditPages);
  const auditPageRows = auditItems;

  const handleAuditSort = (column: string) => {
    const next = toggleSortKey(auditSortKey, auditSortDir, column);
    setAuditSortKey(next.key);
    setAuditSortDir(next.dir);
    setAuditPage(1);
  };

  const headlineStats = useMemo<StatCard[]>(() => {
    const summary = staffSummary;
    // The reporting block is ALWAYS present: `period.isAllTime` is true for the
    // All Time view (every figure is the all-time total) and false for a selected
    // period. One uniform card set is built from it for EVERY period, so
    // switching period never adds, removes or reorders a card.
    const period = summary?.period;
    const allTime = period?.isAllTime ?? true;
    // `inPeriodSuffix` reads "in Last Month" for a period and "" for All Time,
    // so every helper sentence describes the window actually on screen.
    const inPeriodSuffix = period && !allTime ? ` in ${period.label}` : '';

    // ---- Current-state figures (the period cannot change these) -------------
    // "Overdue" describes work that is NOT yet done, so it carries no completion
    // date a past period could filter on. It stays a current position and is
    // never given an invented period value.
    const overdue = summary?.overdueSections ?? 0;

    // ---- Period-based figures (recalculated for the selected window) --------
    // Every one of these comes from the authoritative `period` block, which the
    // backend fills with in-period values (or all-time totals when isAllTime).
    const mattersInScope = period?.mattersWithActivity ?? 0;
    const timeliness = period?.averageTimelinessScore ?? null;
    const quality = period?.averageQualityScore ?? null;
    const mattersCompleted = period?.mattersCompleted ?? 0;
    const fees = period ? period.feesEarned : null;
    const keyActions = period?.keyActionsChecked ?? 0;
    const sections = period?.sectionsCompleted ?? 0;
    // Total Contract Value for the reporting scope — the sum of the contract
    // values of the qualifying matters. Sourced from the backend so it changes
    // with the qualifying set and never reuses an all-time frontend total.
    const contractValue = period?.contractValue ?? 0;

    const stats: StatCard[] = [
      {
        // "Assigned Matters" is THE qualifying set for the period — the matters
        // assigned to you that had activity inside the window (all assigned
        // matters for All Time). It is the SAME set that drives Total Contract
        // Value, the fee table, My Matters and My Work, so every figure on the
        // page reconciles to this one number.
        label: profile.financialScope === 'client' ? 'Assigned Clients / Matters' : 'Assigned Matters',
        value: String(mattersInScope),
        helper: `Matters assigned to you — Initiator, Reviewer, Signer/Approver or assigned lawyer${inPeriodSuffix || ' (all time)'}`,
        icon: Briefcase,
        tone: 'blue',
        href: '/matters',
      },
      {
        label: 'Tasks Outstanding',
        value: String(period?.tasksOutstanding ?? 0),
        helper: !allTime ? `Key actions pending to be checked${inPeriodSuffix}` : 'Key actions pending to be checked',
        icon: CheckSquare,
        tone: (period?.tasksOutstanding ?? 0) ? 'amber' : 'green',
        href: '/tasks',
      },
      {
        label: 'Overdue Tasks',
        value: String(overdue),
        helper: 'Workflow sections past deadline in your open matters (as of today)',
        icon: AlertTriangle,
        tone: overdue ? 'red' : 'green',
        href: '/tasks',
      },
      {
        label: 'On-Time Completion',
        value: timeliness == null ? 'Pending' : `${timeliness}%`,
        helper: `Average Timeliness from your Earned Fees rows${inPeriodSuffix || ' (all time)'}`,
        icon: Clock,
        tone: (timeliness ?? 0) >= 80 ? 'green' : 'amber',
        href: '/performance',
      },
      {
        label: 'Quality Score',
        value: quality == null ? 'Pending' : `${quality}%`,
        helper: `Average Quality from your Earned Fees rows${inPeriodSuffix || ' (all time)'}`,
        icon: Award,
        tone: 'purple',
        href: '/performance',
      },
      {
        // ONE consistent meaning for every period: matters whose workflow
        // completed inside the window (all completed matters for All Time).
        label: 'Matters Completed',
        value: String(mattersCompleted),
        helper: `Matters whose workflow status is Completed${inPeriodSuffix || ' (all time)'}`,
        icon: TrendingUp,
        tone: 'green',
        href: '/performance',
      },
      {
        label: 'Key Actions Checked',
        value: String(keyActions),
        helper: `Key Actions (workflow steps) completed${inPeriodSuffix || ' (all time)'}`,
        icon: CheckCircle2,
        tone: 'blue',
      },
      {
        label: 'Sections Completed',
        value: String(sections),
        helper: `Workflow Sections fully completed${inPeriodSuffix || ' (all time)'}`,
        icon: CheckSquare,
        tone: 'green',
      },
      // TPA is a current, role-based rate — never period-scoped.
      {
        label: 'TPA',
        value: `${summary?.tpaPercent ?? profile.tpa}%`,
        helper: 'Your role participation share from the remuneration table',
        icon: DollarSign,
        tone: 'green',
      },
      {
        label: profile.financialScope === 'client' ? 'Portfolio Total Contract Value' : 'Total Contract Value',
        value: formatRwf(contractValue),
        icon: DollarSign,
        tone: 'green',
      },
      {
        label: 'Fees Earned',
        value: fees == null ? 'Pending' : formatFees(fees),
        icon: DollarSign,
        tone: fees && fees > 0 ? 'green' : 'amber',
      },
    ];
    return stats;
  }, [profile, staffSummary]);

  return (
    <div className="staff-dashboard">
      <div className="mb-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gray-500">{roleLabel(effectiveRole)}</div>
            <h1 className="mt-1 text-2xl font-semibold text-gray-900">{profile.title}</h1>
            <p className="mt-1 text-gray-600">{me?.name ? `Welcome, ${me.name}. ` : ''}{profile.purpose}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="rounded-full bg-gray-900 px-4 py-2 text-xs font-semibold text-white">
              TPA {summary?.tpaPercent ?? profile.tpa}% · {profile.financialScope} scope
            </div>
          </div>
        </div>
      </div>

      {/* Reporting period — same windows as Firm Reports */}
      <div className="mb-6 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-sm text-gray-700">
            Reporting period
            <select
              value={periodRange}
              onChange={(event) => handlePeriodChange(event.target.value as 'all' | StaffDashboardPeriodRange)}
              className="mt-1 rounded border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="all">All time</option>
              <option value="daily">Last Day</option>
              <option value="weekly">Last Week</option>
              <option value="this_month">This Month</option>
              <option value="monthly">Last Month</option>
              <option value="quarterly">Last Quarter</option>
              <option value="yearly">Last Year</option>
              <option value="ytd">Year to Date</option>
              <option value="custom">Custom Range</option>
            </select>
          </label>

          {periodRange === 'custom' && (
            <>
              <label className="flex flex-col text-sm text-gray-700">
                From
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(event) => {
                    setCustomFrom(event.target.value);
                    setCustomError('');
                  }}
                  className="mt-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900"
                />
              </label>
              <label className="flex flex-col text-sm text-gray-700">
                To
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(event) => {
                    setCustomTo(event.target.value);
                    setCustomError('');
                  }}
                  className="mt-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900"
                />
              </label>
              {/* Custom dates only take effect on Apply — never a confusing
                  intermediate reload while the member is still choosing dates. */}
              <button
                type="button"
                onClick={applyCustomRange}
                disabled={summaryLoading}
                className="inline-flex items-center rounded bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-60"
              >
                Apply range
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => void refreshSummary()}
            disabled={summaryLoading}
            className="inline-flex items-center rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${summaryLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="text-sm text-gray-600">
          {summaryLoading ? (
            <span className="text-gray-500">Updating figures…</span>
          ) : hasWindow && period ? (
            <span>
              <span className="font-medium text-gray-800">Applied period:</span> {period.from} → {period.to}
            </span>
          ) : (
            <span className="text-gray-700">Scope: All time</span>
          )}
          {/* An unapplied custom selection is never hidden: if the member picked
              Custom Range but the range is not yet validly applied, say so and
              name the window still on screen. */}
          {periodRange === 'custom' && appliedPeriod.key !== `custom:${customFrom}:${customTo}` && (
            <div className="mt-1 text-xs text-amber-700">
              Custom range not applied yet — the figures below still show{' '}
              {hasWindow && period ? `the period ${period.from} → ${period.to}` : 'all time'}. Choose both
              dates and select “Apply range”.
            </div>
          )}
          {customError && <div className="mt-1 text-xs text-red-700">{customError}</div>}
        </div>
      </div>

      {error && <div className="mb-6 p-4 border border-red-200 bg-red-50 text-red-700 rounded">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {headlineStats.map((stat) => (
          <StatCardView key={stat.label} stat={stat} loading={loading || summaryLoading} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200">
            <SectionHeader
              title={profile.labels.overview}
              description={
                hasWindow
                  ? `Work completed or due between ${period?.from} and ${period?.to}: timeliness bands, approval/review queues, and urgent actions.`
                  : 'Assigned work, timeliness bands, approval/review queues, and urgent actions across all time.'
              }
            />
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              {[
                ['🔵 On Track', workSignals.bandCounts.blue, 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200'],
                ['🟢 Comfortable', workSignals.bandCounts.green, 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'],
                ['🟡 Due Soon', workSignals.bandCounts.yellow, 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'],
                ['🔴 Urgent', workSignals.bandCounts.red, 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200'],
                ['Late', workSignals.bandCounts.overdue, 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200'],
                ['No Deadline', workSignals.bandCounts.untracked, 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'],
              ].map(([label, value, classes]) => (
                <div key={String(label)} className={`rounded-lg border px-3 py-2 text-sm ${classes}`}>
                  <div className="font-semibold">{loading ? '…' : value}</div>
                  <div className="text-xs">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading tasks…</div>
          ) : myWorkItems.length === 0 ? (
            <div className="px-5 py-10 text-gray-500">
              {hasWindow
                ? `No work was due between ${period?.from} and ${period?.to}.`
                : 'No work assigned.'}
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {workSignals.urgent
                .concat(myWorkItems.filter((item) => !item.overdue && item.urgency !== 'red').sort((a, b) => (a.dueAt?.getTime() || 0) - (b.dueAt?.getTime() || 0)))
                .filter((item, index, list) => list.findIndex((entry) => entry.id === item.id) === index)
                .slice(0, 8)
                .map((item) => (
                  <div key={String(item.id)} className="px-5 py-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className={`px-2 py-0.5 text-xs rounded ${priorityChip(item.priority)}`}>{item.priority}</span>
                          <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-700">{item.status}</span>
                          <span className="px-2 py-0.5 text-xs rounded bg-blue-50 text-blue-700">
                            {item.kind === 'key-action' ? 'Key Action' : item.kind === 'matter-task' ? 'Matter Task' : item.kind === 'independent-task' ? 'Standalone' : 'Intake'}
                          </span>
                          <span className={`px-2 py-0.5 text-xs rounded ${urgencyChip(item.urgency)}`} title="Platform deadline urgency">
                            {item.urgency === 'red' ? '🔴 Urgent' : item.urgency === 'yellow' ? '🟡 Due Soon' : item.urgency === 'green' ? '🟢 Comfortable' : item.urgency === 'blue' ? '🔵 On Track' : 'No deadline'}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-900">{item.title}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Due {item.dueLabel}{item.matterNo ? ` · ${item.matterNo}` : ''}{item.matterParties ? ` · ${item.matterParties}` : ''} · {item.roleLabel}
                        </p>
                      </div>
                      <Link
                        to={item.href}
                        className="shrink-0 px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                      >
                        {item.kind === 'independent-task' ? 'Open Task' : item.kind === 'prospect' ? 'Open Intake' : 'Open Case Management'}
                      </Link>
                    </div>
                  </div>
                ))}
            </div>
          )}
          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/tasks" className="text-sm text-gray-600 hover:text-gray-900">Open Task Management →</Link>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <SectionHeader title={profile.labels.risk} description="System-generated alerts from task status, deadlines, approvals, and calendar records." />
          <div className="space-y-3">
            {[
              { label: 'Awaiting review', value: workSignals.awaitingReview.length, icon: CheckCircle2, tone: 'amber' as Tone, hint: 'Key Actions + tasks parked for supervisor review' },
              { label: 'Awaiting approval', value: workSignals.awaitingApproval.length, icon: CheckCircle2, tone: 'purple' as Tone, hint: 'Reviewed work waiting for final sign-off' },
              { label: 'Awaiting client/external info', value: workSignals.awaitingExternal.length, icon: Clock, tone: 'blue' as Tone, hint: 'Blocked on client or third party' },
              { label: 'Upcoming calendar items', value: upcomingEvents.length, icon: CalendarIcon, tone: 'slate' as Tone, hint: 'Your authorised matters, next 30 days' },
            ].map((item) => {
              const Icon = item.icon;
              const tone = toneClasses[item.tone];
              return (
                <div key={item.label} className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center gap-3">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${tone.icon}`}><Icon className="h-4 w-4" /></div>
                    <div>
                      <div className="text-sm text-gray-700">{item.label}</div>
                      <div className="text-xs text-gray-500">{item.hint}</div>
                    </div>
                  </div>
                  <div className={`font-semibold ${tone.text}`}>{loading ? '…' : item.value}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200">
            <SectionHeader
              title={profile.labels.matters}
              description={
                hasWindow
                  ? `Matters you worked on between ${period?.from} and ${period?.to}, with next actions, deadlines, workload pressure, and drill-down.`
                  : 'Matters assigned to you with next actions, deadlines, workload pressure, and drill-down.'
              }
            />
          </div>
          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading matters…</div>
          ) : matterRows.length === 0 ? (
            <div className="px-5 py-10 text-gray-500">No matters are assigned to you yet.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {matterRows.slice(0, 8).map((matter) => (
                <div key={String(matter._id)} className="px-5 py-4 hover:bg-gray-50">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium text-gray-900">{matter.caseNo || matter.parties}</h3>
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">{matter.status}</span>
                        <span className={`px-2 py-0.5 text-xs rounded ${priorityChip(matter.priority)}`}>{matter.priority}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">Client/parties: {matter.parties || '—'}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        Next action: {matter.workflowProgress?.currentStepTitle || 'Workflow task'} · Deadline{' '}
                        {matter.nextDeadline && matter.nextDeadline !== '—' ? formatDeadlineDateTime(matter.nextDeadline) : '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 md:text-right">
                      <div>
                        <div className="text-xs text-gray-500">Open tasks</div>
                        <div className="font-semibold text-gray-900">{matter.openTasks}</div>
                      </div>
                      <Link to={`/matters/${matter._id}`} className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">Open</Link>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                      <span>Progress</span>
                      <span>{matter.progress}% · 🟡 {matter.warningTasks} · 🔴 {matter.poorTasks}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gray-700" style={{ width: `${Math.min(100, matter.progress)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/matters" className="text-sm text-gray-600 hover:text-gray-900">View all matters →</Link>
          </div>
        </div>

        {profile.visible.matterFinancials && (
          <div className="lg:col-span-3 bg-white border border-gray-200 rounded-lg p-5">
            <SectionHeader
              title="Matter Financial Status"
              description={
                hasWindow
                  ? `Planned, completed, and outstanding value of the ${matterRows.length} matter${matterRows.length === 1 ? '' : 's'} you worked on in ${period?.from} → ${period?.to}.`
                  : 'Planned, completed, and outstanding value of the matters assigned to you.'
              }
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                ['Total Contract Value', formatRwf(financials.contractValue), 'slate' as Tone],
                ['Work Value in Progress', formatRwf(financials.earnedValue), 'green' as Tone],
                ['Outstanding Value', formatRwf(financials.outstanding), 'amber' as Tone],
              ].map(([label, value, tone]) => {
                const toneData = toneClasses[tone as Tone];
                return (
                  <div key={String(label)} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-gray-500">{label}</div>
                    <div className={`mt-2 text-lg font-semibold ${toneData.text}`}>{loading ? '…' : value}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {profile.visible.team && (
          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-5">
            <SectionHeader title={profile.labels.team} description="Assigned, completed, overdue, and quality for authorised team workload from task records." />
            {loading ? (
              <div className="text-gray-500">Loading team workload…</div>
            ) : teamRows.length === 0 ? (
              <div className="text-gray-500">No team workload data available.</div>
            ) : (
              <div className="space-y-3">
                {teamRows.map((member) => (
                  <div key={member.name} className="rounded-lg border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-gray-900">{member.name}</div>
                        <div className="text-xs text-gray-500">{member.completed}/{member.assigned} tasks completed · {member.overdue} overdue · quality {member.quality == null ? '—' : `${member.quality}%`}</div>
                      </div>
                      <div className="text-sm font-semibold text-gray-700">{member.assigned} assigned</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <SectionHeader
            title={profile.labels.performance}
            description={
              hasWindow && period
                ? `Completion, timeliness and quality for ${period.label}; the performance rating is your overall record.`
                : 'Completion, timeliness, quality, and rating computed from your assigned matters and your performance record.'
            }
          />
          <div className="space-y-4">
            {([
              [
                hasWindow ? 'Work Completion Rate (in period)' : 'Work Completion Rate',
                workPerformance.completionPct == null ? 'Pending' : `${workPerformance.completionPct}%`,
                CheckSquare,
                (workPerformance.completionPct ?? 0) >= 80 ? 'green' : 'amber',
              ],
              [
                'On-Time Work',
                `${workPerformance.onTime}/${workPerformance.total}`,
                Clock,
                workPerformance.late > 0 ? 'amber' : 'green',
              ],
              [
                'At Risk (Due Soon)',
                String(workPerformance.atRisk),
                Clock,
                workPerformance.atRisk > 0 ? 'amber' : 'green',
              ],
              [
                'Late / Urgent',
                String(workPerformance.late),
                Clock,
                workPerformance.late > 0 ? 'red' : 'green',
              ],
              [
                'Average Timeliness',
                (period?.averageTimelinessScore ?? summary?.averageTimelinessScore) == null
                  ? 'Pending'
                  : `${period?.averageTimelinessScore ?? summary?.averageTimelinessScore}%`,
                Clock,
                ((period?.averageTimelinessScore ?? summary?.averageTimelinessScore) ?? 0) >= 70 ? 'green' : 'amber',
              ],
              [
                'Average Quality',
                (period?.averageQualityScore ?? summary?.averageQualityScore) == null
                  ? 'Pending'
                  : `${period?.averageQualityScore ?? summary?.averageQualityScore}%`,
                Award,
                'purple',
              ],
              ['Performance Rating', performance?.rating?.value ? `${performance.rating.value}/5` : 'Pending', BarChart3, 'blue'],
            ] as Array<[string, string, React.ComponentType<any>, Tone]>).map(([label, value, Icon, tone]) => {
              const toneData = toneClasses[tone as Tone];
              const IconComponent = Icon as React.ComponentType<any>;
              return (
                <div key={String(label)} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${toneData.icon}`}><IconComponent className="h-4 w-4" /></div>
                    <div className="text-sm text-gray-700">{label}</div>
                  </div>
                  <div className={`font-semibold ${toneData.text}`}>{loading ? '…' : String(value)}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 border-t border-gray-200 pt-3">
            <Link to="/performance" className="text-sm text-gray-600 hover:text-gray-900">Open detailed performance →</Link>
          </div>
        </div>

        {profile.visible.business && (
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <SectionHeader title="Business Development" description="Limited CRM/prospect visibility tied to responsible staff, partner, or assignment." />
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Leads/Prospects', businessStats.leads],
                ['Open Opportunities', businessStats.opportunities],
                ['Pipeline Value', formatRwf(businessStats.pipelineValue)],
                ['Conversion Rate', `${businessStats.conversionRate}%`],
                ['New Clients', businessStats.newClients],
                ['Lost Clients', businessStats.lostClients],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <Handshake className="mb-2 h-4 w-4 text-gray-600" />
                  <div className="text-lg font-semibold text-gray-900">{loading ? '…' : String(value)}</div>
                  <div className="text-xs text-gray-500">{label}</div>
                </div>
              ))}
            </div>
            <div className="mt-5 border-t border-gray-200 pt-3">
              <Link to="/matters/intake-prospects" className="text-sm text-gray-600 hover:text-gray-900">Open prospects →</Link>
            </div>
          </div>
        )}

        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-lg p-5">
          <SectionHeader
            title={profile.labels.earnings}
            description={
              hasWindow && period
                ? `Your Earned Fees for ${period.from} → ${period.to}, computed from the payments received in that window and reconciled with Firm Reports (Payment Date).`
                : "Your row from each assigned matter's Case Workspace Earned Fees table. Totals match the Earned fee column of those tables."
            }
          />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              hasWindow && period
                ? ['Fees Earned in Period', period.feesEarned == null ? 'Pending' : formatFees(period.feesEarned), `Earned from payments received in ${period.from} → ${period.to}`]
                : ['Fees Earned', summary?.feesEarnedTotal == null ? 'Pending' : formatFees(summary.feesEarnedTotal), 'Sum of your Earned fee rows across your matters'],
              // Total Contract Value for the CURRENT reporting scope — recalculated
              // from the qualifying matter set, never earned revenue or cash.
              ['Total Contract Value', formatRwf(period?.contractValue ?? 0), `Sum of contract values of the qualifying matters ${hasWindow && period ? `in ${period.from} → ${period.to}` : 'across all time'}`],
              // TPA is a current, role-based rate — labelled as such.
              ['TPA', `${summary?.tpaPercent ?? profile.tpa}%`, 'Your current role participation share from the remuneration table'],
              [
                'Matters with Earned Fees',
                String(feeScoredMatters.length),
                hasWindow
                  ? 'Matters with a calculated earned fee in the period'
                  : `${matterFeeRows.length} matter(s) with your earned-fee record`,
              ],
            ].map(([label, value, helper]) => (
              <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500">{label}</div>
                <div className="mt-2 text-lg font-semibold text-gray-900">{summaryLoading ? '…' : value}</div>
                <div className="mt-1 text-xs text-gray-500">{helper}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
            {hasWindow
              ? `For the selected period only payments received inside it are used as the collected base, so the figures line up with Firm Reports (Payment Date). Fees Earned = Collected Base × TPA% × Timeliness% × Quality%.`
              : `Fees Earned = Collected Base × TPA% × Timeliness% × Quality% for each matter, exactly as shown in that matter's Case Workspace.`}
          </div>

          <div className="mt-5 border-t border-gray-200 pt-3">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm font-medium text-gray-900">
              <span>Fee breakdown by matter {hasWindow && period ? `· ${period.from} → ${period.to}` : '(Case Workspace)'}</span>
              {hasWindow && (
                <span className="text-xs font-normal text-gray-500">
                  {matterFeeRows.length} of {allMatterFeeRows.length} assigned matters had activity in this period
                </span>
              )}
            </div>
            {/* Authoritative totals for the filtered set — recalculated from every
                qualifying row, never from the visible page — so the summary cards,
                the table and the reporting figures always agree. */}
            {matterFeeRows.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm">
                <span className="text-gray-600">
                  {hasWindow ? 'Collected base in period' : 'Collected base (all-time)'}:{' '}
                  <span className="font-semibold tabular-nums text-gray-900">{formatRwf(feeTotals.collected)}</span>
                </span>
                <span className="text-gray-600">
                  {hasWindow ? 'Earned fee in period' : 'Earned fee (all-time)'}:{' '}
                  <span className="font-semibold tabular-nums text-gray-900">
                    {hasWindow
                      ? period?.feesEarned == null
                        ? 'Pending'
                        : formatFees(period.feesEarned)
                      : summary?.feesEarnedTotal == null
                        ? 'Pending'
                        : formatFees(summary.feesEarnedTotal)}
                  </span>
                </span>
                <span className="text-gray-500">
                  across {matterFeeRows.length} matter{matterFeeRows.length === 1 ? '' : 's'}
                </span>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="min-w-[1240px] w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="w-10 px-3 py-3">#</th>
                    <SortableHeader label="Matter" column="matter" sortKey={feeSortKey} sortDir={feeSortDir} onSort={handleFeeSort} />
                    <SortableHeader label="Parties" column="parties" sortKey={feeSortKey} sortDir={feeSortDir} onSort={handleFeeSort} />
                    <SortableHeader label="Role" column="role" sortKey={feeSortKey} sortDir={feeSortDir} onSort={handleFeeSort} />
                    <SortableHeader label="TPA" column="tpa" sortKey={feeSortKey} sortDir={feeSortDir} onSort={handleFeeSort} align="right" />
                    <SortableHeader label="Timeliness" column="timeliness" sortKey={feeSortKey} sortDir={feeSortDir} onSort={handleFeeSort} align="right" />
                    <SortableHeader label="Quality" column="quality" sortKey={feeSortKey} sortDir={feeSortDir} onSort={handleFeeSort} align="right" />
                    <SortableHeader label={hasWindow ? 'Contract value (all-time)' : 'Total Contract Value'} column="contract" sortKey={feeSortKey} sortDir={feeSortDir} onSort={handleFeeSort} align="right" />
                    {hasWindow ? (
                      <>
                        <SortableHeader label="Collected base in period" column="collectedPeriod" sortKey={feeSortKey} sortDir={feeSortDir} onSort={handleFeeSort} align="right" />
                        <SortableHeader label="Earned fee in period" column="earnedPeriod" sortKey={feeSortKey} sortDir={feeSortDir} onSort={handleFeeSort} align="right" />
                      </>
                    ) : (
                      <>
                        <SortableHeader label="Collected base (all-time)" column="collected" sortKey={feeSortKey} sortDir={feeSortDir} onSort={handleFeeSort} align="right" />
                        <SortableHeader label="Earned fee (all-time)" column="earned" sortKey={feeSortKey} sortDir={feeSortDir} onSort={handleFeeSort} align="right" />
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {matterFeeRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                        {hasWindow && period
                          ? `None of your ${allMatterFeeRows.length} assigned matters had qualifying activity in ${period.from} → ${period.to}. Choose a different period, or All time to see every matter.`
                          : 'No matters assigned yet. Earned fees appear here once a matter is assigned to you and scored in its Case Workspace.'}
                      </td>
                    </tr>
                  ) : (
                    feePageRows.map((row, index) => (
                      <tr key={row.caseId} className="align-top">
                        <td className="px-3 py-3 text-gray-500">{(feePageClamped - 1) * PAGE_SIZE + index + 1}</td>
                        <td className="px-4 py-3 text-gray-700">
                          {row.isIndependentContributor ? (
                            <span title="This contribution is completed from Independent Tasks, not the case workspace.">
                              {row.caseNo || row.parties || '—'}
                            </span>
                          ) : (
                            <Link to={`/matters/${row.caseId}`} className="hover:text-gray-900">{row.caseNo || row.parties || '—'}</Link>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{row.parties || '—'}</td>
                        <td className="px-4 py-3 text-gray-700">
                          <div>{row.role || '—'}</div>
                          {row.isIndependentContributor ? (
                            <div className="mt-1 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-800">
                              Independent-task contribution
                            </div>
                          ) : !row.isCurrentAssignment ? (
                            <span
                              className="staff-handover-badge"
                              title="This role was handed over. Previously recorded contributions remain attributed to this team member."
                            >
                              <History aria-hidden="true" />
                              <span>Retained after handover</span>
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">{row.tpaPercent > 0 ? `${row.tpaPercent}%` : '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">{row.timelinessScore == null ? '—' : `${row.timelinessScore}%`}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">{row.qualityScore == null ? '—' : `${row.qualityScore}%`}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatRwf(row.contractValue ?? 0)}</td>
                        {hasWindow ? (
                          <>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatRwf(row.collectedBaseInPeriod ?? 0)}</td>
                            {/* A pending in-period fee is shown as Pending, never as 0. */}
                            <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{row.earnedFeeInPeriod == null ? 'Pending' : formatFees(row.earnedFeeInPeriod)}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatRwf(row.collectedBase)}</td>
                            <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{row.earnedFee == null ? 'Pending' : formatFees(row.earnedFee)}</td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {matterFeeRows.length > 0 && (
              <Pagination page={feePageClamped} pages={feePages} total={matterFeeRows.length} onChange={setFeePage} />
            )}

          </div>
        </div>

        {/* Activity trail — every action recorded against the signed-in member's account. */}
        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-lg p-5">
          <SectionHeader
            title="My Activity Trail"
            description={`Every action recorded against your account${me?.name ? ` (${me.name.trim()})` : ''}, newest first, with the exact time it was performed.`}
          />
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
            <span>
              {loading || (auditLoading && auditItems.length === 0)
                ? 'Loading your activity…'
                : auditError
                  ? auditError
                  : auditTotal > 0
                    ? `${auditTotal} recorded action${auditTotal === 1 ? '' : 's'}${hasWindow && period ? ` in ${period.label}` : ' on your account'}${auditLoading ? ' · refreshing…' : ''}.`
                    : hasWindow && period
                      ? `No activity was recorded on your account in ${period.label}.`
                      : 'No activity has been recorded on your account yet. Actions you take on matters appear here with their exact timestamp.'}
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-600">
              {hasWindow && period ? `Filtered: ${period.from} → ${period.to}` : 'All time'} · newest first
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <SortableHeader label="Date & time" column="when" sortKey={auditSortKey} sortDir={auditSortDir} onSort={handleAuditSort} />
                  <SortableHeader label="Action" column="action" sortKey={auditSortKey} sortDir={auditSortDir} onSort={handleAuditSort} />
                  <SortableHeader label="Activity" column="activity" sortKey={auditSortKey} sortDir={auditSortDir} onSort={handleAuditSort} />
                  {/* Related record is attached after the query, so it is not a
                      server-sortable field — shown as a plain header rather than a
                      sort control that could not reorder the whole period. */}
                  <th className="px-4 py-3">Related record</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading || (auditLoading && auditItems.length === 0) ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">Loading your activity…</td>
                  </tr>
                ) : auditError ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-red-600">
                      {auditError} Your previously loaded activity is unchanged.
                    </td>
                  </tr>
                ) : auditItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                      {hasWindow && period ? `No activity was recorded on your account in ${period.label}.` : 'No activity has been recorded on your account yet. Actions you take on matters appear here with their exact timestamp.'}
                    </td>
                  </tr>
                ) : (
                  auditPageRows.map((entry) => (
                    <tr key={entry._id} className="align-top hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-gray-700">{formatAuditTimestamp(entry.createdAt)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex whitespace-nowrap rounded px-2 py-0.5 text-xs ${auditActionChip(entry.action)}`}>
                          {auditActionLabel(entry.action)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{entry.message || auditActionLabel(entry.action)}</div>
                        {entry.detail ? <div className="mt-0.5 text-xs text-gray-500">{entry.detail}</div> : null}
                      </td>
                      <td className="px-4 py-3">
                        {entry.case ? (
                          <Link to={`/matters/${entry.case._id}`} className="text-blue-700 hover:text-blue-900">
                            {entry.case.caseNo || 'Matter'}
                            {entry.case.parties ? <span className="block text-xs text-gray-500">{entry.case.parties}</span> : null}
                          </Link>
                        ) : entry.caseId ? (
                          <span className="text-gray-500">Matter no longer available</span>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loading && auditTotal > 0 && (
            <Pagination page={auditPageClamped} pages={auditPages} total={auditTotal} onChange={setAuditPage} />
          )}

        </div>
      </div>
    </div>
  );
}
