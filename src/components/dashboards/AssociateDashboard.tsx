import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import usePageTitle from '../../hooks/usePageTitle';
import {
  Briefcase,
  CheckSquare,
  Clock,
  AlertTriangle,
  Calendar as CalendarIcon,
  TrendingUp,
} from 'lucide-react';

import { getAllTasks, TaskData } from '../../services/taskService';
import { getCaseById, CaseData } from '../../services/caseService';
import { getFirmEvents, FirmCalendarEvent } from '../../services/eventService';
import { getMyTimeLogSummary } from '../../services/timeLogService';

type StatCard = {
  label: string;
  value: string;
  icon: React.ComponentType<any>;
  color?: 'red';
};

const isoToday = () => new Date().toISOString().slice(0, 10);

const startOfMonthISO = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

const startOfWeekISO = () => {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1) - day; // Monday as first day
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

const addDaysISO = (baseISO: string, days: number) => {
  const d = new Date(baseISO);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const formatMonthLabel = () =>
  new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

const safeNum = (n: any) => (Number.isFinite(Number(n)) ? Number(n) : 0);

const statusTextColor = (status: string) => {
  switch (status) {
    case 'In Progress':
      return 'text-blue-600';
    case 'Not Started':
      return 'text-gray-600';
    case 'Completed':
      return 'text-green-600';
    default:
      return 'text-gray-600';
  }
};

const priorityChip = (priority: string) => {
  switch (priority) {
    case 'High':
      return 'bg-red-100 text-red-700';
    case 'Medium':
      return 'bg-yellow-100 text-gray-900';
    case 'Low':
      return 'bg-green-100 text-green-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
};

export default function AssociateDashboard() {
  const me = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null') as
        | { id: string; name: string; email: string; role: string }
        | null;
    } catch {
      return null;
    }
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  usePageTitle('Dashboard');
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [casesById, setCasesById] = useState<Record<string, CaseData>>({});
  const [events, setEvents] = useState<FirmCalendarEvent[]>([]);
  const [billableHoursMTD, setBillableHoursMTD] = useState(0);

  const today = useMemo(() => isoToday(), []);
  const weekStart = useMemo(() => startOfWeekISO(), []);
  const monthStart = useMemo(() => startOfMonthISO(), []);
  const next30Days = useMemo(() => addDaysISO(today, 30), [today]);
  const monthLabel = useMemo(() => formatMonthLabel(), []);

  const caseIds = useMemo(() => {
    const ids = new Set<string>();
    tasks.forEach((t) => {
      if (t.caseId) ids.add(String(t.caseId));
    });
    return Array.from(ids);
  }, [tasks]);

  const tasksDueToday = useMemo(
    () => tasks.filter((t) => t.dueDate === today && t.status !== 'Completed'),
    [tasks, today]
  );

  const overdueTasks = useMemo(
    () => tasks.filter((t) => t.status !== 'Completed' && t.dueDate < today),
    [tasks, today]
  );

  const completedThisWeek = useMemo(() => {
    return tasks.filter((t) => {
      if (t.status !== 'Completed') return false;
      const u = (t.updatedAt || '').slice(0, 10);
      return u && u >= weekStart;
    });
  }, [tasks, weekStart]);

  const myTasksPanel = useMemo(() => {
    const prioRank: Record<string, number> = { High: 1, Medium: 2, Low: 3 };
    return [...tasks]
      .sort((a, b) => {
        const d = String(a.dueDate || '9999-99-99').localeCompare(String(b.dueDate || '9999-99-99'));
        if (d !== 0) return d;
        return (prioRank[a.priority] || 9) - (prioRank[b.priority] || 9);
      })
      .slice(0, 6);
  }, [tasks]);

  const myCasesPanel = useMemo(() => {
    const nextDeadlineByCase: Record<string, string> = {};
    const countsByCase: Record<string, { total: number; done: number }> = {};

    for (const t of tasks) {
      if (!t.caseId) continue;
      const cid = String(t.caseId);

      countsByCase[cid] = countsByCase[cid] || { total: 0, done: 0 };
      countsByCase[cid].total += 1;
      if (t.status === 'Completed') countsByCase[cid].done += 1;

      if (t.status !== 'Completed') {
        const due = t.dueDate;
        if (due) {
          if (!nextDeadlineByCase[cid] || due < nextDeadlineByCase[cid]) nextDeadlineByCase[cid] = due;
        }
      }
    }

    const list = caseIds
      .map((id) => casesById[id])
      .filter(Boolean)
      .map((c) => {
        const cid = String(c._id);
        const counts = countsByCase[cid] || { total: 0, done: 0 };
        const progress = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;

        return {
          ...c,
          progress,
          nextDeadline: nextDeadlineByCase[cid] || '—',
        };
      })
      .sort((a, b) => {
        const aHas = a.nextDeadline && a.nextDeadline !== '—';
        const bHas = b.nextDeadline && b.nextDeadline !== '—';
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        if (!aHas && !bHas) return 0;
        return String(a.nextDeadline).localeCompare(String(b.nextDeadline));
      });

    return list;
  }, [caseIds, casesById, tasks]);

  const upcomingEvents = useMemo(() => {
    return [...events]
      .filter((e) => String(e.date) >= today)
      .sort((a, b) => {
        const d = String(a.date).localeCompare(String(b.date));
        if (d !== 0) return d;
        return String(a.time || '').localeCompare(String(b.time || ''));
      })
      .slice(0, 5);
  }, [events, today]);

  const perfSnapshot = useMemo(() => {
    const completedMTD = tasks.filter(
      (t) => t.status === 'Completed' && (t.updatedAt || '').slice(0, 10) >= monthStart
    ).length;

    const completedAll = tasks.filter((t) => t.status === 'Completed');
    const onTimeCount = completedAll.filter((t) => {
      const completedDate = (t.updatedAt || '').slice(0, 10);
      return completedDate && completedDate <= t.dueDate;
    }).length;
    const onTimePct = completedAll.length ? Math.round((onTimeCount / completedAll.length) * 100) : 0;

    return { completedMTD, onTimePct };
  }, [tasks, monthStart]);

  const stats: StatCard[] = useMemo(() => {
    return [
      { label: 'My Active Cases', value: String(caseIds.length), icon: Briefcase },
      { label: 'Tasks Due Today', value: String(tasksDueToday.length), icon: AlertTriangle, color: 'red' },
      { label: 'Completed This Week', value: String(completedThisWeek.length), icon: CheckSquare },
      { label: 'Billable Hours (MTD)', value: String(billableHoursMTD), icon: Clock },
    ];
  }, [caseIds.length, tasksDueToday.length, completedThisWeek.length, billableHoursMTD]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setError('');

        // 1) Tasks
        const allTasks = await getAllTasks();
        if (!mounted) return;
        setTasks(allTasks);

        // 2) Fetch referenced cases
        const uniqueCaseIds = Array.from(
          new Set(allTasks.map((t) => String(t.caseId)).filter((x) => x && x !== 'undefined'))
        );

        const caseResults = await Promise.all(
          uniqueCaseIds.map(async (id) => {
            try {
              return await getCaseById(id);
            } catch {
              return null;
            }
          })
        );

        if (!mounted) return;
        const map: Record<string, CaseData> = {};
        caseResults.filter(Boolean).forEach((c: any) => {
          map[String(c._id)] = c;
        });
        setCasesById(map);

        // 3) Upcoming events (next 30 days)
        const ev = await getFirmEvents({ from: today, to: next30Days, type: 'all' });
        if (!mounted) return;
        setEvents(ev);

        // 4) Billable Hours (MTD) aggregated (accurate + fast)
        try {
          const resp = await getMyTimeLogSummary(monthStart, today);
          if (!mounted) return;
          setBillableHoursMTD(safeNum(resp.totalHours));
        } catch {
          if (!mounted) return;
          setBillableHoursMTD(0);
        }
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load associate dashboard.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [today, next30Days, monthStart]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Associates & Trainees Dashboard</h1>
        <p className="text-gray-600">
          {me?.name ? `Welcome, ${me.name}. ` : ''}
          View your assigned cases, tasks &amp; performance.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 border border-red-200 bg-red-50 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white border border-gray-200 rounded-lg p-5">
              <div className="flex items-start justify-between mb-3">
                <div
                  className={`w-10 h-10 ${stat.color === 'red' ? 'bg-red-100' : 'bg-gray-100'
                    } rounded-lg flex items-center justify-center`}
                >
                  <Icon className={`w-5 h-5 ${stat.color === 'red' ? 'text-red-600' : 'text-gray-700'}`} />
                </div>
              </div>

              <div className="text-2xl font-semibold text-gray-900 mb-1">{loading ? '…' : stat.value}</div>
              <div className="text-sm text-gray-600">{stat.label}</div>

              {!loading && stat.label === 'Tasks Due Today' && overdueTasks.length > 0 && (
                <div className="mt-2 text-xs text-red-600">{overdueTasks.length} overdue</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Rest of your UI unchanged below */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tasks */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="font-semibold text-gray-900">My Tasks</h2>
            <span className="px-2 py-1 text-xs rounded bg-red-100 text-red-700">
              {loading ? '…' : `${tasksDueToday.length} due today`}
            </span>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading tasks…</div>
          ) : myTasksPanel.length === 0 ? (
            <div className="px-5 py-10 text-gray-500">No tasks assigned.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {myTasksPanel.map((task) => (
                <div key={String(task._id)} className="px-5 py-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-0.5 text-xs rounded ${priorityChip(task.priority)}`}>
                          {task.priority}
                        </span>
                        <span className={`text-xs font-medium ${statusTextColor(task.status)}`}>
                          {task.status}
                        </span>

                        {task.requiresApproval && task.approvalStatus === 'Pending' && (
                          <span className="px-2 py-0.5 text-xs rounded bg-yellow-100 text-gray-900">
                            Pending approval
                          </span>
                        )}
                      </div>

                      <p className="text-sm font-medium text-gray-900 mb-1">{task.title}</p>
                      <p className="text-xs text-gray-500">
                        Case:{' '}
                        {casesById[String(task.caseId)]?.caseNo
                          ? `${casesById[String(task.caseId)]?.caseNo} • ${casesById[String(task.caseId)]?.parties || ''}`.trim()
                          : '—'}
                      </p>
                    </div>

                    <Link
                      to={`/tasks/${task._id}`}
                      className="ml-4 px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                    >
                      View
                    </Link>
                  </div>

                  <div className="flex items-center text-xs text-gray-500">
                    <Clock className="w-3 h-3 mr-1" />
                    Due {task.dueDate}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/tasks" className="text-sm text-gray-600 hover:text-gray-900">
              View all tasks →
            </Link>
          </div>
        </div>

        {/* Upcoming Events */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Upcoming Events</h2>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading events…</div>
          ) : upcomingEvents.length === 0 ? (
            <div className="px-5 py-10 text-gray-500">No upcoming events.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {upcomingEvents.map((event) => (
                <div key={String(event._id)} className="px-5 py-4 hover:bg-gray-50">
                  <p className="text-sm font-medium text-gray-900 mb-2">{event.title}</p>
                  <div className="flex items-center text-xs text-gray-600 mb-1">
                    <CalendarIcon className="w-3 h-3 mr-1" />
                    {event.date}
                    {event.case?.caseNo ? <span className="ml-2 text-gray-500">• {event.case.caseNo}</span> : null}
                  </div>
                  <div className="flex items-center text-xs text-gray-600">
                    <Clock className="w-3 h-3 mr-1" />
                    {event.time || '—'}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/calendar" className="text-sm text-gray-600 hover:text-gray-900">
              View calendar →
            </Link>
          </div>
        </div>

        {/* My Cases */}
        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Assigned Cases</h2>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading cases…</div>
          ) : myCasesPanel.length === 0 ? (
            <div className="px-5 py-10 text-gray-500">No assigned cases found.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {myCasesPanel.map((caseItem) => (
                <div key={String(caseItem._id)} className="px-5 py-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium text-gray-900">{caseItem.caseNo}</h3>
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">
                          {caseItem.caseType}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">Parties: {caseItem.parties}</p>
                      <p className="text-xs text-gray-500">
                        Status: {caseItem.status} • Priority: {caseItem.priority}
                      </p>
                    </div>

                    <Link
                      to={`/cases/${caseItem._id}`}
                      className="ml-4 px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                    >
                      Open
                    </Link>
                  </div>

                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                      <span>Progress</span>
                      <span>{caseItem.progress}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gray-700 transition-all" style={{ width: `${caseItem.progress}%` }} />
                    </div>
                  </div>

                  <div className="flex items-center text-xs text-gray-500">
                    <Clock className="w-3 h-3 mr-1" />
                    Next deadline: {caseItem.nextDeadline}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/cases" className="text-sm text-gray-600 hover:text-gray-900">
              View all cases →
            </Link>
          </div>
        </div>

        {/* Performance Snapshot */}
        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Performance Snapshot ({monthLabel})</h2>
          </div>

          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600">Tasks Completed (MTD)</span>
                <TrendingUp className="w-4 h-4 text-green-600" />
              </div>
              <div className="text-2xl font-semibold text-gray-900 mb-1">
                {loading ? '…' : perfSnapshot.completedMTD}
              </div>
              <div className="text-xs text-gray-500">Computed from completed tasks (approx)</div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600">Billable Hours (MTD)</span>
                <TrendingUp className="w-4 h-4 text-green-600" />
              </div>
              <div className="text-2xl font-semibold text-gray-900 mb-1">
                {loading ? '…' : billableHoursMTD}
              </div>
              <div className="text-xs text-gray-500">Computed from time logs</div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600">On-Time Completion</span>
                <TrendingUp className="w-4 h-4 text-green-600" />
              </div>
              <div className="text-2xl font-semibold text-gray-900 mb-1">
                {loading ? '…' : `${perfSnapshot.onTimePct}%`}
              </div>
              <div className="text-xs text-gray-500">Accurate with a completedAt field (optional)</div>
            </div>
          </div>

          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/performance" className="text-sm text-gray-600 hover:text-gray-900">
              View detailed performance →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
