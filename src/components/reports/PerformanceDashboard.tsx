import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Award,
  AlertTriangle,
  Calendar as CalendarIcon,
  CheckSquare,
  Clock,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';

import { UserRole } from '../../App';
import usePageTitle from '../../hooks/usePageTitle';
import { getAllTasks, TaskData } from '../../services/taskService';
import { getMyPerformance, PerformanceSummary } from '../../services/performanceService';

interface PerformanceDashboardProps {
  userRole: UserRole;
}

type Tone = 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'purple';

type MetricCard = {
  label: string;
  value: string;
  helper?: string;
  icon: React.ComponentType<any>;
  tone?: Tone;
  pill?: string;
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

const addDaysISO = (baseISO: string, days: number) => {
  const d = new Date(`${baseISO}T00:00:00Z`);
  d.setDate(d.getDate() + days);
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

const toneClasses: Record<Tone, { icon: string; text: string; chip: string; bar: string }> = {
  slate: {
    icon: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
    text: 'text-gray-900 dark:text-gray-100',
    chip: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
    bar: 'bg-gray-700 dark:bg-gray-500',
  },
  green: {
    icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    text: 'text-emerald-700 dark:text-emerald-300',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    bar: 'bg-emerald-600',
  },
  amber: {
    icon: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    text: 'text-amber-700 dark:text-amber-300',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    bar: 'bg-amber-500',
  },
  red: {
    icon: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    text: 'text-rose-700 dark:text-rose-300',
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    bar: 'bg-rose-600',
  },
  blue: {
    icon: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    text: 'text-blue-700 dark:text-blue-300',
    chip: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    bar: 'bg-blue-600',
  },
  purple: {
    icon: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    text: 'text-purple-700 dark:text-purple-300',
    chip: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    bar: 'bg-purple-600',
  },
};

function PageCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p> : null}
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}

function MetricTile({ metric, loading }: { metric: MetricCard; loading: boolean }) {
  const Icon = metric.icon;
  const tone = toneClasses[metric.tone || 'slate'];

  return (
    <div className="h-full rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone.icon}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className={`text-xs font-medium ${loading ? 'text-gray-500 dark:text-gray-400' : tone.text}`}>
          {loading ? '—' : metric.pill || 'Live'}
        </div>
      </div>
      <div className={`text-2xl font-semibold ${tone.text}`}>{loading ? '…' : metric.value}</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{metric.label}</div>
      {metric.helper ? <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{metric.helper}</div> : null}
    </div>
  );
}

