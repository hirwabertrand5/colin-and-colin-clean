import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase,
  CheckSquare,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Flame,
  Handshake,
  Landmark,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  Users,
  WalletCards,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import usePageTitle from '../../hooks/usePageTitle';
import { getAllCases, CaseData } from '../../services/caseService';
import { getBillingSummary, BillingSummary } from '../../services/billingService';
import { getAllTasks, TaskData } from '../../services/taskService';
import { getFirmEvents, FirmCalendarEvent } from '../../services/eventService';
import { getRecentAuditFeed, AuditFeedItem } from '../../services/auditService';
import { getAllProspects, Prospect } from '../../services/prospectService';
import { listInvoices, Invoice } from '../../services/invoiceService';
import { getActivePettyCashFund, PettyCashFund } from '../../services/pettyCashService';
import { getStaffUsers, User as StaffUser } from '../../services/userService';
import { resolveDeadlineDateTime } from '../../utils/workflowDeadline';
import './ManagingPartnerDashboard.css';

type SourceState = {
  cases: boolean;
  billing: boolean;
  tasks: boolean;
  events: boolean;
  audit: boolean;
  prospects: boolean;
  invoices: boolean;
  fund: boolean;
  staff: boolean;
};

type MetricTone = 'blue' | 'green' | 'teal' | 'orange' | 'purple' | 'red';
type AlertTone = 'critical' | 'high' | 'medium';

const emptySources: SourceState = {
  cases: false,
  billing: false,
  tasks: false,
  events: false,
  audit: false,
  prospects: false,
  invoices: false,
  fund: false,
  staff: false,
};

const NA = 'N/A';

const toNumber = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const formatMoney = (value?: number | null) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return NA;
  const amount = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (amount >= 1_000_000_000) return `${sign}RWF ${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `${sign}RWF ${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${sign}RWF ${(amount / 1_000).toFixed(0)}K`;
  return `${sign}RWF ${Math.round(amount).toLocaleString('en-US')}`;
};

const formatCount = (value?: number | null) =>
  value === null || value === undefined || !Number.isFinite(value) ? NA : value.toLocaleString('en-US');

const formatPercent = (value?: number | null) =>
  value === null || value === undefined || !Number.isFinite(value) ? NA : `${Math.round(value)}%`;

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const addDaysISO = (baseISO: string, days: number) => {
  const d = new Date(`${baseISO}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
};

const startOfYearISO = () => {
  const d = new Date();
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return isoDate(d);
};

