import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpDown,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  ExternalLink,
  Filter,
  FolderTree,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { UserRole } from '../../App';
import { getAllCases, CaseData } from '../../services/caseService';
import { getAssignmentUsers, type User as SystemUser } from '../../services/userService';
import {
  createIndependentTask,
  deleteIndependentTask,
  getIndependentTaskDashboard,
  IndependentTask,
  IndependentTaskDashboard,
  IndependentTaskStatus,
  listIndependentTasks,
  transitionIndependentTask,
  updateIndependentTask,
} from '../../services/independentTaskService';
import usePageTitle from '../../hooks/usePageTitle';
import {
  formatDeadlineDateTime,
  formatDueCountdown,
  getDeadlinePillClass,
  getDueRemainingRatio,
  getPerformanceZoneFromUsedRatio,
} from '../../utils/workflowDeadline';

const TASK_STATUSES: IndependentTaskStatus[] = [
  'Created',
  'Assigned',
  'Acknowledged',
  'In Progress',
  'Awaiting Review',
  'Awaiting External Action',
  'Completed',
  'Closed',
];

const WORKFLOW_PRIMARY_TRANSITIONS: Record<IndependentTaskStatus, IndependentTaskStatus | null> = {
  Created: 'Assigned',
  Assigned: 'Acknowledged',
  Acknowledged: 'In Progress',
  'In Progress': null,
  'Awaiting Review': 'Completed',
  'Awaiting External Action': 'In Progress',
  Completed: 'Closed',
  Closed: null,
};

const isManagerRole = (role: UserRole) =>
  [
    'managing_director',
    'managing_partner',
    'executive_managing_partner',
    'senior_partner',
    'partner',
    'executive_partner',
    'associate_partner',
    'executive_associate_partner',
    'senior_executive_assistant',
    'executive_assistant',
    'originating_attorney',
    'associate',
    'senior_associate',
  ].includes(role);

const statusClasses: Record<IndependentTaskStatus, string> = {
  Created: 'bg-gray-100 text-gray-700 border-gray-200',
  Assigned: 'bg-blue-50 text-blue-700 border-blue-100',
  Acknowledged: 'bg-sky-50 text-sky-700 border-sky-100',
  'In Progress': 'bg-indigo-50 text-indigo-700 border-indigo-100',
  'Awaiting Review': 'bg-amber-50 text-amber-700 border-amber-100',
  'Awaiting External Action': 'bg-orange-50 text-orange-700 border-orange-100',
  Completed: 'bg-green-50 text-green-700 border-green-100',
  Closed: 'bg-gray-900 text-white border-gray-900',
};

type TaskForm = {
  taskNumber: string;
  title: string;
  description: string;
  relatedMatterId: string;
  relatedClient: string;
  assignee: string;
  supervisor: string;
  startDate: string;
  dueDate: string;
};

const emptyForm = (): TaskForm => ({
  taskNumber: '',
  title: '',
  description: '',
  relatedMatterId: '',
  relatedClient: '',
  assignee: '',
  supervisor: '',
  startDate: new Date().toISOString().slice(0, 10),
  dueDate: '',
});

interface IndependentTaskModuleProps {
  userRole: UserRole;
}

