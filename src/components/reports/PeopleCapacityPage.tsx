import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Filter, Search, UsersRound, X } from 'lucide-react';

import { UserRole } from '../../App';
import { getAllCases, CaseData } from '../../services/caseService';
import { getStaffUsers, User } from '../../services/userService';
import { FirmReportRange, getFirmReports, FirmReportResponse } from '../../services/firmReportsService';
import { resolveDeadlineDateTime } from '../../utils/workflowDeadline';
import usePageTitle from '../../hooks/usePageTitle';
import SortableHeader from '../ui/SortableHeader';
import TableExport from '../ui/TableExport';
import { SortDir, sortRows } from '../../utils/tableSort';

export type PeopleCapacityView = 'all-staff' | 'headcount' | 'capacity' | 'utilisation' | 'timeliness' | 'performance-quality' | 'staff-contribution' | 'staff-cost' | 'remuneration' | 'training-development' | 'recruitment-retention';

const PAGE_SIZE = 10;
const managementRoles: UserRole[] = ['managing_director', 'managing_partner', 'executive_managing_partner'];
const titles: Record<PeopleCapacityView, { title: string; description: string }> = {
  'all-staff': { title: 'All Staff', description: 'Active and inactive staff from the authoritative user directory.' },
  headcount: { title: 'Headcount', description: 'Active staff headcount grouped by the roles recorded in the user directory.' },
  capacity: { title: 'Capacity', description: 'Workload of every staff member, banded exactly as the management dashboard (Available <= 3, Committed 4-8, Overloaded > 8 open matters).' },
  utilisation: { title: 'Utilisation', description: 'Average share of allotted time each member used on completed work in the selected period.' },
  timeliness: { title: 'Timeliness', description: 'On-time completion from Key Actions with a valid due date and completion timestamp.' },
  'performance-quality': { title: 'Performance & Quality', description: 'Average matter Quality Score entered through Case Management, plus on-time completion.' },
  'staff-contribution': { title: 'Staff Contribution', description: 'Revenue and fee attribution from the existing Firm Reports productivity calculations.' },
  'staff-cost': { title: 'Staff Cost', description: 'Staff cost information for the selected period.' },
  remuneration: { title: 'Remuneration', description: 'Staff earnings are reported by the period in which each Key Action was completed. Open the Staff Earnings report for the full, itemised calculation.' },
  'training-development': { title: 'Training & Development', description: 'Training hours and required-training records are not present in the current HR data model.' },
  'recruitment-retention': { title: 'Recruitment & Retention', description: 'Recruitment actions, departures and historical opening staff are not present in the current HR data model.' },
};

/**
 * Views that genuinely have no source data in the current system. Everything
 * else is rendered from real records; Remuneration is intentionally NOT listed
 * here because accurate earned fees exist in Firm Reports.
 */
const UNSUPPORTED_VIEWS: PeopleCapacityView[] = ['staff-cost', 'training-development', 'recruitment-retention'];

/** A report team member as returned by the Firm Reports API. */
type ReportMember = NonNullable<FirmReportResponse['team']>[number];

type StaffRow = {
  staff: User;
  assigned: number;
  active: number;
  open: number;
  completed: number;
  overdue: number;
  onTimeTasks: number;
  earlyTasks: number;
  lateTasks: number;
  completedWithDue: number;
  onTime: number;
  quality: number[];
  averageTimeUsedPercent: number | null;
  earningSharePercent: number | null;
  contribution: number;
  firmRetainedEarnings: number;
  feesEarned: number;
};

const normalize = (value?: string | null) => String(value || '').trim().toLowerCase();
const money = (value: number) => `RWF ${Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-US')}`;
const pct = (value: number | null) => value == null || !Number.isFinite(value) ? '-' : `${Math.round(value)}%`;
const rate = (numerator: number, denominator: number) => denominator > 0 ? (numerator / denominator) * 100 : null;

/** Task = whole case: a case is "closed" when it is operationally closed. */
const isClosedCase = (c: CaseData) => String(c.status || '').toLowerCase() === 'closed';
/** Task = whole case: a matter is complete only when the whole workflow is complete. */
const caseCompleted = (c: CaseData) =>
  String(c.workflowProgress?.status || '').toLowerCase() === 'completed' || isClosedCase(c);
