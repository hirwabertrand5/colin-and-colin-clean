import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock,
  FileText,
  Percent,
  RefreshCw,
  UsersRound,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { UserRole } from '../../App';
import { FirmReportRange, FirmReportResponse, getFirmReports } from '../../services/firmReportsService';
import {
  getProfitabilityReport,
  ProfitabilityResponse,
  ProfitabilityRow,
} from '../../services/profitabilityService';
import usePageTitle from '../../hooks/usePageTitle';

type ProfitabilityTab = 'overview' | 'matters' | 'clients' | 'practice' | 'staff' | 'definitions';

const managementRoles: UserRole[] = [
  'managing_director',
  'managing_partner',
  'executive_managing_partner',
];
const PAGE_SIZE = 10;

const money = (value?: number | null) =>
  value == null
    ? 'N/A'
    : `RWF ${Math.round(Number(value) || 0).toLocaleString('en-US')}`;
const percentage = (value?: number | null) => (value == null ? 'N/A' : `${Math.round(value * 10) / 10}%`);
const number = (value?: number | null) => (value == null ? 'N/A' : new Intl.NumberFormat('en-US').format(value));
const tone = (value?: number | null) => (value == null ? 'text-slate-500 dark:text-slate-400' : value < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300');

const tabs: Array<{ id: ProfitabilityTab; label: string; icon: typeof BarChart3 }> = [
  { id: 'overview', label: 'Firm overview', icon: BarChart3 },
  { id: 'matters', label: 'Matter', icon: BriefcaseBusiness },
  { id: 'clients', label: 'Client', icon: Building2 },
  { id: 'practice', label: 'Practice area', icon: Building2 },
  { id: 'staff', label: 'Staff contribution', icon: UsersRound },
  { id: 'definitions', label: 'Definitions & controls', icon: BookOpen },
];

function MetricCard({
  label,
  value,
  detail,
  icon: Icon = BarChart3,
  accent = 'blue',
  valueClass = 'text-slate-950 dark:text-white',
}: {
  label: string;
  value: string;
  detail?: string;
  icon?: LucideIcon;
  accent?: 'blue' | 'emerald' | 'violet' | 'amber' | 'rose';
  valueClass?: string;
}) {
  return (
    <article className="profitability-metric rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <span className={`profitability-metric-icon is-${accent}`}><Icon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</p>
          <p className={`mt-1.5 text-xl font-semibold tracking-tight ${valueClass}`}>{value}</p>
          {detail && <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</p>}
        </div>
      </div>
    </article>
  );
}

function Skeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading profitability report">
      <div className="h-10 w-64 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    </div>
  );
}

function DataGap({ children }: { children: React.ReactNode }) {
  return (
    <div className="profitability-notice flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function Formula({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</p>
      <p className="mt-1 font-mono text-xs leading-5 text-slate-600 dark:text-slate-300">{children}</p>
    </div>
  );
}

function CostStructurePanel({ firm }: { firm: ProfitabilityResponse['firm'] }) {
  const total = Math.max(0, firm.totalFirmCosts || 0);
  const directShare = total > 0 ? Math.min(100, Math.max(0, (firm.directMatterCosts / total) * 100)) : 0;

  return (
    <section className="profitability-detail-card">
      <div className="profitability-detail-heading">
        <span className="profitability-detail-icon"><BarChart3 className="h-5 w-5" /></span>
        <div><h2>Cost structure</h2><p>Recorded costs only; no inferred allocations.</p></div>
      </div>
      <div className="profitability-cost-body">
        <div className="profitability-donut" style={{ background: `conic-gradient(#2f80ed 0 ${directShare}%, #9ac4f8 ${directShare}% 100%)` }}>
          <div><strong>{money(total)}</strong><span>Total costs</span></div>
        </div>
        <dl className="profitability-cost-legend">
          <div><dt><i className="is-direct" />Direct matter costs</dt><dd>{money(firm.directMatterCosts)} <small>{percentage(directShare)}</small></dd></div>
          <div><dt><i className="is-overhead" />General overheads</dt><dd>{money(firm.generalOverheads)} <small>{percentage(100 - directShare)}</small></dd></div>
        </dl>
      </div>
      <div className="profitability-total-strip"><span className="profitability-detail-icon"><FileText className="h-5 w-5" /></span><div><span>Total recorded firm costs</span><strong>{money(total)}</strong><small>Direct matter costs plus recorded internal operating expenses.</small></div></div>
    </section>
  );
}