export default function IndependentTaskModule({ userRole }: IndependentTaskModuleProps) {
  usePageTitle('Independent Tasks');

  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null') as { id?: string; name?: string; role?: string } | null;
    } catch {
      return null;
    }
  }, []);

  const canManage = isManagerRole(userRole);

  const [dashboard, setDashboard] = useState<IndependentTaskDashboard | null>(null);
  const [tasks, setTasks] = useState<IndependentTask[]>([]);
  const [taskTotal, setTaskTotal] = useState(0);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | IndependentTaskStatus>('all');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [supervisorFilter, setSupervisorFilter] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [sortBy, setSortBy] = useState<'dueDate' | 'createdAt' | 'status' | 'taskNumber'>('dueDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<IndependentTask | null>(null);
  const [form, setForm] = useState<TaskForm>(emptyForm());
  const [saving, setSaving] = useState(false);

  const deferredSearch = useDeferredValue(search);

  const loadDashboard = async () => {
    setDashboardLoading(true);
    try {
      const data = await getIndependentTaskDashboard();
      setDashboard(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard');
    } finally {
      setDashboardLoading(false);
    }
  };

  const loadLookups = async () => {
    try {
      setLookupLoading(true);
      const [caseData, userData] = await Promise.all([getAllCases(), getAssignmentUsers()]);
      setCases(caseData || []);
      setUsers(userData || []);
    } catch {
      setCases([]);
      setUsers([]);
    } finally {
      setLookupLoading(false);
    }
  };

  const loadTasks = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listIndependentTasks({
        q: deferredSearch,
        status: statusFilter,
        assignee: assigneeFilter || undefined,
        supervisor: supervisorFilter || undefined,
        page,
        limit,
        sortBy,
        sortDir,
      });
      setTasks(data.items || []);
      setTaskTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message || 'Failed to load tasks');
      setTasks([]);
      setTaskTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
    loadLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredSearch, statusFilter, assigneeFilter, supervisorFilter, page, limit, sortBy, sortDir]);

  const matterOptions = useMemo(
    () =>
      cases
        .slice()
        .sort((a, b) => String(a.caseNo || '').localeCompare(String(b.caseNo || '')))
        .map((matter) => ({
          _id: matter._id || '',
          label: [matter.caseNo, matter.parties].filter(Boolean).join(' • ') || 'Matter',
        })),
    [cases]
  );

  const userOptions = useMemo(
    () =>
      users
        .slice()
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        .map((user) => ({
          value: user.name || '',
          label: [user.name, user.email, user.role ? user.role.replace(/_/g, ' ') : '']
            .filter(Boolean)
            .join(' • '),
        }))
        .filter((user) => Boolean(user.value)),
    [users]
  );

  const supervisorOptions = useMemo(
    () =>
      users
        .slice()
        .filter((user) => ['associate', 'executive_assistant', 'managing_partner'].includes(String(user.role || '').toLowerCase()))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        .map((user) => ({
          value: user.name || '',
          label: [user.name, user.email, user.role ? user.role.replace(/_/g, ' ') : '']
            .filter(Boolean)
            .join(' • '),
        }))
        .filter((user) => Boolean(user.value)),
    [users]
  );

  const getDeadlineUsage = (task: Pick<IndependentTask, 'startDate' | 'dueDate'>) => {
    const dueAt = task.dueDate;
    const ratio = getDueRemainingRatio(task.startDate, dueAt);
    if (ratio === undefined) {
      return { usedPercent: undefined as number | undefined, zone: 'untracked' as const };
    }
    const usedPercent = Math.max(0, Math.min(100, Math.round((1 - ratio) * 100)));
    return {
      usedPercent,
      zone: getPerformanceZoneFromUsedRatio(usedPercent / 100),
    };
  };

  const deadlineDashboardItems = useMemo(() => {
    const source = dashboard?.upcomingDeadlines || [];
    return source.slice(0, 5).map((task) => {
      const metrics = getDeadlineUsage(task);
      return {
        ...task,
        ...metrics,
      };
    });
  }, [dashboard?.upcomingDeadlines]);

  const counts = dashboard?.summary;

  const openCreate = () => {
    setEditingTask(null);
    setForm(emptyForm());
    setShowModal(true);
  };

  const openEdit = (task: IndependentTask) => {
    setEditingTask(task);
    setForm({
      taskNumber: task.taskNumber || '',
      title: task.title || '',
      description: task.description || '',
      relatedMatterId: task.relatedMatterId || '',
      relatedClient: task.relatedClient || '',
      assignee: task.assignee || '',
      supervisor: task.supervisor || '',
      startDate: task.startDate || new Date().toISOString().slice(0, 10),
      dueDate: task.dueDate || '',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingTask(null);
    setForm(emptyForm());
  };

  const saveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error('Title is required.');
    if (!form.assignee.trim()) return toast.error('Assignee is required.');
    if (!form.supervisor.trim()) return toast.error('Supervisor is required.');
    if (!form.dueDate) return toast.error('Due date is required.');
    if (form.startDate && form.dueDate < form.startDate) return toast.error('Due date cannot be earlier than start date.');

    try {
      setSaving(true);
      const payload = {
        taskNumber: form.taskNumber || undefined,
        title: form.title,
        description: form.description || undefined,
        relatedMatterId: form.relatedMatterId || undefined,
        relatedClient: form.relatedClient || undefined,
        assignee: form.assignee,
        supervisor: form.supervisor,
        startDate: form.startDate,
        dueDate: form.dueDate,
      };

      if (editingTask) {
        await updateIndependentTask(editingTask._id, payload);
        toast.success('Independent task updated.');
      } else {
        await createIndependentTask(payload);
        toast.success('Independent task created.');
      }

      closeModal();
      await Promise.all([loadDashboard(), loadTasks()]);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save task');
    } finally {
      setSaving(false);
    }
  };

  const removeTask = async (task: IndependentTask) => {
    if (!window.confirm(`Delete ${task.taskNumber}?`)) return;
    try {
      await deleteIndependentTask(task._id);
      toast.success('Task deleted.');
      await Promise.all([loadDashboard(), loadTasks()]);
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete task');
    }
  };

  const exportCsv = () => {
    const rows = [
      ['Task Number', 'Title', 'Related Matter', 'Related Client', 'Assignee', 'Supervisor', 'Deadline Used %', 'Status', 'Due Date', 'Created Date'],
      ...tasks.map((task) => [
        task.taskNumber || '',
        task.title || '',
        task.relatedMatter?.caseNo ? [task.relatedMatter.caseNo, task.relatedMatter.parties].filter(Boolean).join(' • ') : task.relatedMatterLabel || '',
        task.relatedClient || '',
        task.assignee || '',
        task.supervisor || '',
        (() => {
          const deadline = getDeadlineUsage(task);
          return typeof deadline.usedPercent === 'number' ? `${deadline.usedPercent}%` : '';
        })(),
        task.status || '',
        task.dueDate || '',
        task.createdAt ? new Date(task.createdAt).toLocaleDateString() : '',
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'independent-tasks.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const taskMatterLabel = (task: IndependentTask) =>
    task.relatedMatter?.caseNo
      ? [task.relatedMatter.caseNo, task.relatedMatter.parties].filter(Boolean).join(' • ')
      : task.relatedMatterLabel || '—';

  const nextStatus = (status: IndependentTaskStatus): IndependentTaskStatus | null => WORKFLOW_PRIMARY_TRANSITIONS[status];
  const getTransitionLabel = (status: IndependentTaskStatus, next: IndependentTaskStatus) => {
    switch (status) {
      case 'Created':
        return `Assign`;
      case 'Assigned':
        return `Acknowledge`;
      case 'Acknowledged':
        return `Start Work`;
      case 'Awaiting Review':
        return `Complete`;
      case 'Awaiting External Action':
        return `Resume`;
      case 'Completed':
        return `Close`;
      default:
        return next;
    }
  };

  const handleTransition = async (task: IndependentTask, next?: IndependentTaskStatus | null) => {
    const nextStatusValue = next || nextStatus(task.status);
    if (!nextStatusValue) return;
    const allowed = canManage || task.assignee === currentUser?.name || task.supervisor === currentUser?.name;
    if (!allowed) return toast.error('You do not have permission to change this task.');
    if (task.status === 'In Progress') return toast.info('Open the task details to choose the next workflow step.');
    try {
      await transitionIndependentTask(task._id, nextStatusValue);
      toast.success(`Moved to ${nextStatusValue}.`);
      await Promise.all([loadDashboard(), loadTasks()]);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update workflow');
    }
  };

  const totalPages = Math.max(1, Math.ceil((taskTotal || 0) / limit));

  const canQuickTransition = (task: IndependentTask) => Boolean(nextStatus(task.status));
  const transitionButtonLabel = (task: IndependentTask) => {
    const next = nextStatus(task.status);
    return next ? getTransitionLabel(task.status, next) : '';
  };

  const handleTransitionQuick = async (task: IndependentTask) => {
    const next = nextStatus(task.status);
    if (!next) return;
    return handleTransition(task, next);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
              <FolderTree className="h-3.5 w-3.5" />
              Matter Module
            </div>
            <h1 className="text-3xl font-semibold text-gray-900">Independent Tasks</h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-600">
              Manage operational tasks with a dedicated workflow, timeline, comments, attachments, and activity history.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              to="/matters/closed"
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <ArrowRight className="h-4 w-4" />
              Closed Matters
            </Link>
            <button
              type="button"
              onClick={() => Promise.all([loadDashboard(), loadTasks()])}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            {canManage && (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                <Plus className="h-4 w-4" />
                New Task
              </button>
            )}
          </div>
        </div>
      </div>

      {(dashboardLoading || loading) && (
        <div className="rounded-3xl border border-gray-200 bg-white p-10 text-center text-gray-500">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-gray-400" />
          Loading independent tasks...
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total Tasks', value: counts?.totalTasks || 0, tone: 'bg-slate-900 text-white' },
          { label: 'Open Tasks', value: counts?.openTasks || 0, tone: 'bg-blue-50 text-blue-700' },
          { label: 'In Progress', value: counts?.inProgress || 0, tone: 'bg-indigo-50 text-indigo-700' },
          { label: 'Awaiting Review', value: counts?.awaitingReview || 0, tone: 'bg-amber-50 text-amber-700' },
          { label: 'Awaiting External Action', value: counts?.awaitingExternalAction || 0, tone: 'bg-orange-50 text-orange-700' },
          { label: 'Completed', value: counts?.completed || 0, tone: 'bg-green-50 text-green-700' },
          { label: 'Closed', value: counts?.closed || 0, tone: 'bg-gray-100 text-gray-900' },
          { label: 'Critical Tasks', value: counts?.criticalTasks || 0, tone: 'bg-rose-50 text-rose-700' },
        ].map((card) => (
          <div key={card.label} className={`rounded-2xl border border-gray-200 p-5 shadow-sm ${card.tone}`}>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">{card.label}</div>
            <div className="mt-3 text-3xl font-semibold">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Task List</h2>
              <p className="text-sm text-gray-500">Search, filter, sort, paginate, and export.</p>
            </div>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-5">
            <div className="relative lg:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
                placeholder="Search task number, title, owner..."
                className="w-full rounded-xl border border-gray-300 py-2 pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => {
                setPage(1);
                setStatusFilter(e.target.value as any);
              }}
              className="rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="all">All Statuses</option>
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>

            <select
              value={assigneeFilter}
              onChange={(e) => {
                setPage(1);
                setAssigneeFilter(e.target.value);
              }}
              className="rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              disabled={lookupLoading}
            >
              <option value="">{lookupLoading ? 'Loading users...' : 'All Assignees'}</option>
              {userOptions.map((user) => (
                <option key={`assignee-${user.value}`} value={user.value}>
                  {user.label}
                </option>
              ))}
            </select>

            <select
              value={supervisorFilter}
              onChange={(e) => {
                setPage(1);
                setSupervisorFilter(e.target.value);
              }}
              className="rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              disabled={lookupLoading}
            >
              <option value="">{lookupLoading ? 'Loading users...' : 'All Supervisors'}</option>
              {supervisorOptions.map((user) => (
                <option key={`supervisor-${user.value}`} value={user.value}>
                  {user.label}
                </option>
              ))}
            </select>

            <div className="flex items-center justify-end gap-2 lg:col-span-6">
              <button
                type="button"
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <ArrowUpDown className="h-4 w-4" />
                {sortDir === 'asc' ? 'Ascending' : 'Descending'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPage(1);
                  loadTasks();
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Filter className="h-4 w-4" />
                Apply Filters
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr className="text-left text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Task</th>
                    <th className="px-4 py-3">Matter</th>
                    <th className="px-4 py-3">Assignee</th>
                    <th className="px-4 py-3">Deadline</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Due</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {tasks.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-500">
                        <CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-gray-300" />
                        No independent tasks found.
                      </td>
                    </tr>
                  ) : (
                    tasks.map((task, index) => {
                      const next = nextStatus(task.status);
                      const isClosed = task.status === 'Closed';
                      const rowNumber = (page - 1) * limit + index + 1;
                      return (
                        <tr key={task._id} className="align-top">
                          <td className="px-4 py-4 text-sm font-medium text-gray-500">{rowNumber}</td>
                          <td className="px-4 py-4">
                            <div className="font-medium text-gray-900">{task.title}</div>
                            <div className="text-xs text-gray-500">{task.taskNumber}</div>
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-700">
                            {taskMatterLabel(task)}
                            <div className="text-xs text-gray-500">{task.relatedClient || '—'}</div>
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-700">
                            <div>{task.assignee}</div>
                            <div className="text-xs text-gray-500">Supervisor: {task.supervisor}</div>
                          </td>
                          <td className="px-4 py-4">
                            {(() => {
                              const deadline = getDeadlineUsage(task);
                              const deadlinePillClass = getDeadlinePillClass(task.dueDate, task.startDate);
                              const usageLabel =
                                deadline.zone === 'excellent'
                                  ? 'Excellent pace'
                                  : deadline.zone === 'good'
                                    ? 'On track'
                                    : deadline.zone === 'delayed'
                                      ? 'Watch closely'
                                      : deadline.zone === 'risk'
                                        ? 'At risk'
                                        : 'Untracked';

                              return (
                                <div className="space-y-2">
                                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${deadlinePillClass}`}>
                                    {formatDueCountdown(task.dueDate)}
                                  </span>
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between text-xs text-gray-500">
                                      <span>{usageLabel}</span>
                                      <span>{typeof deadline.usedPercent === 'number' ? `${deadline.usedPercent}% used` : 'No timeline'}</span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                                      <div
                                        className={`h-2 rounded-full ${
                                          deadline.zone === 'excellent'
                                            ? 'bg-sky-500'
                                            : deadline.zone === 'good'
                                              ? 'bg-emerald-500'
                                              : deadline.zone === 'delayed'
                                                ? 'bg-amber-500'
                                                : deadline.zone === 'risk'
                                                  ? 'bg-rose-500'
                                                  : 'bg-gray-400'
                                        }`}
                                        style={{ width: `${deadline.usedPercent ?? 0}%` }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClasses[task.status]}`}>
                              {task.status}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-600">{formatDeadlineDateTime(task.dueDate)}</td>
                          <td className="px-4 py-4">
                            <div className="flex justify-end gap-2">
                              <Link
                                to={`/matters/independent-tasks/${task._id}`}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                Open
                              </Link>
                              {canManage && !isClosed && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openEdit(task)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                    Edit
                                  </button>
                                  {canQuickTransition(task) && (
                                    <button
                                      type="button"
                                      onClick={() => handleTransitionQuick(task)}
                                      className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                    >
                                      {transitionButtonLabel(task)}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => removeTask(task)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 disabled:opacity-40"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
              <select
                value={limit}
                onChange={(e) => {
                  setPage(1);
                  setLimit(Number(e.target.value));
                }}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm"
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Deadline Health</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs uppercase tracking-[0.14em] text-gray-500">Overdue</div>
                <div className="mt-2 text-2xl font-semibold text-rose-700">{counts?.overdueTasks || 0}</div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs uppercase tracking-[0.14em] text-gray-500">Due Today</div>
                <div className="mt-2 text-2xl font-semibold text-amber-700">{dashboard?.tasksDueToday?.length || 0}</div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs uppercase tracking-[0.14em] text-gray-500">Open</div>
                <div className="mt-2 text-2xl font-semibold text-sky-700">{counts?.openTasks || 0}</div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs uppercase tracking-[0.14em] text-gray-500">Completed</div>
                <div className="mt-2 text-2xl font-semibold text-emerald-700">{counts?.completed || 0}</div>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {deadlineDashboardItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
                  No upcoming deadlines.
                </div>
              ) : (
                deadlineDashboardItems.map((task) => {
                  const usageLabel =
                    task.zone === 'excellent'
                      ? 'Excellent pace'
                      : task.zone === 'good'
                        ? 'On track'
                        : task.zone === 'delayed'
                          ? 'Watch closely'
                          : task.zone === 'risk'
                            ? 'At risk'
                            : 'Untracked';

                  return (
                    <div key={task._id} className="rounded-2xl border border-gray-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{task.title}</div>
                          <div className="text-xs text-gray-500">{task.taskNumber}</div>
                        </div>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getDeadlinePillClass(task.dueDate, task.startDate)}`}>
                          {formatDueCountdown(task.dueDate)}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                        <span>{usageLabel}</span>
                        <span>{typeof task.usedPercent === 'number' ? `${task.usedPercent}% used` : 'No timeline'}</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={`h-2 rounded-full ${
                            task.zone === 'excellent'
                              ? 'bg-sky-500'
                              : task.zone === 'good'
                                ? 'bg-emerald-500'
                                : task.zone === 'delayed'
                                  ? 'bg-amber-500'
                                  : task.zone === 'risk'
                                    ? 'bg-rose-500'
                                    : 'bg-gray-400'
                          }`}
                          style={{ width: `${task.usedPercent ?? 0}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Assigned To Me</h3>
            <div className="mt-4 space-y-3">
              {(dashboard?.assignedToMe || []).length === 0 ? (
                <div className="text-sm text-gray-500">No tasks assigned to you.</div>
              ) : (
                dashboard!.assignedToMe.map((task) => (
                  <Link key={task._id} to={`/matters/independent-tasks/${task._id}`} className="block rounded-2xl border border-gray-200 p-3 hover:bg-gray-50">
                    <div className="font-medium text-gray-900">{task.title}</div>
                    <div className="mt-1 text-xs text-gray-500">{task.taskNumber}</div>
                  </Link>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Tasks Due Today</h3>
            <div className="mt-4 space-y-3">
              {(dashboard?.tasksDueToday || []).length === 0 ? (
                <div className="text-sm text-gray-500">No tasks due today.</div>
              ) : (
                dashboard!.tasksDueToday.map((task) => (
                  <Link key={task._id} to={`/matters/independent-tasks/${task._id}`} className="block rounded-2xl border border-gray-200 p-3 hover:bg-gray-50">
                    <div className="font-medium text-gray-900">{task.title}</div>
                    <div className="mt-1 text-xs text-gray-500">{task.taskNumber}</div>
                  </Link>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Upcoming Deadlines</h3>
            <div className="mt-4 space-y-3">
              {(dashboard?.upcomingDeadlines || []).length === 0 ? (
                <div className="text-sm text-gray-500">No upcoming deadlines.</div>
              ) : (
                dashboard!.upcomingDeadlines.map((task) => (
                  <Link key={task._id} to={`/matters/independent-tasks/${task._id}`} className="block rounded-2xl border border-gray-200 p-3 hover:bg-gray-50">
                    <div className="font-medium text-gray-900">{task.title}</div>
                    <div className="mt-1 text-xs text-gray-500">{formatDeadlineDateTime(task.dueDate)}</div>
                  </Link>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Recent Activity</h3>
            <div className="mt-4 space-y-3">
              {(dashboard?.recentActivities || []).length === 0 ? (
                <div className="text-sm text-gray-500">No recent activity.</div>
              ) : (
                dashboard!.recentActivities.map((item) => (
                  <div key={item._id} className="rounded-2xl border border-gray-200 p-3">
                    <div className="text-sm font-medium text-gray-900">{item.message}</div>
                    <div className="mt-1 text-xs text-gray-500">{item.actorName} • {new Date(item.createdAt).toLocaleString()}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-gray-200 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">{editingTask ? 'Edit Independent Task' : 'Create Independent Task'}</h2>
                  <p className="text-sm text-gray-500">Independent tasks can be linked to a matter, a client, both, or neither.</p>
                </div>
                <button type="button" onClick={closeModal} className="rounded-full p-2 text-gray-500 hover:bg-gray-100">
                  <ChevronLeft className="h-5 w-5" />
                </button>
              </div>
            </div>

            <form onSubmit={saveTask} className="grid gap-6 p-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Task Number</label>
                  <input
                    value={form.taskNumber}
                    onChange={(e) => setForm((prev) => ({ ...prev, taskNumber: e.target.value }))}
                    placeholder="Auto-generated if blank"
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Title</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    rows={5}
                    className="w-full rounded-2xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Related Matter</label>
                  <select
                    value={form.relatedMatterId}
                    onChange={(e) => setForm((prev) => ({ ...prev, relatedMatterId: e.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    disabled={saving}
                  >
                    <option value="">No matter linked</option>
                    {matterOptions.map((matter) => (
                      <option key={matter._id} value={matter._id}>
                        {matter.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Related Client</label>
                  <input
                    value={form.relatedClient}
                    onChange={(e) => setForm((prev) => ({ ...prev, relatedClient: e.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Assignee</label>
                    <select
                      value={form.assignee}
                      onChange={(e) => setForm((prev) => ({ ...prev, assignee: e.target.value }))}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                      disabled={saving || lookupLoading}
                    >
                      <option value="">{lookupLoading ? 'Loading users...' : 'Select assignee'}</option>
                      {userOptions.map((user) => (
                        <option key={`form-assignee-${user.value}`} value={user.value}>
                          {user.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Supervisor</label>
                    <select
                      value={form.supervisor}
                      onChange={(e) => setForm((prev) => ({ ...prev, supervisor: e.target.value }))}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                      disabled={saving || lookupLoading}
                    >
                      <option value="">{lookupLoading ? 'Loading users...' : 'Select supervisor'}</option>
                      {supervisorOptions.map((user) => (
                        <option key={`form-supervisor-${user.value}`} value={user.value}>
                          {user.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Start Date</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Due Date</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="col-span-full flex flex-col-reverse gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {editingTask ? 'Save Changes' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
