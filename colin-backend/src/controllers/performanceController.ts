import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Task from '../models/taskModel';
import User from '../models/userModel';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import { resolveDeadlineDateTime } from '../utils/deadlineUtils';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const isoToday = () => new Date().toISOString().slice(0, 10);

const parseRange = (q: any) => {
  const to = String(q?.to || isoToday()).slice(0, 10);
  const from =
    String(q?.from || '').slice(0, 10) ||
    (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
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

const getTimelinessScore = (task: any) => {
  const due = task?.dueDate ? resolveDeadlineDateTime(task.dueDate) : null;
  const completed = task?.completedAt ? new Date(task.completedAt) : null;
  const start =
    task?.startDate ? new Date(task.startDate) :
    task?.createdAt ? new Date(task.createdAt) :
    null;

  if (!due || !completed || !start) return null;
  if (!Number.isFinite(due.getTime()) || !Number.isFinite(completed.getTime()) || !Number.isFinite(start.getTime())) {
    return null;
  }

  const totalMs = due.getTime() - start.getTime();
  const usedMs = completed.getTime() - start.getTime();
  if (totalMs <= 0 || !Number.isFinite(totalMs) || !Number.isFinite(usedMs)) return null;

  const consumedPercent = Math.max(0, Math.round((usedMs / totalMs) * 1000) / 10);
  return Math.min(100, Math.max(0, Math.round(100 - consumedPercent)));
};

const computeRating1to5 = (inputs: {
  productivityScore: number | null; // 0..100
  qualityScore: number | null;      // 0..100
  reliabilityScore: number | null;  // 0..100
}): number | null => {
  // A rating requires all three inputs to be real data - never invent values.
  if (inputs.productivityScore == null || inputs.qualityScore == null || inputs.reliabilityScore == null) return null;

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

const normalizePerformanceName = (value: unknown) => String(value || '').trim().toLowerCase();

/** Whether the user is part of the assigned team of a case. */
const caseTeamIncludes = (c: any, name: string) => {
  const me = normalizePerformanceName(name);
  if (!me) return false;
  const candidates = [
    c?.assignedTo,
    c?.caseAssignments?.initiator,
    c?.caseAssignments?.reviewer,
    c?.caseAssignments?.signerApprover,
  ].map(normalizePerformanceName).filter(Boolean);
  return candidates.includes(me);
};

const isClosedCase = (c: any) => String(c?.status || '').trim().toLowerCase() === 'closed';

/** A Task is the whole case: it is completed only when every Key Action is completed. */
const wholeCaseCompleted = (inst: any) => {
  if (!inst) return false;
  if (String(inst?.status || '').trim().toLowerCase() === 'completed') return true;
  const steps = Array.isArray(inst?.steps) ? inst.steps : [];
  if (!steps.length) return false;
  return steps.every((s: any) => String(s?.status || '').trim().toLowerCase() === 'completed');
};

const stepDate = (value: unknown): Date | null => {
  const resolved = resolveDeadlineDateTime(value as never);
  return resolved && Number.isFinite(resolved.getTime()) ? resolved : null;
};

/** Whole-case completion moment = the latest completed Key Action's completedAt. */
const caseCompletionDate = (c: any, inst: any): Date | null => {
  if (inst) {
    const completedSteps = (Array.isArray(inst.steps) ? inst.steps : []) as any[];
  const dateValues: Array<Date | null> = completedSteps
    .filter((s: any) => String(s?.status || '').trim().toLowerCase() === 'completed' && s?.completedAt)
    .map((s: any): Date | null => stepDate(s.completedAt));
  const dates = dateValues.filter((d): d is Date => d !== null && Number.isFinite(d.getTime()));
    if (dates.length) return new Date(Math.max(...dates.map((d) => d.getTime())));
  }
  if (isClosedCase(c)) {
    const updated = c?.updatedAt ? new Date(c.updatedAt) : null;
    if (updated && Number.isFinite(updated.getTime())) return updated;
  }
  return null;
};

/** Next/current due date of the open portion of the case workflow. */
const caseNextDueAt = (c: any, inst: any): Date | null => {
  if (inst && !wholeCaseCompleted(inst)) {
    const steps = (Array.isArray(inst.steps) ? inst.steps : []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
    const open = steps.find((s: any) => String(s?.status || '').trim().toLowerCase() !== 'completed');
    if (open?.dueAt) return stepDate(open.dueAt);
    for (const s of steps) if (s?.dueAt) return stepDate(s.dueAt);
  }
  return stepDate(c?.workflowProgress?.currentStepDueAt) || stepDate(c?.workflowProgress?.nextDueAt);
};

/**
 * Whole-case timeliness from the last completed Key Action using the existing
 * 100 âˆ’ consumed% formula. Always capped at 100 â€” never above.
 */
const caseTimelinessScore = (c: any, inst: any): number | null => {
  if (!inst) return null;
  const steps = (Array.isArray(inst.steps) ? inst.steps : [])
    .filter((s: any) => String(s?.status || '').trim().toLowerCase() === 'completed' && s?.startAt && s?.completedAt && s?.dueAt)
    .sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  if (!steps.length) return null;
  const last = steps[steps.length - 1];
  const startAt = stepDate(last.startAt);
  const completedAt = stepDate(last.completedAt);
  const dueAt = stepDate(last.dueAt);
  if (!startAt || !completedAt || !dueAt) return null;
  const totalMs = dueAt.getTime() - startAt.getTime();
  if (!Number.isFinite(totalMs) || totalMs <= 0) return null;
  const usedMs = completedAt.getTime() - startAt.getTime();
  const consumed = Math.round((usedMs / totalMs) * 1000) / 10;
  return Math.min(100, Math.max(0, Math.round(100 - consumed)));
};

async function computeUserPerformance(req: AuthRequest, userName: string, from: string, to: string) {
  const scopeName = String(userName || req.user?.name || '').trim();

  // A Task is the whole case: the universe below is the user's matters (cases),
  // never the staged per-Key-Action task records.
  const [cases, contributorTasks] = await Promise.all([
    Case.find()
      .select('_id caseNo assignedTo caseAssignments status priority workflowProgress caseManagement createdAt updatedAt workflowStartDate')
      .lean(),
    scopeName
      ? Task.find({ $or: [{ assignee: scopeName }, { supervisor: scopeName }] }).select('caseId taskStages').lean()
      : [],
  ]);

  const me = normalizePerformanceName(scopeName);
  const contribCaseIds = new Set<string>();
  for (const task of contributorTasks as any[]) {
    if (task?.caseId) contribCaseIds.add(String(task.caseId));
    for (const stage of task?.taskStages || []) {
      if (stage?.staffMember && normalizePerformanceName(stage.staffMember) === me && task.caseId) {
        contribCaseIds.add(String(task.caseId));
      }
    }
  }

  const myCases = (cases as any[]).filter(
    (c) => caseTeamIncludes(c, scopeName) || contribCaseIds.has(String(c._id))
  );
  const myCaseIds = (myCases as any[]).map((c) => c._id);
  const instances = myCaseIds.length
    ? await WorkflowInstance.find({ caseId: { $in: myCaseIds } }).select('caseId status steps').lean()
    : [];
  const instByCase = new Map<string, any>((instances as any[]).map((i) => [String(i.caseId), i]));

  // Project each matter into the shape the rest of this function consumes, with
  // task state now meaning whole-case state.
  const tasks = (myCases as any[]).map((c) => {
    const inst: any = instByCase.get(String(c._id)) || null;
    const completed = wholeCaseCompleted(inst) || isClosedCase(c);
    const completedAt = completed ? caseCompletionDate(c, inst) : null;
    const dueAt = caseNextDueAt(c, inst);
    const completedAtISO = completedAt && Number.isFinite(completedAt.getTime()) ? completedAt.toISOString() : '';
    const dueISO = dueAt && Number.isFinite(dueAt.getTime()) ? dueAt.toISOString().slice(0, 10) : '';
    const start = stepDate(c?.workflowStartDate) || (c?.createdAt ? new Date(c.createdAt) : null);
    const startISO = start && Number.isFinite(start.getTime()) ? start.toISOString().slice(0, 10) : '';
    const quality = Number.isFinite(Number(c?.caseManagement?.qualityScore))
      ? Math.min(100, Math.max(0, Number(c.caseManagement.qualityScore)))
      : null;
    const pendingDecision = Boolean(
      !completed &&
      !isClosedCase(c) &&
      inst &&
      (Array.isArray(inst.steps) ? inst.steps : []).some((s: any) => {
        const status = String(s?.status || '').toLowerCase();
        return status === 'awaiting review' || status === 'awaiting approval';
      })
    );
    return {
      _id: c._id,
      caseId: String(c._id),
      title: String(c.caseNo || ''),
      dueDate: dueISO,
      startDate: startISO,
      completedAt: completedAtISO || undefined,
      status: completed ? 'Completed' : String(c?.workflowProgress?.status || c?.status || 'In Progress'),
      priority: String(c?.priority || 'Medium'),
      qualityScore: quality,
      timelinessScore: completed && !isClosedCase(c) ? caseTimelinessScore(c, inst) : null,
      requiresApproval: pendingDecision,
      approvalStatus: pendingDecision ? 'Pending' : 'Not Required',
      isWholeCase: true,
    };
  });

  const fromD = new Date(`${from}T00:00:00.000Z`);
  const toD = new Date(`${to}T23:59:59.999Z`);

  // A matter belongs to the period when it was completed in it, or when an open
  // matter's next due date falls inside it.
  const inRangeTasks = tasks.filter((t: any) => {
    if (t.completedAt) {
      const comp = new Date(t.completedAt);
      if (Number.isFinite(comp.getTime()) && comp.getTime() >= fromD.getTime() && comp.getTime() <= toD.getTime()) {
        return true;
      }
    }
    if (String(t.status || '').toLowerCase() !== 'completed' && t.dueDate) {
      const due = resolveDeadlineDateTime(t.dueDate);
      if (due && due.getTime() >= fromD.getTime() && due.getTime() <= toD.getTime()) return true;
    }
    return false;
  });

  const completed = inRangeTasks.filter((t: any) => String(t.status || '').toLowerCase() === 'completed');
  // Whole cases completed are the approved work; there is no rejection signal in the data model.
  const approved = completed;
  const rejected: any[] = [];
  const pending = inRangeTasks.filter((t: any) => t.requiresApproval === true && t.approvalStatus === 'Pending');

  // On-time: completedAt <= dueDate
  const onTimeCount = completed.filter((t: any) => {
    const comp = t.completedAt ? new Date(t.completedAt) : null;
    const due = resolveDeadlineDateTime(t.dueDate);
    if (!comp || !due) return false;
    return comp.getTime() <= due.getTime();
  }).length;
  const deadlineBreakdown = completed.reduce(
    (acc: { early: number; onTime: number; late: number }, t: any) => {
      const comp = t.completedAt ? new Date(t.completedAt) : null;
      const due = resolveDeadlineDateTime(t.dueDate);
      if (!comp || !due || !Number.isFinite(due.getTime())) return acc;
      const diffHours = (due.getTime() - comp.getTime()) / (1000 * 60 * 60);
      if (diffHours >= 24) acc.early += 1;
      else if (diffHours >= 0) acc.onTime += 1;
      else acc.late += 1;
      return acc;
    },
    { early: 0, onTime: 0, late: 0 }
  );
  const overdueCount = inRangeTasks.filter((t: any) => {
    if (t.status === 'Completed') return false;
    const due = resolveDeadlineDateTime(t.dueDate);
    return due ? due.getTime() < Date.now() : String(t.dueDate) < isoToday();
  }).length;

  const onTimePct = completed.length ? Math.round((onTimeCount / completed.length) * 100) : 0;

  // Monthly aggregates (by dueDate month)
  const monthlyMap = new Map<string, { month: string; tasksCompleted: number; tasksTotal: number; onTime: number; late: number }>();
  for (const t of inRangeTasks as any[]) {
    const dt = resolveDeadlineDateTime(String(t.dueDate));
    if (!dt) continue;
    const key = monthKey(dt);
    const row = monthlyMap.get(key) || { month: key, tasksCompleted: 0, tasksTotal: 0, onTime: 0, late: 0 };
    row.tasksTotal += 1;
    if (t.status === 'Completed') {
      row.tasksCompleted += 1;
      const comp = t.completedAt ? new Date(t.completedAt) : null;
      const due = resolveDeadlineDateTime(t.dueDate);
      if (comp && due && comp.getTime() <= due.getTime()) row.onTime += 1;
      else if (due) row.late += 1;
    }
    monthlyMap.set(key, row);
  }
  const monthly = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  // Breakdown by priority
  const priorityLabels = ['High', 'Medium', 'Low'];
  const byPriority = priorityLabels.map((label) => {
    const items = inRangeTasks.filter((t: any) => t.priority === label);
    const completedItems = items.filter((t: any) => t.status === 'Completed').length;
    return { label, completed: completedItems, total: items.length };
  });

  // Breakdown by whole-case status (dynamic so every matter status is reported)
  const statusGroupMap = new Map<string, { label: string; completed: number; total: number }>();
  for (const t of inRangeTasks as any[]) {
    const label = String(t.status || 'In Progress');
    const row = statusGroupMap.get(label) || { label, completed: 0, total: 0 };
    row.total += 1;
    if (String(t.status || '').toLowerCase() === 'completed') row.completed += 1;
    statusGroupMap.set(label, row);
  }
  const byStatus = Array.from(statusGroupMap.values());

  // Weighted productivity: completed tasks weighted by priority, normalized
  const weightedCompleted = completed.reduce((s: number, t: any) => s + priorityWeight(t.priority), 0);
  const weightedTotal = inRangeTasks.reduce((s: number, t: any) => s + priorityWeight(t.priority), 0);
  const productivityScore = weightedTotal ? Math.round((weightedCompleted / weightedTotal) * 100) : 0;

  const scoredQuality = completed.filter((t: any) => Number.isFinite(Number(t.qualityScore)));
  const averageQualityScore = scoredQuality.length
    ? Math.round((scoredQuality.reduce((sum: number, t: any) => sum + (Number(t.qualityScore) || 0), 0) / scoredQuality.length) * 10) / 10
    : null;

  // Whole-case timeliness uses the score already computed from the completed
  // workflow (100 âˆ’ consumed%, always capped at 100).
  const scoredTimeliness = completed
    .map((t: any) => t.timelinessScore as number | undefined | null)
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score) && score >= 0);
  const averageTimelinessScore = scoredTimeliness.length
    ? Math.round((scoredTimeliness.reduce((sum: number, score: number) => sum + score, 0) / scoredTimeliness.length) * 10) / 10
    : null;

  // Quality & reliability only from real data â€” never inferred from other metrics.
  const approvalRate: number | null = null; // no rejection signal exists in the data model
  const qualityScore = averageQualityScore != null
    ? clamp(averageQualityScore, 0, 100)
    : null;

  // Reliability score based on task timeliness, then on-time completion as fallback
  const onTimeReliability = completed.length ? onTimePct : null;
  const reliabilityScore = averageTimelinessScore != null
    ? clamp(averageTimelinessScore, 0, 100)
    : onTimeReliability != null
      ? clamp(onTimeReliability, 0, 100)
      : null;

  const rating = computeRating1to5({ productivityScore, qualityScore, reliabilityScore });

  return {
    range: { from, to },
    user: { name: userName },
    tasksCompleted: completed.length,
    tasksTotal: inRangeTasks.length,
    onTimeCompletionPct: clamp(onTimePct, 0, 100),
    averageQualityScore,
    averageTimelinessScore,
    pendingQualityScores: completed.filter((t: any) => !Number.isFinite(Number(t.qualityScore))).length,
    deadlineBreakdown: {
      ...deadlineBreakdown,
      overdue: overdueCount,
    },

    approvals: {
      pending: pending.length,
      approved: approved.length,
      rejected: rejected.length,
      approvalRatePct: approvalRate == null ? null : clamp(approvalRate, 0, 100),
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

    // Rank: rating desc, then productivity desc, then on-time completion desc
    rows.sort((a, b) => {
      const ar = a.rating == null ? -1 : a.rating;
      const br = b.rating == null ? -1 : b.rating;
      if (br !== ar) return br - ar;
      if (b.scores.productivity !== a.scores.productivity) return b.scores.productivity - a.scores.productivity;
      return (b.onTimeCompletionPct || 0) - (a.onTimeCompletionPct || 0);
    });

    return res.json({ range: { from, to }, results: rows });
  } catch {
    return res.status(500).json({ message: 'Failed to load team performance.' });
  }
};
