import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import Task from '../models/taskModel';
import TaskTimeLog from '../models/taskTimeLogModel';
import User from '../models/userModel';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const isoToday = () => new Date().toISOString().slice(0, 10);

const parseRange = (q: any) => {
  const to = String(q?.to || isoToday()).slice(0, 10);
  const from =
    String(q?.from || '').slice(0, 10) ||
    (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 5);
      return d.toISOString().slice(0, 10);
    })();

  return { from, to };
};

const monthKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const priorityWeight = (p: string) => {
  if (p === 'High') return 3;
  if (p === 'Medium') return 2;
  return 1;
};

const computeRating1to5 = (inputs: {
  productivityScore: number; // 0..100
  qualityScore: number;      // 0..100
  reliabilityScore: number;  // 0..100
}) => {
  // Weighted score
  const total =
    0.45 * inputs.productivityScore +
    0.35 * inputs.qualityScore +
    0.20 * inputs.reliabilityScore;

  // Map to 1..5
  if (total >= 90) return 5;
  if (total >= 80) return 4;
  if (total >= 70) return 3;
  if (total >= 60) return 2;
  return 1;
};

const getUserScopeFilter = (req: AuthRequest, userName: string) => {
  // In your system tasks are scoped by assignee name (MVP).
  // MD can query anyone; others can query only self.
  if (req.user?.role === 'managing_director') return { assignee: userName };
  return { assignee: req.user?.name || '' };
};

