import React, { useEffect, useMemo, useState } from 'react';
import usePageTitle from '../../hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { UserRole } from '../../App';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Banknote,
  BarChart3,
  Briefcase,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  CreditCard,
  FileCheck2,
  FileText,
  Folder,
  Handshake,
  MessageSquareWarning,
  Plus,
  ShieldAlert,
  Star,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { getAllCases, CaseData } from '../../services/caseService';
import { getBillingSummary, BillingSummary } from '../../services/billingService';
import { getAllTasks, TaskData } from '../../services/taskService';
import { getFirmEvents, FirmCalendarEvent } from '../../services/eventService';
import { getRecentAuditFeed, AuditFeedItem } from '../../services/auditService';
import { getAllProspects, Prospect } from '../../services/prospectService';
import { listInvoices, Invoice } from '../../services/invoiceService';
import { getActivePettyCashFund, PettyCashFund } from '../../services/pettyCashService';
import { formatDeadlineDateTime, resolveDeadlineDateTime } from '../../utils/workflowDeadline';

const formatRwfShort = (n: number) => {
  const val = Number(n) || 0;
  if (val >= 1_000_000_000) return `RWF ${(val / 1_000_000_000).toFixed(1)}B`;
  if (val >= 1_000_000) return `RWF ${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `RWF ${(val / 1_000).toFixed(1)}K`;
  return `RWF ${Math.round(val).toLocaleString('en-US')}`;
};

const formatMonthLabel = (month: string) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return month;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const isoToday = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (baseISO: string, days: number) => {
  const d = new Date(baseISO);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const timeAgo = (isoDate: string) => {
  const t = new Date(isoDate).getTime();
  if (!Number.isFinite(t)) return '-';
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
};

const formatActivityDateTime = (isoDate?: string) => {
  if (!isoDate) return '-';
  const d = new Date(isoDate);
  if (!Number.isFinite(d.getTime())) return '-';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getTaskDueAt = (task?: TaskData) => resolveDeadlineDateTime(task?.dueDate);

const normalizeProspectStage = (stage?: string) => String(stage || '').trim().toLowerCase().replace(/-/g, ' ');
const normalizeOpportunitySource = (prospect: Prospect) =>
  String(prospect.referralSource || prospect.enquirySource || '').trim() || 'Unspecified';
const isTerminalProspect = (prospect: Prospect) => {
  const stage = normalizeProspectStage(prospect.stage);
  return stage === 'converted' || stage === 'non converted';
};
const isConvertedProspect = (prospect: Prospect) => normalizeProspectStage(prospect.stage) === 'converted';
const isLostProspect = (prospect: Prospect) => normalizeProspectStage(prospect.stage) === 'non converted';
const getProspectValue = (prospect: Prospect) => Number(prospect.estimatedFeeValue) || Number(prospect.estimatedMatterValue) || 0;

function DashboardSection({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <Icon className="h-5 w-5 text-gray-700 dark:text-gray-300" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function KPICard({
  title,
  value,
  detail,
  icon: Icon,
  tone = 'slate',
  to,
  children,
}: {
  title: string;
  value: React.ReactNode;
  detail?: string;
  icon: React.ElementType;
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'indigo';
  to?: string;
  children?: React.ReactNode;
}) {
  const toneStyles: Record<string, string> = {
    slate: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    red: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  };

  const card = (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-transform duration-200 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-gray-600 dark:text-gray-400">{title}</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{value}</div>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneStyles[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {detail ? <div className="text-sm text-gray-500 dark:text-gray-400">{detail}</div> : null}
      {children}
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="block h-full transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md">
        {card}
      </Link>
    );
  }

  return card;
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        {subtitle ? <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

function DashboardTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ matter: string; partner: string; deadline: string; status: string }>;
}) {
  const statusStyles: Record<string, string> = {
    Upcoming: 'bg-slate-100 text-slate-700',
    Urgent: 'bg-amber-100 text-amber-700',
    Overdue: 'bg-rose-100 text-rose-700',
    Completed: 'bg-emerald-100 text-emerald-700',
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-gray-400">Matter</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-gray-400">Assigned Partner</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-gray-400">Deadline</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-gray-400">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
            {rows.map((row) => (
              <tr key={`${row.matter}-${row.deadline}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                <td className="px-5 py-3 text-sm text-gray-900 dark:text-gray-100">{row.matter}</td>
                <td className="px-5 py-3 text-sm text-gray-600 dark:text-gray-400">{row.partner}</td>
                <td className="px-5 py-3 text-sm text-gray-600 dark:text-gray-400">{row.deadline}</td>
                <td className="px-5 py-3 text-sm text-gray-600 dark:text-gray-400">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusStyles[row.status] || 'bg-slate-100 text-slate-700'}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DashboardTimeline({ items }: { items: Array<{ title: string; detail: string; time: string; actor: string; timestamp: string }> }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Recent Business Activity</h3>
      </div>
      <div className="px-5 py-4">
        <div className="space-y-4">
          {items.map((item, index) => (
            <div key={`${item.title}-${index}`} className="flex gap-3">
              <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                <Activity className="h-4 w-4" />
              </div>
              <div className="flex-1 border-b border-gray-100 pb-4 last:border-b-0 last:pb-0 dark:border-gray-700">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.title}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{item.time}</div>
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  <span className="font-medium text-gray-700 dark:text-gray-300">{item.actor}</span>
                  <span> • {item.timestamp}</span>
                </div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">{item.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardInsightCard({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300">
      {text}
    </div>
  );
}

type NavigationItem = { block: string; detail: string; path: string };
type AlertItem = { severity: 'high' | 'medium' | 'low'; title: string; detail: string; source: string };
type PerformanceRow = { name: string; assigned: number; completed: number; overdue: number; averageQuality: number; completionRate: number };

export default function ManagingPartnerDashboard({ userRole }: { userRole?: UserRole }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cases, setCases] = useState<CaseData[]>([]);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [allTasks, setAllTasks] = useState<TaskData[]>([]);
  const [events, setEvents] = useState<FirmCalendarEvent[]>([]);
  const [auditFeed, setAuditFeed] = useState<AuditFeedItem[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<Invoice[]>([]);
  const [activeFund, setActiveFund] = useState<PettyCashFund | null>(null);

  usePageTitle('Management Dashboard');

  const roleLabel = useMemo(() => {
    if (!userRole) return 'Dashboard';
    if (userRole === 'managing_director') return 'Managing Director';
    if (userRole === 'managing_partner') return 'Managing Partner';
    if (userRole === 'senior_partner') return 'Senior Partner';
    if (userRole === 'partner') return 'Partner';
    if (userRole === 'associate_partner') return 'Associate Partner';
    return 'Leadership';
  }, [userRole]);

  const today = useMemo(() => isoToday(), []);
  const next14Days = useMemo(() => addDaysISO(today, 14), [today]);
  const recentWindow = useMemo(() => Date.now() - 30 * 24 * 60 * 60 * 1000, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setError('');

        const [
          casesResult,
          billingResult,
          tasksResult,
          eventsResult,
          feedResult,
          prospectsResult,
          invoicesResult,
          fundResult,
        ] = await Promise.allSettled([
          getAllCases(),
          getBillingSummary(),
          getAllTasks(),
          getFirmEvents({ from: today, to: next14Days, type: 'all' }),
          getRecentAuditFeed(8),
          getAllProspects({ includeTerminal: true }),
          listInvoices({ status: 'Pending' }),
          getActivePettyCashFund(),
        ]);

        if (!mounted) return;

        if (casesResult.status === 'fulfilled') setCases(casesResult.value);
        if (billingResult.status === 'fulfilled') setSummary(billingResult.value);
        if (tasksResult.status === 'fulfilled') setAllTasks(tasksResult.value);
        if (eventsResult.status === 'fulfilled') setEvents(eventsResult.value);
        if (feedResult.status === 'fulfilled') setAuditFeed(feedResult.value);
        if (prospectsResult.status === 'fulfilled') setProspects(prospectsResult.value);
        if (invoicesResult.status === 'fulfilled') setPendingInvoices(invoicesResult.value);
        if (fundResult.status === 'fulfilled') setActiveFund(fundResult.value);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || `Failed to load ${roleLabel} dashboard.`);
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [today, next14Days, roleLabel]);

  const pendingInvoiceTotal = useMemo(() => pendingInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0), [pendingInvoices]);
  const pendingInvoiceCount = pendingInvoices.length;

  const activeMattersCount = useMemo(
    () => cases.filter((item) => String(item.status || '').toLowerCase() !== 'closed').length,
    [cases]
  );

  const newMattersCount = useMemo(
    () => cases.filter((item) => item.createdAt && new Date(item.createdAt).getTime() >= recentWindow).length,
    [cases, recentWindow]
  );

  const closedMattersCount = useMemo(
    () =>
      cases.filter(
        (item) => String(item.status || '').toLowerCase() === 'closed' && item.updatedAt && new Date(item.updatedAt).getTime() >= recentWindow
      ).length,
    [cases, recentWindow]
  );

  const criticalMattersCount = useMemo(
    () =>
      cases.filter((item) => {
        const status = String(item.status || '').toLowerCase();
        if (status === 'closed') return false;
        const progress = Number(item.workflowProgress?.percent ?? 0) || 0;
        const priority = String(item.priority || '').toLowerCase();
        return progress <= 25 || priority === 'high';
      }).length,
    [cases]
  );

  const upcomingEvents = useMemo(
    () =>
      [...events]
        .filter((event) => String(event.date) >= today)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .slice(0, 6),
    [events, today]
  );

  const upcomingCriticalDeadlinesCount = useMemo(
    () => events.filter((event) => String(event.date) >= today && String(event.date) <= addDaysISO(today, 7)).length,
    [events, today]
  );

  const overdueDeadlinesCount = useMemo(() => events.filter((event) => String(event.date) < today).length, [events, today]);

  const completedTasks = useMemo(() => allTasks.filter((task) => task.status === 'Completed'), [allTasks]);

  const pendingReviewCount = useMemo(
    () => allTasks.filter((task) => task.workflowStage === 'Awaiting Review' || task.approvalStatus === 'Pending').length,
    [allTasks]
  );

  const overdueTasksCount = useMemo(
    () =>
      allTasks.filter((task) => {
        if (task.status === 'Completed') return false;
        const due = getTaskDueAt(task);
        return Boolean(due && Number.isFinite(due.getTime()) && due.getTime() < Date.now());
      }).length,
    [allTasks]
  );

  const recentCompletedTasksCount = useMemo(
    () => completedTasks.filter((task) => task.completedAt && new Date(task.completedAt).getTime() >= recentWindow).length,
    [completedTasks, recentWindow]
  );

  const onTimeCompletionRate = useMemo(() => {
    const withDeadlines = completedTasks.filter((task) => task.dueDate && task.completedAt);
    if (!withDeadlines.length) return 0;
    const onTime = withDeadlines.filter((task) => {
      const due = getTaskDueAt(task);
      return Boolean(due && new Date(task.completedAt!).getTime() <= due.getTime());
    }).length;
    return Math.round((onTime / withDeadlines.length) * 100);
  }, [completedTasks]);

  const averageQualityScore = useMemo(() => {
    const scored = completedTasks.filter((task) => Number.isFinite(Number(task.qualityScore)));
    if (!scored.length) return null;
    return Math.round((scored.reduce((sum, task) => sum + (Number(task.qualityScore) || 0), 0) / scored.length) * 10) / 10;
  }, [completedTasks]);

  const totalOpportunitiesCount = prospects.length;
  const newOpportunitiesCount = useMemo(
    () => prospects.filter((prospect) => prospect.dateReceived && new Date(prospect.dateReceived).getTime() >= recentWindow).length,
    [prospects, recentWindow]
  );
  const redFlagClientsCount = useMemo(
    () => prospects.filter((prospect) => prospect.conflictCheckStatus === 'Flagged').length,
    [prospects]
  );
  const convertedProspectsCount = useMemo(() => prospects.filter((prospect) => isConvertedProspect(prospect)).length, [prospects]);
  const lostOpportunitiesCount = useMemo(() => prospects.filter((prospect) => isLostProspect(prospect)).length, [prospects]);
  const openOpportunitiesCount = useMemo(() => prospects.filter((prospect) => !isTerminalProspect(prospect)).length, [prospects]);
  const terminalOpportunityCount = convertedProspectsCount + lostOpportunitiesCount;
  const conversionRate = terminalOpportunityCount > 0 ? Math.round((convertedProspectsCount / terminalOpportunityCount) * 100) : 0;
  const pipelineValue = useMemo(() => prospects.reduce((sum, prospect) => sum + getProspectValue(prospect), 0), [prospects]);

  const sourceBreakdown = useMemo(() => {
    const palette = ['#0f172a', '#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626'];
    const map = new Map<string, { label: string; total: number; converted: number; lost: number; open: number; value: number }>();

    prospects.forEach((prospect) => {
      const label = normalizeOpportunitySource(prospect);
      const row = map.get(label) || { label, total: 0, converted: 0, lost: 0, open: 0, value: 0 };
      row.total += 1;
      row.value += getProspectValue(prospect);
      if (isConvertedProspect(prospect)) row.converted += 1;
      else if (isLostProspect(prospect)) row.lost += 1;
      else row.open += 1;
      map.set(label, row);
    });

    return Array.from(map.values())
      .sort((a, b) => b.total - a.total || b.value - a.value)
      .slice(0, 6)
      .map((item, index) => ({
        ...item,
        color: palette[index % palette.length],
      }));
  }, [prospects]);

  const taskPerformanceByMember = useMemo<PerformanceRow[]>(() => {
    const map = new Map<string, { name: string; assigned: number; completed: number; overdue: number; qualityTotal: number; qualityCount: number }>();

    allTasks.forEach((task) => {
      const name = String(task.assignee || 'Unassigned').trim() || 'Unassigned';
      const row = map.get(name) || { name, assigned: 0, completed: 0, overdue: 0, qualityTotal: 0, qualityCount: 0 };
      row.assigned += 1;
      if (task.status === 'Completed') row.completed += 1;
      const due = getTaskDueAt(task);
      if (task.status !== 'Completed' && due && due.getTime() < Date.now()) row.overdue += 1;
      if (Number.isFinite(Number(task.qualityScore))) {
        row.qualityTotal += Number(task.qualityScore) || 0;
        row.qualityCount += 1;
      }
      map.set(name, row);
    });

    return Array.from(map.values())
      .sort((a, b) => b.completed - a.completed || b.assigned - a.assigned)
      .slice(0, 6)
      .map((item) => ({
        name: item.name,
        assigned: item.assigned,
        completed: item.completed,
        overdue: item.overdue,
        averageQuality: item.qualityCount > 0 ? Math.round((item.qualityTotal / item.qualityCount) * 10) / 10 : 0,
        completionRate: item.assigned > 0 ? Math.round((item.completed / item.assigned) * 100) : 0,
      }));
  }, [allTasks]);

  const monthlyTrend = useMemo(() => summary?.months || [], [summary?.months]);
  const managementNavigation = useMemo<NavigationItem[]>(
    () => [
      { block: 'Finance', detail: 'Revenue, collections, profit, cash', path: 'Revenue > Practice > Partner > Client > Matter > Invoice > Transaction' },
      { block: 'Collections', detail: 'Receivables and payment tracking', path: 'Receivables > Client > Matter > Invoice > Payment' },
      { block: 'Profitability', detail: 'Firm, practice, partner, client, matter, and task economics', path: 'Firm > Practice > Partner > Client > Matter > Task' },
      { block: 'Cash', detail: 'Cash flow and available cash position', path: 'Cash Flow > Bank Account > Transaction' },
      { block: 'Expenses', detail: 'Cost categories and supplier transactions', path: 'Category > Department > Expense > Supplier / Payee > Transaction' },
      { block: 'Remuneration', detail: 'Staff earnings and task-linked pay', path: 'Staff > Individual > Earnings > Task' },
    ],
    []
  );

  const cashPosition = Number(activeFund?.remainingAmount ?? 0);
  const cashThreshold = Number(activeFund?.initialAmount ?? 0) * (Number(activeFund?.lowBalancePercent ?? 20) / 100);
  const cashIsLow = Boolean(activeFund && cashPosition <= cashThreshold);
  const collectionRate = Number(summary?.collectionRate ?? 0);
  const revenueGrowth = useMemo(() => {
    const months = summary?.months || [];
    if (months.length < 2) return null;
    const last = Number(months[months.length - 1]?.collected) || 0;
    const prev = Number(months[months.length - 2]?.collected) || 0;
    if (prev <= 0) return null;
    return Math.round(((last - prev) / prev) * 100);
  }, [summary?.months]);

  const grossProfit = Number(summary?.grossProfit ?? 0);
  const netProfit = Number(summary?.netProfit ?? 0);
  const profitabilityMargin = Number(summary?.netProfitMargin ?? summary?.grossProfitMargin ?? 0);
  const outstandingValue = Number(summary?.outstanding ?? 0);
  const pendingInvoiceLabel = `${pendingInvoiceCount} pending invoice${pendingInvoiceCount === 1 ? '' : 's'}`;

  const operationalRows = useMemo(() => {
    const caseLookup = new Map(cases.map((item) => [item._id, item]));

    return upcomingEvents.map((event) => {
      const match = event.caseId ? caseLookup.get(event.caseId) : undefined;
      const deadline = event.time ? `${event.date} ${event.time}` : event.date;
      let status: 'Upcoming' | 'Urgent' | 'Overdue' = 'Upcoming';
      if (String(event.date) < today) status = 'Overdue';
      else if (String(event.date) <= addDaysISO(today, 7)) status = 'Urgent';

      return {
        matter: event.case ? `${event.case.caseNo} - ${event.case.parties}` : event.title,
        partner: match?.assignedTo ? String(match.assignedTo) : '-',
        deadline,
        status,
      };
    });
  }, [cases, upcomingEvents, today]);

  const managementAlerts = useMemo<AlertItem[]>(() => {
    const alerts: AlertItem[] = [];

    if (collectionRate < 85) {
      alerts.push({
        severity: 'high',
        title: 'Collection rate below target',
        detail: `Collection rate is ${collectionRate}% against the 85% benchmark.`,
        source: 'Finance',
      });
    }

    if (cashIsLow) {
      alerts.push({
        severity: 'high',
        title: 'Low cash position',
        detail: `Active petty cash balance is ${formatRwfShort(cashPosition)} and has crossed the low-balance threshold.`,
        source: 'Cash',
      });
    }

    if (overdueTasksCount > 0) {
      alerts.push({
        severity: 'high',
        title: 'Overdue tasks',
        detail: `${overdueTasksCount} task${overdueTasksCount === 1 ? '' : 's'} are past due and still open.`,
        source: 'People & Performance',
      });
    }

    if (criticalMattersCount > 0) {
      alerts.push({
        severity: 'medium',
        title: 'Critical matters',
        detail: `${criticalMattersCount} active matter${criticalMattersCount === 1 ? '' : 's'} are at elevated workflow risk.`,
        source: 'Matters',
      });
    }

    if (redFlagClientsCount > 0) {
      alerts.push({
        severity: 'medium',
        title: 'Red flag clients',
        detail: `${redFlagClientsCount} client${redFlagClientsCount === 1 ? '' : 's'} were flagged by conflict review.`,
        source: 'Risk & Compliance',
      });
    }

    if (pendingReviewCount > 0) {
      alerts.push({
        severity: 'medium',
        title: 'Pending partner review',
        detail: `${pendingReviewCount} task${pendingReviewCount === 1 ? '' : 's'} still need review or approval.`,
        source: 'Operations',
      });
    }

    if (pendingInvoiceCount > 0) {
      alerts.push({
        severity: 'low',
        title: 'Pending invoices',
        detail: pendingInvoiceLabel,
        source: 'Billing',
      });
    }

    if ((summary?.netProfitMargin ?? 0) < 30 && (summary?.collected ?? 0) > 0) {
      alerts.push({
        severity: 'low',
        title: 'Profit margin under target',
        detail: `Net profit margin is ${summary?.netProfitMargin ?? 0}%.`,
        source: 'Finance',
      });
    }

    return alerts.slice(0, 6);
  }, [
    cashIsLow,
    cashPosition,
    collectionRate,
    criticalMattersCount,
    overdueTasksCount,
    pendingReviewCount,
    redFlagClientsCount,
    pendingInvoiceCount,
    pendingInvoiceLabel,
    summary?.collected,
    summary?.netProfitMargin,
  ]);

  const latestActivity = useMemo(
    () =>
      (auditFeed || []).slice(0, 5).map((item) => ({
        title: item.message || 'System activity',
        detail: [
          item.detail || item.action || 'Activity recorded in the audit trail',
          item.case ? `${item.case.caseNo} - ${item.case.parties}` : '',
        ].filter(Boolean).join(' • '),
        time: item.createdAt ? timeAgo(item.createdAt) : '-',
        actor: item.actorName || 'Unknown user',
        timestamp: formatActivityDateTime(item.createdAt),
      })),
    [auditFeed]
  );

  const insights = useMemo(() => {
    const items: string[] = [];
    if (monthlyTrend.length > 1) {
      const last = Number(monthlyTrend[monthlyTrend.length - 1]?.collected) || 0;
      const prev = Number(monthlyTrend[monthlyTrend.length - 2]?.collected) || 0;
      if (last > prev) items.push('Revenue increased compared with the prior billing period.');
    }
    if (overdueDeadlinesCount > 0) items.push(`${overdueDeadlinesCount} deadlines are overdue.`);
    if (pendingInvoiceCount > 0) items.push(`${pendingInvoiceCount} invoices remain pending.`);
    if (pendingReviewCount > 0) items.push(`${pendingReviewCount} matters require partner review.`);
    if (terminalOpportunityCount > 0) items.push(`Prospect conversion rate currently stands at ${conversionRate}%.`);
    if (sourceBreakdown[0]) items.push(`Top opportunity source: ${sourceBreakdown[0].label}.`);
    return items;
  }, [
    monthlyTrend,
    overdueDeadlinesCount,
    pendingInvoiceCount,
    pendingReviewCount,
    terminalOpportunityCount,
    conversionRate,
    sourceBreakdown,
  ]);

  if (loading && !summary && !cases.length && !allTasks.length && !error) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-sm text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
        Loading management dashboard...
      </div>
    );
  }

  const revenueGrowthLabel =
    revenueGrowth == null ? 'No prior month comparison' : revenueGrowth >= 0 ? `+${revenueGrowth}% vs previous month` : `${revenueGrowth}% vs previous month`;

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="bg-gradient-to-br from-slate-50 via-white to-gray-100 px-6 py-6 text-gray-900 sm:px-8 dark:from-gray-900 dark:via-slate-800 dark:to-slate-700 dark:text-white">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Management Dashboard</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-700 dark:text-white/75">
                Executive overview of finance, matters, people, business development, risk, and alerts built from live system data.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  to="/cases/new"
                  className="inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create New Case
                </Link>
                <Link
                  to="/reports"
                  className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
                >
                  <FileText className="mr-2 h-4 w-4" />
                  View Reports
                </Link>
                <Link
                  to="/petty-cash"
                  className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
                >
                  <Wallet className="mr-2 h-4 w-4" />
                  Cash Desk
                </Link>
              </div>
            </div>

            <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4 lg:max-w-2xl">
              <Link to="/billing" className="block h-full rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-white/10">
                <div className="text-[11px] uppercase tracking-[0.2em] text-gray-500 dark:text-white/60">Collected</div>
                <div className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatRwfShort(summary?.collected ?? 0)}</div>
              </Link>
              <Link to="/billing" className="block h-full rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-white/10">
                <div className="text-[11px] uppercase tracking-[0.2em] text-gray-500 dark:text-white/60">Outstanding</div>
                <div className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatRwfShort(summary?.outstanding ?? 0)}</div>
              </Link>
              <Link to="/petty-cash" className="block h-full rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-white/10">
                <div className="text-[11px] uppercase tracking-[0.2em] text-gray-500 dark:text-white/60">Cash</div>
                <div className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{activeFund ? formatRwfShort(cashPosition) : 'No fund'}</div>
              </Link>
              <Link to="/tasks" className="block h-full rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-white/10">
                <div className="text-[11px] uppercase tracking-[0.2em] text-gray-500 dark:text-white/60">Reviews</div>
                <div className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{pendingReviewCount}</div>
              </Link>
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-900/60 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Revenue Growth</div>
            <div className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{revenueGrowthLabel}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Compared with the previous billing month</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Collection Rate</div>
            <div className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{collectionRate}%</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Collected divided by contract value</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Profit Margin</div>
            <div className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{profitabilityMargin}%</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Net profit margin from billing summary</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Outstanding Value</div>
            <div className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{formatRwfShort(outstandingValue)}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Uncollected contract value in the current period</div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KPICard title="Revenue Billed" value={formatRwfShort(summary?.billed ?? 0)} detail="Invoices generated in the selected period" icon={Banknote} tone="slate" to="/billing" />
        <KPICard title="Revenue Collected" value={formatRwfShort(summary?.collected ?? 0)} detail="Paid invoices captured in the system" icon={TrendingUp} tone="green" to="/billing" />
        <KPICard title="Outstanding Receivables" value={formatRwfShort(summary?.outstanding ?? 0)} detail="Contract value still outstanding" icon={CreditCard} tone="amber" to="/billing" />
        <KPICard title="Cash Position" value={activeFund ? formatRwfShort(cashPosition) : 'No fund'} detail={activeFund ? `Active fund: ${activeFund.name}` : 'No active fund set up'} icon={Wallet} tone={cashIsLow ? 'red' : 'green'} to="/petty-cash" />
        <KPICard title="Active Matters" value={String(activeMattersCount)} detail="Open matters in the case register" icon={Briefcase} tone="indigo" to="/cases" />
        <KPICard title="Pending Reviews" value={String(pendingReviewCount)} detail="Tasks waiting on partner review" icon={ClipboardCheck} tone="amber" to="/tasks" />
      </div>

      <DashboardSection title="Management Navigation" description="What management sees immediately, aligned to the dashboard navigation map" icon={FileText}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {managementNavigation.map((item) => (
            <div key={item.block} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Block</div>
                  <h3 className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">{item.block}</h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{item.detail}</p>
                </div>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">Live</span>
              </div>
              <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-5 text-gray-700 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
                {item.path}
              </div>
            </div>
          ))}
        </div>
      </DashboardSection>

      <DashboardSection title="Firm Financial Status" description="Revenue, collections, profit, and cash at a glance" icon={Wallet}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <KPICard title="Revenue Billed" value={formatRwfShort(summary?.billed ?? 0)} detail="Gross billed revenue" icon={FileText} tone="slate" to="/billing" />
          <KPICard title="Revenue Collected" value={formatRwfShort(summary?.collected ?? 0)} detail="Cash collected from paid invoices" icon={Banknote} tone="green" to="/billing" />
          <KPICard title="Outstanding Receivables" value={formatRwfShort(summary?.outstanding ?? 0)} detail="Uncollected contractual value" icon={CreditCard} tone="amber" to="/billing" />
          <KPICard title="Gross Profit" value={formatRwfShort(grossProfit)} detail="Collected minus direct matter costs" icon={BarChart3} tone="indigo" to="/reports" />
          <KPICard title="Net Profit" value={formatRwfShort(netProfit)} detail={`Net margin ${profitabilityMargin}%`} icon={TrendingUp} tone={profitabilityMargin >= 30 ? 'green' : 'red'} to="/reports" />
          <KPICard title="Cash Position" value={activeFund ? formatRwfShort(cashPosition) : 'No fund'} detail={activeFund ? activeFund.name : 'No active petty cash fund found'} icon={Wallet} tone={cashIsLow ? 'red' : 'green'} to="/petty-cash" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartCard title="Monthly Billing Trend" subtitle="Billed versus collected across the current billing window">
            {monthlyTrend.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tickFormatter={formatMonthLabel} />
                    <YAxis tickFormatter={(value) => formatRwfShort(Number(value))} />
                    <Tooltip
                      formatter={(value) => formatRwfShort(Number(value))}
                      labelFormatter={(value) => formatMonthLabel(String(value))}
                    />
                    <Bar dataKey="billed" fill="#111827" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="collected" fill="#2563eb" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">
                No monthly billing data available yet.
              </div>
            )}
          </ChartCard>

          <ChartCard title="Cash and Margin Snapshot" subtitle="Current financial health indicators">
            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Collection Rate</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Collected / contract value</div>
                  </div>
                  <div className="text-right text-sm font-semibold text-gray-900 dark:text-gray-100">{collectionRate}%</div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(collectionRate, 100)}%` }} />
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Net Profit</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">After direct matter costs and operating expenses</div>
                  </div>
                  <div className="text-right text-sm font-semibold text-gray-900 dark:text-gray-100">{formatRwfShort(netProfit)}</div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div className="h-2 rounded-full bg-slate-800" style={{ width: `${Math.min(Math.max(profitabilityMargin, 0), 100)}%` }} />
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Cash Position</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{activeFund ? formatRwfShort(cashPosition) : 'No fund'}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {activeFund ? `${activeFund.name}${cashIsLow ? ' is below the low-balance threshold.' : ' is healthy.'}` : 'No active petty cash fund configured.'}
                </div>
              </div>
            </div>
          </ChartCard>
        </div>
      </DashboardSection>

      <DashboardSection title="Matters and Clients" description="Active matters, new matters, critical matters, and deadlines" icon={Folder}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <KPICard title="Active Matters" value={String(activeMattersCount)} detail="Open matters currently in the system" icon={Briefcase} tone="indigo" to="/cases" />
          <KPICard title="New Matters" value={String(newMattersCount)} detail="Matters created in the last 30 days" icon={Plus} tone="green" to="/cases" />
          <KPICard title="Closed Matters" value={String(closedMattersCount)} detail="Matters closed in the last 30 days" icon={CheckCircle2} tone="slate" to="/cases" />
          <KPICard title="Critical Matters" value={String(criticalMattersCount)} detail="Open matters flagged by workflow risk" icon={AlertTriangle} tone="red" to="/cases" />
          <KPICard title="Overdue Tasks" value={String(overdueTasksCount)} detail="Incomplete tasks past their due date" icon={Clock} tone="amber" to="/tasks" />
          <KPICard title="Critical Deadlines" value={String(upcomingCriticalDeadlinesCount)} detail="Deadlines within the next 7 days" icon={FileCheck2} tone="green" to="/calendar" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DashboardTable title="Upcoming Operational Activities" rows={operationalRows} />
          <ChartCard title="Matter Risk Snapshot" subtitle="Workflow and deadline risk from live records">
            <div className="space-y-3">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Critical Matters</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{criticalMattersCount}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Open matters with low workflow progress or high priority</div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Overdue Deadlines</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{overdueDeadlinesCount}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Deadlines that are already past due</div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Pending Reviews</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{pendingReviewCount}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Tasks awaiting partner approval or review</div>
              </div>
            </div>
          </ChartCard>
        </div>
      </DashboardSection>

      <DashboardSection title="People and Performance" description="Workload, completion, and quality across the team" icon={Users}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <KPICard title="Tasks Completed" value={String(recentCompletedTasksCount)} detail="Completed tasks in the last 30 days" icon={CheckCircle2} tone="green" to="/performance" />
          <KPICard title="On-Time Completion Rate" value={`${onTimeCompletionRate}%`} detail="Completed on or before due date" icon={Clock} tone={onTimeCompletionRate >= 80 ? 'green' : 'amber'} to="/performance" />
          <KPICard title="Average Quality Score" value={averageQualityScore == null ? '-' : `${averageQualityScore}%`} detail="Average quality score across completed tasks" icon={Star} tone="indigo" to="/performance" />
          <KPICard title="Pending Reviews" value={String(pendingReviewCount)} detail="Work waiting on partner review or approval" icon={ClipboardCheck} tone="amber" to="/tasks" />
          <KPICard title="Outstanding Value" value={formatRwfShort(outstandingValue)} detail="Uncollected contract value in the current window" icon={Wallet} tone="amber" to="/billing" />
          <KPICard title="Overdue Tasks" value={String(overdueTasksCount)} detail="Tasks overdue across the firm" icon={AlertCircle} tone="red" to="/tasks" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartCard title="Team Capacity" subtitle="Assigned versus completed tasks by team member">
            {taskPerformanceByMember.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={taskPerformanceByMember}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" hide />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="assigned" fill="#94a3b8" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="completed" fill="#16a34a" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">No task performance data available yet.</div>
            )}
          </ChartCard>

          <ChartCard title="Team Performance Breakdown" subtitle="Completion, overload, and quality by assignee">
            {taskPerformanceByMember.length > 0 ? (
              <div className="space-y-3">
                {taskPerformanceByMember.map((member) => (
                  <div key={member.name} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="font-medium text-gray-900 dark:text-gray-100">{member.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {member.completed}/{member.assigned} completed - {member.overdue} overdue
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{member.completionRate}% complete</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Avg quality {member.averageQuality}%</div>
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                      <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${member.completionRate}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">No team performance data available yet.</div>
            )}
          </ChartCard>
        </div>
      </DashboardSection>

      <DashboardSection title="Business Development" description="Pipeline, conversions, and lead quality" icon={Handshake}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <KPICard title="Total Opportunities" value={String(totalOpportunitiesCount)} detail="All prospect records in the system" icon={Handshake} tone="indigo" to="/matters/intake-prospects" />
          <KPICard title="Open Opportunities" value={String(openOpportunitiesCount)} detail="Prospects still in the pipeline" icon={Briefcase} tone="slate" to="/matters/intake-prospects" />
          <KPICard title="New Opportunities" value={String(newOpportunitiesCount)} detail="Prospects received in the last 30 days" icon={Plus} tone="green" to="/matters/intake-prospects" />
          <KPICard title="Converted Opportunities" value={String(convertedProspectsCount)} detail={terminalOpportunityCount > 0 ? `${conversionRate}% conversion rate` : 'No converted opportunities yet'} icon={Target} tone="green" to="/matters/intake-prospects" />
          <KPICard title="Lost Opportunities" value={String(lostOpportunitiesCount)} detail="Terminal prospects marked non-converted" icon={AlertTriangle} tone="amber" to="/matters/intake-prospects" />
          <KPICard title="Pipeline Value" value={formatRwfShort(pipelineValue)} detail="Total estimated fee/value across prospects" icon={TrendingUp} tone="slate" to="/reports" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartCard title="Opportunity Sources" subtitle="Converted, lost, and open prospects by source">
            {sourceBreakdown.length > 0 ? (
              <div className="space-y-3">
                {sourceBreakdown.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="font-medium text-gray-900 dark:text-gray-100">{item.label}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {item.total} opportunities - {item.open} open
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {item.converted + item.lost > 0 ? Math.round((item.converted / (item.converted + item.lost)) * 100) : 0}% converted
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{formatRwfShort(item.value)}</div>
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                      <div className="h-2 rounded-full" style={{ width: `${Math.min(100, item.total * 10)}%`, backgroundColor: item.color }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">No prospect source data available yet.</div>
            )}
          </ChartCard>

          <ChartCard title="Conversion Snapshot" subtitle="How the pipeline is performing right now">
            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Converted vs Lost</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {convertedProspectsCount} converted / {lostOpportunitiesCount} lost
                    </div>
                  </div>
                  <div className="text-right text-sm font-semibold text-gray-900 dark:text-gray-100">{conversionRate}%</div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${conversionRate}%` }} />
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">New Opportunities</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{newOpportunitiesCount}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Prospects received in the last 30 days</div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Pipeline Value</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{formatRwfShort(pipelineValue)}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Total estimated value of open and closed prospects</div>
              </div>
            </div>
          </ChartCard>
        </div>
      </DashboardSection>

      <DashboardSection title="Risk and Compliance" description="Early warnings, flagged matters, and control points" icon={ShieldAlert}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <KPICard title="Red Flag Clients" value={String(prospects.filter((prospect) => prospect.conflictCheckStatus === 'Flagged').length)} detail="Clients flagged by conflict review" icon={ShieldAlert} tone="red" to="/matters/intake-prospects" />
          <KPICard title="Critical Matters" value={String(criticalMattersCount)} detail="Open matters at elevated risk" icon={AlertTriangle} tone="amber" to="/cases" />
          <KPICard title="Overdue Tasks" value={String(overdueTasksCount)} detail="Tasks past due and still open" icon={Clock} tone="red" to="/tasks" />
          <KPICard title="Cash Low Alert" value={cashIsLow ? 'Yes' : 'No'} detail={activeFund ? `Threshold: ${formatRwfShort(cashThreshold)}` : 'No active fund configured'} icon={Wallet} tone={cashIsLow ? 'red' : 'green'} to="/petty-cash" />
          <KPICard title="Pending Reviews" value={String(pendingReviewCount)} detail="Tasks awaiting review or approval" icon={ClipboardCheck} tone="amber" to="/tasks" />
          <KPICard title="Profit Margin Watch" value={`${profitabilityMargin}%`} detail="Net margin compared with the 30% benchmark" icon={TrendingUp} tone={profitabilityMargin >= 30 ? 'green' : 'red'} to="/reports" />
      </div>
      </DashboardSection>

      <DashboardSection title="Management Alerts" description="Automatically generated from live data and management benchmarks" icon={MessageSquareWarning}>
        <div className="space-y-3">
          {managementAlerts.length > 0 ? (
            managementAlerts.map((alert) => (
              <div
                key={`${alert.title}-${alert.source}`}
                className={`rounded-2xl border p-4 shadow-sm ${
                  alert.severity === 'high'
                    ? 'border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/20'
                    : alert.severity === 'medium'
                      ? 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20'
                      : 'border-sky-200 bg-sky-50 dark:border-sky-900/50 dark:bg-sky-950/20'
                }`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{alert.title}</div>
                    <div className="mt-1 text-sm text-gray-700 dark:text-gray-300">{alert.detail}</div>
                  </div>
                  <div className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-700 shadow-sm dark:bg-gray-800 dark:text-gray-200">
                    {alert.source}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">
              No active management alerts. The firm is within current benchmarks.
            </div>
          )}
        </div>
      </DashboardSection>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DashboardTimeline items={latestActivity} />
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
              <BarChart3 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Management Insights</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Executive summaries generated from live firm data</p>
            </div>
          </div>
          <div className="space-y-3">
            {insights.length > 0 ? insights.map((item) => <DashboardInsightCard key={item} text={item} />) : (
              <DashboardInsightCard text="No insights to display yet." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