/** The assignment identities a member can own on a matter (mirrors caseMatchesAssignee). */
const caseIdentities = (c: CaseData): string[] =>
  [c.assignedTo, c.caseAssignments?.initiator, c.caseAssignments?.reviewer, c.caseAssignments?.signerApprover]
    .map(normalize)
    .filter(Boolean);
const caseNextDue = (c: CaseData) =>
  resolveDeadlineDateTime(c.workflowProgress?.currentStepDueAt || c.workflowProgress?.nextDueAt);

/** Capacity band thresholds shared with the management dashboard. */
const capacityBand = (open: number) => (open <= 3 ? 'Available' : open <= 8 ? 'Committed' : 'Overloaded');
const capacityBandClass = (band: string) =>
  band === 'Available' ? 'text-emerald-700' : band === 'Committed' ? 'text-amber-700' : 'text-red-700';

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-500">{hint}</div> : null}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-52 animate-pulse rounded bg-gray-200" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="h-3 w-20 animate-pulse rounded bg-gray-200" />
            <div className="mt-3 h-8 w-20 animate-pulse rounded bg-gray-200" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white p-4">
        <div className="grid gap-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex gap-3 py-2">
              <div className="h-8 w-8 animate-pulse rounded bg-gray-200" />
              <div className="h-8 flex-1 animate-pulse rounded bg-gray-200" />
              <div className="hidden h-8 w-28 animate-pulse rounded bg-gray-200 md:block" />
              <div className="hidden h-8 w-28 animate-pulse rounded bg-gray-200 lg:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Pagination({ page, pages, total, onChange }: { page: number; pages: number; total: number; onChange: (page: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-4 text-sm text-gray-600"><span>Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total}</span><div className="flex gap-1"><button type="button" disabled={page === 1} onClick={() => onChange(page - 1)} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Previous</button>{Array.from({ length: pages }, (_, index) => index + 1).map((number) => <button type="button" key={number} onClick={() => onChange(number)} className={`rounded border px-3 py-1.5 ${number === page ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white'}`}>{number}</button>)}<button type="button" disabled={page === pages} onClick={() => onChange(page + 1)} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Next</button></div></div>;
}

