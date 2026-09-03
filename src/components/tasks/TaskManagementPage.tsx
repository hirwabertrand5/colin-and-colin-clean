import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, Search, UserRound } from 'lucide-react';

import usePageTitle from '../../hooks/usePageTitle';
import { CaseData, getAllCases, isTemporarilyClosedCase } from '../../services/caseService';
import { getAllTasks, TaskData, TaskWorkflowStage } from '../../services/taskService';
import { formatDeadlineDateTime, getDeadlinePillClass, resolveDeadlineDateTime } from '../../utils/workflowDeadline';

export type TaskManagementView =
  | 'all'
  | 'my'
  | 'unassigned'
  | 'due-today'
  | 'due-this-week'
  | 'overdue'
  | 'awaiting-review'
  | 'awaiting-external-action'
  | 'completed'
  | 'closed'
  | 'performance';

const PAGE_SIZE = 10;
const normalize = (value?: string | null) => String(value || '').trim().toLowerCase();
const dateKey = (value?: Date | string) => {
  const date = resolveDeadlineDateTime(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
};
const todayKey = () => dateKey(new Date());
const weekStart = (date: Date) => {
  const start = new Date(date);
  const day = start.getDay();
  start.setDate(start.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start;
};
const isClosed = (task: TaskData) => task.workflowStage === 'Closed';
const isCompleted = (task: TaskData) => task.status === 'Completed' || task.workflowStage === 'Completed';
const isUnassigned = (task: TaskData) => !normalize(task.assignee) || normalize(task.assignee) === '—';
const stageFor = (task: TaskData): TaskWorkflowStage => task.workflowStage || (task.status === 'Completed' ? 'Completed' : task.status === 'In Progress' ? 'In Progress' : 'Assigned');
const currentUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null') as { name?: string; email?: string } | null;
  } catch {
    return null;
  }
};
const matchesIdentity = (value: string | undefined, user: { name?: string; email?: string } | null) => {
  const normalized = normalize(value);
  return Boolean(normalized && [normalize(user?.name), normalize(user?.email)].includes(normalized));
};
const formatDate = (value?: string) => value ? new Date(value).toLocaleDateString() : '—';
const safePercent = (numerator: number, denominator: number) => denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : '—';

const viewDetails: Record<TaskManagementView, { title: string; description: string; empty: string }> = {
  all: { title: 'All Tasks', description: 'All permitted task records across the firm.', empty: 'No tasks found.' },
  my: { title: 'My Tasks', description: 'Tasks assigned to the authenticated user.', empty: 'You currently have no assigned tasks.' },
  unassigned: { title: 'Unassigned Tasks', description: 'Tasks that do not currently have an assignee.', empty: 'No unassigned tasks.' },
  'due-today': { title: 'Due Today', description: 'Tasks due today, excluding closed tasks.', empty: 'No tasks are due today.' },
  'due-this-week': { title: 'Due This Week', description: 'Tasks due during the current calendar week, excluding closed tasks.', empty: 'No tasks are due this week.' },
  overdue: { title: 'Overdue Tasks', description: 'Open tasks whose due date has passed.', empty: 'No overdue tasks.' },
  'awaiting-review': { title: 'Awaiting Review', description: 'Tasks at the existing Awaiting Review workflow stage.', empty: 'No tasks are awaiting review.' },
  'awaiting-external-action': { title: 'Awaiting External Action', description: 'Tasks at the existing Awaiting External Action workflow stage.', empty: 'No tasks are awaiting external action.' },
  completed: { title: 'Completed Tasks', description: 'Tasks completed through the existing task workflow.', empty: 'No completed tasks found.' },
  closed: { title: 'Closed Tasks', description: 'Tasks finalized at the existing Closed workflow stage.', empty: 'No closed tasks found.' },
  performance: { title: 'Task Performance', description: 'Completion, timeliness, overdue and quality indicators from real task records.', empty: 'No task performance data available.' },
};

