import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Search, UsersRound } from 'lucide-react';

import { UserRole } from '../../App';
import { getAllTasks, TaskData } from '../../services/taskService';
import { getStaffUsers, User } from '../../services/userService';
import { FirmReportRange, getFirmReports, FirmReportResponse } from '../../services/firmReportsService';
import { resolveDeadlineDateTime } from '../../utils/workflowDeadline';
import usePageTitle from '../../hooks/usePageTitle';

export type PeopleCapacityView = 'all-staff' | 'headcount' | 'capacity' | 'utilisation' | 'timeliness' | 'performance-quality' | 'staff-contribution' | 'staff-cost' | 'remuneration' | 'training-development' | 'recruitment-retention';

const PAGE_SIZE = 10;
const managementRoles: UserRole[] = ['managing_director', 'managing_partner', 'executive_managing_partner'];
const titles: Record<PeopleCapacityView, { title: string; description: string }> = {
  'all-staff': { title: 'All Staff', description: 'Active and inactive staff from the authoritative user directory.' },
  headcount: { title: 'Headcount', description: 'Active staff headcount grouped by the roles recorded in the user directory.' },
  capacity: { title: 'Capacity', description: 'Workload signals from assigned tasks and matters.' },
  utilisation: { title: 'Utilisation', description: 'Productivity indicators from task records and the existing performance/reporting model.' },
  timeliness: { title: 'Timeliness', description: 'On-time completion based on valid task completion and due dates.' },
  'performance-quality': { title: 'Performance & Quality', description: 'Performance and quality indicators from the existing firm reporting calculations.' },
  'staff-contribution': { title: 'Staff Contribution', description: 'Revenue and fee attribution from the existing Firm Reports productivity calculations.' },
  'staff-cost': { title: 'Staff Cost', description: 'Staff cost information for the selected period.' },
  remuneration: { title: 'Remuneration', description: 'Approved staff remuneration records are not present in the current data model.' },
  'training-development': { title: 'Training & Development', description: 'Training hours and required-training records are not present in the current HR data model.' },
  'recruitment-retention': { title: 'Recruitment & Retention', description: 'Recruitment actions, departures and historical opening staff are not present in the current HR data model.' },
};

type StaffRow = {
  staff: User;
  assigned: number;
  matters: number;
  completed: number;
  open: number;
  overdue: number;
  due: number;
  completedWithDue: number;
  onTime: number;
  quality: number[];
  contribution: number;
  feesEarned: number;
};

const normalize = (value?: string | null) => String(value || '').trim().toLowerCase();
const todayKey = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => `RWF ${Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-US')}`;
const pct = (value: number | null) => value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`;
const rate = (numerator: number, denominator: number) => denominator > 0 ? (numerator / denominator) * 100 : null;
const isClosed = (task: TaskData) => task.workflowStage === 'Closed';
const isCompleted = (task: TaskData) => task.status === 'Completed' || task.workflowStage === 'Completed';
const taskOnTime = (task: TaskData) => {
  if (!isCompleted(task) || !task.completedAt || !task.dueDate) return null;
  const completed = new Date(task.completedAt);
  const due = resolveDeadlineDateTime(task.dueDate);
  if (!Number.isFinite(completed.getTime()) || !due) return null;
  return completed.getTime() <= due.getTime();
};

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-gray-200 bg-white p-4"><div className="text-xs uppercase tracking-[0.16em] text-gray-500">{label}</div><div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div></div>;
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
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-4 text-sm text-gray-600"><span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span><div className="flex gap-1"><button type="button" disabled={page === 1} onClick={() => onChange(page - 1)} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Previous</button>{Array.from({ length: pages }, (_, index) => index + 1).map((number) => <button type="button" key={number} onClick={() => onChange(number)} className={`rounded border px-3 py-1.5 ${number === page ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white'}`}>{number}</button>)}<button type="button" disabled={page === pages} onClick={() => onChange(page + 1)} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Next</button></div></div>;
}

