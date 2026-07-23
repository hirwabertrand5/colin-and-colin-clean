import React, { useEffect, useMemo, useState } from 'react';
import usePageTitle from '../../hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { UserRole } from '../../App';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
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
  HeartHandshake,
  MessageSquareWarning,
  Plus,
  ShieldAlert,
  Smile,
  Star,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';

import { getAllCases, CaseData } from '../../services/caseService';
import { getBillingSummary, BillingSummary } from '../../services/billingService';
import { getAllTasks, TaskData } from '../../services/taskService';
import { getFirmEvents, FirmCalendarEvent } from '../../services/eventService';
import { getRecentAuditFeed, AuditFeedItem } from '../../services/auditService';
import { getAllProspects, getProspectStats, Prospect } from '../../services/prospectService';
import { listInvoices, Invoice } from '../../services/invoiceService';

const formatRwfShort = (n: number) => {
  const val = Number(n) || 0;
  if (val >= 1_000_000_000) return `RWF ${(val / 1_000_000_000).toFixed(1)}B`;
  if (val >= 1_000_000) return `RWF ${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `RWF ${(val / 1_000).toFixed(1)}K`;
  return `RWF ${Math.round(val).toLocaleString('en-US')}`;
};

const isoToday = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (baseISO: string, days: number) => {
  const d = new Date(baseISO);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const timeAgo = (isoDate: string) => {
  const t = new Date(isoDate).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
};

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
    <section className="mb-8">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white">
          <Icon className="h-5 w-5 text-gray-700" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-600">{description}</p>
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
  children,
}: {
  title: string;
  value: React.ReactNode;
  detail?: string;
  icon: React.ElementType;
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'indigo';
  children?: React.ReactNode;
}) {
  const toneStyles: Record<string, string> = {
    slate: 'bg-gray-100 text-gray-700',
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-rose-100 text-rose-700',
    indigo: 'bg-indigo-100 text-indigo-700',
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="text-sm text-gray-600">{title}</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneStyles[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {detail ? <div className="text-sm text-gray-500">{detail}</div> : null}
      {children}
    </div>
  );
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
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {subtitle ? <p className="text-sm text-gray-500">{subtitle}</p> : null}
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
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-5 py-4">
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-600">Matter</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-600">Assigned Partner</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-600">Deadline</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-600">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {rows.map((row) => (
              <tr key={`${row.matter}-${row.deadline}`} className="hover:bg-gray-50">
                <td className="px-5 py-3 text-sm text-gray-900">{row.matter}</td>
                <td className="px-5 py-3 text-sm text-gray-600">{row.partner}</td>
                <td className="px-5 py-3 text-sm text-gray-600">{row.deadline}</td>
                <td className="px-5 py-3 text-sm text-gray-600">
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

function DashboardTimeline({ items }: { items: Array<{ title: string; detail: string; time: string }> }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-5 py-4">
        <h3 className="font-semibold text-gray-900">Recent Business Activity</h3>
      </div>
      <div className="px-5 py-4">
        <div className="space-y-4">
          {items.map((item, index) => (
            <div key={`${item.title}-${index}`} className="flex gap-3">
              <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-700">
                <Activity className="h-4 w-4" />
              </div>
              <div className="flex-1 border-b border-gray-100 pb-4 last:border-b-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-gray-900">{item.title}</div>
                  <div className="text-xs text-gray-500">{item.time}</div>
                </div>
                <div className="mt-1 text-sm text-gray-600">{item.detail}</div>
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
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 shadow-sm">
      {text}
    </div>
  );
}

export default function ManagingPartnerDashboard({ userRole }: { userRole?: UserRole }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const roleLabel = useMemo(() => {
    if (!userRole) return 'Dashboard';
    if (userRole === 'managing_director') return 'Managing Director';
    if (userRole === 'managing_partner') return 'Managing Partner';
    if (userRole === 'senior_partner') return 'Senior Partner';
    if (userRole === 'partner') return 'Partner';
    if (userRole === 'associate_partner') return 'Associate Partner';
    return 'Leadership';
  }, [userRole]);

  usePageTitle('Management Dashboard');
  const [cases, setCases] = useState<CaseData[]>([]);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [pendingTasks, setPendingTasks] = useState<TaskData[]>([]);
  const [events, setEvents] = useState<FirmCalendarEvent[]>([]);
  const [auditFeed, setAuditFeed] = useState<AuditFeedItem[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [prospectStats, setProspectStats] = useState<Record<string, number> | null>(null);
  const [pendingInvoices, setPendingInvoices] = useState<Invoice[]>([]);

  const today = useMemo(() => isoToday(), []);
  const next14Days = useMemo(() => addDaysISO(today, 14), [today]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setError('');

        const [casesResult, billingResult, tasksResult, eventsResult, feedResult, prospectsResult, statsResult, invoicesResult] =
          await Promise.allSettled([
            getAllCases(),
            getBillingSummary(),
            getAllTasks({ approvalStatus: 'Pending' as any }),
            getFirmEvents({ from: today, to: next14Days, type: 'all' }),
            getRecentAuditFeed(8),
            getAllProspects({ isActive: true }),
            getProspectStats(),
            listInvoices({ status: 'Pending' }),
          ]);

        if (!mounted) return;

        if (casesResult.status === 'fulfilled') setCases(casesResult.value);
        if (billingResult.status === 'fulfilled') setSummary(billingResult.value);
        if (tasksResult.status === 'fulfilled') setPendingTasks(tasksResult.value);
        if (eventsResult.status === 'fulfilled') setEvents(eventsResult.value);
        if (feedResult.status === 'fulfilled') setAuditFeed(feedResult.value);
        if (prospectsResult.status === 'fulfilled') setProspects(prospectsResult.value);
        if (statsResult.status === 'fulfilled') setProspectStats(statsResult.value);
        if (invoicesResult.status === 'fulfilled') setPendingInvoices(invoicesResult.value);
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

  const prospectStageTotals = useMemo(() => {
    return Object.entries(prospectStats || {}).reduce<Record<string, number>>((acc, [key, value]) => {
      acc[key] = Number(value) || 0;
      return acc;
    }, {});
  }, [prospectStats]);

  const activeProspectsCount = useMemo(() => {
    return Object.values(prospectStageTotals).reduce((sum, value) => sum + value, 0);
  }, [prospectStageTotals]);

  const convertedProspectsCount = prospectStageTotals.Converted || 0;
  const lostOpportunitiesCount = prospectStageTotals['Non-Converted'] || 0;
  const conversionRate = activeProspectsCount > 0 ? Math.round((convertedProspectsCount / activeProspectsCount) * 100) : 0;

  const referralSourceData = useMemo(() => {
    const totals = prospects.reduce<Record<string, number>>((acc, prospect) => {
      const source = prospect.referralSource?.trim() || 'Unspecified';
      const value = Number(prospect.estimatedFeeValue) || Number(prospect.estimatedMatterValue) || 0;
      acc[source] = (acc[source] || 0) + value;
      return acc;
    }, {});

    return Object.entries(totals)
      .map(([label, value]) => ({ label, value, color: '#4f46e5' }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [prospects]);

  const activeMattersCount = useMemo(() => {
    return cases.filter((item) => String(item.status || '').toLowerCase() !== 'closed').length;
  }, [cases]);

  const upcomingEvents = useMemo(() => {
    return [...events]
      .filter((event) => String(event.date) >= today)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, 6);
  }, [events, today]);

  const missedDeadlinesCount = useMemo(() => {
    return events.filter((event) => String(event.date) < today).length;
  }, [events, today]);

  const pendingReviewCount = useMemo(() => {
    return pendingTasks.filter((task) => task.workflowStage === 'Awaiting Review' || task.approvalStatus === 'Pending').length;
  }, [pendingTasks]);

  const weeklyReportsDueCount = useMemo(() => {
    return cases.filter((item) => Boolean(item.reporting?.weeklyEnabled)).length;
  }, [cases]);

  const monthlyReportsDueCount = useMemo(() => {
    return cases.filter((item) => Boolean(item.reporting?.monthlyEnabled)).length;
  }, [cases]);

  const operationalRows = useMemo(() => {
    const caseLookup = new Map(cases.map((item) => [item._id, item]));

    return upcomingEvents.map((event) => {
      const match = event.caseId ? caseLookup.get(event.caseId) : undefined;
      const deadline = event.time ? `${event.date} ${event.time}` : event.date;
      let status: 'Upcoming' | 'Urgent' | 'Overdue' = 'Upcoming';
      if (String(event.date) < today) status = 'Overdue';
      else if (String(event.date) <= addDaysISO(today, 7)) status = 'Urgent';

      return {
        matter: event.case ? `${event.case.caseNo} • ${event.case.parties}` : event.title,
        partner: match?.assignedTo ? String(match.assignedTo) : '—',
        deadline,
        status,
      };
    });
  }, [cases, upcomingEvents, today]);

  const pendingInvoiceTotal = useMemo(() => {
    return pendingInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  }, [pendingInvoices]);

  const pendingInvoiceCount = pendingInvoices.length;

  const redFlagClientsCount = useMemo(() => {
    return prospects.filter((prospect) => prospect.conflictCheckStatus === 'Flagged').length;
  }, [prospects]);

  type DashboardChartItem = { label: string; value: number; color?: string };

  const dashboardData = useMemo(() => ({
    businessDevelopment: {
      activeProspects: {
        value: activeProspectsCount,
        trend: activeProspectsCount > 0 ? `${activeProspectsCount} active pipeline items` : 'No active prospects yet',
        positive: true,
      },
      conversionRate: {
        value: `${conversionRate}%`,
        trend: `${convertedProspectsCount} converted`,
        positive: conversionRate >= 50,
        progress: conversionRate,
      },
      lostOpportunities: {
        value: lostOpportunitiesCount,
        trend: lostOpportunitiesCount > 0 ? `${lostOpportunitiesCount} lost or closed out` : 'No lost opportunities recorded',
        positive: false,
      },
      referralSources: referralSourceData.length > 0 ? referralSourceData : [],
    },
    operations: {
      activeMatters: { value: activeMattersCount, detail: 'Current active matters in the system' },
      upcomingDeadlines: { value: upcomingEvents.length, detail: `Next deadline: ${upcomingEvents[0]?.date || '—'}` },
      missedDeadlines: { value: missedDeadlinesCount, detail: missedDeadlinesCount > 0 ? 'Past due deadlines recorded' : 'No overdue deadlines', positive: missedDeadlinesCount > 0 },
      pendingReviews: { value: pendingReviewCount, detail: pendingReviewCount > 0 ? 'Awaiting partner review' : 'No review items pending' },
      weeklyReportsDue: { value: weeklyReportsDueCount, detail: 'Cases with weekly reporting enabled' },
      monthlyReportsDue: { value: monthlyReportsDueCount, detail: 'Cases with monthly reporting enabled' },
      activities: operationalRows,
    },
    finance: {
      billingPending: { value: formatRwfShort(pendingInvoiceTotal), detail: `${pendingInvoiceCount} pending invoices` },
      outstandingInvoices: { value: String(pendingInvoiceCount), detail: `${formatRwfShort(pendingInvoiceTotal)} outstanding`, secondary: pendingInvoiceCount > 0 ? 'Pending invoice capture' : 'No pending invoices' },
      // TODO: Finance aggregation endpoints for debtor ageing, partner revenue, and practice-area revenue are not yet available in the backend.
      debtorAgeing: [] as DashboardChartItem[],
      totalRevenueCollected: { value: formatRwfShort(summary?.collected ?? 0), detail: summary?.months?.length ? `${summary.months.length} months available` : 'Collection data available', trend: summary?.months?.length ? 'Based on billing summary' : 'No trend data yet' },
      revenueByPartner: [] as DashboardChartItem[],
      revenueByPractice: [] as DashboardChartItem[],
    },
    clientExperience: {
      // TODO: Client satisfaction, repeat-instruction rate, referral-rate, and complaint metrics require backend endpoints or data collection.
      satisfaction: { value: 'Data pending', detail: 'Backend support for satisfaction scoring is not yet exposed', stars: 0 },
      repeatInstruction: { value: 'Data pending', detail: 'Client repeat-use data requires backend aggregation', positive: true },
      referralRate: { value: 'Data pending', detail: 'Referral-rate aggregation is not yet available', positive: true },
      redFlagClients: { value: redFlagClientsCount, detail: 'Clients flagged by conflict review' },
      complaints: { open: 0, resolved: 0, pending: 0 },
    },
    latestActivity: (auditFeed || []).slice(0, 5).map((item) => ({
      title: item.message || 'System activity',
      detail: item.detail || item.action || 'Activity recorded in the audit trail',
      time: item.createdAt ? timeAgo(item.createdAt) : '—',
    })),
    insights: [
      ...(summary?.months?.length && summary.months.length > 1 && summary.months[summary.months.length - 1]?.collected > (summary.months[summary.months.length - 2]?.collected || 0)
        ? [`Revenue increased compared with the prior billing period.`]
        : []),
      ...(missedDeadlinesCount > 0 ? [`${missedDeadlinesCount} deadlines are overdue.`] : []),
      ...(pendingInvoiceCount > 0 ? [`${pendingInvoiceCount} invoices remain pending.`] : []),
      ...(pendingReviewCount > 0 ? [`${pendingReviewCount} matters require partner review.`] : []),
      ...(activeProspectsCount > 0 ? [`Prospect conversion rate currently stands at ${conversionRate}%.`] : []),
    ],
  }), [
    activeProspectsCount,
    conversionRate,
    convertedProspectsCount,
    lostOpportunitiesCount,
    referralSourceData,
    activeMattersCount,
    upcomingEvents,
    missedDeadlinesCount,
    pendingReviewCount,
    weeklyReportsDueCount,
    monthlyReportsDueCount,
    operationalRows,
    pendingInvoiceTotal,
    pendingInvoiceCount,
    summary,
    auditFeed,
    redFlagClientsCount,
  ]);

  const billingSummary = summary ? {
    billed: summary.billed ?? 0,
    collected: summary.collected ?? 0,
    outstanding: summary.outstanding ?? 0,
    collectionRate: summary.collectionRate ?? 0,
  } : {
    billed: 0,
    collected: 0,
    outstanding: 0,
    collectionRate: 0,
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="mb-1 text-2xl font-semibold uppercase tracking-wide text-gray-900">Management Dashboard</h1>
        <p className="text-gray-600">Executive overview of business development, operations, finance, and client performance.</p>
      </div>

      {error ? (
        <div className="mb-6 rounded border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-3">
        <Link
          to="/cases/new"
          className="inline-flex items-center rounded bg-gray-800 px-4 py-2 text-white transition-colors hover:bg-gray-700"
        >
          <Plus className="mr-2 h-4 w-4" />
          Create New Case
        </Link>
        <Link
          to="/reports"
          className="inline-flex items-center rounded border border-gray-300 bg-white px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50"
        >
          <FileText className="mr-2 h-4 w-4" />
          View Reports
        </Link>
      </div>

      <DashboardSection title="Business Development" description="Growth pipeline and client acquisition momentum" icon={Briefcase}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KPICard title="Active Prospects" value={dashboardData.businessDevelopment.activeProspects.value} detail="Total active prospects" icon={Handshake} tone="indigo">
            <div className="mt-3 flex items-center text-sm text-emerald-600">
              <TrendingUp className="mr-1 h-4 w-4" />
              {dashboardData.businessDevelopment.activeProspects.trend}
            </div>
          </KPICard>

          <KPICard title="Conversion Rate" value={dashboardData.businessDevelopment.conversionRate.value} detail="Performance against target" icon={Target} tone="green">
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                <span>Conversion progress</span>
                <span>{dashboardData.businessDevelopment.conversionRate.progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${dashboardData.businessDevelopment.conversionRate.progress}%` }} />
              </div>
            </div>
            <div className="mt-3 flex items-center text-sm text-emerald-600">
              <ArrowUpRight className="mr-1 h-4 w-4" />
              {dashboardData.businessDevelopment.conversionRate.trend}
            </div>
          </KPICard>

          <KPICard title="Lost Opportunities" value={dashboardData.businessDevelopment.lostOpportunities.value} detail="Client losses tracked this quarter" icon={AlertTriangle} tone="amber">
            <div className="mt-3 flex items-center text-sm text-rose-600">
              <ArrowDownRight className="mr-1 h-4 w-4" />
              {dashboardData.businessDevelopment.lostOpportunities.trend}
            </div>
          </KPICard>

          <ChartCard title="Revenue by Referral Source" subtitle="Current mix of inbound revenue">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dashboardData.businessDevelopment.referralSources}>
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {dashboardData.businessDevelopment.referralSources.map((entry) => (
                      <Cell key={entry.label} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 space-y-2">
              {dashboardData.businessDevelopment.referralSources.map((item) => (
                <div key={item.label} className="flex items-center justify-between text-sm text-gray-600">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    {item.label}
                  </span>
                  <span className="font-medium text-gray-900">{formatRwfShort(item.value)}</span>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>
      </DashboardSection>

      <DashboardSection title="Operational Performance" description="Deliverables, deadlines, and review readiness" icon={Folder}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <KPICard title="Active Matters" value={dashboardData.operations.activeMatters.value} detail={dashboardData.operations.activeMatters.detail} icon={Briefcase} tone="indigo" />
          <KPICard title="Upcoming Deadlines" value={dashboardData.operations.upcomingDeadlines.value} detail={dashboardData.operations.upcomingDeadlines.detail} icon={Clock} tone="slate" />
          <KPICard title="Missed Deadlines" value={dashboardData.operations.missedDeadlines.value} detail={dashboardData.operations.missedDeadlines.detail} icon={AlertCircle} tone={dashboardData.operations.missedDeadlines.positive ? 'green' : 'red'} />
          <KPICard title="Pending Reviews" value={dashboardData.operations.pendingReviews.value} detail={dashboardData.operations.pendingReviews.detail} icon={ClipboardCheck} tone="amber" />
          <KPICard title="Weekly Reports Due" value={dashboardData.operations.weeklyReportsDue.value} detail={dashboardData.operations.weeklyReportsDue.detail} icon={FileCheck2} tone="green" />
          <KPICard title="Monthly Reports Due" value={dashboardData.operations.monthlyReportsDue.value} detail={dashboardData.operations.monthlyReportsDue.detail} icon={BarChart3} tone="slate" />
        </div>
        <div className="mt-4">
          <DashboardTable title="Upcoming Operational Activities" rows={dashboardData.operations.activities} />
        </div>
      </DashboardSection>

      <DashboardSection title="Financial Performance" description="Revenue health, collections, and client billing status" icon={Wallet}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <KPICard title="Billing Pending" value={dashboardData.finance.billingPending.value} detail={dashboardData.finance.billingPending.detail} icon={Banknote} tone="amber" />
          <KPICard title="Outstanding Invoices" value={dashboardData.finance.outstandingInvoices.value} detail={dashboardData.finance.outstandingInvoices.detail} icon={CreditCard} tone="red">
            <div className="mt-3 text-sm text-gray-500">{dashboardData.finance.outstandingInvoices.secondary}</div>
          </KPICard>
          <ChartCard title="Debtor Ageing" subtitle="Collections aging profile">
            {dashboardData.finance.debtorAgeing.length > 0 ? (
              <div className="space-y-3">
                {dashboardData.finance.debtorAgeing.map((item) => (
                  <div key={item.label}>
                    <div className="mb-1 flex items-center justify-between text-sm text-gray-600">
                      <span>{item.label}</span>
                      <span className="font-medium text-gray-900">{item.value}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-2 rounded-full" style={{ width: `${item.value}%`, backgroundColor: item.color }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                Data not yet available. Backend support for debtor ageing is not implemented.
              </div>
            )}
          </ChartCard>

          <KPICard title="Total Revenue Collected" value={dashboardData.finance.totalRevenueCollected.value} detail={dashboardData.finance.totalRevenueCollected.detail} icon={TrendingUp} tone="green">
            <div className="mt-3 flex items-center text-sm text-emerald-600">
              <ArrowUpRight className="mr-1 h-4 w-4" />
              {dashboardData.finance.totalRevenueCollected.trend}
            </div>
          </KPICard>

          <ChartCard title="Revenue by Partner" subtitle="Ranked by contribution">
            {dashboardData.finance.revenueByPartner.length > 0 ? (
              <div className="space-y-3">
                {dashboardData.finance.revenueByPartner.map((item) => (
                  <div key={item.label}>
                    <div className="mb-1 flex items-center justify-between text-sm text-gray-600">
                      <span>{item.label}</span>
                      <span className="font-medium text-gray-900">{item.value}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${item.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                Data not yet available. Partner-level revenue aggregation is pending backend support.
              </div>
            )}
          </ChartCard>

          <ChartCard title="Revenue by Practice Area" subtitle="Distribution across core practice groups">
            {dashboardData.finance.revenueByPractice.length > 0 ? (
              <>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={dashboardData.finance.revenueByPractice} dataKey="value" nameKey="label" innerRadius={48} outerRadius={70} paddingAngle={2}>
                        {dashboardData.finance.revenueByPractice.map((entry) => (
                          <Cell key={entry.label} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-2">
                  {dashboardData.finance.revenueByPractice.map((item) => (
                    <div key={item.label} className="flex items-center justify-between text-sm text-gray-600">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                        {item.label}
                      </span>
                      <span className="font-medium text-gray-900">{item.value}%</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                Data not yet available. Practice-area revenue breakdown requires additional backend aggregation.
              </div>
            )}
          </ChartCard>
        </div>
      </DashboardSection>

      <DashboardSection title="Client Experience" description="Satisfaction, retention, and service risk" icon={Users}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <KPICard title="Client Satisfaction Scores" value={dashboardData.clientExperience.satisfaction.value} detail={dashboardData.clientExperience.satisfaction.detail} icon={HeartHandshake} tone="green">
            {dashboardData.clientExperience.satisfaction.stars > 0 ? (
              <div className="mt-3 flex items-center gap-1 text-amber-500">
                {Array.from({ length: dashboardData.clientExperience.satisfaction.stars }).map((_, index) => (
                  <Star key={index} className="h-4 w-4 fill-current" />
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                Data not yet available.
              </div>
            )}
          </KPICard>
          <KPICard title="Repeat Instruction Rate" value={dashboardData.clientExperience.repeatInstruction.value} detail={dashboardData.clientExperience.repeatInstruction.detail} icon={Smile} tone="indigo">
            <div className="mt-3 rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              {dashboardData.clientExperience.repeatInstruction.value === 'Data pending' ? 'Data not yet available. Backend aggregation is required.' : dashboardData.clientExperience.repeatInstruction.detail}
            </div>
          </KPICard>
          <KPICard title="Referral Rate" value={dashboardData.clientExperience.referralRate.value} detail={dashboardData.clientExperience.referralRate.detail} icon={Handshake} tone="green">
            <div className="mt-3 rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              {dashboardData.clientExperience.referralRate.value === 'Data pending' ? 'Data not yet available. Backend aggregation is required.' : dashboardData.clientExperience.referralRate.detail}
            </div>
          </KPICard>
          <KPICard title="Red Flag Clients" value={dashboardData.clientExperience.redFlagClients.value} detail={dashboardData.clientExperience.redFlagClients.detail} icon={ShieldAlert} tone="red">
            <div className="mt-3 flex items-center text-sm text-rose-600">
              <AlertTriangle className="mr-1 h-4 w-4" />
              Click to review flagged clients
            </div>
          </KPICard>
          <ChartCard title="Complaints Dashboard" subtitle="Open, resolved, and pending cases">
            <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              Data not yet available. Complaints tracking requires an exposed backend aggregation endpoint.
            </div>
          </ChartCard>
        </div>
      </DashboardSection>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DashboardTimeline items={dashboardData.latestActivity} />
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
              <BarChart3 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Management Insights</h3>
              <p className="text-sm text-gray-500">Executive summaries generated from current performance</p>
            </div>
          </div>
          <div className="space-y-3">
            {dashboardData.insights.map((item) => (
              <DashboardInsightCard key={item} text={item} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}