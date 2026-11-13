import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { RetainerPerformancePanel } from './RetainerPerformancePanel';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
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
import { FirmReportResponse } from '../../services/firmReportsService';
import {
  ProfitabilityResponse,
  ProfitabilityRow,
  ProfitabilityPeriod,
} from '../../services/profitabilityService';
import usePageTitle from '../../hooks/usePageTitle';
import './profitability.css';
import { REPORT_PERIOD_OPTIONS } from '../../constants/reportPeriods';
import { getDataRevision, subscribeDataChanges } from '../../services/navigationRequest';
import { readFinancialProfitability, readStaffProfitability, profitabilityScopeKey } from '../../services/profitabilityResource';

type ProfitabilityTab = 'overview' | 'matters' | 'clients' | 'practice' | 'staff';

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
  { id: 'staff', label: 'Staff profitability', icon: UsersRound },
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
          <p className={`profitability-metric-value mt-1.5 text-xl font-semibold tracking-tight ${valueClass}`} title={value}>{value}</p>
          {detail && <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</p>}
        </div>
      </div>
    </article>
  );
}

function Skeleton() {
  return (
    <div className="profitability-loading space-y-6" role="status" aria-busy="true" aria-label="Loading profitability report">
      <p>Loading report data…</p>
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

function CostStructurePanel({ firm }: { firm: ProfitabilityResponse['firm'] }) {
  const total = firm.totalFirmCosts || 0;
  const chartable = total > 0 && firm.directMatterCosts >= 0 && firm.generalOverheads >= 0;
  const directShare = chartable ? Math.min(100, (firm.directMatterCosts / total) * 100) : 0;

  return (
    <section className="profitability-detail-card">
      <div className="profitability-detail-heading">
        <span className="profitability-detail-icon"><BarChart3 className="h-5 w-5" /></span>
        <div><h2>Cost structure</h2><p>Recorded costs only; no inferred allocations.</p></div>
      </div>
      <div className="profitability-cost-body">
        <div className="profitability-donut" style={{ background: chartable ? `conic-gradient(#2f80ed 0 ${directShare}%, #9ac4f8 ${directShare}% 100%)` : '#dbe4ef' }}>
          <div><strong>{money(total)}</strong><span>{chartable ? 'Total costs' : 'Net costs after refunds'}</span></div>
        </div>
        <dl className="profitability-cost-legend">
          <div><dt><i className="is-direct" />Direct matter costs</dt><dd>{money(firm.directMatterCosts)} <small>{percentage(directShare)}</small></dd></div>
          <div><dt><i className="is-overhead" />General overheads</dt><dd>{money(firm.generalOverheads)}</dd></div>
          {!!firm.retainerStaffTpa && <div><dt>Accrued retainer staff TPA</dt><dd>{money(firm.retainerStaffTpa)}</dd></div>}
        </dl>
      </div>
      <div className="profitability-total-strip"><span className="profitability-detail-icon"><FileText className="h-5 w-5" /></span><div><span>Total recorded firm costs</span><strong>{money(total)}</strong><small>Direct matter costs, internal operating expenses and accrued retainer staff TPA.</small></div></div>
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
    <div className="profitability-pagination flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm dark:border-slate-700">
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
  rows,
  kind,
}: {
  title: string;
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
    kind === 'matter' ? row.matterNo || row.label || 'Unnumbered matter' : row.label || 'Unclassified';
  const secondary = (row: ProfitabilityRow) =>
    kind === 'matter'
      ? `${row.client || 'Unassigned client'} · ${row.practiceArea || 'Unclassified'}`
      : kind === 'client'
        ? `${row.matterCount} matters · ${row.activeMatters || 0} active`
        : `${row.matterCount} matters · ${row.activeMatters || 0} active`;

  useEffect(() => setPage(1), [query, rows]);

  return (
    <section className="profitability-card profitability-data-card profitability-financial-card overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="profitability-table-header profitability-financial-table-toolbar flex flex-col gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">{title}</h2>
        </div>
        <label className="profitability-search-control block w-full lg:w-72">
          <span className="sr-only">Search {title.toLowerCase()}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${kind === 'practice' ? 'practice areas' : `${kind}s`}…`} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-500 transition focus:ring-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
        </label>
      </div>
      {!searchableRows.length ? (
        <div className="px-5 py-12 text-center text-sm text-slate-500 dark:text-slate-400">No records match this view.</div>
      ) : (
        <div className="profitability-table-wrap overflow-x-auto">
          <table className="profitability-financial-table profitability-retainer-table min-w-[1574px] w-full text-sm">
            <colgroup>
              <col className="profitability-col-row-number" /><col className="profitability-col-identifier" /><col className="profitability-col-contract" /><col className="profitability-col-collected" /><col className="profitability-col-billed" /><col className="profitability-col-receivables" /><col className="profitability-col-costs" /><col className="profitability-col-contribution" /><col className="profitability-col-margin" /><col className="profitability-col-allocation" />
            </colgroup>
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-3 py-3 text-center">#</th>
                <th scope="col" className="px-5 py-3">{kind === 'practice' ? 'Practice area' : kind === 'client' ? 'Client' : 'Matter'}</th>
                <th scope="col" className="px-4 py-3 text-right">Contract value</th>
                <th scope="col" className="px-4 py-3 text-right" title="Recognised collected revenue">Collected revenue</th>
                <th scope="col" className="px-4 py-3 text-right">Fees billed</th>
                <th scope="col" className="px-4 py-3 text-right">Open receivables</th>
                <th scope="col" className="px-4 py-3 text-right">Direct costs</th>
                <th scope="col" className="px-4 py-3 text-right">Gross contribution</th>
                <th scope="col" className="px-4 py-3 text-right">Contribution margin</th>
                <th scope="col" className="px-4 py-3">Cost allocation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleRows.map((row, index) => (
                <tr key={row.id || row.label || row.matterNo} className="align-top transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="profitability-row-number px-3 py-4 text-center">{(safePage - 1) * PAGE_SIZE + index + 1}</td>
                  <td className="px-5 py-4">
                    <p className="profitability-table-identifier font-semibold text-slate-900 dark:text-slate-100" title={primary(row)}>{primary(row)}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{secondary(row)}</p>
                  </td>
                  <td className="profitability-number-cell px-4 py-4 text-right font-medium text-slate-700 dark:text-slate-200">{money(row.contractValue)}</td>
                  <td className="profitability-number-cell px-4 py-4 text-right font-medium text-slate-900 dark:text-white">{money(row.collected)}</td>
                  <td className="profitability-number-cell px-4 py-4 text-right text-slate-700 dark:text-slate-200">{money(row.billed)}</td>
                  <td className="profitability-number-cell px-4 py-4 text-right text-amber-700 dark:text-amber-300">{money(row.outstanding)}</td>
                  <td className="profitability-number-cell px-4 py-4 text-right text-rose-700 dark:text-rose-300">{money(row.directMatterCosts)}</td>
                  <td className={`profitability-number-cell px-4 py-4 text-right font-semibold ${tone(row.grossContribution)}`}>{money(row.grossContribution)}</td>
                  <td className={`profitability-number-cell px-4 py-4 text-right font-semibold ${tone(row.contributionMargin)}`}>{percentage(row.contributionMargin)}</td>
                  <td className="px-4 py-4"><span className="profitability-allocation-status" title="Direct matter costs are recorded. Staff and overhead allocation is not configured, so net contribution is not estimated.">Direct costs only</span></td>
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
    <section className="profitability-card profitability-data-card overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="profitability-table-header profitability-staff-header border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div>
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">Staff performance & revenue attribution</h2>
        </div>
        <div className="profitability-staff-controls">
          <label><span>Role</span><select value={role} onChange={(event) => setRole(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-500 transition focus:ring-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"><option value="all">All roles</option>{roles.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
          <label><span className="sr-only">Sort staff</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-500 transition focus:ring-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"><option value="fees">Highest attributed fees</option><option value="matters">Most matters completed</option><option value="overdue">Most overdue matters</option></select></label>
          <label className="profitability-staff-search"><span className="sr-only">Search staff</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff…" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-500 transition focus:ring-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
        </div>
      </div>
      {!filtered.length ? <div className="px-5 py-12 text-center text-sm text-slate-500 dark:text-slate-400">No staff records match the selected filters.</div> : (
        <div className="profitability-table-wrap overflow-x-auto">
          <table className="profitability-financial-table profitability-retainer-table profitability-staff-table min-w-[1574px] w-full text-sm">
            <colgroup>
              <col className="profitability-col-row-number" /><col className="profitability-col-staff" /><col className="profitability-col-small-number" /><col className="profitability-col-small-number" /><col className="profitability-col-timing" /><col className="profitability-col-small-number" /><col className="profitability-col-money" /><col className="profitability-col-money" /><col className="profitability-col-money" /><col className="profitability-col-ratio" /><col className="profitability-col-money" />
            </colgroup>
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:bg-slate-800/80 dark:text-slate-400"><tr>
              <th scope="col" className="px-3 py-3 text-center">#</th><th scope="col" className="px-5 py-3">Staff member</th><th scope="col" className="px-4 py-3 text-right">Active matters</th><th scope="col" className="px-4 py-3 text-right">Matters completed</th><th scope="col" className="px-4 py-3 text-right">Early / on time / late</th><th scope="col" className="px-4 py-3 text-right">Overdue matters</th><th scope="col" className="px-4 py-3 text-right">Collected fee base</th><th scope="col" className="px-4 py-3 text-right">Fees attributed</th><th scope="col" className="px-4 py-3 text-right">Firm retained</th><th scope="col" className="px-4 py-3 text-right">Attribution ratio</th><th scope="col" className="px-4 py-3 text-right">Staff net profit</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visible.map((member, index) => {
                const collectedBase = member.grossFeesHandled ?? member.invoicePaymentsReceived ?? 0;
                const attributedFees = member.revenueAttributed ?? member.earnedFees ?? 0;
                const firmRetained = member.firmRetainedEarnings ?? Math.max(0, collectedBase - attributedFees);
                const attributionRatio = member.contributionRatio ?? (collectedBase > 0 ? (attributedFees / collectedBase) * 100 : null);
                return <tr key={member.id} className="transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="profitability-row-number px-3 py-4 text-center">{(safePage - 1) * PAGE_SIZE + index + 1}</td>
                  <td className="px-5 py-4"><p className="profitability-table-identifier font-semibold text-slate-900 dark:text-slate-100" title={member.name}>{member.name}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{member.role} · {member.earningRoleLabel || 'Fee-attribution role'}{member.earningSharePercent != null ? ` · ${member.earningSharePercent}% configured share` : ''}</p></td>
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
  const [range, setRange] = useState<ProfitabilityPeriod>('ytd');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const revision = useSyncExternalStore(subscribeDataChanges, getDataRevision);
  const [focusKey, setFocusKey] = useState(0);
  const snapshots = useRef(new Map<string, { financial?: ProfitabilityResponse; staff?: FirmReportResponse }>());
  const refreshed = useRef(0);
  const [result, setResult] = useState<{ key: string; financial?: ProfitabilityResponse; staff?: FirmReportResponse } | null>(null);
  const [failure, setFailure] = useState({ key: '', message: '' });
  const reportView = tab === 'staff' ? 'staff' : 'financial';
  const params = { range, from: range === 'custom' ? from : undefined, to: range === 'custom' ? to : undefined };
  const scopeKey = [profitabilityScopeKey(params), revision, refreshKey].join(':');
  const reportKey = `${reportView}:${scopeKey}`;
  const customError = range !== 'custom' ? '' : !from || !to ? 'Choose both a From date and a To date to load this report.' : from > to ? 'The From date must be on or before the To date.' : '';
  const snapshot = snapshots.current.get(scopeKey);
  const data = snapshot?.financial || (result?.key === reportKey ? result.financial : null);
  const staffReport = snapshot?.staff || (result?.key === reportKey ? result.staff : null);
  const error = failure.key === reportKey ? failure.message : '';
  const busy = !customError && !error && !(reportView === 'staff' ? staffReport : data);
  const permitted = managementRoles.includes(userRole);
  usePageTitle(tab === 'staff' ? 'Staff profitability' : 'Profitability');

  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    const refreshOnFocus = () => setFocusKey(value => value + 1);
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, []);

  useEffect(() => {
    if (!permitted || customError) return;
    const controller = new AbortController();
    const force = refreshed.current !== refreshKey;
    refreshed.current = refreshKey;
    setFailure({ key: reportKey, message: '' });
    const receive = (value: { financial?: ProfitabilityResponse; staff?: FirmReportResponse }) => {
      if (controller.signal.aborted) return;
      while (snapshots.current.size > 6) snapshots.current.delete(snapshots.current.keys().next().value!);
      const combined = { ...snapshots.current.get(scopeKey), ...value };
      snapshots.current.set(scopeKey, combined);
      setResult({ key: reportKey, ...combined });
    };
    // Prepare both views once per period. Matter/client/practice share the
    // financial response; staff no longer discards it or waits for a click.
    void readFinancialProfitability(params, force).then(financial => receive({ financial })).catch(error => {
      if (!controller.signal.aborted && reportView === 'financial') setFailure({ key: reportKey, message: error.message });
    });
    void readStaffProfitability(params, force).then(staff => receive({ staff })).catch(error => {
      if (!controller.signal.aborted && reportView === 'staff') setFailure({ key: reportKey, message: error.message });
    });
    return () => controller.abort();
  }, [permitted, reportKey, customError, focusKey]);

  if (!permitted) return <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><h1 className="text-xl font-semibold">Access denied</h1><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">You do not have permission to view Billing & Finance profitability.</p></div>;

  const firm = data?.firm;
  const scopeLabel = data?.range.label || (staffReport ? range === 'all' ? 'All time' : `${staffReport.range.from} → ${staffReport.range.to}` : '');
  const inputClass = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100';

  return (
    <div className="profitability-page space-y-5 pb-8" aria-busy={busy}>
      <header className="profitability-page-header">
        <Link to="/billing" className="profitability-back-link mb-3 inline-flex items-center gap-2"><ArrowLeft className="h-4 w-4" />Billing & Finance</Link>
        <div className="profitability-identity flex items-center gap-3">
          <div className="rounded-xl bg-blue-700 p-2.5 text-white"><BarChart3 className="h-5 w-5" /></div>
          <div><h1>{tab === 'staff' ? 'Staff profitability' : 'Profitability'}</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Understand revenue, costs and staff contribution for your selected period.</p></div>
        </div>
      </header>

      <section className="profitability-filter-bar" aria-label="Report filters">
        <div className="profitability-period-controls">
          <label><span><CalendarDays className="h-4 w-4" />Reporting period</span>
            <select value={range} onChange={event => setRange(event.target.value as ProfitabilityPeriod)} className={inputClass}>
              {REPORT_PERIOD_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {range === 'custom' && <>
            <label><span>From</span><input type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} className={inputClass} /></label>
            <label><span>To</span><input type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} className={inputClass} /></label>
          </>}
          <button type="button" onClick={() => setRefreshKey(value => value + 1)} disabled={busy || Boolean(customError)} className="profitability-refresh"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Refresh</button>
        </div>
        <p className="profitability-scope" role="status" aria-live="polite">{customError || (busy ? 'Loading selected period…' : error ? 'Report could not be loaded.' : `${scopeLabel} · RWF · ${data?.timeZone || 'Africa/Kigali'}`)}</p>
      </section>

      <nav className="profitability-tabs overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-900" aria-label="Profitability reports">
        <div className="flex min-w-max gap-1">{tabs.map(item => {
          const Icon = item.icon; const active = tab === item.id;
          return <button key={item.id} type="button" aria-pressed={active} onClick={() => setTab(item.id)} className={`profitability-tab inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${active ? 'bg-blue-700 text-white is-active' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}><Icon className="h-4 w-4" />{item.label}</button>;
        })}</div>
      </nav>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">{error} Use Refresh to try again.</div>}
      {customError && <p className="profitability-empty">{customError}</p>}
      {busy && <Skeleton />}
      {!busy && !error && !customError && <>

        {tab === 'overview' && firm && data && <div className="space-y-5">
          <section className="profitability-financial-summary rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
            <div className="profitability-hero-main"><div><p className="profitability-hero-label">Net profit in period</p><h2>{money(firm.netProfit)}</h2><p className="profitability-hero-description">Collected revenue less recorded costs and accrued retainer staff TPA.</p></div><span className="profitability-hero-art"><BarChart3 className="h-8 w-8" /></span></div>
            <div className="profitability-hero-stat-grid">
              <div className="is-emerald"><span className="profitability-hero-stat-icon"><Percent className="h-5 w-5" /></span><div><span>Net profit margin</span><strong>{percentage(firm.netProfitMargin)}</strong></div></div>
              <div className="is-violet"><span className="profitability-hero-stat-icon"><Wallet className="h-5 w-5" /></span><div><span>Gross contribution</span><strong>{money(firm.grossContribution)}</strong></div></div>
              <div className="is-amber"><span className="profitability-hero-stat-icon"><CircleHelp className="h-5 w-5" /></span><div><span>Cost ratio</span><strong>{percentage(firm.costRatio)}</strong></div></div>
            </div>
          </section>
          <section>
            <h2 className="profitability-section-title">Revenue & receivables</h2>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              <MetricCard icon={FileText} label="New contract value" value={money(firm.contractValue)} detail="Agreed fees on matters entered in the period." />
              <MetricCard icon={FileText} accent="emerald" label="Fees billed" value={money(firm.billed)} detail="Invoice entries and retainer fees in the period." />
              <MetricCard icon={Wallet} accent="violet" label="Collected revenue" value={money(firm.recognisedCollectedRevenue)} detail="Payments recorded in the period." valueClass="text-emerald-700 dark:text-emerald-300" />
              <MetricCard icon={Wallet} accent="rose" label="Receivables at period end" value={money(firm.totalReceivables)} detail="Includes unpaid balances from earlier periods." valueClass="text-amber-700 dark:text-amber-300" />
              <MetricCard icon={Percent} accent="emerald" label="Collection rate" value={percentage(firm.collectionRate)} detail="Period payments ÷ period billing; may exceed 100%." />
              <MetricCard icon={BriefcaseBusiness} label="Active matters entered" value={number(firm.activeMatters)} detail="Matters entered in the period that are currently open." />
            </div>
          </section>
          <section className="grid gap-4 xl:grid-cols-2"><CostStructurePanel firm={firm} /><ReceivablesAgeingPanel ageing={data.ageing} total={firm.totalReceivables} /></section>
          <details className="profitability-retainers"><summary>Retainer performance</summary><RetainerPerformancePanel data={data.retainer} /></details>
        </div>}

        {tab === 'matters' && <FinancialTable title="Matter profitability" rows={data?.matterRows || []} kind="matter" />}
        {tab === 'clients' && <FinancialTable title="Client profitability" rows={data?.clientRows || []} kind="client" />}
        {tab === 'practice' && <FinancialTable title="Practice area profitability" rows={data?.practiceAreaRows || []} kind="practice" />}
        {tab === 'staff' && staffReport && <div className="space-y-4">
          <section className="profitability-staff-summary">
            <MetricCard icon={UsersRound} label="Staff members" value={number(staffReport.team.length)} detail="Active staff registered by the report end." />
            <MetricCard icon={Wallet} accent="emerald" label="Attributed fees" value={money(staffReport.team.reduce((sum, member) => sum + (member.revenueAttributed ?? member.earnedFees ?? 0), 0))} detail="Earned from work completed in this period." valueClass="text-emerald-700 dark:text-emerald-300" />
            <MetricCard icon={FileText} accent="violet" label="Collected work base" value={money(staffReport.team.reduce((sum, member) => sum + (member.grossFeesHandled ?? member.invoicePaymentsReceived ?? 0), 0))} detail="Collected base attributed to staff work in the period." />
            <MetricCard icon={Clock} accent="amber" label="Overdue matters entered" value={number(staffReport.team.reduce((sum, member) => sum + (member.overdueTasks || 0), 0))} detail="Period entries still open with a deadline before the report end." valueClass="text-amber-700 dark:text-amber-300" />
          </section>
          <StaffDashboardTable members={staffReport.team} />
          <p className="profitability-table-note">Staff costs and overhead allocations are not configured. Net contribution is unavailable.</p>
        </div>}
      </>}
    </div>
  );
}