const monthKey = (value?: string | Date) => {
  const d = value ? new Date(value) : new Date();
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const monthLabel = (key: string) => {
  const d = new Date(`${key}-01T00:00:00`);
  if (!Number.isFinite(d.getTime())) return key || NA;
  return d.toLocaleDateString('en-US', { month: 'short' });
};

const timeAgo = (iso?: string) => {
  if (!iso) return NA;
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return NA;
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

const normalize = (value?: string) => String(value || '').trim().toLowerCase().replace(/[-_]/g, ' ');
const isClosedMatter = (matter: CaseData) => normalize(matter.status) === 'closed';
const isActiveMatter = (matter: CaseData) => !isClosedMatter(matter) && normalize(matter.status) !== 'temporarily closed';
const getTaskDueAt = (task: TaskData) => resolveDeadlineDateTime(task.dueDate);
const getProspectValue = (prospect: Prospect) => toNumber(prospect.estimatedFeeValue) || toNumber(prospect.estimatedMatterValue);
const isConvertedProspect = (prospect: Prospect) => normalize(prospect.stage) === 'converted';
const isLostProspect = (prospect: Prospect) => normalize(prospect.stage) === 'non converted';
const isOpenProspect = (prospect: Prospect) => !isConvertedProspect(prospect) && !isLostProspect(prospect);

const percentChange = (current: number, previous: number) => {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
};

const newestMonthPair = (series: Array<{ value: number }>) => {
  const current = series[series.length - 1]?.value ?? 0;
  const previous = series[series.length - 2]?.value ?? 0;
  return percentChange(current, previous);
};

const getEventMatter = (event: FirmCalendarEvent) => event.case?.caseNo || event.case?.parties || event.title || NA;

function DashboardCard({
  title,
  action,
  to,
  className = '',
  children,
}: {
  title: string;
  action?: string;
  to?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`mp-card ${className}`}>
      <div className="mp-card-header">
        <h2>{title}</h2>
        {to ? (
          <Link to={to} className="mp-card-action">
            {action || 'View all'}
            <ChevronRight size={13} />
          </Link>
        ) : (
          <span className="mp-card-action">{action || ''}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function Sparkline({ data, color }: { data: Array<{ label: string; value: number }>; color: string }) {
  if (!data.length) return <div className="mp-mini-na">{NA}</div>;
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <Area type="monotone" dataKey="value" stroke={color} fill={color} fillOpacity={0.12} strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function MetricCard({
  title,
  value,
  note,
  icon: Icon,
  tone,
  trend,
  trendDirection = 'up',
  data,
  to,
}: {
  title: string;
  value: React.ReactNode;
  note: string;
  icon: React.ElementType;
  tone: MetricTone;
  trend?: number | null;
  trendDirection?: 'up' | 'down';
  data: Array<{ label: string; value: number }>;
  to: string;
}) {
  const trendColor = trendDirection === 'down' ? '#ef4444' : '#10b981';
  const TrendIcon = trendDirection === 'down' ? TrendingDown : TrendingUp;

  return (
    <Link to={to} className="mp-metric-card">
      <div className="mp-metric-top">
        <span className={`mp-metric-icon ${tone}`}>
          <Icon size={20} />
        </span>
        <span className="mp-metric-title">{title}</span>
      </div>
      <strong>{value}</strong>
      <div className="mp-metric-trend">
        {trend === null || trend === undefined ? (
          <span className="mp-muted">{NA}</span>
        ) : (
          <span style={{ color: trendColor }}>
            <TrendIcon size={12} /> {trend > 0 ? '+' : ''}
            {trend}%
          </span>
        )}
        <span>{note}</span>
      </div>
      <Sparkline data={data} color={trendColor} />
    </Link>
  );
}

function ValueRow({ color, label, value }: { color: string; label: string; value: React.ReactNode }) {
  return (
    <div className="mp-value-row">
      <span className="mp-dot" style={{ backgroundColor: color }} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Donut({
  data,
  centerValue,
  centerLabel,
}: {
  data: Array<{ name: string; value: number; color: string }>;
  centerValue: React.ReactNode;
  centerLabel: string;
}) {
  const filtered = data.filter((item) => item.value > 0);
  if (!filtered.length) return <div className="mp-empty-block">{NA}</div>;
  return (
    <div className="mp-donut-wrap">
      <ResponsiveContainer width="100%" height={178}>
        <PieChart>
          <Pie data={filtered} innerRadius={48} outerRadius={72} paddingAngle={2} dataKey="value">
            {filtered.map((item) => (
              <Cell key={item.name} fill={item.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="mp-donut-center">
        <strong>{centerValue}</strong>
        <span>{centerLabel}</span>
      </div>
    </div>
  );
}

function Funnel({ rows }: { rows: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="mp-funnel">
      {rows.map((row, index) => (
        <div
          key={row.label}
          className="mp-funnel-row"
          style={{
            width: `${Math.max(42, (row.value / max) * 100)}%`,
            backgroundColor: row.color,
            marginLeft: `${index * 3}%`,
          }}
        >
          <strong>{formatCount(row.value)}</strong>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}

function HorizontalBars({ rows }: { rows: Array<{ label: string; value: number; color?: string; meta?: string }> }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  if (!rows.length) return <div className="mp-empty-block">{NA}</div>;
  return (
    <div className="mp-bars">
      {rows.map((row) => (
        <div className="mp-bar-row" key={row.label}>
          <span title={row.label}>{row.label}</span>
          <div className="mp-bar-track">
            <div style={{ width: `${Math.max(6, (row.value / max) * 100)}%`, backgroundColor: row.color || '#2563eb' }} />
          </div>
          <strong>{row.meta || formatCount(row.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function AlertPill({ tone }: { tone: AlertTone }) {
  return <span className={`mp-alert-pill ${tone}`}>{tone.toUpperCase()}</span>;
}

function EmptyState({ label = NA }: { label?: string }) {
  return <div className="mp-empty-block">{label}</div>;
}

export default function ManagingPartnerDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sources, setSources] = useState<SourceState>(emptySources);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [events, setEvents] = useState<FirmCalendarEvent[]>([]);
  const [auditFeed, setAuditFeed] = useState<AuditFeedItem[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<Invoice[]>([]);
  const [activeFund, setActiveFund] = useState<PettyCashFund | null>(null);
  const [staff, setStaff] = useState<StaffUser[]>([]);

  usePageTitle('Managing Partner Dashboard');

  const today = useMemo(() => isoDate(new Date()), []);
  const next14Days = useMemo(() => addDaysISO(today, 14), [today]);
  const startOfYear = useMemo(() => startOfYearISO(), []);
  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      setError('');
      const results = await Promise.allSettled([
        getAllCases(),
        getBillingSummary({ from: startOfYear, to: today }),
        getAllTasks(),
        getFirmEvents({ from: today, to: next14Days, type: 'all' }),
        getRecentAuditFeed(8),
        getAllProspects({ includeTerminal: true }),
        listInvoices({ status: 'Pending' }),
        getActivePettyCashFund(),
        getStaffUsers(),
      ]);

      if (!mounted) return;
      const nextSources = { ...emptySources };

      if (results[0].status === 'fulfilled') {
        setCases(results[0].value);
        nextSources.cases = true;
      }
      if (results[1].status === 'fulfilled') {
        setSummary(results[1].value);
        nextSources.billing = true;
      }
      if (results[2].status === 'fulfilled') {
        setTasks(results[2].value);
        nextSources.tasks = true;
      }
      if (results[3].status === 'fulfilled') {
        setEvents(results[3].value);
        nextSources.events = true;
      }
      if (results[4].status === 'fulfilled') {
        setAuditFeed(results[4].value);
        nextSources.audit = true;
      }
      if (results[5].status === 'fulfilled') {
        setProspects(results[5].value);
        nextSources.prospects = true;
      }
      if (results[6].status === 'fulfilled') {
        setPendingInvoices(results[6].value);
        nextSources.invoices = true;
      }
      if (results[7].status === 'fulfilled') {
        setActiveFund(results[7].value);
        nextSources.fund = true;
      }
      if (results[8].status === 'fulfilled') {
        setStaff(results[8].value);
        nextSources.staff = true;
      }

      setSources(nextSources);
      if (!Object.values(nextSources).some(Boolean)) setError('Unable to load dashboard data.');
      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [next14Days, startOfYear, today]);

  const currentMonthKey = monthKey(new Date());
  const previousMonthKey = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return monthKey(d);
  }, []);

  const activeMatters = useMemo(() => cases.filter(isActiveMatter), [cases]);
  const activeMattersCount = sources.cases ? activeMatters.length : null;
  const mattersByMonth = useMemo(() => {
    const map = new Map<string, number>();
    cases.forEach((matter) => {
      const key = monthKey(matter.createdAt);
      if (key) map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([key, value]) => ({ label: monthLabel(key), value }));
  }, [cases]);
  const currentMonthMatters = cases.filter((matter) => monthKey(matter.createdAt) === currentMonthKey).length;
  const previousMonthMatters = cases.filter((matter) => monthKey(matter.createdAt) === previousMonthKey).length;

  const billingMonths = useMemo(
    () =>
      (summary?.months || []).map((item) => ({
        label: monthLabel(item.month),
        billed: Number(item.billed) || 0,
        collected: Number(item.collected) || 0,
        value: Number(item.billed) || 0,
      })),
    [summary]
  );

  const revenueTrend = useMemo(() => billingMonths.map((item) => ({ label: item.label, value: item.billed })), [billingMonths]);
  const collectionTrend = useMemo(() => billingMonths.map((item) => ({ label: item.label, value: item.collected })), [billingMonths]);
  const outstandingTrend = useMemo(() => {
    let outstanding = 0;
    return billingMonths.map((item) => {
      outstanding = Math.max(0, outstanding + item.billed - item.collected);
      return { label: item.label, value: outstanding };
    });
  }, [billingMonths]);

  const openTasks = useMemo(() => tasks.filter((task) => task.status !== 'Completed'), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((task) => task.status === 'Completed'), [tasks]);
  const openTaskSeries = useMemo(() => {
    const map = new Map<string, number>();
    tasks.forEach((task) => {
      const key = monthKey(task.createdAt || task.dueDate);
      if (key && task.status !== 'Completed') map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([key, value]) => ({ label: monthLabel(key), value }));
  }, [tasks]);

  const overdueTasks = useMemo(
    () =>
      tasks.filter((task) => {
        if (task.status === 'Completed') return false;
        const due = getTaskDueAt(task);
        return Boolean(due && Number.isFinite(due.getTime()) && due.getTime() < Date.now());
      }),
    [tasks]
  );

  const upcomingDeadlines = useMemo(
    () =>
      events
        .filter((event) => event.date >= today)
        .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`))
        .slice(0, 5),
    [events, today]
  );

  const nearDeadlines = useMemo(() => events.filter((event) => event.date >= today && event.date <= addDaysISO(today, 7)), [events, today]);

  const pendingInvoiceTotal = useMemo(() => pendingInvoices.reduce((sum, invoice) => sum + toNumber(invoice.amount), 0), [pendingInvoices]);
  const outstandingValue = sources.billing ? toNumber(summary?.outstanding) : null;
  const directMatterCosts = sources.billing ? toNumber(summary?.directMatterCosts) : null;
  const grossProfit = sources.billing ? toNumber(summary?.grossProfit) : null;
  const grossProfitMargin = sources.billing ? toNumber(summary?.grossProfitMargin) : null;
  const netProfit = sources.billing ? toNumber(summary?.netProfit) : null;
  const netProfitMargin = sources.billing ? toNumber(summary?.netProfitMargin) : null;

  const openProspects = useMemo(() => prospects.filter(isOpenProspect), [prospects]);
  const convertedProspects = useMemo(() => prospects.filter(isConvertedProspect), [prospects]);
  const lostProspects = useMemo(() => prospects.filter(isLostProspect), [prospects]);
  const conversionRate = convertedProspects.length + lostProspects.length > 0
    ? Math.round((convertedProspects.length / (convertedProspects.length + lostProspects.length)) * 100)
    : null;
  const pipelineValue = sources.prospects ? openProspects.reduce((sum, prospect) => sum + getProspectValue(prospect), 0) : null;

  const practiceBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    activeMatters.forEach((matter) => {
      const label = matter.legalServicePath?.[0]?.label || matter.caseType || 'Other';
      map.set(label, (map.get(label) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value], index) => ({
        name: label,
        label,
        value,
        color: ['#2563eb', '#06b6d4', '#22c55e', '#f59e0b', '#8b5cf6', '#64748b'][index],
      }));
  }, [activeMatters]);

  const lifecycleRows = useMemo(() => {
    const inquiry = openProspects.length;
    const assessment = activeMatters.filter((matter) => (matter.workflowProgress?.percent || 0) <= 25).length;
    const engagement = activeMatters.filter((matter) => (matter.workflowProgress?.percent || 0) > 25 && (matter.workflowProgress?.percent || 0) <= 70).length;
    const active = activeMatters.filter((matter) => (matter.workflowProgress?.percent || 0) > 70).length;
    const review = tasks.filter((task) => task.workflowStage === 'Awaiting Review' || task.approvalStatus === 'Pending').length;
    const completion = tasks.filter((task) => task.status === 'Completed').length;
    const closed = cases.filter(isClosedMatter).length;
    return [
      { label: 'Inquiry / Intake', value: inquiry, color: '#1d4ed8' },
      { label: 'Assessment', value: assessment, color: '#2563eb' },
      { label: 'Engagement', value: engagement, color: '#06b6d4' },
      { label: 'Active', value: active, color: '#22c55e' },
      { label: 'Review', value: review, color: '#f59e0b' },
      { label: 'Completion', value: completion, color: '#fb923c' },
      { label: 'Closed', value: closed, color: '#ef4444' },
    ];
  }, [activeMatters, cases, openProspects.length, tasks]);

  const departmentRows = useMemo(() => {
    const map = new Map<string, { total: number; open: number }>();
    tasks.forEach((task) => {
      const matter = cases.find((item) => item._id === task.caseId);
      const label = matter?.legalServicePath?.[0]?.label || matter?.caseType || 'Unassigned';
      const item = map.get(label) || { total: 0, open: 0 };
      item.total += 1;
      if (task.status !== 'Completed') item.open += 1;
      map.set(label, item);
    });
    return Array.from(map.entries())
      .map(([label, item]) => ({
        label,
        value: item.open,
        meta: item.total ? `${Math.round((item.open / item.total) * 100)}%` : '0%',
        color: item.open / Math.max(item.total, 1) > 0.75 ? '#ef4444' : '#2563eb',
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [cases, tasks]);

  const capacityRows = useMemo(() => {
    const openByAssignee = new Map<string, number>();
    openTasks.forEach((task) => {
      const assignee = task.assignee || 'Unassigned';
      openByAssignee.set(assignee, (openByAssignee.get(assignee) || 0) + 1);
    });
    const available = staff.filter((person) => (openByAssignee.get(person.name) || 0) <= 3).length;
    const committed = staff.filter((person) => {
      const count = openByAssignee.get(person.name) || 0;
      return count > 3 && count <= 8;
    }).length;
    const overloaded = staff.filter((person) => (openByAssignee.get(person.name) || 0) > 8).length;
    return [
      { name: 'Available', value: available, color: '#22c55e' },
      { name: 'Committed', value: committed, color: '#2563eb' },
      { name: 'Overloaded', value: overloaded, color: '#ef4444' },
    ];
  }, [openTasks, staff]);

  const clientRevenueRows = useMemo(() => {
    const caseMap = new Map(cases.map((matter) => [String(matter._id), matter]));
    const map = new Map<string, number>();
    pendingInvoices.forEach((invoice) => {
      const matter = caseMap.get(String(invoice.caseId));
      const label = invoice.case?.parties || matter?.parties || invoice.case?.caseNo || 'Unassigned';
      map.set(label, (map.get(label) || 0) + toNumber(invoice.amount));
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, value]) => ({ label, value, meta: formatMoney(value), color: '#2563eb' }));
  }, [cases, pendingInvoices]);

  const pipelineRows = useMemo(() => {
    const stages = ['Inquiry', 'Consultation', 'Quotation', 'Awaiting Client Decision', 'Engagement'];
    const colors = ['#1d4ed8', '#2563eb', '#06b6d4', '#22c55e', '#84cc16'];
    return stages.map((stage, index) => ({
      label: stage,
      value: prospects.filter((prospect) => normalize(prospect.stage) === normalize(stage)).length,
      color: colors[index],
    }));
  }, [prospects]);

  const highRiskMatters = sources.cases
    ? activeMatters.filter((matter) => normalize(matter.priority) === 'high' || toNumber(matter.workflowProgress?.percent) <= 25).length
    : null;
  const conflictReviews = sources.prospects ? prospects.filter((prospect) => prospect.conflictCheckStatus === 'Flagged').length : null;
  const complianceExceptions = sources.tasks ? overdueTasks.length : null;
  const regulatoryDeadlines = sources.events
    ? events.filter((event) => normalize(event.type).includes('regulatory') || normalize(event.title).includes('regulatory')).length
    : null;

  const managementAlerts = useMemo(() => {
    const alerts: Array<{ tone: AlertTone; text: string; time: string }> = [];
    if (highRiskMatters && highRiskMatters > 0) alerts.push({ tone: 'critical', text: `${highRiskMatters} matters require your immediate attention`, time: 'Live' });
    if (pendingInvoiceTotal > 0) alerts.push({ tone: 'high', text: `${pendingInvoices.length} invoices are pending (${formatMoney(pendingInvoiceTotal)})`, time: 'Live' });
    if (overdueTasks.length > 0) alerts.push({ tone: 'high', text: `${overdueTasks.length} tasks are overdue`, time: 'Live' });
    if (nearDeadlines.length > 0) alerts.push({ tone: 'medium', text: `${nearDeadlines.length} deadlines due in the next 7 days`, time: 'Live' });
    if (conflictReviews && conflictReviews > 0) alerts.push({ tone: 'medium', text: `${conflictReviews} conflict checks require review`, time: 'Live' });
    return alerts.slice(0, 5);
  }, [conflictReviews, highRiskMatters, nearDeadlines.length, overdueTasks.length, pendingInvoiceTotal, pendingInvoices.length]);

  const recentActivities = useMemo(() => auditFeed.slice(0, 5), [auditFeed]);

  const cashRows = useMemo(() => {
    const months = billingMonths.length ? billingMonths : [{ label: monthLabel(currentMonthKey), billed: 0, collected: 0, value: 0 }];
    return months.map((item) => ({
      label: item.label,
      moneyIn: item.collected,
      moneyOut: item.billed - item.collected > 0 ? item.billed - item.collected : 0,
      net: item.collected - Math.max(0, item.billed - item.collected),
    }));
  }, [billingMonths, currentMonthKey]);

  const totalPeople = sources.staff ? staff.length : null;
  const totalContractValue = sources.billing ? toNumber(summary?.contractValue) : null;
  const totalBilled = sources.billing ? toNumber(summary?.billed) : null;
  const totalCollected = sources.billing ? toNumber(summary?.collected) : null;
  const currentOpenTasks = openTaskSeries[openTaskSeries.length - 1]?.value || openTasks.length;

  if (loading) {
    return (
      <div className="mp-dashboard mp-dashboard-loading">
        <div className="mp-loader">Loading managing partner dashboard...</div>
      </div>
    );
  }

  return (
    <div className="mp-dashboard">
      {error ? <div className="mp-error">{error}</div> : null}

      <div className="mp-metrics-grid">
        <MetricCard
          title="Active Matters"
          value={formatCount(activeMattersCount)}
          note="vs last month"
          icon={Briefcase}
          tone="blue"
          trend={sources.cases ? percentChange(currentMonthMatters, previousMonthMatters) : null}
          data={sources.cases ? mattersByMonth : []}
          to="/matters"
        />
        <MetricCard
          title="Revenue (YTD)"
          value={sources.billing ? formatMoney(totalBilled) : NA}
          note="vs last month"
          icon={Landmark}
          tone="green"
          trend={sources.billing ? newestMonthPair(revenueTrend) : null}
          data={sources.billing ? revenueTrend : []}
          to="/billing"
        />
        <MetricCard
          title="Fees Collected (YTD)"
          value={sources.billing ? formatMoney(totalCollected) : NA}
          note="vs last month"
          icon={WalletCards}
          tone="teal"
          trend={sources.billing ? newestMonthPair(collectionTrend) : null}
          data={sources.billing ? collectionTrend : []}
          to="/billing"
        />
        <MetricCard
          title="Outstanding Receivables"
          value={sources.billing ? formatMoney(outstandingValue) : NA}
          note="vs last month"
          icon={ReceiptText}
          tone="orange"
          trend={sources.billing ? newestMonthPair(outstandingTrend) : null}
          trendDirection="down"
          data={sources.billing ? outstandingTrend : []}
          to="/billing/invoices"
        />
        <MetricCard
          title="Open Tasks"
          value={sources.tasks ? formatCount(openTasks.length) : NA}
          note="vs last month"
          icon={CheckSquare}
          tone="purple"
          trend={sources.tasks ? newestMonthPair(openTaskSeries.length ? openTaskSeries : [{ label: 'Now', value: currentOpenTasks }]) : null}
          data={sources.tasks ? openTaskSeries : []}
          to="/tasks"
        />
        <MetricCard
          title="Matters Nearing Deadline"
          value={sources.events ? formatCount(nearDeadlines.length) : NA}
          note="next 7 days"
          icon={Flame}
          tone="red"
          trend={null}
          data={[]}
          to="/calendar"
        />
      </div>

      <div className="mp-main-grid">
        <DashboardCard title="Matter Lifecycle Overview" action="View full pipeline" to="/matters" className="mp-span-4">
          <div className="mp-lifecycle">
            <Funnel rows={lifecycleRows} />
            <Donut data={practiceBreakdown} centerValue={formatCount(activeMattersCount)} centerLabel="Active Matters" />
            <div className="mp-legend-list">
              {practiceBreakdown.length ? (
                practiceBreakdown.map((item) => (
                  <ValueRow
                    key={item.label}
                    color={item.color}
                    label={item.label}
                    value={activeMatters.length ? `${Math.round((item.value / activeMatters.length) * 100)}%` : '0%'}
                  />
                ))
              ) : (
                <EmptyState />
              )}
            </div>
          </div>
        </DashboardCard>

        <DashboardCard title="Financial Performance (YTD)" action="View full report" to="/billing" className="mp-span-4">
          <div className="mp-finance">
            <div className="mp-finance-list">
              <ValueRow color="#2563eb" label="Total Contract Value" value={formatMoney(totalContractValue)} />
              <ValueRow color="#06b6d4" label="Total Billed" value={formatMoney(totalBilled)} />
              <ValueRow color="#22c55e" label="Total Collected" value={formatMoney(totalCollected)} />
              <ValueRow color="#f97316" label="Outstanding (Receivables)" value={formatMoney(outstandingValue)} />
              <ValueRow color="#8b5cf6" label="Direct Matter Costs" value={formatMoney(directMatterCosts)} />
              <ValueRow color="#eab308" label="Gross Profit" value={formatMoney(grossProfit)} />
              <ValueRow color="#64748b" label="Gross Profit Margin" value={formatPercent(grossProfitMargin)} />
            </div>
            <div className="mp-finance-chart">
              <h3>Revenue vs Collections</h3>
              {billingMonths.length ? (
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={billingMonths} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#edf2f7" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={34} />
                    <Tooltip formatter={(value: number) => formatMoney(value)} />
                    <Line type="monotone" dataKey="billed" name="Revenue" stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} />
                    <Line type="monotone" dataKey="collected" name="Collections" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState />
              )}
              <div className="mp-profit-cards">
                <div>
                  <span>Net Profit</span>
                  <strong>{formatMoney(netProfit)}</strong>
                </div>
                <div>
                  <span>Net Profit Margin</span>
                  <strong>{formatPercent(netProfitMargin)}</strong>
                </div>
              </div>
            </div>
          </div>
        </DashboardCard>

        <DashboardCard title="Upcoming Deadlines" action="View all" to="/calendar" className="mp-span-3">
          <div className="mp-deadlines">
            {upcomingDeadlines.length ? (
              upcomingDeadlines.map((event) => {
                const day = new Date(`${event.date}T00:00:00`);
                const diffDays = Math.ceil((day.getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
                return (
                  <Link to="/calendar" className="mp-deadline-row" key={event._id || `${event.title}-${event.date}`}>
                    <div className="mp-deadline-date">
                      <span>{day.toLocaleDateString('en-US', { month: 'short' })}</span>
                      <strong>{day.toLocaleDateString('en-US', { day: '2-digit' })}</strong>
                    </div>
                    <div>
                      <strong>{getEventMatter(event)}</strong>
                      <span>{event.title}</span>
                    </div>
                    <em>{diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : `${diffDays} days left`}</em>
                  </Link>
                );
              })
            ) : (
              <EmptyState />
            )}
          </div>
        </DashboardCard>

        <DashboardCard title="People & Capacity Overview" action="View full capacity" to="/performance" className="mp-span-4">
          <div className="mp-mini-kpis">
            <div><Users size={18} /><span>Total People</span><strong>{formatCount(totalPeople)}</strong></div>
            <div><TrendingUp size={18} /><span>Utilization</span><strong>{NA}</strong></div>
            <div><CircleDollarSign size={18} /><span>Billable Capacity</span><strong>{NA}</strong></div>
            <div><Briefcase size={18} /><span>Open Positions</span><strong>{NA}</strong></div>
          </div>
          <div className="mp-two-col">
            <div>
              <h3>Workload by Department</h3>
              <HorizontalBars rows={departmentRows} />
            </div>
            <div className="mp-capacity">
              <h3>Capacity Distribution</h3>
              {sources.staff ? (
                <Donut
                  data={capacityRows}
                  centerValue={formatCount(totalPeople)}
                  centerLabel="Team Members"
                />
              ) : (
                <EmptyState />
              )}
              <div className="mp-capacity-legend">
                {capacityRows.map((item) => (
                  <ValueRow key={item.name} color={item.color} label={item.name} value={formatCount(item.value)} />
                ))}
              </div>
            </div>
          </div>
        </DashboardCard>

        <DashboardCard title="Clients & Business Development" action="View full pipeline" to="/matters/intake-prospects" className="mp-span-4">
          <div className="mp-mini-kpis mp-mini-kpis-three">
            <div><Users size={18} /><span>Active Clients</span><strong>{sources.cases ? formatCount(new Set(activeMatters.map((matter) => matter.parties)).size) : NA}</strong></div>
            <div><Handshake size={18} /><span>New Clients (YTD)</span><strong>{sources.prospects ? formatCount(convertedProspects.length) : NA}</strong></div>
            <div><WalletCards size={18} /><span>Pipeline Value</span><strong>{formatMoney(pipelineValue)}</strong></div>
          </div>
          <div className="mp-two-col">
            <div>
              <h3>Top Clients by Revenue (YTD)</h3>
              <HorizontalBars rows={clientRevenueRows} />
            </div>
            <div>
              <h3>Pipeline (Opportunities)</h3>
              <Funnel rows={pipelineRows} />
              <div className="mp-conversion">Conversion Rate: <strong>{formatPercent(conversionRate)}</strong></div>
            </div>
          </div>
        </DashboardCard>

        <DashboardCard title="Risk & Compliance Overview" action="View all" to="/management/risk-compliance?view=risk-overview" className="mp-span-3">
          <div className="mp-risk-list">
            <ValueRow color="#ef4444" label="High Risk Matters" value={formatCount(highRiskMatters)} />
            <ValueRow color="#ef4444" label="Conflicts Requiring Review" value={formatCount(conflictReviews)} />
            <ValueRow color="#f59e0b" label="KYC / AML Pending" value={NA} />
            <ValueRow color="#f59e0b" label="Regulatory Deadlines" value={formatCount(regulatoryDeadlines)} />
            <ValueRow color="#ef4444" label="Compliance Exceptions" value={formatCount(complianceExceptions)} />
            <ValueRow color="#f59e0b" label="Documents Expiring (30 days)" value={NA} />
          </div>
        </DashboardCard>

        <DashboardCard title="Cash Flow (YTD)" action="View full cash flow" to="/billing" className="mp-span-4">
          <div className="mp-cash-summary">
            <div><span>Money In</span><strong>{formatMoney(totalCollected)}</strong></div>
            <div><span>Money Out</span><strong>{formatMoney((directMatterCosts || 0) + toNumber(summary?.firmOperatingExpenses))}</strong></div>
            <div><span>Petty Cash</span><strong>{sources.fund ? formatMoney(activeFund?.remainingAmount ?? null) : NA}</strong></div>
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <ComposedChart data={cashRows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#edf2f7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
              <Tooltip formatter={(value: number) => formatMoney(value)} />
              <Bar dataKey="moneyIn" name="Money In" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="moneyOut" name="Money Out" fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="net" name="Net" stroke="#2563eb" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </DashboardCard>

        <DashboardCard title="Management Alerts" action="View all" to="/management/risk-compliance?view=management-alerts" className="mp-span-4">
          <div className="mp-alerts">
            {managementAlerts.length ? (
              managementAlerts.map((alert) => (
                <div className="mp-alert-row" key={alert.text}>
                  <AlertPill tone={alert.tone} />
                  <span>{alert.text}</span>
                  <em>{alert.time}</em>
                </div>
              ))
            ) : (
              <EmptyState label="No active management alerts." />
            )}
          </div>
        </DashboardCard>

        <DashboardCard title="Recent Activities" action="View all" to="/matters" className="mp-span-3">
          <div className="mp-activity-list">
            {recentActivities.length ? (
              recentActivities.map((activity) => (
                <Link to={activity.caseId ? `/matters/${activity.caseId}` : '/matters'} key={activity._id} className="mp-activity-row">
                  <FileText size={15} />
                  <div>
                    <strong>{activity.message || activity.action || NA}</strong>
                    <span>{activity.actorName || NA} · {activity.case?.caseNo || activity.case?.parties || NA}</span>
                  </div>
                  <em>{timeAgo(activity.createdAt)}</em>
                </Link>
              ))
            ) : (
              <EmptyState />
            )}
          </div>
        </DashboardCard>
      </div>
    </div>
  );
}