function Pill({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${className}`}>{children}</span>;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-gray-200 bg-white p-4"><div className="text-xs uppercase tracking-[0.16em] text-gray-500">{label}</div><div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div></div>;
}

function LoadingSkeleton() {
  return <div className="space-y-6"><div className="h-8 w-48 animate-pulse rounded bg-gray-200" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-lg border border-gray-200 bg-white" />)}</div><div className="overflow-hidden rounded-lg border border-gray-200 bg-white p-4"><div className="space-y-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="flex gap-3"><div className="h-9 w-10 animate-pulse rounded bg-gray-200" /><div className="h-9 flex-1 animate-pulse rounded bg-gray-200" /><div className="hidden h-9 w-40 animate-pulse rounded bg-gray-200 md:block" /></div>)}</div></div></div>;
}

export default function TaskManagementPage({ view }: { view: TaskManagementView }) {
  const detail = viewDetails[view];
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  usePageTitle(detail.title);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([getAllTasks(), getAllCases()])
      .then(([taskData, caseData]) => {
        if (!mounted) return;
        setTasks(taskData);
        setCases(caseData);
      })
      .catch((loadError) => mounted && setError(loadError?.message || 'Failed to load tasks.'))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  const caseMap = useMemo(() => new Map(cases.filter((item) => item._id).map((item) => [item._id as string, item])), [cases]);
  const permittedTasks = useMemo(() => tasks.filter((task) => !isTemporarilyClosedCase(caseMap.get(task.caseId))), [caseMap, tasks]);
  const filteredTasks = useMemo(() => {
    const user = currentUser();
    const today = todayKey();
    const currentWeekStart = weekStart(new Date());
    const currentWeekEnd = new Date(currentWeekStart);
    currentWeekEnd.setDate(currentWeekEnd.getDate() + 7);
    const term = normalize(search);

    return permittedTasks.filter((task) => {
      const relatedCase = caseMap.get(task.caseId);
      const dueDate = resolveDeadlineDateTime(task.dueDate);
      const dueKey = dateKey(task.dueDate);
      const matchesView = view === 'all'
        || (view === 'my' && matchesIdentity(task.assignee, user))
        || (view === 'unassigned' && isUnassigned(task))
        || (view === 'due-today' && dueKey === today && !isClosed(task))
        || (view === 'due-this-week' && Boolean(dueDate && dueDate >= currentWeekStart && dueDate < currentWeekEnd && !isClosed(task)))
        || (view === 'overdue' && Boolean(dueDate && dueKey < today && !isCompleted(task) && !isClosed(task)))
        || (view === 'awaiting-review' && stageFor(task) === 'Awaiting Review')
        || (view === 'awaiting-external-action' && stageFor(task) === 'Awaiting External Action')
        || (view === 'completed' && isCompleted(task))
        || (view === 'closed' && isClosed(task));
      const searchable = [task.taskNo, task.title, task.description, task.assignee, task.supervisor, task.relatedClient, task.status, task.workflowStage, task.priority, relatedCase?.caseNo, relatedCase?.parties].map(normalize).join(' ');
      return matchesView && (!term || searchable.includes(term)) && (priority === 'all' || task.priority === priority) && (status === 'all' || task.status === status || stageFor(task) === status);
    });
  }, [caseMap, permittedTasks, priority, search, status, view]);

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const paginatedTasks = filteredTasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => setPage(1), [priority, search, status, view]);
  useEffect(() => setPage((currentPage) => Math.min(currentPage, totalPages)), [totalPages]);

  const performance = useMemo(() => {
    const today = todayKey();
    const completed = permittedTasks.filter(isCompleted);
    const open = permittedTasks.filter((task) => !isCompleted(task) && !isClosed(task));
    const due = permittedTasks.filter((task) => Boolean(dateKey(task.dueDate)));
    const overdue = open.filter((task) => dateKey(task.dueDate) < today);
    const completedWithDue = completed.filter((task) => task.completedAt && resolveDeadlineDateTime(task.dueDate));
    const onTime = completedWithDue.filter((task) => new Date(task.completedAt as string).getTime() <= (resolveDeadlineDateTime(task.dueDate)?.getTime() || 0));
    const durations = completed.filter((task) => task.startDate && task.completedAt).map((task) => new Date(task.completedAt as string).getTime() - new Date(task.startDate as string).getTime()).filter((value) => Number.isFinite(value) && value >= 0);
    const scored = permittedTasks.filter((task) => task.qualityScore != null && Number.isFinite(Number(task.qualityScore)));
    const staff = new Map<string, { assigned: number; completed: number; overdue: number; onTime: number; quality: number[] }>();
    permittedTasks.forEach((task) => {
      const name = task.assignee?.trim() || 'Unassigned';
      const row = staff.get(name) || { assigned: 0, completed: 0, overdue: 0, onTime: 0, quality: [] };
      row.assigned += 1;
      if (isCompleted(task)) row.completed += 1;
      if (open.includes(task) && dateKey(task.dueDate) < today) row.overdue += 1;
      if (completedWithDue.includes(task) && onTime.includes(task)) row.onTime += 1;
      if (task.qualityScore != null && Number.isFinite(Number(task.qualityScore))) row.quality.push(Number(task.qualityScore));
      staff.set(name, row);
    });
    return { total: permittedTasks.length, completed: completed.length, open: open.length, overdue: overdue.length, awaitingReview: permittedTasks.filter((task) => stageFor(task) === 'Awaiting Review').length, awaitingExternal: permittedTasks.filter((task) => stageFor(task) === 'Awaiting External Action').length, completionRate: safePercent(completed.length, due.length), onTimeRate: safePercent(onTime.length, completedWithDue.length), overdueRate: safePercent(overdue.length, open.length), averageDuration: durations.length ? `${(durations.reduce((sum, value) => sum + value, 0) / durations.length / 86400000).toFixed(1)} days` : '—', averageQuality: scored.length ? `${Math.round(scored.reduce((sum, task) => sum + Number(task.qualityScore), 0) / scored.length)}%` : '—', staff: Array.from(staff.entries()).map(([name, row]) => ({ name, ...row, onTimeRate: safePercent(row.onTime, row.completed), averageQuality: row.quality.length ? `${Math.round(row.quality.reduce((sum, value) => sum + value, 0) / row.quality.length)}%` : '—' })).sort((left, right) => right.completed - left.completed) };
  }, [permittedTasks]);

  if (loading) return <LoadingSkeleton />;
  if (view === 'performance') return <PerformanceView detail={detail} performance={performance} />;

  const emptyMessage = detail.empty;
  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold text-gray-900">{detail.title}</h1><p className="mt-1 text-gray-600">{detail.description}</p></div><Link to="/tasks" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> Task board</Link></div>
      {error && <div className="mb-4 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={17} />{error}</div>}
      <div className="mb-6 flex flex-col gap-3 xl:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search task, matter, client, assignee..." className="w-full rounded-md border border-gray-300 py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-gray-400" /></div><select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2"><option value="all">All statuses</option><option>Not Started</option><option>In Progress</option><option>Completed</option><option>Awaiting Review</option><option>Awaiting External Action</option><option>Closed</option></select><select value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2"><option value="all">All priorities</option><option>High</option><option>Medium</option><option>Low</option></select></div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white"><div className="overflow-x-auto">{paginatedTasks.length === 0 ? <div className="p-12 text-center text-sm text-gray-500">{emptyMessage}</div> : <table className="min-w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Task</th><th className="px-4 py-3">Matter / Client</th><th className="px-4 py-3">Description</th><th className="px-4 py-3">Assignee / Supervisor</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Status / Confirmation</th><th className="px-4 py-3">Actions</th></tr></thead><tbody>{paginatedTasks.map((task, index) => { const relatedCase = caseMap.get(task.caseId); const stage = stageFor(task); const confirmed = task.approvalStatus || 'Not Required'; return <tr key={task._id} className="border-t border-gray-100 align-top hover:bg-gray-50"><td className="px-4 py-4 text-gray-500">{(page - 1) * PAGE_SIZE + index + 1}</td><td className="px-4 py-4"><Link to={`/tasks/${task._id}`} className="font-medium text-blue-700 hover:underline">{task.taskNo || 'Task'}</Link><div className="mt-1 font-semibold text-gray-900">{task.title}</div></td><td className="px-4 py-4"><div className="text-gray-900">{relatedCase?.caseNo || task.caseId || 'Matter unavailable'}</div><div className="text-xs text-gray-500">{task.relatedClient || relatedCase?.parties || 'Client unavailable'}</div></td><td className="max-w-xs whitespace-pre-line px-4 py-4 text-gray-600">{task.description || '—'}</td><td className="px-4 py-4"><div>{task.assignee || 'Unassigned'}</div><div className="text-xs text-gray-500">{task.supervisor || 'No supervisor'}</div></td><td className="px-4 py-4"><Pill className={task.priority === 'High' ? 'border-red-100 bg-red-50 text-red-700' : task.priority === 'Medium' ? 'border-yellow-100 bg-yellow-50 text-yellow-800' : 'border-green-100 bg-green-50 text-green-700'}>{task.priority}</Pill></td><td className="px-4 py-4 text-xs text-gray-600"><div>Start: {formatDate(task.startDate)}</div><div className={`mt-1 rounded px-1 py-0.5 ${getDeadlinePillClass(task.dueDate, task.startDate)}`}>Due: {formatDeadlineDateTime(task.dueDate)}</div><div>Done: {formatDate(task.completedAt)}</div></td><td className="px-4 py-4"><Pill className={stage === 'Awaiting Review' ? 'border-amber-100 bg-amber-50 text-amber-700' : stage === 'Awaiting External Action' ? 'border-orange-100 bg-orange-50 text-orange-700' : stage === 'Completed' ? 'border-green-100 bg-green-50 text-green-700' : stage === 'Closed' ? 'border-gray-900 bg-gray-900 text-white' : 'border-blue-100 bg-blue-50 text-blue-700'}>{stage}</Pill><div className="mt-1 text-xs text-gray-500">Confirmation: {confirmed}</div></td><td className="px-4 py-4"><Link to={`/tasks/${task._id}`} className="text-sm font-medium text-gray-700 hover:text-gray-900">Open</Link></td></tr>; })}</tbody></table>}</div>{filteredTasks.length > 0 && <Pagination page={page} totalPages={totalPages} total={filteredTasks.length} onPageChange={setPage} />}</div>
    </div>
  );
}

function Pagination({ page, totalPages, total, onPageChange }: { page: number; totalPages: number; total: number; onPageChange: (page: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-4 text-sm text-gray-600"><span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span><div className="flex gap-1"><button type="button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Previous</button>{Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => <button type="button" key={pageNumber} onClick={() => onPageChange(pageNumber)} className={`rounded border px-3 py-1.5 ${pageNumber === page ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white'}`}>{pageNumber}</button>)}<button type="button" onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Next</button></div></div>;
}

function PerformanceView({ detail, performance }: { detail: { title: string; description: string }; performance: any }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(performance.staff.length / PAGE_SIZE));
  const visibleStaff = performance.staff.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => setPage(1), [performance.staff.length]);

  return <div><div className="mb-6"><h1 className="text-2xl font-semibold text-gray-900">{detail.title}</h1><p className="mt-1 text-gray-600">{detail.description}</p></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Kpi label="Total Tasks" value={String(performance.total)} /><Kpi label="Completed" value={String(performance.completed)} /><Kpi label="Open" value={String(performance.open)} /><Kpi label="Overdue" value={String(performance.overdue)} /><Kpi label="Completion Rate" value={performance.completionRate} /><Kpi label="On-Time Rate" value={performance.onTimeRate} /><Kpi label="Overdue Rate" value={performance.overdueRate} /><Kpi label="Average Completion" value={performance.averageDuration} /><Kpi label="Awaiting Review" value={String(performance.awaitingReview)} /><Kpi label="Awaiting External Action" value={String(performance.awaitingExternal)} /><Kpi label="Average Quality" value={performance.averageQuality} /></div><div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white"><div className="border-b border-gray-200 px-5 py-4"><h2 className="font-semibold text-gray-900">Performance by staff</h2></div>{performance.staff.length === 0 ? <div className="p-10 text-center text-sm text-gray-500">No task performance data available.</div> : <><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Staff</th><th className="px-4 py-3">Assigned</th><th className="px-4 py-3">Completed</th><th className="px-4 py-3">Outstanding</th><th className="px-4 py-3">Overdue</th><th className="px-4 py-3">On-Time Rate</th><th className="px-4 py-3">Quality</th></tr></thead><tbody>{visibleStaff.map((row: any, index: number) => <tr key={row.name} className="border-t border-gray-100"><td className="px-4 py-4 text-gray-500">{(page - 1) * PAGE_SIZE + index + 1}</td><td className="px-4 py-4 font-medium text-gray-900">{row.name}</td><td className="px-4 py-4">{row.assigned}</td><td className="px-4 py-4">{row.completed}</td><td className="px-4 py-4">{row.assigned - row.completed}</td><td className="px-4 py-4">{row.overdue}</td><td className="px-4 py-4">{row.onTimeRate}</td><td className="px-4 py-4">{row.averageQuality}</td></tr>)}</tbody></table></div><Pagination page={page} totalPages={totalPages} total={performance.staff.length} onPageChange={setPage} /></>}</div></div>;
}