export default function PeopleCapacityPage({ view, userRole }: { view: PeopleCapacityView; userRole: UserRole }) {
  const detail = titles[view];
  const [staff, setStaff] = useState<User[]>([]);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [report, setReport] = useState<FirmReportResponse | null>(null);
  const [range, setRange] = useState<FirmReportRange>('monthly');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const permitted = managementRoles.includes(userRole);

  usePageTitle(detail.title);

  useEffect(() => {
    if (!permitted) return;
    let mounted = true;
    setLoading(true);
    const unsupportedView = ['staff-cost', 'remuneration', 'training-development', 'recruitment-retention'].includes(view);
    const needsReport = view === 'staff-contribution';
    const dataRequests: [Promise<User[]>, Promise<TaskData[]>, Promise<FirmReportResponse | null>] = [
      getStaffUsers({ includeInactive: true }),
      unsupportedView ? Promise.resolve([]) : getAllTasks(),
      needsReport ? getFirmReports({ range, basis: 'invoiceDate' }).catch(() => null) : Promise.resolve(null),
    ];
    Promise.all(dataRequests)
      .then(([staffData, taskData, reportData]) => {
        if (!mounted) return;
        setStaff(staffData); setTasks(taskData); setReport(reportData);
      })
      .catch((loadError: any) => mounted && setError(loadError?.message || 'Failed to load people and capacity data.'))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [permitted, range, view]);
  const rows = useMemo<StaffRow[]>(() => staff.map((person) => {
    const name = normalize(person.name);
    const personTasks = tasks.filter((task) => normalize(task.assignee) === name);
    const personMatters = new Set(personTasks.map((task) => task.caseId).filter(Boolean));
    const completed = personTasks.filter(isCompleted);
    const open = personTasks.filter((task) => !isCompleted(task) && !isClosed(task));
    const overdue = open.filter((task) => {
      const due = resolveDeadlineDateTime(task.dueDate);
      return Boolean(due && due.getTime() < Date.now());
    });
    const completedWithDue = completed.filter((task) => taskOnTime(task) !== null);
    const onTime = completedWithDue.filter((task) => taskOnTime(task) === true);
    const quality = personTasks.filter((task) => task.qualityScore != null && Number.isFinite(Number(task.qualityScore))).map((task) => Number(task.qualityScore));
    const reportMember = report?.team?.find((member) => normalize(member.name) === name);
    return { staff: person, assigned: personTasks.length, matters: personMatters.size, completed: completed.length, open: open.length, overdue: overdue.length, due: personTasks.filter((task) => Boolean(resolveDeadlineDateTime(task.dueDate))).length, completedWithDue: completedWithDue.length, onTime: onTime.length, quality, contribution: reportMember?.revenueAttributed || 0, feesEarned: reportMember?.earnedFees || 0 };
  }), [report, staff, tasks]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    const term = normalize(search);
    const searchable = `${row.staff.name} ${row.staff.email} ${row.staff.role}`.toLowerCase();
    return (!term || searchable.includes(term)) && (role === 'all' || row.staff.role === role) && (activeFilter === 'all' || (activeFilter === 'active' ? row.staff.isActive : !row.staff.isActive));
  }), [activeFilter, role, rows, search]);
  const pages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const visibleRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => setPage(1), [activeFilter, range, role, search, view]);
  useEffect(() => setPage((currentPage) => Math.min(currentPage, pages)), [pages]);

  const totals = useMemo(() => {
    const active = staff.filter((person) => person.isActive).length;
    const inactive = staff.length - active;
    const completed = rows.reduce((sum, row) => sum + row.completed, 0);
    const due = rows.reduce((sum, row) => sum + row.due, 0);
    const onTime = rows.reduce((sum, row) => sum + row.onTime, 0);
    const open = rows.reduce((sum, row) => sum + row.open, 0);
    const overdue = rows.reduce((sum, row) => sum + row.overdue, 0);
    const qualityScores = rows.flatMap((row) => row.quality);
    const contribution = rows.reduce((sum, row) => sum + row.contribution, 0);
    return { active, inactive, completed, due, onTime, open, overdue, quality: qualityScores.length ? qualityScores.reduce((sum, value) => sum + value, 0) / qualityScores.length : null, contribution };
  }, [rows, staff]);

  const reportRows = report?.team || [];
  const unsupported = ['staff-cost', 'remuneration', 'training-development', 'recruitment-retention'].includes(view);
  const metricForRow = (row: StaffRow) => {
    if (view === 'staff-contribution') return money(row.contribution);
    if (view === 'timeliness') return pct(rate(row.onTime, row.completedWithDue));
    if (view === 'performance-quality') return pct(row.quality.length ? row.quality.reduce((sum, value) => sum + value, 0) / row.quality.length : null);
    if (view === 'utilisation') return 'Not configured';
    if (view === 'capacity') return `${row.open} open tasks`;
    return String(row.assigned);
  };

  if (!permitted) return <div className="rounded-lg border border-gray-200 bg-white p-6"><h1 className="text-xl font-semibold text-gray-900">Access denied</h1><p className="mt-2 text-gray-600">You do not have permission to view People & Capacity.</p></div>;
  if (loading) return <LoadingSkeleton />;

  return <div><div className="mb-6 flex items-start justify-between gap-4"><div><Link to="/management/people?view=all-staff" className="mb-3 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> People & Capacity</Link><h1 className="text-2xl font-semibold text-gray-900">{detail.title}</h1><p className="mt-1 text-gray-600">{detail.description}</p></div><div className="flex items-center gap-2"><label className="text-sm text-gray-600" htmlFor="people-range">Period</label><select id="people-range" value={range} onChange={(event) => setRange(event.target.value as FirmReportRange)} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></div></div>{error && <div className="mb-5 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={17} />{error}</div>}{unsupported && <div className="mb-5 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">The current application has no authoritative {detail.title.toLowerCase()} records. This page does not substitute task or revenue data for HR values.</div>}<div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Active staff" value={String(totals.active)} /><Metric label="Inactive staff" value={String(totals.inactive)} /><Metric label={view === 'staff-contribution' ? 'Staff contribution' : view === 'timeliness' ? 'Timeliness' : view === 'performance-quality' ? 'Average quality' : 'Assigned tasks'} value={view === 'staff-contribution' ? money(totals.contribution) : view === 'timeliness' ? pct(rate(totals.onTime, totals.due)) : view === 'performance-quality' ? pct(totals.quality) : String(rows.reduce((sum, row) => sum + row.assigned, 0))} /><Metric label="Completed tasks" value={String(totals.completed)} /></div>{(view === 'headcount' || view === 'all-staff') && <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Total staff" value={String(staff.length)} /><Metric label="Active headcount" value={String(totals.active)} /><Metric label="Inactive staff" value={String(totals.inactive)} /><Metric label="Roles represented" value={String(new Set(staff.map((person) => person.role)).size)} /></div>}{view === 'performance-quality' && <div className="mb-5 rounded border border-gray-200 bg-white p-4 text-sm text-gray-600">Firm report data is loaded for the selected period: {report?.range ? `${report.range.from} to ${report.range.to}` : 'period unavailable'}{reportRows.length ? ` · ${reportRows.length} staff attribution records` : ''}.</div>}<div className="mb-5 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff name, email or role..." className="w-full rounded-md border border-gray-300 py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-gray-400" /></div><select value={role} onChange={(event) => setRole(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2"><option value="all">All roles</option>{Array.from(new Set(staff.map((person) => person.role))).sort().map((staffRole) => <option key={staffRole} value={staffRole}>{staffRole}</option>)}</select>{view === 'all-staff' && <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as typeof activeFilter)} className="rounded-md border border-gray-300 px-3 py-2"><option value="all">All status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>}</div>{unsupported ? <div className="mt-6 rounded-lg border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">No {detail.title.toLowerCase()} data available.</div> : <div className="mt-6 max-w-full overflow-hidden rounded-lg border border-gray-200 bg-white"><div className="overflow-x-auto"><table className="min-w-[960px] w-full table-fixed text-left text-sm"><thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500"><tr><th className="w-10 px-3 py-3">#</th><th className="w-44 px-3 py-3">Staff</th><th className="w-36 px-3 py-3">Role / Status</th><th className="w-32 px-3 py-3">Assigned / Matters</th><th className="w-36 px-3 py-3">Completed / Overdue</th><th className="w-36 px-3 py-3">Quality / Timeliness</th><th className="w-30 px-3 py-3">{view === 'staff-contribution' ? 'Contribution' : view === 'capacity' ? 'Workload' : 'Metric'}</th><th className="w-20 px-3 py-3">Action</th></tr></thead><tbody>{visibleRows.length === 0 ? <tr><td colSpan={8} className="p-10 text-center text-sm text-gray-500">No staff records found.</td></tr> : visibleRows.map((row, index) => <tr key={row.staff._id} className="border-t border-gray-100 align-top hover:bg-gray-50"><td className="px-3 py-4 text-gray-500">{(page - 1) * PAGE_SIZE + index + 1}</td><td className="px-3 py-4"><div className="truncate font-medium text-gray-900" title={row.staff.name}>{row.staff.name}</div><div className="truncate text-xs text-gray-500" title={row.staff.email}>{row.staff.email}</div></td><td className="px-3 py-4"><div className="truncate" title={row.staff.role}>{row.staff.role}</div><div className={row.staff.isActive ? 'text-xs text-green-700' : 'text-xs text-gray-500'}>{row.staff.isActive ? 'Active' : 'Inactive'}</div></td><td className="px-3 py-4"><div className="truncate">{row.assigned} tasks</div><div className="text-xs text-gray-500">{row.matters} matters</div></td><td className="px-3 py-4"><div className="truncate">{row.completed} completed</div><div className="text-xs text-red-700">{row.overdue} overdue</div></td><td className="px-3 py-4"><div className="truncate">{pct(row.quality.length ? row.quality.reduce((sum, value) => sum + value, 0) / row.quality.length : null)}</div><div className="text-xs text-gray-500">{pct(rate(row.onTime, row.completedWithDue))} on time</div></td><td className="px-3 py-4 font-semibold text-gray-900">{metricForRow(row)}</td><td className="px-3 py-4"><Link to={`/management/people/${row.staff._id}?view=${view}&range=${range}`} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"><UsersRound size={15} /> View</Link></td></tr>)}</tbody></table></div>{filteredRows.length > 0 && <Pagination page={page} pages={pages} total={filteredRows.length} onChange={setPage} />}</div>}</div>;
}