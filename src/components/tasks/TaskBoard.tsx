import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { UserRole } from '../../App';
import { getAllTasks, TaskData } from '../../services/taskService';
import { getAllCases, CaseData, isTemporarilyClosedCase } from '../../services/caseService';
import usePageTitle from '../../hooks/usePageTitle';
import { formatDueCountdown, getDeadlinePillClass } from '../../utils/workflowDeadline';

interface TaskBoardProps {
  userRole: UserRole;
}

type BoardColumnId = 'Not Started' | 'In Progress' | 'Pending Approval' | 'Completed';

const isAssociateLike = (role: UserRole) =>
  role === 'associate' || role === 'trainee_associate' || role === 'senior_associate' || role === 'intern';

export default function TaskBoard({ userRole }: TaskBoardProps) {
  usePageTitle('Tasks');

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | BoardColumnId>('all');
  const [filterPriority, setFilterPriority] = useState<'all' | 'High' | 'Medium' | 'Low'>('all');

  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [tasksData, casesData] = await Promise.all([getAllTasks(), getAllCases()]);
        setTasks(tasksData);
        setCases(casesData);
      } catch (err: any) {
        setError(err.message || 'Failed to load tasks');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const caseMap = useMemo(() => {
    const map = new Map<string, CaseData>();
    cases.forEach((c) => {
      if (c._id) map.set(c._id, c);
    });
    return map;
  }, [cases]);

  const activeTasks = useMemo(
    () => tasks.filter((task) => !isTemporarilyClosedCase(caseMap.get(task.caseId))),
    [tasks, caseMap]
  );

  const getPriorityPill = (priority: string) => {
    if (priority === 'High') return 'bg-red-50 text-red-700 border border-red-100';
    if (priority === 'Medium') return 'bg-yellow-50 text-yellow-800 border border-yellow-100';
    if (priority === 'Low') return 'bg-green-50 text-green-700 border border-green-100';
    return 'bg-gray-50 text-gray-700 border border-gray-100';
  };

  const getColumn = (t: TaskData): BoardColumnId => {
    if (t.requiresApproval && t.approvalStatus === 'Pending') return 'Pending Approval';
    if (t.status === 'Not Started') return 'Not Started';
    if (t.status === 'In Progress') return 'In Progress';
    return 'Completed';
  };

  const getTaskDeadlineColor = (task: TaskData) =>
    getDeadlinePillClass(`${task.dueDate}T23:59:59.999`, task.createdAt);

  // Performance badge intentionally removed — show only deadline pill

  const filteredTasks = useMemo(() => {
    return activeTasks.filter((t) => {
      const relatedCase = caseMap.get(t.caseId);
      const caseLabel = relatedCase?.caseNo || relatedCase?.parties || '';

      const matchesSearch =
        t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(caseLabel).toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.assignee || '').toLowerCase().includes(searchTerm.toLowerCase());

      const column = getColumn(t);
      const matchesStatus = filterStatus === 'all' || column === filterStatus;
      const matchesPriority = filterPriority === 'all' || t.priority === filterPriority;

      return matchesSearch && matchesStatus && matchesPriority;
    });
  }, [activeTasks, searchTerm, filterStatus, filterPriority, caseMap]);

  const columns: BoardColumnId[] = ['Not Started', 'In Progress', 'Pending Approval', 'Completed'];

  const counts = useMemo(() => {
    const c = {
      'Not Started': 0,
      'In Progress': 0,
      'Pending Approval': 0,
      Completed: 0,
    } as Record<BoardColumnId, number>;
    activeTasks.forEach((t) => c[getColumn(t)]++);
    return c;
  }, [activeTasks]);

  const headerSubtitle =
    userRole === 'managing_director'
      ? 'Manage all firm tasks and approvals'
      : isAssociateLike(userRole)
        ? 'Your assigned tasks and deadlines'
        : 'Task coordination and tracking';

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Tasks</h1>
        <p className="text-gray-600">{headerSubtitle}</p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search tasks..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-gray-400 focus:outline-none"
          />
        </div>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as any)}
          className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-gray-400 focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="Not Started">Not Started</option>
          <option value="In Progress">In Progress</option>
          <option value="Pending Approval">Pending Approval</option>
          <option value="Completed">Completed</option>
        </select>

        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value as any)}
          className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-gray-400 focus:outline-none"
        >
          <option value="all">All Priorities</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading tasks...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {columns.map((col) => {
              const colTasks = filteredTasks.filter((t) => getColumn(t) === col);

              return (
                <div key={col} className="bg-white border border-gray-200 rounded-lg">
                  <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">{col}</h3>
                    <span className="px-2 py-1 text-xs rounded border border-gray-200 bg-gray-50 text-gray-700">
                      {colTasks.length}
                    </span>
                  </div>

                  <div className="p-4 space-y-3 min-h-[220px]">
                    {colTasks.length === 0 ? (
                      <div className="text-sm text-gray-400 text-center py-10">No tasks</div>
                    ) : (
                      colTasks.map((task) => {
                        const relatedCase = caseMap.get(task.caseId);
                        const caseLabel = relatedCase?.caseNo || relatedCase?.parties || '—';

                        const showApproval = task.requiresApproval && task.approvalStatus === 'Pending';
                        const showRejected = task.requiresApproval && task.approvalStatus === 'Rejected';
                        const isCompleted = task.status === 'Completed';

                        return (
                          <Link
                            key={task._id}
                            to={`/tasks/${task._id}`}
                            className="block border border-gray-200 rounded-lg p-4 bg-white hover:shadow-sm transition"
                          >
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <span className={`px-2 py-0.5 text-xs rounded ${getPriorityPill(task.priority)}`}>
                                {task.priority}
                              </span>

                              {showApproval && (
                                <span className="px-2 py-0.5 text-xs rounded bg-purple-50 text-purple-700 border border-purple-100">
                                  Approval
                                </span>
                              )}

                              {showRejected && (
                                <span className="px-2 py-0.5 text-xs rounded bg-red-50 text-red-700 border border-red-100">
                                  Rejected
                                </span>
                              )}
                            </div>

                            <div className="text-sm font-semibold text-gray-900 mb-2">{task.title}</div>
                            <div className="text-xs text-gray-500 mb-2 truncate">{caseLabel}</div>

                            <div className="flex items-center justify-between text-xs text-gray-500">
                              <span className="truncate">{task.assignee}</span>
                              <span className="shrink-0">Due {task.dueDate}</span>
                            </div>
                            <div className="mt-3 flex items-center gap-2 flex-wrap">
                              {!isCompleted && (
                                <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${getTaskDeadlineColor(task)}`}>
                                  {formatDueCountdown(`${task.dueDate}T23:59:59.999`)}
                                </span>
                              )}
                              {/* performance badge removed */}
                            </div>
                          </Link>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
            {columns.map((c) => (
              <div key={c} className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="text-2xl font-semibold text-gray-900">{counts[c]}</div>
                <div className="text-sm text-gray-600">{c}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