async function computeUserPerformance(req: AuthRequest, userName: string, from: string, to: string) {
  const scope = getUserScopeFilter(req, userName);

  // Use completedAt for completion KPIs; use dueDate range for planning KPIs
  const tasks = await Task.find(scope).lean();

  // limit to range using dueDate for "workload in period"
  const inRangeTasks = tasks.filter((t: any) => String(t.dueDate) >= from && String(t.dueDate) <= to);

  const taskIds = inRangeTasks.map((t: any) => t._id);

  // time logs in range by loggedAt date (more correct than per-task calls)
  const logFilter: any = {
    taskId: { $in: taskIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
    loggedAt: { $gte: new Date(from + 'T00:00:00.000Z'), $lte: new Date(to + 'T23:59:59.999Z') },
  };
  if (req.user?.role !== 'managing_director') {
    logFilter.userName = req.user?.name || '';
  }

  const logs = await TaskTimeLog.find(logFilter).lean();

  const hoursByTask = new Map<string, number>();
  for (const l of logs as any[]) {
    const key = String(l.taskId);
    hoursByTask.set(key, (hoursByTask.get(key) || 0) + (Number(l.hours) || 0));
  }
  const hoursForTask = (taskId: any) => Number(hoursByTask.get(String(taskId)) || 0);

  const completed = inRangeTasks.filter((t: any) => t.status === 'Completed');
  const approved = inRangeTasks.filter((t: any) => t.requiresApproval && t.approvalStatus === 'Approved');
  const rejected = inRangeTasks.filter((t: any) => t.requiresApproval && t.approvalStatus === 'Rejected');
  const pending = inRangeTasks.filter((t: any) => t.requiresApproval && t.approvalStatus === 'Pending');

  // On-time: completedAt <= dueDate
  const onTimeCount = completed.filter((t: any) => {
    const comp = t.completedAt ? new Date(t.completedAt) : null;
    if (!comp) return false;
    const compISO = comp.toISOString().slice(0, 10);
    return compISO <= String(t.dueDate);
  }).length;
  const deadlineBreakdown = completed.reduce(
    (acc: { early: number; onTime: number; late: number }, t: any) => {
      const comp = t.completedAt ? new Date(t.completedAt) : null;
      const due = new Date(`${t.dueDate}T23:59:59.999`);
      if (!comp || !Number.isFinite(due.getTime())) return acc;
      const diffHours = (due.getTime() - comp.getTime()) / (1000 * 60 * 60);
      if (diffHours >= 24) acc.early += 1;
      else if (diffHours >= 0) acc.onTime += 1;
      else acc.late += 1;
      return acc;
    },
    { early: 0, onTime: 0, late: 0 }
  );
  const overdueCount = inRangeTasks.filter((t: any) => t.status !== 'Completed' && String(t.dueDate) < isoToday()).length;

  const onTimePct = completed.length ? Math.round((onTimeCount / completed.length) * 100) : 0;

  const billableHours = logs.reduce((s: number, l: any) => s + (Number(l.hours) || 0), 0);

  // Monthly aggregates (by dueDate month)
  const monthlyMap = new Map<string, { month: string; tasksCompleted: number; hours: number }>();
  for (const t of inRangeTasks as any[]) {
    const dt = new Date(String(t.dueDate));
    const key = monthKey(dt);
    const row = monthlyMap.get(key) || { month: key, tasksCompleted: 0, hours: 0 };
    if (t.status === 'Completed') row.tasksCompleted += 1;
    row.hours += hoursForTask(t._id);
    monthlyMap.set(key, row);
  }
  const monthly = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  // Breakdown by priority
  const priorityLabels = ['High', 'Medium', 'Low'];
  const byPriority = priorityLabels.map((label) => {
    const items = inRangeTasks.filter((t: any) => t.priority === label);
    const completedItems = items.filter((t: any) => t.status === 'Completed').length;
    const hours = items.reduce((s: number, t: any) => s + hoursForTask(t._id), 0);
    return { label, completed: completedItems, total: items.length, hours: Math.round(hours * 10) / 10 };
  });

  // Breakdown by status
  const statusLabels = ['Not Started', 'In Progress', 'Completed'];
  const byStatus = statusLabels.map((label) => {
    const items = inRangeTasks.filter((t: any) => t.status === label);
    const completedItems = items.filter((t: any) => t.status === 'Completed').length;
    const hours = items.reduce((s: number, t: any) => s + hoursForTask(t._id), 0);
    return { label, completed: completedItems, total: items.length, hours: Math.round(hours * 10) / 10 };
  });

  // Weighted productivity: completed tasks weighted by priority, normalized
  const weightedCompleted = completed.reduce((s: number, t: any) => s + priorityWeight(t.priority), 0);
  const weightedTotal = inRangeTasks.reduce((s: number, t: any) => s + priorityWeight(t.priority), 0);
  const productivityScore = weightedTotal ? Math.round((weightedCompleted / weightedTotal) * 100) : 0;

  // Quality score based on approval success
  const decided = approved.length + rejected.length;
  const approvalRate = decided ? Math.round((approved.length / decided) * 100) : 100; // if none, treat as perfect
  const qualityScore = clamp(approvalRate, 0, 100);

  // Reliability score based on on-time completion
  const reliabilityScore = clamp(onTimePct, 0, 100);

  const rating = computeRating1to5({ productivityScore, qualityScore, reliabilityScore });

  return {
    range: { from, to },
    user: { name: userName },
    tasksCompleted: completed.length,
    tasksTotal: inRangeTasks.length,
    billableHours: Math.round(billableHours * 10) / 10,
    onTimeCompletionPct: clamp(onTimePct, 0, 100),
    deadlineBreakdown: {
      ...deadlineBreakdown,
      overdue: overdueCount,
    },

    approvals: {
      pending: pending.length,
      approved: approved.length,
      rejected: rejected.length,
      approvalRatePct: clamp(approvalRate, 0, 100),
    },

    rating: {
      value: rating, // 1..5
      productivityScore,
      qualityScore,
      reliabilityScore,
    },

    monthly,
    byStatus,
    byPriority,
  };
}

// GET /api/performance/me
export const getMyPerformance = async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = parseRange(req.query);
    const me = req.user?.name;
    if (!me) return res.status(401).json({ message: 'Unauthorized' });

    const perf = await computeUserPerformance(req, me, from, to);
    return res.json(perf);
  } catch (e) {
    return res.status(500).json({ message: 'Failed to load performance.' });
  }
};

// GET /api/performance/team  (MD only)
export const getTeamPerformance = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'managing_director') {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const { from, to } = parseRange(req.query);
    const role = String(req.query.role || '').trim(); // optional filter

    const userFilter: any = { isActive: true };
    if (role) userFilter.role = role;

    const users = await User.find(userFilter).select('name role').lean();

    const rows = await Promise.all(
      users.map(async (u: any) => {
        // MD querying others: allow compute by passing MD req
        const perf = await computeUserPerformance(req, u.name, from, to);
        return {
          name: u.name,
          role: u.role,
          rating: perf.rating.value,
          tasksCompleted: perf.tasksCompleted,
          tasksTotal: perf.tasksTotal,
          billableHours: perf.billableHours,
          onTimeCompletionPct: perf.onTimeCompletionPct,
          approvals: perf.approvals,
          scores: {
            productivity: perf.rating.productivityScore,
            quality: perf.rating.qualityScore,
            reliability: perf.rating.reliabilityScore,
          },
        };
      })
    );

    // Rank: rating desc, then productivity desc, then hours desc
    rows.sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      if (b.scores.productivity !== a.scores.productivity) return b.scores.productivity - a.scores.productivity;
      return (b.billableHours || 0) - (a.billableHours || 0);
    });

    return res.json({ range: { from, to }, results: rows });
  } catch {
    return res.status(500).json({ message: 'Failed to load team performance.' });
  }
};