export default function PerformanceDashboard({ userRole }: PerformanceDashboardProps) {
  const [data, setData] = useState<PerformanceSummary | null>(null);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const today = useMemo(() => isoToday(), []);
  usePageTitle('My Performance');

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

  const workflowSignals = useMemo(() => {
    const isCompleted = (task: TaskData) => task.status === 'Completed';
    const openTasks = tasks.filter((task) => !isCompleted(task));
    const overdue = openTasks
      .filter((task) => task.dueDate && task.dueDate < today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const dueSoon = openTasks
      .filter((task) => task.dueDate && task.dueDate >= today && task.dueDate <= addDaysISO(today, 7))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 5);
    const pendingApprovals = tasks.filter(
      (task) => task.requiresApproval && task.approvalStatus === 'Pending'
    );
    const awaitingReview = tasks.filter(
      (task) => task.workflowStage === 'Awaiting Review' || task.approvalStatus === 'Pending'
    );
    return {
      totalTasks: tasks.length,
      openTasks: openTasks.length,
      overdue,
      dueSoon,
      pendingApprovals,
      awaitingReview,
      completedThisMonthCount: data?.tasksCompleted ?? 0,
      completionRate: data?.tasksTotal ? Math.round(((data.tasksCompleted ?? 0) / data.tasksTotal) * 100) : 0,
      onTimeRate: data?.onTimeCompletionPct ?? 0,
    };
  }, [data?.onTimeCompletionPct, data?.tasksCompleted, data?.tasksTotal, tasks, today]);

  const metrics = useMemo<MetricCard[]>(() => {
    const rating = data?.rating?.value;
    const approvals = data?.approvals;
    const tasksCompleted = data?.tasksCompleted ?? 0;
    const tasksTotal = data?.tasksTotal ?? 0;
    const onTime = data?.onTimeCompletionPct ?? 0;
    const qualityScore = data?.averageQualityScore ?? data?.rating?.qualityScore ?? null;
    const timelinessScore = data?.averageTimelinessScore ?? data?.rating?.reliabilityScore ?? null;

    return [
      {
        label: 'Rating',
        value: rating ? `${rating}/5` : '—',
        helper: rating ? ratingLabel(rating) : 'Waiting for a rating',
        icon: Award,
        tone: rating && rating >= 4 ? 'green' : rating === 3 ? 'amber' : 'slate',
        pill: rating ? `${Math.round((rating / 5) * 100)}%` : '—',
      },
      {
        label: 'Tasks Completed',
        value: String(tasksCompleted),
        helper: tasksTotal ? `Out of ${tasksTotal} tasks in period` : 'No tasks in this period',
        icon: CheckSquare,
        tone: 'blue',
        pill: tasksTotal ? `${Math.round((tasksCompleted / Math.max(1, tasksTotal)) * 100)}%` : '—',
      },
      {
        label: 'On-Time Completion',
        value: `${onTime}%`,
        helper: 'Completed on or before due date',
        icon: Clock,
        tone: onTime >= 80 ? 'green' : onTime >= 60 ? 'amber' : 'red',
        pill: data?.deadlineBreakdown ? `${data.deadlineBreakdown.overdue} overdue` : 'Live',
      },
      {
        label: 'Approval Rate',
        value: `${approvals?.approvalRatePct ?? 0}%`,
        helper: `Approved: ${approvals?.approved ?? 0} • Rejected: ${approvals?.rejected ?? 0}`,
        icon: TrendingUp,
        tone: approvals && approvals.approvalRatePct >= 80 ? 'green' : 'amber',
        pill: `${approvals?.pending ?? 0} pending`,
      },
      {
        label: 'Average Quality Score',
        value: qualityScore == null ? '—' : `${qualityScore}%`,
        helper: 'Matches the productivity report',
        icon: Sparkles,
        tone: (qualityScore ?? 0) >= 80 ? 'green' : (qualityScore ?? 0) >= 60 ? 'amber' : 'red',
        pill: `${data?.pendingQualityScores ?? 0} pending`,
      },
      {
        label: 'Average Timeliness Score',
        value: timelinessScore == null ? '—' : `${timelinessScore}%`,
        helper: 'Matches the productivity report',
        icon: Users,
        tone: (timelinessScore ?? 0) >= 80 ? 'green' : (timelinessScore ?? 0) >= 60 ? 'amber' : 'red',
        pill: `${workflowSignals.overdue.length} overdue`,
      },
      {
        label: 'Open Tasks',
        value: String(workflowSignals.openTasks),
        helper: workflowSignals.dueSoon.length ? `${workflowSignals.dueSoon.length} due soon` : 'No deadlines in the next 7 days',
        icon: AlertTriangle,
        tone: workflowSignals.openTasks ? 'amber' : 'green',
        pill: `${workflowSignals.completedThisMonthCount} this month`,
      },
      {
        label: 'Pending Approvals',
        value: String(workflowSignals.pendingApprovals.length),
        helper: 'Waiting on partner or MD review',
        icon: CalendarIcon,
        tone: workflowSignals.pendingApprovals.length ? 'amber' : 'green',
        pill: `${workflowSignals.awaitingReview.length} review`,
      },
    ];
  }, [data, workflowSignals]);

  const monthlyData = useMemo(
    () =>
      (data?.monthly || []).slice(-6).map((month) => ({
        month: month.month,
        tasksCompleted: month.tasksCompleted,
        tasksTotal: month.tasksTotal,
        onTime: month.onTime,
        late: month.late,
        completionRate: month.tasksTotal > 0 ? Math.round((month.tasksCompleted / month.tasksTotal) * 100) : 0,
        onTimeRate: month.tasksCompleted > 0 ? Math.round((month.onTime / month.tasksCompleted) * 100) : 0,
      })),
    [data]
  );

  const statusBreakdown = useMemo(
    () =>
      (data?.byStatus || []).map((item) => ({
        label: item.label,
        completed: item.completed,
        total: item.total,
        percent: item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0,
      })),
    [data]
  );

  const achievements = useMemo(() => {
    if (!data) return [];
    const list: Array<{ title: string; description: string; icon: any; tone: Tone }> = [];

    if (data.rating?.value) {
      list.push({
        title: `Rating ${data.rating.value}/5`,
        description: `${ratingLabel(data.rating.value)} • Productivity ${data.rating.productivityScore}% • Quality ${data.averageQualityScore ?? data.rating.qualityScore}%`,
        icon: Award,
        tone: data.rating.value >= 4 ? 'green' : data.rating.value >= 3 ? 'amber' : 'red',
      });
    }

    if (data.tasksCompleted > 0) {
      list.push({
        title: `${data.tasksCompleted} tasks completed`,
        description: `Across the selected period (${data.range.from} → ${data.range.to})`,
        icon: CheckSquare,
        tone: 'blue',
      });
    }

    if ((data.approvals?.approvalRatePct ?? 0) > 0) {
      list.push({
        title: `Approval rate ${data.approvals?.approvalRatePct ?? 0}%`,
        description: `${data.approvals?.approved ?? 0} approved • ${data.approvals?.pending ?? 0} pending`,
        icon: TrendingUp,
        tone: data.approvals!.approvalRatePct >= 80 ? 'green' : 'amber',
      });
    }

    list.push({
      title: `On-time completion ${data.onTimeCompletionPct}%`,
      description: 'Computed from completedAt versus dueDate in the live task feed',
      icon: Clock,
      tone: data.onTimeCompletionPct >= 80 ? 'green' : 'amber',
    });

    return list.slice(0, 4);
  }, [data]);

  if (!canAccess(userRole)) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h1 className="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">Access denied</h1>
        <p className="text-gray-600 dark:text-gray-300">You do not have permission to view performance.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Junior Performance</div>
            <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">My Performance</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {loading
                ? 'Loading…'
                : data
                  ? `Period: ${data.range.from} → ${data.range.to}`
                  : 'Track your productivity, quality, and deadlines from live data'}
            </p>
          </div>
          <div className="rounded-full bg-gray-900 px-4 py-2 text-xs font-semibold text-white dark:bg-gray-100 dark:text-gray-900">
            Live task feed • progress visible in both themes
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricTile key={metric.label} metric={metric} loading={loading} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <PageCard title="Monthly Performance Trend" subtitle="Completion, on-time work, and task volume from live records">
            {loading ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
            ) : monthlyData.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">No monthly data available yet.</div>
            ) : (
              <div className="space-y-4">
                {monthlyData.map((month) => (
                  <div key={month.month} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{month.month}</div>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {month.tasksCompleted}/{month.tasksTotal} completed • {month.onTime} on time • {month.late} late
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{month.completionRate}% complete</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{month.onTimeRate}% on time</div>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      <div>
                        <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                          <span>Completion</span>
                          <span>{month.completionRate}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                          <div className="h-2 rounded-full bg-gray-700 dark:bg-gray-400" style={{ width: `${Math.min(100, month.completionRate)}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                          <span>On-time</span>
                          <span>{month.onTimeRate}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                          <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, month.onTimeRate)}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </PageCard>
        </div>

        <PageCard title="Workflow Signals" subtitle="What needs attention right now">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Completed this month', workflowSignals.completedThisMonthCount, 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'],
                ['Pending approvals', workflowSignals.pendingApprovals.length, 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'],
                ['Overdue tasks', workflowSignals.overdue.length, 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'],
                ['Due soon', workflowSignals.dueSoon.length, 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'],
              ].map(([label, value, classes]) => (
                <div key={String(label)} className={`rounded-2xl px-3 py-3 text-sm ${classes}`}>
                  <div className="font-semibold">{value}</div>
                  <div className="text-xs">{label}</div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Current completion</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Completed tasks divided by total tasks</div>
                </div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{workflowSignals.completionRate}%</div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div className="h-2 rounded-full bg-gray-700 dark:bg-gray-400" style={{ width: `${workflowSignals.completionRate}%` }} />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Due Soon</h3>
              </div>
              {workflowSignals.dueSoon.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">No upcoming deadlines.</div>
              ) : (
                <div className="space-y-2">
                  {workflowSignals.dueSoon.map((task) => (
                    <div key={String(task._id)} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{task.title}</div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Due {task.dueDate} • {task.priority} • {task.status}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className={`rounded-full px-2.5 py-1 text-xs font-medium ${task.priority === 'High' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' : task.priority === 'Medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
                          {task.priority}
                        </div>
                        <Link to={`/tasks/${task._id}`} className="text-xs font-medium text-gray-700 underline hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100">
                          Open
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </PageCard>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <PageCard title="Status Breakdown" subtitle="Progress by workflow status">
          {statusBreakdown.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">No status breakdown yet.</div>
          ) : (
            <div className="space-y-4">
              {statusBreakdown.map((item) => (
                <div key={item.label}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{item.label}</span>
                    <span className="text-gray-600 dark:text-gray-400">
                      {item.completed}/{item.total} • {item.percent}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div className="h-2 rounded-full bg-blue-600" style={{ width: `${item.percent}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </PageCard>
      </div>

      <PageCard title="Recent Achievements" subtitle="Signals generated from rating, completion, approvals, and live task data">
        {achievements.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">No achievements yet.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {achievements.map((achievement) => {
              const Icon = achievement.icon;
              const tone = toneClasses[achievement.tone];
              return (
                <div key={achievement.title} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
                  <div className="flex items-start gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone.icon}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{achievement.title}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{achievement.description}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageCard>

      <PageCard title="Overdue Attention" subtitle="Tasks that need immediate follow-up">
        {workflowSignals.overdue.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">No overdue tasks.</div>
        ) : (
          <div className="space-y-3">
            {workflowSignals.overdue.slice(0, 8).map((task) => (
              <div key={String(task._id)} className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{task.title}</div>
                  <div className="mt-1 text-xs text-rose-700 dark:text-rose-300">
                    Overdue since {task.dueDate} • {task.priority}
                  </div>
                </div>
                <Link to={`/tasks/${task._id}`} className="text-xs font-medium text-gray-700 underline hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100">
                  View
                </Link>
              </div>
            ))}
          </div>
        )}
      </PageCard>
    </div>
  );
}