function ReceivablesAgeingPanel({
  ageing,
  total,
}: {
  ageing: ProfitabilityResponse['ageing'];
  total: number;
}) {
  const bands = [
    { label: '0 – 30 days', value: ageing.current, tone: 'blue' },
    { label: '31 – 60 days', value: ageing.days31to60, tone: 'sky' },
    { label: '61 – 90 days', value: ageing.days61to90, tone: 'amber' },
    { label: 'Over 90 days', value: ageing.over90, tone: 'rose' },
  ];

  return (
    <section className="profitability-detail-card">
      <div className="profitability-detail-heading">
        <span className="profitability-detail-icon"><Clock className="h-5 w-5" /></span>
        <div><h2>Receivables ageing</h2><p>Open invoice balances at the selected report end.</p></div>
      </div>
      <div className="profitability-ageing-list">
        {bands.map((band) => {
          const share = total > 0 ? Math.min(100, Math.max(0, (band.value / total) * 100)) : 0;
          return <div key={band.label} className="profitability-ageing-row">
            <div><span>{band.label}</span><strong>{money(band.value)}</strong></div>
            <div className="profitability-ageing-track"><i className={`is-${band.tone}`} style={{ width: `${share}%` }} /></div>
            <small>{percentage(share)}</small>
          </div>;
        })}
      </div>
      <div className="profitability-total-strip"><span className="profitability-detail-icon"><FileText className="h-5 w-5" /></span><div><span>Total open receivables</span><strong>{money(total)}</strong><small>Unpaid invoices issued on or before the report end.</small></div></div>
    </section>
  );
}