export default function PeopleCapacityPage({ view, userRole }: { view: PeopleCapacityView; userRole: UserRole }) {
  const detail = titles[view];
  const [staff, setStaff] = useState<User[]>([]);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [report, setReport] = useState<FirmReportResponse | null>(null);
  const [range, setRange] = useState<FirmReportRange>('monthly');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [memberFilter, setMemberFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const permitted = managementRoles.includes(userRole);
  const unsupported = UNSUPPORTED_VIEWS.includes(view);

  usePageTitle(detail.title);

  useEffect(() => {
    if (!permitted) return;
    if (range === 'custom' && (!customFrom || !customTo)) return;
    let mounted = true;
    setLoading(true);
    // Fees / timeliness / utilisation are loaded for every supported view so the
    // table always shows each member's real figures for the selected period.
    const dataRequests: [Promise<User[]>, Promise<CaseData[]>, Promise<FirmReportResponse | null>] = [
      getStaffUsers({ includeInactive: true }),
      unsupported ? Promise.resolve([]) : getAllCases(),
      // Payment-date basis - the same basis the staff dashboards use.
      getFirmReports({
        range,
        basis: 'paymentDate',
        from: range === 'custom' ? customFrom : undefined,
        to: range === 'custom' ? customTo : undefined,
      }).catch(() => null),
    ];
    Promise.all(dataRequests)
      .then(([staffData, caseData, reportData]) => {
        if (!mounted) return;
        setStaff(staffData); setCases(caseData); setReport(reportData);
      })
      .catch((loadError: any) => mounted && setError(loadError?.message || 'Failed to load people and capacity data.'))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [permitted, range, customFrom, customTo, view, unsupported]);

  // Single pass over all cases, grouped by each assignment identity. This keeps
  // the per-member lookup O(1) instead of re-filtering every case per staff
  // member (which was O(staff x cases)).
  const casesByName = useMemo(() => {
    const map = new Map<string, CaseData[]>();
    for (const c of cases) {
      for (const id of new Set(caseIdentities(c))) {
        const bucket = map.get(id);
        if (bucket) bucket.push(c);
        else map.set(id, [c]);
      }
    }
    return map;
  }, [cases]);

  const reportByName = useMemo(() => {
    const map = new Map<string, ReportMember>();
    for (const member of report?.team || []) map.set(normalize(member.name), member);
    return map;
  }, [report]);

  // Task = whole case: workload, completion and overdue are all counted on
  // matters (cases), never on the staged per-Key-Action task records.
  const rows = useMemo<StaffRow[]>(() => staff.map((person) => {
    const name = normalize(person.name);
    const personCases = casesByName.get(name) || [];
    const completed = personCases.filter(caseCompleted);
    const open = personCases.filter((c) => !caseCompleted(c) && !isClosedCase(c));
    const overdue = open.filter((c) => {
      const due = caseNextDue(c);
      return Boolean(due && due.getTime() < Date.now());
    });
    const quality = personCases
      .filter((c) => c.caseManagement?.qualityScore != null && Number.isFinite(Number(c.caseManagement.qualityScore)))
      .map((c) => Number(c.caseManagement.qualityScore));

    // Timeliness comes from the Firm Reports team record - the same calculation
    // used on every staff dashboard. On-time = early + on-time; the denominator
    // is every completed Key Action that had a valid due date.
    const member = reportByName.get(name);
    const earlyTasks = member?.earlyTasks || 0;
    const onTimeTasks = member?.onTimeTasks || 0;
    const lateTasks = member?.lateTasks || 0;
    const completedWithDue = earlyTasks + onTimeTasks + lateTasks;

    return {
      staff: person,
      assigned: personCases.length,
      active: personCases.filter((c) => !isClosedCase(c)).length,
      open: open.length,
      completed: completed.length,
      overdue: overdue.length,
      onTimeTasks,
      earlyTasks,
      lateTasks,
      completedWithDue,
      onTime: earlyTasks + onTimeTasks,
      quality,
      averageTimeUsedPercent: member?.averageTimeUsedPercent ?? null,
      earningSharePercent: member?.earningSharePercent ?? null,
      contribution: member?.revenueAttributed || member?.earnedFees || 0,
      firmRetainedEarnings: member?.firmRetainedEarnings || 0,
      feesEarned: member?.earnedFees || 0,
    };
  }), [casesByName, reportByName, staff]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    const term = normalize(search);
    const searchable = `${row.staff.name} ${row.staff.email} ${row.staff.role}`.toLowerCase();
    return (!term || searchable.includes(term)) && (role === 'all' || row.staff.role === role) && (memberFilter === 'all' || normalize(row.staff.name) === memberFilter) && (activeFilter === 'all' || (activeFilter === 'active' ? row.staff.isActive : !row.staff.isActive));
  }), [activeFilter, memberFilter, role, rows, search]);

  const hasActiveFilters = Boolean(search) || role !== 'all' || memberFilter !== 'all' || activeFilter !== 'all';
  const clearFilters = () => { setSearch(''); setRole('all'); setMemberFilter('all'); setActiveFilter('all'); };

  const [sortKey, setSortKey] = useState('staff');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const handleSort = (column: string) => {
    if (sortKey === column) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(column); setSortDir('asc'); }
  };

  const avgQuality = (row: StaffRow) => (row.quality.length ? row.quality.reduce((sum, value) => sum + value, 0) / row.quality.length : null);
  const onTimePercent = (row: StaffRow) => rate(row.onTime, row.completedWithDue);

  // The "Metric" column relabels per view so its heading matches what it shows.
  const metricColumn: { label: string; value: (row: StaffRow) => string } = (() => {
    switch (view) {
      case 'staff-contribution': return { label: 'Revenue Attributed', value: (row) => money(row.contribution) };
      case 'remuneration': return { label: 'Earning Share', value: (row) => (row.earningSharePercent == null ? '-' : `${row.earningSharePercent}%`) };
      case 'capacity': return { label: 'Workload', value: (row) => `${row.open} open` };
      case 'utilisation': return { label: 'Time Used', value: (row) => pct(row.averageTimeUsedPercent) };
      case 'timeliness': return { label: 'On Time', value: (row) => pct(onTimePercent(row)) };
      case 'performance-quality': return { label: 'Avg Quality', value: (row) => pct(avgQuality(row)) };
      default: return { label: 'Assigned', value: (row) => String(row.assigned) };
    }
  })();

  const staffSortValueOf = (row: StaffRow, key: string): unknown => {
    switch (key) {
      case 'staff':
        return row.staff.name || '';
      case 'role':
        return `${row.staff.role || ''} ${row.staff.isActive ? 'Active' : 'Inactive'}`;
      case 'assigned':
        return row.assigned;
      case 'completed':
        return row.completed;
      case 'overdue':
        return row.overdue;
      case 'quality':
        return avgQuality(row) ?? -1;
      case 'timeliness':
        return onTimePercent(row) ?? -1;
      case 'utilisation':
        return row.averageTimeUsedPercent ?? -1;
      case 'contribution':
        return row.contribution;
      case 'feesEarned':
        return row.feesEarned;
      case 'metric':
        if (view === 'staff-contribution') return row.contribution;
        if (view === 'capacity') return row.open;
        if (view === 'utilisation') return row.averageTimeUsedPercent ?? -1;
        if (view === 'timeliness') return onTimePercent(row) ?? -1;
        if (view === 'performance-quality') return avgQuality(row) ?? -1;
        if (view === 'remuneration') return row.earningSharePercent ?? -1;
        return row.assigned;
      default:
        return row.staff.name || '';
    }
  };
  const sortedRows = useMemo(
    () => sortRows(filteredRows, sortKey, sortDir, (row) => staffSortValueOf(row, sortKey)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredRows, sortDir, sortKey, view],
  );
  const pages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const visibleRows = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => setPage(1), [activeFilter, memberFilter, range, role, search, sortDir, sortKey, view]);
  useEffect(() => setPage((currentPage) => Math.min(currentPage, pages)), [pages]);

  const totals = useMemo(() => {
    const active = staff.filter((person) => person.isActive).length;
    const inactive = staff.length - active;
    const completedWithDue = rows.reduce((sum, row) => sum + row.completedWithDue, 0);
    const onTime = rows.reduce((sum, row) => sum + row.onTime, 0);
    const timeUsedValues = rows.map((row) => row.averageTimeUsedPercent).filter((v): v is number => v != null && Number.isFinite(v));
    return {
      active,
      inactive,
      assigned: rows.reduce((sum, row) => sum + row.assigned, 0),
      completed: rows.reduce((sum, row) => sum + row.completed, 0),
      open: rows.reduce((sum, row) => sum + row.open, 0),
      overdue: rows.reduce((sum, row) => sum + row.overdue, 0),
      completedWithDue,
      onTime,
      quality: (() => { const all = rows.flatMap((row) => row.quality); return all.length ? all.reduce((sum, value) => sum + value, 0) / all.length : null; })(),
      timeUsed: timeUsedValues.length ? timeUsedValues.reduce((sum, value) => sum + value, 0) / timeUsedValues.length : null,
      contribution: rows.reduce((sum, row) => sum + row.contribution, 0),
      firmRetained: rows.reduce((sum, row) => sum + row.firmRetainedEarnings, 0),
      feesEarned: rows.reduce((sum, row) => sum + row.feesEarned, 0),
    };
  }, [rows, staff]);

  const reportRowsCount = report?.team?.length || 0;
  const periodLabel = report?.range ? `${report.range.from.slice(0, 10)} to ${report.range.to.slice(0, 10)}` : 'period unavailable';

  // The primary KPI card changes with the view so the headline figure always
  // matches what the table below is measuring.
  const headline = (() => {
    switch (view) {
      case 'capacity': return { label: 'Open matters', value: String(totals.open), hint: `${totals.overdue} overdue` };
      case 'utilisation': return { label: 'Avg time used', value: pct(totals.timeUsed), hint: 'Share of allotted time used' };
      case 'timeliness': return { label: 'On-time completion', value: pct(rate(totals.onTime, totals.completedWithDue)), hint: `${totals.completedWithDue} key actions scored` };
      case 'performance-quality': return { label: 'Avg quality', value: pct(totals.quality), hint: 'Matter Quality Score' };
      case 'staff-contribution': return { label: 'Total contribution', value: money(totals.contribution), hint: `${money(totals.firmRetained)} retained by firm` };
      case 'remuneration': return { label: 'Total earnings', value: money(totals.feesEarned), hint: 'Selected period' };
      default: return { label: 'Assigned matters', value: String(totals.assigned), hint: `${totals.completed} completed` };
    }
  })();

  if (!permitted) return <div className="rounded-lg border border-gray-200 bg-white p-6"><h1 className="text-xl font-semibold text-gray-900">Access denied</h1><p className="mt-2 text-gray-600">You do not have permission to view People & Capacity.</p></div>;
  if (loading) return <LoadingSkeleton />;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link to="/management/people?view=all-staff" className="mb-3 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft size={16} /> People &amp; Capacity
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">{detail.title}</h1>
          <p className="mt-1 max-w-2xl text-gray-600">{detail.description}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500" htmlFor="people-range">Period</label>
            <select id="people-range" value={range} onChange={(event) => setRange(event.target.value as FirmReportRange)} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
              <option value="ytd">Year to date</option>
              <option value="custom">Custom range</option>
            </select>
          </div>
          {range === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm" aria-label="Period from" />
              <span className="text-sm text-gray-500">to</span>
              <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm" aria-label="Period to" />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-5 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={17} /> {error}
        </div>
      )}

      {view === 'remuneration' && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-600">Staff earnings are calculated from completed Key Actions, the paid-collection cap and the TPA x timeliness x quality rule, attributed to the period each Key Action was completed in ({periodLabel}).</p>
          <Link to={`/billing/finance/remuneration/fee-earned?range=${range}`} className="mt-3 inline-flex items-center gap-2 rounded border border-gray-800 bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">Open Staff Earnings report</Link>
        </div>
      )}

      {!unsupported && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Active staff" value={String(totals.active)} />
            <Metric label="Inactive staff" value={String(totals.inactive)} />
            <Metric label={headline.label} value={headline.value} hint={headline.hint} />
            <Metric label="Fees earned (period)" value={money(totals.feesEarned)} hint={periodLabel} />
          </div>

          {(view === 'headcount' || view === 'all-staff') && (
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Total staff" value={String(staff.length)} />
              <Metric label="Active headcount" value={String(totals.active)} />
              <Metric label="Inactive staff" value={String(totals.inactive)} />
              <Metric label="Roles represented" value={String(new Set(staff.map((person) => person.role)).size)} />
            </div>
          )}

          {view === 'performance-quality' && (
            <p className="mb-5 rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
              Figures are for {periodLabel}{reportRowsCount ? `   ${reportRowsCount} staff attribution records` : ''}. Quality is the matter Quality Score entered through Case Management.
            </p>
          )}
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff name, email or role..." className="w-full rounded-md border border-gray-300 py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-gray-400" />
            </div>
            <select value={role} onChange={(event) => setRole(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="all">All roles</option>
              {Array.from(new Set(staff.map((person) => person.role))).sort().map((staffRole) => <option key={staffRole} value={staffRole}>{staffRole}</option>)}
            </select>
            <select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" aria-label="Team member">
              <option value="all">All members</option>
              {staff.map((person) => <option key={person._id} value={normalize(person.name)}>{person.name}</option>)}
            </select>
            {view === 'all-staff' && (
              <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as typeof activeFilter)} className="rounded-md border border-gray-300 px-3 py-2 text-sm" aria-label="Status">
                <option value="all">All status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            )}
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
                <X size={15} /> Clear
              </button>
            )}
          </div>
          <div className="mt-6 max-w-full overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500"><Filter size={14} /> {sortedRows.length} of {rows.length} staff</span>
              {sortedRows.length > 0 && (
                <TableExport
                  filename={`people_capacity_${view}`}
                  title={detail.title}
                  subtitle={`${sortedRows.length} staff   ${periodLabel}`}
                  columns={[
                    { label: 'Staff', value: (row: StaffRow) => row.staff.name || '' },
                    { label: 'Email', value: (row: StaffRow) => row.staff.email || '' },
                    { label: 'Role', value: (row: StaffRow) => row.staff.role || '' },
                    { label: 'Status', value: (row: StaffRow) => (row.staff.isActive ? 'Active' : 'Inactive') },
                    { label: 'Assigned', value: (row: StaffRow) => String(row.assigned) },
                    { label: 'Completed', value: (row: StaffRow) => String(row.completed) },
                    { label: 'Overdue', value: (row: StaffRow) => String(row.overdue) },
                    { label: 'Avg Quality', value: (row: StaffRow) => pct(avgQuality(row)) },
                    { label: 'On Time', value: (row: StaffRow) => pct(onTimePercent(row)) },
                    { label: metricColumn.label, value: (row: StaffRow) => metricColumn.value(row) },
                    { label: 'Fees Earned', value: (row: StaffRow) => money(row.feesEarned) },
                  ]}
                  rows={sortedRows}
                />
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[1040px] w-full table-fixed text-left text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="w-10 px-3 py-3">#</th>
                    <SortableHeader label="Staff" column="staff" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-48 px-3 py-3" />
                    <SortableHeader label="Role / Status" column="role" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-40 px-3 py-3" />
                    <SortableHeader label="Assigned / Open" column="assigned" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-32 px-3 py-3" />
                    <SortableHeader label="Completed / Overdue" column="completed" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-40 px-3 py-3" />
                    <SortableHeader label="Quality / On Time" column="quality" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-40 px-3 py-3" />
                    <SortableHeader label={metricColumn.label} column="metric" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-32 px-3 py-3" />
                    <SortableHeader label="Fees Earned" column="feesEarned" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-32 px-3 py-3" />
                    <th className="w-24 px-3 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr><td colSpan={9} className="p-10 text-center text-sm text-gray-500">{hasActiveFilters ? 'No staff match the current filters.' : 'No staff records found.'}</td></tr>
                  ) : visibleRows.map((row, index) => {
                    const band = capacityBand(row.open);
                    return (
                      <tr key={row.staff._id} className="border-t border-gray-100 align-top hover:bg-gray-50">
                        <td className="px-3 py-4 text-gray-500">{(page - 1) * PAGE_SIZE + index + 1}</td>
                        <td className="px-3 py-4">
                          <div className="truncate font-medium text-gray-900" title={row.staff.name}>{row.staff.name}</div>
                          <div className="truncate text-xs text-gray-500" title={row.staff.email}>{row.staff.email}</div>
                        </td>
                        <td className="px-3 py-4">
                          <div className="truncate" title={row.staff.role}>{row.staff.role}</div>
                          <span className={`text-xs font-medium ${row.staff.isActive ? 'text-emerald-700' : 'text-gray-500'}`}>{row.staff.isActive ? 'Active' : 'Inactive'}</span>
                        </td>
                        <td className="px-3 py-4">
                          <div className="font-medium text-gray-900">{row.assigned} total</div>
                          <div className="text-xs text-gray-500">{row.open} open</div>
                        </td>
                        <td className="px-3 py-4">
                          <div className="truncate">{row.completed} completed</div>
                          <div className={`text-xs ${row.overdue > 0 ? 'text-red-700' : 'text-gray-500'}`}>{row.overdue} overdue</div>
                        </td>
                        <td className="px-3 py-4">
                          <div className="truncate">{pct(avgQuality(row))}</div>
                          <div className="text-xs text-gray-500">{pct(onTimePercent(row))} on time</div>
                        </td>
                        <td className="px-3 py-4">
                          <div className="font-semibold text-gray-900">{metricColumn.value(row)}</div>
                          {view === 'capacity' && <div className={`text-xs font-medium ${capacityBandClass(band)}`}>{band}</div>}
                        </td>
                        <td className="px-3 py-4 font-semibold text-green-700">{money(row.feesEarned)}</td>
                        <td className="px-3 py-4">
                          <button type="button" onClick={() => setMemberFilter(normalize(row.staff.name))} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline" title={`Focus the table on ${row.staff.name}`}>
                            <UsersRound size={15} /> View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredRows.length > 0 && <Pagination page={page} pages={pages} total={filteredRows.length} onChange={setPage} />}
          </div>
        </>
      )}

      {unsupported && (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          No {detail.title.toLowerCase()} data is available. The current HR data model does not record this information, and this page does not substitute task or revenue data for HR values.
        </div>
      )}
    </div>
  );
}
