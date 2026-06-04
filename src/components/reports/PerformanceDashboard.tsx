import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  CheckSquare,
  Clock,
  Award,
  AlertTriangle,
  Calendar as CalendarIcon,
} from 'lucide-react';

import { UserRole } from '../../App';
import { getMyPerformance, PerformanceSummary } from '../../services/performanceService';
import { getAllTasks, TaskData } from '../../services/taskService';

interface PerformanceDashboardProps {
  userRole: UserRole;
}

type StatCard = {
  label: string;
  value: string;
  target?: string;
  helper?: string;
  icon: React.ComponentType<any>;
  color?: 'red';
  trendText?: string; // right-side small indicator text
};

const canAccess = (role: UserRole) =>
  role === 'associate' ||
  role === 'trainee_associate' ||
  role === 'senior_associate' ||
  role === 'intern' ||
  role === 'managing_director' ||
  role === 'managing_partner' ||
  role === 'senior_partner' ||
  role === 'partner' ||
  role === 'associate_partner' ||
  role === 'executive_assistant';
  
const isoToday = () => new Date().toISOString().slice(0, 10);
const startOfMonthISO = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

const ratingLabel = (v?: number) => {
  switch (v) {
    case 5:
      return 'Excellent';
    case 4:
      return 'Very Good';
    case 3:
      return 'Good';
    case 2:
      return 'Needs Improvement';
    case 1:
      return 'Poor';
    default:
      return '—';
  }
};