function Pagination({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm dark:border-slate-700">
      <span className="text-slate-500 dark:text-slate-400">
        Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1} className="rounded-lg border border-slate-300 p-1.5 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800" aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-slate-600 dark:text-slate-300">Page {page} of {pages}</span>
        <button type="button" onClick={() => onPage(Math.min(pages, page + 1))} disabled={page === pages} className="rounded-lg border border-slate-300 p-1.5 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800" aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function FinancialTable({
  title,
  subtitle,
  rows,
  kind,
}: {
  title: string;
  subtitle: string;
  rows: ProfitabilityRow[];
  kind: 'matter' | 'client' | 'practice';
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const searchableRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return rows;
    return rows.filter((row) =>
      [row.label, row.matterNo, row.client, row.practiceArea, row.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search),
    );
  }, [query, rows]);
  const pages = Math.max(1, Math.ceil(searchableRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const visibleRows = searchableRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const primary = (row: ProfitabilityRow) =>
    kind === 'matter' ? row.matterNo : row.label || 'Unclassified';
  const secondary = (row: ProfitabilityRow) =>
    kind === 'matter'
      ? `${row.client || 'Unassigned client'} · ${row.practiceArea || 'Unclassified'}`
      : kind === 'client'
        ? `${row.matterCount} matters · ${row.activeMatters || 0} active`
        : `${row.matterCount} matters · ${row.activeMatters || 0} active`;

  useEffect(() => setPage(1), [query, rows]);

  return (
    <section className="profitability-card overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 dark:border-slate-700 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">{title}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        <label className="block w-full lg:w-72">
          <span className="sr-only">Search {title.toLowerCase()}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${kind === 'practice' ? 'practice areas' : `${kind}s`}…`} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-500 transition focus:ring-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
        </label>
      </div>
      {!searchableRows.length ? (
        <div className="px-5 py-12 text-center text-sm text-slate-500 dark:text-slate-400">No records match this view.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[1260px] w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3">{kind === 'practice' ? 'Practice area' : kind === 'client' ? 'Client' : 'Matter'}</th>
                <th className="px-4 py-3 text-right">Contract value</th>
                <th className="px-4 py-3 text-right">Recognised collected revenue</th>
                <th className="px-4 py-3 text-right">Fees billed</th>
                <th className="px-4 py-3 text-right">Open receivables</th>
                <th className="px-4 py-3 text-right">Direct matter costs</th>
                <th className="px-4 py-3 text-right">Gross contribution</th>
                <th className="px-4 py-3 text-right">Contribution margin</th>
                <th className="px-4 py-3">Cost allocation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleRows.map((row) => (
                <tr key={row.id || row.label || row.matterNo} className="align-top transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="px-5 py-4">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{primary(row)}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{secondary(row)}</p>
                  </td>
                  <td className="px-4 py-4 text-right font-medium text-slate-700 dark:text-slate-200">{money(row.contractValue)}</td>
                  <td className="px-4 py-4 text-right font-medium text-slate-900 dark:text-white">{money(row.collected)}</td>
                  <td className="px-4 py-4 text-right text-slate-700 dark:text-slate-200">{money(row.billed)}</td>
                  <td className="px-4 py-4 text-right text-amber-700 dark:text-amber-300">{money(row.outstanding)}</td>
                  <td className="px-4 py-4 text-right text-rose-700 dark:text-rose-300">{money(row.directMatterCosts)}</td>
                  <td className={`px-4 py-4 text-right font-semibold ${tone(row.grossContribution)}`}>{money(row.grossContribution)}</td>
                  <td className={`px-4 py-4 text-right font-semibold ${tone(row.contributionMargin)}`}>{percentage(row.contributionMargin)}</td>
                  <td className="px-4 py-4 text-xs leading-5 text-slate-500 dark:text-slate-400">Direct costs only<br />Staff and overhead allocation not configured</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={safePage} total={searchableRows.length} onPage={setPage} />
    </section>
  );
}

function StaffDashboardTable({ members }: { members: FirmReportResponse['team'] }) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const [sort, setSort] = useState<'fees' | 'matters' | 'overdue'>('fees');
  const [page, setPage] = useState(1);
  const roles = useMemo(
    () => Array.from(new Set(members.map((member) => member.role || 'Unclassified'))).sort((a, b) => a.localeCompare(b)),
    [members],
  );
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return members
      .filter((member) => role === 'all' || (member.role || 'Unclassified') === role)
      .filter((member) => !search || `${member.name} ${member.role}`.toLowerCase().includes(search))
      .sort((left, right) => {
        if (sort === 'matters') return (right.tasksCompleted || 0) - (left.tasksCompleted || 0) || left.name.localeCompare(right.name);
        if (sort === 'overdue') return (right.overdueTasks || 0) - (left.overdueTasks || 0) || left.name.localeCompare(right.name);
        return (right.revenueAttributed ?? right.earnedFees ?? 0) - (left.revenueAttributed ?? left.earnedFees ?? 0) || left.name.localeCompare(right.name);
      });
  }, [members, query, role, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => setPage(1), [query, role, sort, members]);

  return (
    <section className="profitability-card overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 dark:border-slate-700 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">Staff performance & revenue attribution</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">The same source and period logic used by staff dashboards, presented separately from staff profitability.</p>
        </div>
        <div className="flex w-full gap-2 lg:w-auto">
          <label className="block flex-1 lg:w-44"><span className="sr-only">Filter by role</span><select value={role} onChange={(event) => setRole(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-500 transition focus:ring-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"><option value="all">All roles</option>{roles.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="block flex-1 lg:w-52"><span className="sr-only">Sort staff</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-500 transition focus:ring-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"><option value="fees">Highest attributed fees</option><option value="matters">Most matters completed</option><option value="overdue">Most overdue matters</option></select></label>
        </div>
        <label className="block w-full lg:w-72"><span className="sr-only">Search staff</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff…" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-500 transition focus:ring-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
      </div>
      {!filtered.length ? <div className="px-5 py-12 text-center text-sm text-slate-500 dark:text-slate-400">No staff records match the selected filters.</div> : (
        <div className="overflow-x-auto">
          <table className="min-w-[1320px] w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:bg-slate-800/80 dark:text-slate-400"><tr>
              <th className="px-5 py-3">Staff member</th><th className="px-4 py-3 text-right">Active matters</th><th className="px-4 py-3 text-right">Matters completed</th><th className="px-4 py-3 text-right">Early / on time / late</th><th className="px-4 py-3 text-right">Overdue matters</th><th className="px-4 py-3 text-right">Collected fee base</th><th className="px-4 py-3 text-right">Fees attributed</th><th className="px-4 py-3 text-right">Firm retained</th><th className="px-4 py-3 text-right">Attribution ratio</th><th className="px-4 py-3 text-right">Staff net profit</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visible.map((member) => {
                const collectedBase = member.grossFeesHandled ?? member.invoicePaymentsReceived ?? 0;
                const attributedFees = member.revenueAttributed ?? member.earnedFees ?? 0;
                const firmRetained = member.firmRetainedEarnings ?? Math.max(0, collectedBase - attributedFees);
                const attributionRatio = member.contributionRatio ?? (collectedBase > 0 ? (attributedFees / collectedBase) * 100 : null);
                return <tr key={member.id} className="transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="px-5 py-4"><p className="font-semibold text-slate-900 dark:text-slate-100">{member.name}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{member.role} · {member.earningRoleLabel || 'Fee-attribution role'}{member.earningSharePercent != null ? ` · ${member.earningSharePercent}% configured share` : ''}</p></td>
                  <td className="px-4 py-4 text-right text-slate-700 dark:text-slate-200">{number(member.activeCases)}</td><td className="px-4 py-4 text-right text-slate-700 dark:text-slate-200">{number(member.tasksCompleted)}</td><td className="px-4 py-4 text-right text-slate-700 dark:text-slate-200">{number(member.earlyTasks)} / {number(member.onTimeTasks)} / {number(member.lateTasks)}</td><td className="px-4 py-4 text-right font-medium text-amber-700 dark:text-amber-300">{number(member.overdueTasks)}</td>
                  <td className="px-4 py-4 text-right text-slate-700 dark:text-slate-200">{money(collectedBase)}</td><td className="px-4 py-4 text-right font-semibold text-slate-900 dark:text-white">{money(attributedFees)}</td><td className="px-4 py-4 text-right text-slate-700 dark:text-slate-200">{money(firmRetained)}</td><td className="px-4 py-4 text-right font-medium text-slate-700 dark:text-slate-200">{percentage(attributionRatio)}</td><td className="px-4 py-4 text-right text-slate-500 dark:text-slate-400">N/A</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={safePage} total={filtered.length} onPage={setPage} />
    </section>
  );
}

export default function ProfitabilityPage({ userRole, initialTab = 'overview' }: { userRole: UserRole; initialTab?: ProfitabilityTab }) {
  const [tab, setTab] = useState<ProfitabilityTab>(initialTab);
  const [range, setRange] = useState<FirmReportRange>('ytd');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<ProfitabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [staffReport, setStaffReport] = useState<FirmReportResponse | null>(null);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState('');
  const staffCache = useRef(new Map<string, FirmReportResponse>());
  const permitted = managementRoles.includes(userRole);
  usePageTitle('Profitability');

  useEffect(() => setTab(initialTab), [initialTab]);

  useEffect(() => {
    if (!permitted) return;
    if (range === 'custom' && (!from || !to)) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setRefreshing(Boolean(data));
        setLoading(!data);
        setError('');
        const report = await getProfitabilityReport({ range, from: range === 'custom' ? from : undefined, to: range === 'custom' ? to : undefined }, controller.signal);
        setData(report);
      } catch (loadError: any) {
        if (loadError?.name !== 'AbortError') setError(loadError?.message || 'Failed to load profitability report.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }, range === 'custom' ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [permitted, range, from, to, refreshKey]);

  useEffect(() => {
    if (!permitted || tab !== 'staff') return;
    if (range === 'custom' && (!from || !to)) return;

    const reportKey = [range, range === 'custom' ? from : '', range === 'custom' ? to : '', refreshKey].join(':');
    const cached = staffCache.current.get(reportKey);
    if (cached) {
      setStaffReport(cached);
      setStaffError('');
      setStaffLoading(false);
      return;
    }

    let current = true;
    setStaffLoading(true);
    setStaffError('');
    setStaffReport(null);
    getFirmReports({
      range,
      from: range === 'custom' ? from : undefined,
      to: range === 'custom' ? to : undefined,
      basis: 'paymentDate',
    })
      .then((report) => {
        if (!current) return;
        staffCache.current.set(reportKey, report);
        setStaffReport(report);
      })
      .catch((loadError: any) => {
        if (current) setStaffError(loadError?.message || 'Failed to load staff dashboard KPIs.');
      })
      .finally(() => {
        if (current) setStaffLoading(false);
      });

    return () => {
      current = false;
    };
  }, [permitted, tab, range, from, to, refreshKey]);

  if (!permitted) return <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><h1 className="text-xl font-semibold">Access denied</h1><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">You do not have permission to view Billing & Finance profitability.</p></div>;
  if (loading && !data) return <Skeleton />;

  const firm = data?.firm;
  const missingCostAllocation = !data?.dataAvailability.allocatedOverhead || !data?.dataAvailability.staffCostRegister;

  return (
    <div className="profitability-page space-y-5 pb-8">
      <header className="profitability-page-header flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
        <div>
          <Link to="/billing" className="profitability-back-link mb-3 inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950 dark:text-slate-400 dark:hover:text-white"><ArrowLeft className="h-4 w-4" />Billing & Finance</Link>
          <div className="profitability-identity flex items-center gap-3"><div className="rounded-xl bg-indigo-600 p-2.5 text-white shadow-sm"><BarChart3 className="h-5 w-5" /></div><div><span className="profitability-eyebrow">Billing & Finance</span><h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">Profitability</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">A reconciled view of financial contribution, from firm level through matter, client, practice area and staff.</p></div></div>
        </div>
        <div className="profitability-filter-bar flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400"><span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Reporting period</span><select value={range} onChange={(event) => setRange(event.target.value as FirmReportRange)} className="min-w-36 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none ring-indigo-500 focus:ring-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"><option value="daily">Today</option><option value="weekly">Last 7 days</option><option value="monthly">This month</option><option value="quarterly">Previous quarter</option><option value="yearly">Previous year</option><option value="ytd">Year to date</option><option value="custom">Custom range</option></select></label>
          {range === 'custom' && <><label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-500 focus:ring-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label><label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-500 focus:ring-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label></>}
          <button type="button" onClick={() => { staffCache.current.clear(); setRefreshKey((value) => value + 1); }} disabled={refreshing || staffLoading} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"><RefreshCw className={`h-4 w-4 ${refreshing || staffLoading ? 'animate-spin' : ''}`} />Refresh</button>
        </div>
      </header>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{error}</div>}
      {data && <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400"><span className="font-semibold text-slate-700 dark:text-slate-200">Scope:</span><span>{data.range.label}</span><span className="text-slate-300 dark:text-slate-600">•</span><span>Currency: RWF</span>{refreshing && <><span className="text-slate-300 dark:text-slate-600">•</span><span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />Updating</span></>}</div>}

      <nav className="profitability-tabs overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900" aria-label="Profitability reports"><div className="flex min-w-max gap-1">{tabs.map((item) => { const Icon = item.icon; const active = tab === item.id; return <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`profitability-tab inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${active ? 'bg-indigo-600 text-white shadow-sm is-active' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</div></nav>

      {missingCostAllocation && tab !== 'definitions' && <DataGap><strong>Cost completeness:</strong> direct matter costs and internal operating expenses are shown from the finance ledger. The system has no staff-cost register or approved overhead-allocation basis yet, so matter, client, practice-area and staff <strong>net contribution</strong> is intentionally shown as N/A rather than estimated.</DataGap>}

      {tab === 'overview' && firm && <div className="space-y-5">
        <section className="profitability-financial-summary rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-6 text-white shadow-lg">
          <div className="profitability-hero-main">
            <div>
              <p className="profitability-hero-label">Firm profitability</p>
              <h2>{money(firm.netProfit)}</h2>
              <p>Net profit is recognised collected revenue less recorded direct matter costs and general overheads for the selected period. Tax and non-operating items are not recorded in this report.</p>
            </div>
            <span className="profitability-hero-art"><BarChart3 className="h-10 w-10" /></span>
          </div>
          <div className="profitability-hero-stat-grid">
            <div className="is-emerald"><span className="profitability-hero-stat-icon"><Percent className="h-6 w-6" /></span><div><span>Net profit margin</span><strong>{percentage(firm.netProfitMargin)}</strong></div></div>
            <div className="is-violet"><span className="profitability-hero-stat-icon"><Wallet className="h-6 w-6" /></span><div><span>Gross contribution</span><strong>{money(firm.grossContribution)}</strong></div></div>
            <div className="is-amber"><span className="profitability-hero-stat-icon"><CircleHelp className="h-6 w-6" /></span><div><span>Cost ratio</span><strong>{percentage(firm.costRatio)}</strong></div></div>
          </div>
        </section>
        <section>
          <div className="mb-3 flex items-center gap-2"><h2 className="text-base font-semibold text-slate-950 dark:text-white">Revenue & receivables</h2><span title="Financial events remain distinct: contracted, billed and collected are never substituted for each other."><CircleHelp className="h-4 w-4 text-slate-400" /></span></div>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            <MetricCard icon={FileText} accent="blue" label="Contract value" value={money(firm.contractValue)} detail="Agreed fees for the selected matter population." />
            <MetricCard icon={FileText} accent="emerald" label="Fees billed" value={money(firm.billed)} detail="Invoices issued in the period." />
            <MetricCard icon={Wallet} accent="violet" label="Recognised collected revenue" value={money(firm.recognisedCollectedRevenue)} detail="Paid invoices recorded in the period; credit notes and payment refunds are not separately ledgered." valueClass="text-emerald-700 dark:text-emerald-300" />
            <MetricCard icon={Wallet} accent="rose" label="Open receivables" value={money(firm.totalReceivables)} detail="Current unpaid invoices issued to the report end." valueClass="text-amber-700 dark:text-amber-300" />
            <MetricCard icon={Percent} accent="emerald" label="Collection rate" value={percentage(firm.collectionRate)} detail="Recorded payments ÷ billed for the selected period." />
            <MetricCard icon={BriefcaseBusiness} accent="blue" label="Active matters" value={number(firm.activeMatters)} detail="Open matters in the selected population." />
          </div>
        </section>
        <section className="grid gap-4 xl:grid-cols-2">
          <CostStructurePanel firm={firm} />
          <ReceivablesAgeingPanel ageing={data.ageing} total={firm.totalReceivables} />
        </section>
      </div>}

      {tab === 'matters' && <FinancialTable title="Matter profitability" subtitle="Gross contribution = matter recognised collected revenue − direct external matter costs. Net contribution needs approved staff and overhead allocations." rows={data?.matterRows || []} kind="matter" />}
      {tab === 'clients' && <FinancialTable title="Client profitability" subtitle="Consolidated financial contribution across each client's matters. Retainers and unbilled earned fees are not treated as recognised revenue." rows={data?.clientRows || []} kind="client" />}
      {tab === 'practice' && <FinancialTable title="Practice area profitability" subtitle="Each matter is grouped by its designated top-level legal-service practice area. Unclassified matters remain visible and are not silently assigned." rows={data?.practiceAreaRows || []} kind="practice" />}
      {tab === 'staff' && <div className="space-y-4">
        <DataGap><strong>Staff profitability remains unavailable:</strong> direct employment cost and approved staff-overhead allocations are not in the finance register. The revenue and performance figures below are dashboard KPIs, not a substitute for staff net profit.</DataGap>
        {staffReport && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Staff members" value={number(staffReport.team.length)} detail="Active dashboard population." /><MetricCard label="Attributed fees" value={money(staffReport.team.reduce((sum, member) => sum + (member.revenueAttributed ?? member.earnedFees ?? 0), 0))} detail="Fees Earned dashboard source." valueClass="text-emerald-700 dark:text-emerald-300" /><MetricCard label="Gross fee base" value={money(staffReport.team.reduce((sum, member) => sum + (member.grossFeesHandled ?? member.invoicePaymentsReceived ?? 0), 0))} detail="Collected-base allocation used by staff KPIs." /><MetricCard label="Overdue matters" value={number(staffReport.team.reduce((sum, member) => sum + (member.overdueTasks || 0), 0))} detail="Workflow matters past their deadline." valueClass="text-amber-700 dark:text-amber-300" /></section>}
        {staffError && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{staffError}</div>}
        {staffLoading ? <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">Loading dashboard-aligned staff KPIs…</div> : staffReport ? <StaffDashboardTable members={staffReport.team} /> : !staffError && <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">Choose a complete reporting period to view staff KPIs.</div>}
      </div>}
      {tab === 'definitions' && <section className="space-y-6"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"><h2 className="text-lg font-semibold text-slate-950 dark:text-white">Calculation dictionary</h2><p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">The page uses one reporting period and currency throughout. If a denominator is zero, the result is N/A—not zero and not a divided value.</p><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3"><Formula label="Firm net profit">Recognised collected revenue − total recorded firm costs</Formula><Formula label="Gross contribution">Recognised collected revenue − direct matter costs</Formula><Formula label="Net profit margin">Net profit ÷ recognised collected revenue × 100</Formula><Formula label="Matter / client gross contribution">Recognised collected revenue − direct external matter costs</Formula><Formula label="Contribution margin">Net contribution ÷ recognised collected revenue × 100</Formula><Formula label="Staff attributed revenue">Sum of eligible Key Action fees × approved staff attribution percentage</Formula><Formula label="Collection rate">Payments allocated to invoices ÷ invoice amounts eligible for collection × 100</Formula><Formula label="Cost ratio">Total firm costs ÷ recognised collected revenue × 100</Formula><Formula label="Overhead allocation">Firm overhead × allocation units ÷ total allocation units</Formula></div></div><div className="grid gap-6 xl:grid-cols-2"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"><h2 className="text-base font-semibold text-slate-950 dark:text-white">Current data coverage</h2><ul className="mt-4 space-y-3 text-sm"><li className="flex justify-between gap-4"><span className="text-slate-600 dark:text-slate-300">Contract values, issued invoices & recorded payments</span><span className="font-medium text-emerald-700 dark:text-emerald-300">Available</span></li><li className="flex justify-between gap-4"><span className="text-slate-600 dark:text-slate-300">Direct matter costs & internal operating expenses</span><span className="font-medium text-emerald-700 dark:text-emerald-300">Available</span></li><li className="flex justify-between gap-4"><span className="text-slate-600 dark:text-slate-300">Auditable Staff Key Action attribution ledger</span><span className="font-medium text-emerald-700 dark:text-emerald-300">Available</span></li><li className="flex justify-between gap-4"><span className="text-slate-600 dark:text-slate-300">Firm-wide fee-recognition / unbilled-earned-fee ledger</span><span className="font-medium text-amber-700 dark:text-amber-300">Not configured</span></li><li className="flex justify-between gap-4"><span className="text-slate-600 dark:text-slate-300">Direct employment-cost register & overhead allocation</span><span className="font-medium text-amber-700 dark:text-amber-300">Not configured</span></li><li className="flex justify-between gap-4"><span className="text-slate-600 dark:text-slate-300">Tax, non-operating items, credit notes & refund ledger</span><span className="font-medium text-amber-700 dark:text-amber-300">Not configured</span></li></ul></div><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"><h2 className="text-base font-semibold text-slate-950 dark:text-white">Controls that protect accuracy</h2><ol className="mt-4 space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300"><li><strong className="text-slate-900 dark:text-slate-100">One source of truth.</strong> Contract values, invoices, payments, expenses and staff earnings are each read from their authoritative record.</li><li><strong className="text-slate-900 dark:text-slate-100">No double counting.</strong> Direct costs are never added again as general overhead; unavailable allocations are not estimated.</li><li><strong className="text-slate-900 dark:text-slate-100">Separate events.</strong> Contracted, billed and collected amounts remain distinct throughout the report.</li><li><strong className="text-slate-900 dark:text-slate-100">Traceable period.</strong> Every response is calculated against the reporting period shown in the header.</li></ol></div></div><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"><h2 className="text-base font-semibold text-slate-950 dark:text-white">Required staff-cost register</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">These document categories are ready for the finance cost register. Once recorded with an approved allocation basis, staff, matter and practice-area net contribution can be calculated without double counting.</p><div className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">{['Remuneration', 'Bonuses & incentives', 'Recruitment costs', 'Training & development', 'Technology', 'Office cost allocation', 'Travel & client work', 'Employee welfare', 'Administrative costs', 'Professional memberships', 'Other employment costs'].map((category) => <div key={category} className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{category}</div>)}</div><p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">Required record fields: cost category, cost item, actual amount, cost date / accounting period, staff member when directly attributable, matter ID when applicable, allocation method, approval status and accounting reference.</p></div></section>}
    </div>
  );
}
