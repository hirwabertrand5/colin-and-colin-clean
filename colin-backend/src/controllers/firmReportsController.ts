import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';

import Case from '../models/caseModel';
import Task from '../models/taskModel';
import Invoice from '../models/invoiceModel';
import TaskTimeLog from '../models/taskTimeLogModel';
import User from '../models/userModel';
import PettyCashExpense from '../models/pettyCashExpenseModel';

const iso = (d: Date) => d.toISOString().slice(0, 10);

function computeRange(range?: string) {
  const to = new Date();
  to.setHours(23, 59, 59, 999);

  const from = new Date(to);
  const r = String(range || 'monthly').toLowerCase();

  if (r === 'weekly') from.setDate(from.getDate() - 7);
  else if (r === 'quarterly') from.setMonth(from.getMonth() - 3);
  else if (r === 'yearly') from.setFullYear(from.getFullYear() - 1);
  else from.setMonth(from.getMonth() - 1); // monthly default

  from.setHours(0, 0, 0, 0);
  return { from, to };
}

const monthKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const selectedPathLabel = (c: any) => {
  const path = Array.isArray(c?.legalServicePath) ? c.legalServicePath : [];
  const selected = path
    .map((item: any) => String(item?.label || '').trim())
    .filter(Boolean);
  // Use only the last path item
  return selected.length
    ? selected[selected.length - 1]
    : String(c?.matterType || c?.workflow || c?.caseType || 'Unclassified');
};

type PerformanceZone = 'excellent' | 'good' | 'delayed' | 'risk';

const roleEarningShare = (role?: string) => {
  const normalized = String(role || '').toLowerCase();
  const shares: Record<string, { label: string; percent: number }> = {
    intern: { label: 'Intern', percent: 1 },
    trainee_associate: { label: 'Trainee Associate', percent: 3 },
    associate: { label: 'Associate / Executive Assistant', percent: 6 },
    executive_assistant: { label: 'Associate / Executive Assistant', percent: 6 },
    senior_associate: { label: 'Senior Associate / Senior Executive Assistant', percent: 10 },
    senior_executive_assistant: { label: 'Senior Associate / Senior Executive Assistant', percent: 10 },
    associate_partner: { label: 'Associate Partner / Executive Associate Partner', percent: 12 },
    executive_associate_partner: { label: 'Associate Partner / Executive Associate Partner', percent: 12 },
    partner: { label: 'Partner / Executive Partner', percent: 8 },
    executive_partner: { label: 'Partner / Executive Partner', percent: 8 },
    managing_partner: { label: 'Managing Partner / Executive Managing Partner', percent: 8 },
    executive_managing_partner: { label: 'Managing Partner / Executive Managing Partner', percent: 8 },
    senior_partner: { label: 'Senior Partner / Executive Partner / Originating Attorney', percent: 12 },
    originating_attorney: { label: 'Senior Partner / Executive Partner / Originating Attorney', percent: 12 },
  };
  return shares[normalized] || { label: 'Firm Retained Earnings', percent: 0 };
};

const FIRM_RETAINED_PERCENT = 40;

const getPerformanceZone = (task: any): { zone: PerformanceZone; usedPercent: number } | null => {
  if (!task?.createdAt || !task?.completedAt || !task?.dueDate) return null;
  const assignedAt = new Date(task.createdAt);
  const completedAt = new Date(task.completedAt);
  const dueAt = new Date(`${task.dueDate}T23:59:59.999`);
  const totalMs = dueAt.getTime() - assignedAt.getTime();
  const usedMs = completedAt.getTime() - assignedAt.getTime();
  if (!Number.isFinite(totalMs) || !Number.isFinite(usedMs) || totalMs <= 0) return null;
  const usedRatio = Math.max(0, usedMs / totalMs);
  const usedPercent = Math.round(usedRatio * 1000) / 10;
  if (usedRatio <= 0.25) return { zone: 'excellent', usedPercent };
  if (usedRatio <= 0.55) return { zone: 'good', usedPercent };
  if (usedRatio <= 0.85) return { zone: 'delayed', usedPercent };
  return { zone: 'risk', usedPercent };
};