export default function PerformanceDashboard({ userRole }: PerformanceDashboardProps) {
  const [data, setData] = useState<PerformanceSummary | null>(null);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const today = useMemo(() => isoToday(), []);
  const monthStart = useMemo(() => startOfMonthISO(), []);

  useEffect(() => {
    if (!canAccess(userRole)) return;

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError('');

        const [perf, myTasks] = await Promise.all([getMyPerformance(), getAllTasks()]);

        if (!mounted) return;
        setData(perf);
        setTasks(myTasks);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load performance.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [userRole]);

  // --------------------------
  // Workflow signals (based on tasks list)
  // --------------------------
  const workflowSignals = useMemo(() => {
    const isCompleted = (t: TaskData) => t.status === 'Completed';

    const overdue = tasks.filter((t) => !isCompleted(t) && t.dueDate < today);

    const dueSoon = tasks
      .filter((t) => !isCompleted(t) && t.dueDate >= today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 5);

    const pendingApprovals = tasks.filter(
      (t) => t.requiresApproval && t.approvalStatus === 'Pending'
    );

    // Keep best-effort fallback: completedAt -> updatedAt
    const completedThisMonth = tasks.filter((t) => {
      if (!isCompleted(t)) return false;
      const updated = String((t as any).completedAt || t.updatedAt || '').slice(0, 10);
      return updated && updated >= monthStart;
    });

    return {
      totalTasks: tasks.length,
      overdueCount: overdue.length,
      overdueTop: overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5),
      dueSoon,
      pendingApprovalsCount: pendingApprovals.length,
      completedThisMonthCount: completedThisMonth.length,
    };
  }, [tasks, today, monthStart]);

  // --------------------------
  // Stats (reformatted UI like AssociateDashboard cards)
  // --------------------------
  const stats: StatCard[] = useMemo(() => {
    const rating = data?.rating?.value;
    const approvalRate = data?.approvals?.approvalRatePct ?? 0;
    const rejected = data?.approvals?.rejected ?? 0;

    const tasksCompleted = data?.tasksCompleted ?? 0;
    const tasksTotal = data?.tasksTotal ?? 0;

    const billableHours = data?.billableHours ?? 0;
    const onTime = data?.onTimeCompletionPct ?? 0;
    const deadlines = data?.deadlineBreakdown;

    const hasAnyTasks = workflowSignals.totalTasks > 0;

    return [
      {
        label: 'Rating (1–5)',
        value: rating ? `${rating}/5` : '—',
        helper: rating ? ratingLabel(rating) : '',
        icon: Award,
        trendText: rating ? `${Math.round((rating / 5) * 100)}%` : '—',
      },
      {
        label: 'Tasks Completed',
        value: String(tasksCompleted),
        helper: `In period: ${tasksTotal} total`,
        icon: CheckSquare,
        trendText:
          tasksTotal > 0 ? `${Math.round((tasksCompleted / Math.max(1, tasksTotal)) * 100)}%` : '—',
      },
      {
        label: 'Billable Hours',
        value: String(billableHours),
        helper: 'From time logs (period)',
        icon: Clock,
        trendText: billableHours ? 'MTD' : '—',
      },
      {
        label: 'Approval Rate',
        value: `${approvalRate}%`,
        helper: `Rejected: ${rejected}`,
        icon: TrendingUp,
        trendText: approvalRate ? `${approvalRate}%` : '—',
      },
      {
        label: 'On-time Completion',
        value: `${onTime}%`,
        helper: 'Completed vs due date',
        icon: TrendingUp,
        trendText: onTime ? `${onTime}%` : '—',
      },
      {
        label: 'Early / On Time / Late',
        value: deadlines ? `${deadlines.early}/${deadlines.onTime}/${deadlines.late}` : '—',
        helper: 'Deadline behavior',
        icon: CalendarIcon,
        trendText: deadlines ? `${deadlines.overdue} overdue` : '—',
        color: deadlines?.late || deadlines?.overdue ? 'red' : undefined,
      },
      {
        label: 'Overdue Tasks',
        value: hasAnyTasks ? String(workflowSignals.overdueCount) : '—',
        helper: hasAnyTasks ? 'Should be 0' : '',
        icon: AlertTriangle,
        color: workflowSignals.overdueCount ? 'red' : undefined,
        trendText: hasAnyTasks ? (workflowSignals.overdueCount ? 'Action needed' : 'Healthy') : '—',
      },
    ];
  }, [data, workflowSignals.totalTasks, workflowSignals.overdueCount]);

  // --------------------------
  // Trends & breakdowns
  // --------------------------
  const monthlyData = useMemo(() => {
    return (data?.monthly || []).slice(-6).map((m) => ({
      month: m.month,
      tasks: m.tasksCompleted,
      hours: m.hours,
    }));
  }, [data]);

  const tasksBreakdown = useMemo(() => {
    const byPriority = data?.byPriority || [];
    return byPriority.map((p) => ({
      label: `Priority: ${p.label}`,
      completed: p.completed,
      total: p.total,
      hours: p.hours,
    }));
  }, [data]);

  // --------------------------
  // Achievements
  // --------------------------
  const achievements = useMemo(() => {
    const perf = data;
    if (!perf) return [];

    const completed = perf.tasksCompleted;
    const total = perf.tasksTotal;
    const hours = perf.billableHours;
    const onTime = perf.onTimeCompletionPct;

    const list: Array<{ title: string; description: string; icon: any; color: string }> = [];

    if (perf.rating?.value) {
      list.push({
        title: `Rating: ${perf.rating.value}/5 (${ratingLabel(perf.rating.value)})`,
        description: `Productivity ${perf.rating.productivityScore}% • Quality ${perf.rating.qualityScore}% • Reliability ${perf.rating.reliabilityScore}%`,
        icon: Award,
        color:
          perf.rating.value >= 4
            ? 'bg-green-100 text-green-700'
              : perf.rating.value >= 3
              ? 'bg-yellow-400 text-black'
              : 'bg-red-100 text-red-700',
      });
    }

    if (completed > 0) {
      list.push({
        title: `Completed ${completed} tasks`,
        description: `Within ${perf.range.from} → ${perf.range.to}`,
        icon: CheckSquare,
        color: 'bg-blue-100 text-blue-700',
      });
    }

    if (hours > 0) {
      list.push({
        title: `${hours} hours logged`,
        description: `Based on time logs in the selected period`,
        icon: Clock,
        color: 'bg-slate-100 text-slate-700',
      });
    }

    list.push({
      title: `On-time completion: ${onTime}%`,
      description: `Uses completedAt (backend) compared to due dates`,
      icon: TrendingUp,
      color: onTime >= 90 ? 'bg-green-100 text-green-700' : 'bg-yellow-400 text-black',
    });

    list.push({
      title: `Task coverage`,
      description: `${completed} completed out of ${total} tasks in the selected period`,
      icon: Award,
      color: 'bg-purple-100 text-purple-700',
    });

    return list.slice(0, 4);
  }, [data]);

  if (!canAccess(userRole)) {
    return (
      <div className="p-6 bg-white border border-gray-200 rounded">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">You do not have permission to view performance.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">My Performance</h1>
        <p className="text-gray-600">
          {loading
            ? 'Loading…'
            : data
              ? `Period: ${data.range.from} → ${data.range.to}`
              : 'Track your productivity and achievements'}
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 border border-red-200 bg-red-50 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Metrics Grid (match AssociateDashboard style) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {stats.map((stat) => {
          const Icon = stat.icon;

          return (
            <div key={stat.label} className="bg-white border border-gray-200 rounded-lg p-5">
              <div className="flex items-start justify-between mb-3">
                <div
                  className={`w-10 h-10 ${
                    stat.color === 'red' ? 'bg-red-100' : 'bg-gray-100'
                  } rounded-lg flex items-center justify-center`}
                >
                  <Icon
                    className={`w-5 h-5 ${
                      stat.color === 'red' ? 'text-red-600' : 'text-gray-700'
                    }`}
                  />
                </div>

                <div className="flex items-center text-xs text-gray-500">
                  <TrendingUp className="w-3 h-3 mr-1" />
                  {loading ? '…' : stat.trendText || '—'}
                </div>
              </div>

              <div className="text-2xl font-semibold text-gray-900 mb-1">
                {loading ? '…' : stat.value}
              </div>
              <div className="text-sm text-gray-600">{stat.label}</div>

              {stat.target ? (
                <div className="mt-1 text-xs text-gray-500">Target: {stat.target}</div>
              ) : null}

              {stat.helper ? <div className="mt-2 text-xs text-gray-500">{stat.helper}</div> : null}

              {!loading && stat.label === 'Overdue Tasks' && workflowSignals.overdueCount > 0 ? (
                <div className="mt-2 text-xs text-red-600">
                  {workflowSignals.overdueCount} overdue (attention)
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Body layout (same modules, rearranged as clean panels) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Trend */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Monthly Performance Trend</h2>

          {loading ? (
            <div className="text-gray-500">Loading…</div>
          ) : monthlyData.length === 0 ? (
            <div className="text-gray-500">No data available.</div>
          ) : (
            <div className="space-y-4">
              {monthlyData.map((m) => {
                const maxTasks = Math.max(10, ...monthlyData.map((x) => x.tasks));
                const taskPercentage = maxTasks > 0 ? (m.tasks / maxTasks) * 100 : 0;

                return (
                  <div key={m.month}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium text-gray-900">{m.month}</span>
                      <div className="flex gap-4 text-xs text-gray-600">
                        <span>{m.tasks} tasks</span>
                        <span>{m.hours}h</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gray-700" style={{ width: `${taskPercentage}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Workflow Signals (summary + due soon) */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Workflow Signals</h2>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading…</div>
          ) : (
            <div className="p-5 space-y-5">
              <div className="flex flex-wrap gap-2">
                <span className="px-2.5 py-1 text-xs rounded bg-gray-100 text-gray-700">
                  Completed this month: <b>{workflowSignals.completedThisMonthCount}</b>
                </span>
                <span className="px-2.5 py-1 text-xs rounded bg-yellow-400 text-black">
                  Pending approvals: <b>{workflowSignals.pendingApprovalsCount}</b>
                </span>
                <span
                  className={`px-2.5 py-1 text-xs rounded ${
                    workflowSignals.overdueCount ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                  }`}
                >
                  Overdue tasks: <b>{workflowSignals.overdueCount}</b>
                </span>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <CalendarIcon className="w-4 h-4 text-gray-500" />
                  <h3 className="text-sm font-medium text-gray-900">Due Soon</h3>
                </div>

                {workflowSignals.dueSoon.length === 0 ? (
                  <div className="text-sm text-gray-500">No upcoming deadlines.</div>
                ) : (
                  <div className="divide-y divide-gray-200 border border-gray-200 rounded-lg">
                    {workflowSignals.dueSoon.map((t) => (
                      <div key={String(t._id)} className="p-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm text-gray-900 font-medium">{t.title}</div>
                          <div className="text-xs text-gray-500">
                            Due {t.dueDate} • {t.priority} • {t.status}
                          </div>
                        </div>
                        <Link
                          to={`/tasks/${t._id}`}
                          className="text-xs text-gray-700 hover:text-gray-900 underline"
                        >
                          View
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/tasks" className="text-sm text-gray-600 hover:text-gray-900">
              View all tasks →
            </Link>
          </div>
        </div>

        {/* Tasks Breakdown */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Tasks Breakdown</h2>

          {loading ? (
            <div className="text-gray-500">Loading…</div>
          ) : tasksBreakdown.length === 0 ? (
            <div className="text-gray-500">No data available.</div>
          ) : (
            <div className="space-y-4">
              {tasksBreakdown.map((item) => {
                const completionRate = item.total > 0 ? (item.completed / item.total) * 100 : 0;

                return (
                  <div key={item.label}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium text-gray-900">{item.label}</span>
                      <div className="flex gap-3 text-xs text-gray-600">
                        <span>
                          {item.completed}/{item.total}
                        </span>
                        <span>{item.hours}h</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${
                          completionRate === 100 ? 'bg-green-600' : 'bg-blue-600'
                        }`}
                        style={{ width: `${completionRate}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Achievements */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Recent Achievements</h2>

          {loading ? (
            <div className="text-gray-500">Loading…</div>
          ) : achievements.length === 0 ? (
            <div className="text-gray-500">No achievements yet.</div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {achievements.map((a) => {
                const Icon = a.icon;
                return (
                  <div key={a.title} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${a.color}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{a.title}</p>
                        <p className="text-xs text-gray-500 mt-1">{a.description}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-gray-200">
            <p className="text-xs text-gray-500">
              Achievements are generated from rating, task completion, approvals and time logs (when available).
            </p>
          </div>
        </div>

        {/* Overdue Attention (kept module, separated like a panel) */}
        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <h2 className="font-semibold text-gray-900">Overdue (Attention)</h2>
            </div>
            <span className="text-xs text-gray-500">
              {loading ? '…' : `${workflowSignals.overdueTop.length} shown`}
            </span>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading…</div>
          ) : workflowSignals.overdueTop.length === 0 ? (
            <div className="px-5 py-10 text-gray-500">No overdue tasks.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {workflowSignals.overdueTop.map((t) => (
                <div key={String(t._id)} className="px-5 py-4 hover:bg-gray-50 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-gray-900 font-medium">{t.title}</div>
                    <div className="text-xs text-red-700">Overdue since {t.dueDate} • {t.priority}</div>
                  </div>
                  <Link to={`/tasks/${t._id}`} className="text-xs text-gray-700 hover:text-gray-900 underline">
                    View
                  </Link>
                </div>
              ))}
            </div>
          )}

          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/tasks" className="text-sm text-gray-600 hover:text-gray-900">
              Go to task board →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