// GET /api/reports/firm?range=weekly|monthly|quarterly|yearly&from=YYYY-MM-DD&to=YYYY-MM-DD
export const getFirmReports = async (req: AuthRequest, res: Response) => {
  try {
    // Safety (route also has authorize)
    if (req.user?.role !== 'managing_director') {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const { range, from, to } = req.query as any;

    let fromDate: Date;
    let toDate: Date;

    if (from && to) {
      fromDate = new Date(String(from));
      toDate = new Date(String(to));
      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
        return res.status(400).json({ message: 'Invalid from/to date.' });
      }
      fromDate.setHours(0, 0, 0, 0);
      toDate.setHours(23, 59, 59, 999);
    } else {
      ({ from: fromDate, to: toDate } = computeRange(range));
    }

    const fromISO = iso(fromDate);
    const toISO = iso(toDate);

    // -----------------------------
    // KPIs
    // -----------------------------
    // "Active" = anything not explicitly Closed
    const activeCases = await Case.countDocuments({ status: { $ne: 'Closed' } });

    // Invoice date is stored as YYYY-MM-DD string, so string range works
    const invoicesInRange = await Invoice.find({
      date: { $gte: fromISO, $lte: toISO },
    })
      .select('amount status date caseId')
      .lean();

    const billed = invoicesInRange.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0);
    const collected = invoicesInRange
      .filter((i: any) => i.status === 'Paid')
      .reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0);
    const outstanding = Math.max(0, billed - collected);

    const hoursAgg = await TaskTimeLog.aggregate([
      { $match: { loggedAt: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: null, totalHours: { $sum: '$hours' } } },
    ]);
    const billableHours = Math.round((((hoursAgg?.[0]?.totalHours as number) || 0) * 10)) / 10;

    // -----------------------------
    // Team table (best-effort based on name strings)
    // -----------------------------
    const [casesAll, tasksCompleted, timeLogs, users] = await Promise.all([
      Case.find().select('assignedTo status').lean(),
      Task.find({
        status: 'Completed',
        completedAt: { $gte: fromDate, $lte: toDate },
      })
        .select('assignee completedAt dueDate caseId createdAt')
        .lean(),
      TaskTimeLog.find({
        loggedAt: { $gte: fromDate, $lte: toDate },
      })
        .select('userName hours')
        .lean(),
      User.find({ isActive: { $ne: false } }).select('name role').lean(),
    ]);

    const roleByName = new Map(
      (users as any[]).map((u) => [String(u.name || '').trim(), String(u.role || '')])
    );

    const activeByName = new Map<string, number>();
    for (const c of casesAll as any[]) {
      const isActive = String(c.status || '').toLowerCase() !== 'closed';
      if (!isActive) continue;
      const name = String(c.assignedTo || '—').trim();
      activeByName.set(name, (activeByName.get(name) || 0) + 1);
    }

    const completedTasksByName = new Map<string, number>();
    const earlyByName = new Map<string, number>();
    const onTimeByName = new Map<string, number>();
    const lateByName = new Map<string, number>();
    const excellentByName = new Map<string, number>();
    const goodByName = new Map<string, number>();
    const delayedByName = new Map<string, number>();
    const riskByName = new Map<string, number>();
    const usedPercentByName = new Map<string, number[]>();
    const completedCaseIds = Array.from(new Set((tasksCompleted as any[]).map((t) => String(t.caseId)).filter(Boolean)));
    const completedCases = await Case.find({ _id: { $in: completedCaseIds } })
      .select('_id workflowProgress.completedValue')
      .lean();
    const caseEarnedById = new Map(
      (completedCases as any[]).map((c) => [String(c._id), Number(c.workflowProgress?.completedValue?.amount) || 0])
    );
    const completedTaskCountByCase = new Map<string, number>();
    for (const t of tasksCompleted as any[]) {
      const caseId = String(t.caseId || '');
      if (!caseId) continue;
      completedTaskCountByCase.set(caseId, (completedTaskCountByCase.get(caseId) || 0) + 1);
    }
    const earnedByName = new Map<string, number>();
    const grossHandledByName = new Map<string, number>();
    const firmRetainedByName = new Map<string, number>();
    for (const t of tasksCompleted as any[]) {
      const name = String(t.assignee || '—').trim();
      completedTasksByName.set(name, (completedTasksByName.get(name) || 0) + 1);
      const due = new Date(`${t.dueDate}T23:59:59.999`);
      const completed = t.completedAt ? new Date(t.completedAt) : undefined;
      if (completed && Number.isFinite(due.getTime())) {
        const diffHours = (due.getTime() - completed.getTime()) / (1000 * 60 * 60);
        if (diffHours >= 24) earlyByName.set(name, (earlyByName.get(name) || 0) + 1);
        else if (diffHours >= 0) onTimeByName.set(name, (onTimeByName.get(name) || 0) + 1);
        else lateByName.set(name, (lateByName.get(name) || 0) + 1);
      }
      const perf = getPerformanceZone(t);
      if (perf) {
        if (perf.zone === 'excellent') excellentByName.set(name, (excellentByName.get(name) || 0) + 1);
        if (perf.zone === 'good') goodByName.set(name, (goodByName.get(name) || 0) + 1);
        if (perf.zone === 'delayed') delayedByName.set(name, (delayedByName.get(name) || 0) + 1);
        if (perf.zone === 'risk') riskByName.set(name, (riskByName.get(name) || 0) + 1);
        usedPercentByName.set(name, [...(usedPercentByName.get(name) || []), perf.usedPercent]);
      }
      const caseId = String(t.caseId || '');
      const taskShare = (caseEarnedById.get(caseId) || 0) / Math.max(1, completedTaskCountByCase.get(caseId) || 1);
      const roleShare = roleEarningShare(roleByName.get(name));
      grossHandledByName.set(name, (grossHandledByName.get(name) || 0) + taskShare);
      earnedByName.set(name, (earnedByName.get(name) || 0) + taskShare * (roleShare.percent / 100));
      firmRetainedByName.set(name, (firmRetainedByName.get(name) || 0) + taskShare * (FIRM_RETAINED_PERCENT / 100));
    }

    const overdueTasks = await Task.find({
      status: { $ne: 'Completed' },
      dueDate: { $lt: iso(new Date()) },
    })
      .select('assignee')
      .lean();
    const overdueByName = new Map<string, number>();
    for (const t of overdueTasks as any[]) {
      const name = String(t.assignee || '—').trim();
      overdueByName.set(name, (overdueByName.get(name) || 0) + 1);
    }

    const hoursByName = new Map<string, number>();
    for (const l of timeLogs as any[]) {
      const name = String(l.userName || '—').trim();
      hoursByName.set(name, (hoursByName.get(name) || 0) + (Number(l.hours) || 0));
    }

    const team = (users as any[])
      .map((u) => {
        const name = String(u.name || '—').trim();
        const roleShare = roleEarningShare(u.role);
        return {
          name,
          role: u.role,
          earningRoleLabel: roleShare.label,
          earningSharePercent: roleShare.percent,
          activeCases: activeByName.get(name) || 0,
          tasksCompleted: completedTasksByName.get(name) || 0,
          billableHours: Math.round(((hoursByName.get(name) || 0) * 10)) / 10,
          earnedFees: Math.round((earnedByName.get(name) || 0) * 100) / 100,
          grossFeesHandled: Math.round((grossHandledByName.get(name) || 0) * 100) / 100,
          firmRetainedEarnings: Math.round((firmRetainedByName.get(name) || 0) * 100) / 100,
          earlyTasks: earlyByName.get(name) || 0,
          onTimeTasks: onTimeByName.get(name) || 0,
          lateTasks: lateByName.get(name) || 0,
          overdueTasks: overdueByName.get(name) || 0,
          excellentTasks: excellentByName.get(name) || 0,
          goodTasks: goodByName.get(name) || 0,
          delayedTasks: delayedByName.get(name) || 0,
          riskTasks: riskByName.get(name) || 0,
          averageTimeUsedPercent: (() => {
            const values = usedPercentByName.get(name) || [];
            if (!values.length) return null;
            return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
          })(),
        };
      })
      .sort((a, b) => b.activeCases - a.activeCases);

    // -----------------------------
    // Case analytics by type + revenue by type (in range)
    // -----------------------------
    const casesForAnalytics = await Case.find()
      .select('caseType matterType workflow legalServicePath status updatedAt createdAt')
      .lean();

    const caseAnalyticsByPath = new Map<
      string,
      { type: string; active: number; closed: number; durationTotal: number; durationCount: number }
    >();
    for (const c of casesForAnalytics as any[]) {
      const type = selectedPathLabel(c);
      const current = caseAnalyticsByPath.get(type) || {
        type,
        active: 0,
        closed: 0,
        durationTotal: 0,
        durationCount: 0,
      };
      const closed = String(c.status || '').toLowerCase() === 'closed';
      if (closed) {
        current.closed += 1;
        const duration = (new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (Number.isFinite(duration)) {
          current.durationTotal += duration;
          current.durationCount += 1;
        }
      } else {
        current.active += 1;
      }
      caseAnalyticsByPath.set(type, current);
    }

    const caseIds = Array.from(
      new Set((invoicesInRange as any[]).map((i) => String(i.caseId)).filter(Boolean))
    );

    const casesForInvoices = await Case.find({ _id: { $in: caseIds } })
      .select('_id caseType matterType workflow legalServicePath')
      .lean();

    const caseTypeById = new Map((casesForInvoices as any[]).map((c) => [String(c._id), selectedPathLabel(c)]));

    const revenueByType = new Map<string, number>();
    for (const inv of invoicesInRange as any[]) {
      const ct = caseTypeById.get(String(inv.caseId)) || 'Unknown';
      revenueByType.set(ct, (revenueByType.get(ct) || 0) + (Number(inv.amount) || 0));
    }

    const caseTypes = Array.from(caseAnalyticsByPath.values()).map((row) => ({
      type: row.type,
      active: row.active,
      closed: row.closed,
      avgDurationDays: row.durationCount > 0 ? Math.round(row.durationTotal / row.durationCount) : null,
      revenueBilled: Math.round((revenueByType.get(row.type) || 0) * 100) / 100,
    })).sort((a, b) => a.type.localeCompare(b.type));

    // Billing trend by month
    const monthsMap = new Map<string, { month: string; billed: number; collected: number }>();
    for (const inv of invoicesInRange as any[]) {
      const dt = new Date(inv.date);
      const key = monthKey(dt);
      const item = monthsMap.get(key) || { month: key, billed: 0, collected: 0 };
      item.billed += Number(inv.amount) || 0;
      if (inv.status === 'Paid') item.collected += Number(inv.amount) || 0;
      monthsMap.set(key, item);
    }
    const months = Array.from(monthsMap.values()).sort((a, b) => a.month.localeCompare(b.month));

    const expensesInRange = await PettyCashExpense.find({
      date: { $gte: fromISO, $lte: toISO },
    })
      .select('amount category chargeType title date caseNoSnapshot partiesSnapshot')
      .lean();

    const clientRelatedExpenses = (expensesInRange as any[])
      .filter((expense) => expense.chargeType === 'client')
      .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);

    const expenseTypeMap = new Map<string, { type: string; amount: number; count: number; clientRelatedAmount: number }>();
    for (const expense of expensesInRange as any[]) {
      const type = String(expense.category || expense.title || 'Unclassified').trim() || 'Unclassified';
      const current = expenseTypeMap.get(type) || { type, amount: 0, count: 0, clientRelatedAmount: 0 };
      current.amount += Number(expense.amount) || 0;
      current.count += 1;
      if (expense.chargeType === 'client') current.clientRelatedAmount += Number(expense.amount) || 0;
      expenseTypeMap.set(type, current);
    }

    const expenseTypes = Array.from(expenseTypeMap.values())
      .map((row) => ({
        ...row,
        amount: Math.round(row.amount * 100) / 100,
        clientRelatedAmount: Math.round(row.clientRelatedAmount * 100) / 100,
      }))
      .sort((a, b) => b.amount - a.amount);

    return res.json({
      range: { from: fromISO, to: toISO },
      kpis: {
        activeCases,
        billed,
        collected,
        outstanding,
        billableHours,
        clientRelatedExpenses: Math.round(clientRelatedExpenses * 100) / 100,
      },
      team,
      caseTypes,
      months,
      expenseTypes,
    });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || 'Failed to load firm reports.' });
  }
};
