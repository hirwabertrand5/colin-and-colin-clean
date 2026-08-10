import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';

import Case from '../models/caseModel';
import Task from '../models/taskModel';
import Invoice from '../models/invoiceModel';
import TaskTimeLog from '../models/taskTimeLogModel';
import User from '../models/userModel';
import PettyCashExpense from '../models/pettyCashExpenseModel';
import ClientReport from '../models/clientReportModel';
import Prospect from '../models/prospectModel';
import {
  getCollectedValueFromProgress,
  getDirectMatterCost,
  getNegotiatedPlannedValue,
} from '../utils/financialMetrics';

const iso = (d: Date) => d.toISOString().slice(0, 10);

type DateBasis = 'invoiceDate' | 'paymentDate' | 'taskDate';

type AgeingBucket = '0-30' | '30-60' | '60-90' | '90+';

function computeRange(range?: string) {
  const to = new Date();
  to.setHours(23, 59, 59, 999);

  const from = new Date(to);
  const r = String(range || 'monthly').toLowerCase();

  if (r === 'daily') from.setDate(from.getDate());
  else if (r === 'weekly') from.setDate(from.getDate() - 7);
  else if (r === 'quarterly') from.setMonth(from.getMonth() - 3);
  else if (r === 'yearly') from.setFullYear(from.getFullYear() - 1);
  else from.setMonth(from.getMonth() - 1); // monthly default

  from.setHours(0, 0, 0, 0);
  return { from, to };
}

const normalizeBasis = (value?: string): DateBasis => {
  const normalized = String(value || 'invoiceDate').trim().toLowerCase();
  if (normalized === 'paymentdate' || normalized === 'payment_date') return 'paymentDate';
  if (normalized === 'taskdate' || normalized === 'task_date') return 'taskDate';
  return 'invoiceDate';
};

const getAgeingBuckets = (invoices: any[], referenceDate: Date) => {
  const buckets: Record<AgeingBucket, number> = {
    '0-30': 0,
    '30-60': 0,
    '60-90': 0,
    '90+': 0,
  };

  for (const invoice of invoices) {
    if (!invoice?.date) continue;
    const invoiceDate = new Date(`${invoice.date}T00:00:00.000Z`);
    if (!Number.isFinite(invoiceDate.getTime())) continue;
    const diffMs = referenceDate.getTime() - invoiceDate.getTime();
    if (diffMs < 0) continue;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const amount = Number(invoice.amount) || 0;
    if (diffDays <= 30) buckets['0-30'] += amount;
    else if (diffDays <= 60) buckets['30-60'] += amount;
    else if (diffDays <= 90) buckets['60-90'] += amount;
    else buckets['90+'] += amount;
  }

  return [
    { label: '0–30 days', amount: buckets['0-30'], color: 'blue' },
    { label: '30–60 days', amount: buckets['30-60'], color: 'green' },
    { label: '60–90 days', amount: buckets['60-90'], color: 'yellow' },
    { label: 'Over 90 days', amount: buckets['90+'], color: 'red' },
  ];
};

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
  return selected.length
    ? selected.join(' / ')
    : String(c?.matterType || c?.workflow || c?.caseType || 'Unclassified');
};

type PerformanceZone = 'excellent' | 'good' | 'delayed' | 'risk';

const roleEarningShare = (role?: string) => {
  const normalized = String(role || '').toLowerCase();
  const shares: Record<string, { label: string; percent: number }> = {
    managing_director: { label: 'Managing Partner / Executive Managing Partner', percent: 10 },
    intern: { label: 'Intern', percent: 1 },
    trainee_associate: { label: 'Trainee Associate', percent: 3 },
    associate: { label: 'Associate', percent: 5 },
    executive_assistant: { label: 'Executive Assistant', percent: 5 },
    senior_associate: { label: 'Senior Associate', percent: 6 },
    senior_executive_assistant: { label: 'Senior Executive Assistant', percent: 6 },
    associate_partner: { label: 'Associate Partner', percent: 8 },
    executive_associate_partner: { label: 'Executive Associate Partner', percent: 8 },
    partner: { label: 'Partner / Executive Partner', percent: 8 },
    executive_partner: { label: 'Partner / Executive Partner', percent: 8 },
    managing_partner: { label: 'Managing Partner / Executive Managing Partner', percent: 10 },
    executive_managing_partner: { label: 'Managing Partner / Executive Managing Partner', percent: 10 },
    senior_partner: { label: 'Senior Partner / Executive Partner / Originating Attorney', percent: 8 },
    originating_attorney: { label: 'Senior Partner / Executive Partner / Originating Attorney', percent: 8 },
  };
  return shares[normalized] || { label: 'Firm Retained Earnings', percent: FIRM_RETAINED_PERCENT };
};

const FIRM_RETAINED_PERCENT = 40;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const parseTaskDate = (value: any, endOfDay = false) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;

  const raw = String(value).trim();
  if (!raw) return null;

  const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (isoDateOnly.test(raw)) {
    const parsed = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const TASK_TPA_SHARES: Record<string, number> = {
  intern: 1,
  trainee_associate: 3,
  associate: 5,
  executive_assistant: 5,
  senior_associate: 6,
  senior_executive_assistant: 6,
  partner: 8,
  executive_partner: 8,
  associate_partner: 8,
  executive_associate_partner: 8,
  senior_partner: 8,
  originating_attorney: 8,
  managing_partner: 10,
  executive_managing_partner: 10,
  managing_director: 10,
};

const getTaskParticipationAllocation = (role?: string) => {
  const normalized = String(role || '').toLowerCase();
  return TASK_TPA_SHARES[normalized] ?? 0;
};

const getTaskProgressPercent = (task: any) => {
  const checklist = Array.isArray(task?.checklist) ? task.checklist : [];
  const total = checklist.length;
  const completed = checklist.filter((item: any) => Boolean(item?.completed)).length;
  if (total > 0) {
    return {
      completed,
      total,
      percent: Math.round((completed / total) * 100),
    };
  }

  return {
    completed: 0,
    total: 0,
    percent: String(task?.status || '').toLowerCase() === 'completed' ? 100 : 0,
  };
};

const getTimelinessScore = (task: any) => {
  const taskStatus = String(task?.status || '').toLowerCase();
  const assignedAt = parseTaskDate(task?.startDate) || parseTaskDate(task?.createdAt) || parseTaskDate(task?.updatedAt) || parseTaskDate(task?.completedAt);
  const completedAt = parseTaskDate(task?.completedAt) || parseTaskDate(task?.updatedAt) || parseTaskDate(task?.createdAt);
  const dueAt = parseTaskDate(task?.dueDate, true);
  const hasValidDates =
    assignedAt != null &&
    completedAt != null &&
    dueAt != null &&
    Number.isFinite(assignedAt.getTime()) &&
    Number.isFinite(completedAt.getTime()) &&
    Number.isFinite(dueAt.getTime());

  if (!hasValidDates) {
    return taskStatus === 'completed'
      ? {
        consumedPercent: 100,
        score: 0,
        status: 'Late' as const,
      }
      : null;
  }

  const totalMs = dueAt.getTime() - assignedAt.getTime();
  const usedMs = completedAt.getTime() - assignedAt.getTime();
  if (!Number.isFinite(totalMs) || !Number.isFinite(usedMs) || totalMs <= 0) {
    return {
      consumedPercent: 100,
      score: 0,
      status: 'Late' as const,
    };
  }

  const consumedPercent = Math.round((usedMs / totalMs) * 1000) / 10;
  let timelinessStatus: 'Excellent' | 'Good' | 'Warning' | 'Poor' | 'Late' = 'Late';
  if (consumedPercent <= 25) timelinessStatus = 'Excellent';
  else if (consumedPercent <= 50) timelinessStatus = 'Good';
  else if (consumedPercent <= 75) timelinessStatus = 'Warning';
  else if (consumedPercent <= 100) timelinessStatus = 'Poor';

  return {
    consumedPercent: Math.max(0, consumedPercent),
    score: consumedPercent > 100 ? 0 : Math.max(0, Math.round(100 - consumedPercent)),
    status: timelinessStatus,
  };
};

const getPerformanceZone = (task: any): { zone: PerformanceZone; usedPercent: number } | null => {
  const assignedAt = parseTaskDate(task?.startDate) || parseTaskDate(task?.createdAt);
  const completedAt = parseTaskDate(task?.completedAt);
  const dueAt = parseTaskDate(task?.dueDate, true);
  if (!assignedAt || !completedAt || !dueAt) return null;
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
    // Safety (route also has authorize) — allow managing director and executive assistant
    if (!['managing_director', 'executive_assistant'].includes(String(req.user?.role || ''))) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const { range, from, to, basis, teamMemberId } = req.query as any;
    const dateBasis = normalizeBasis(basis);

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

    const selectedMember = teamMemberId
      ? await User.findById(teamMemberId).select('name role').lean()
      : null;
    const selectedMemberName = selectedMember ? String(selectedMember.name || '').trim() : null;

    // -----------------------------
    // KPIs
    // -----------------------------
    const activeCases = selectedMemberName
      ? await Case.countDocuments({ status: { $ne: 'Closed' }, assignedTo: selectedMemberName })
      : await Case.countDocuments({ status: { $ne: 'Closed' } });

    const invoicesByInvoiceDateQuery = { date: { $gte: fromISO, $lte: toISO } };
    const invoicesByPaymentDateQuery = { status: 'Paid', updatedAt: { $gte: fromDate, $lte: toDate } };
    const tasksByDateQuery = { status: 'Completed', completedAt: { $gte: fromDate, $lte: toDate } };

    const [invoicesByInvoiceDate, invoicesByPaymentDate, tasksCompleted, timeLogs, users, prospectsByCreator, reportsByGenerator] = await Promise.all([
      Invoice.find(invoicesByInvoiceDateQuery).select('amount status date caseId proofUrl createdAt updatedAt').lean(),
      Invoice.find(invoicesByPaymentDateQuery).select('amount status date caseId proofUrl createdAt updatedAt').lean(),
      Task.find(tasksByDateQuery).select('assignee supervisor title completedAt updatedAt dueDate caseId createdAt checklist qualityScore').lean(),
      TaskTimeLog.find({ loggedAt: { $gte: fromDate, $lte: toDate } }).select('userName hours').lean(),
      User.find({ isActive: { $ne: false } }).select('name role').lean(),
      Prospect.aggregate([
        { $match: { createdAt: { $gte: fromDate, $lte: toDate }, createdBy: { $exists: true } } },
        { $group: { _id: '$createdBy', count: { $sum: 1 } } },
      ]),
      ClientReport.aggregate([
        { $match: { createdAt: { $gte: fromDate, $lte: toDate }, generatedByUserId: { $exists: true } } },
        { $group: { _id: '$generatedByUserId', count: { $sum: 1 } } },
      ]),
    ]);

    const casesForInvoices = await Case.find({ _id: { $in: Array.from(new Set([...invoicesByInvoiceDate, ...invoicesByPaymentDate].map((inv: any) => String(inv.caseId || '')).filter(Boolean))) } })
      .select('_id assignedTo')
      .lean();

    const financialMatters = await Case.find(
      selectedMemberName ? { assignedTo: selectedMemberName } : {}
    )
      .select('_id assignedTo budget updatedAt workflowProgress billingSettings')
      .lean();
    const selectedMatters = financialMatters as any[];
    const selectedMatterIds = new Set(selectedMatters.map((matter) => String(matter._id)));
    const taskCaseIds = Array.from(new Set((tasksCompleted as any[]).map((task) => String(task.caseId || '')).filter(Boolean)));
    const taskCases = taskCaseIds.length
      ? await Case.find({ _id: { $in: taskCaseIds } })
        .select('_id caseNo parties budget workflowProgress billingSettings matterType workflow legalServicePath')
        .lean()
      : [];
    const taskCaseMap = new Map((taskCases as any[]).map((matter) => [String(matter._id), matter]));

    const baseInvoices = dateBasis === 'paymentDate' ? invoicesByPaymentDate : invoicesByInvoiceDate;
    const selectedInvoices = baseInvoices.filter((inv: any) => selectedMatterIds.has(String(inv.caseId)));

    const totalContractValue = selectedMatters.reduce((sum: number, matter: any) => sum + getNegotiatedPlannedValue(matter), 0);
    const progressValue = selectedMatters.reduce((sum: number, matter: any) => sum + getCollectedValueFromProgress(matter), 0);
    const totalCollected = invoicesByPaymentDate.reduce((sum: number, inv: any) => {
      const caseId = String(inv.caseId || '');
      if (selectedMemberName && !selectedMatterIds.has(caseId)) return sum;
      return sum + (Number(inv.amount) || 0);
    }, 0);
    const totalBilled = selectedInvoices.reduce((sum: number, inv: any) => sum + (Number(inv.amount) || 0), 0);
    const outstanding = Math.max(0, totalContractValue - totalCollected);
    const totalDirectMatterCosts = (await PettyCashExpense.find({
      date: { $gte: fromISO, $lte: toISO },
      chargeType: 'client',
      caseId: { $in: Array.from(selectedMatterIds) },
    })
      .select('amount refundAmount chargeType caseId')
      .lean()).reduce((sum, expense: any) => sum + getDirectMatterCost(expense), 0);
    const firmOperatingExpenses = (await PettyCashExpense.find({
      date: { $gte: fromISO, $lte: toISO },
      chargeType: { $ne: 'client' },
    })
      .select('amount refundAmount chargeType caseId')
      .lean()).reduce((sum, expense: any) => sum + getDirectMatterCost(expense), 0);
    const grossProfit = totalCollected - totalDirectMatterCosts;
    const grossProfitMargin = totalCollected > 0 ? Math.round((grossProfit / totalCollected) * 100) : 0;
    const netProfit = grossProfit - firmOperatingExpenses;
    const netProfitMargin = totalCollected > 0 ? Math.round((netProfit / totalCollected) * 100) : 0;

    const hoursAgg = await TaskTimeLog.aggregate([
      { $match: { loggedAt: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: null, totalHours: { $sum: '$hours' } } },
    ]);
    const billableHours = Math.round((((hoursAgg?.[0]?.totalHours as number) || 0) * 10)) / 10;

    const ageingReport = getAgeingBuckets(
      await Invoice.find({ status: { $ne: 'Paid' }, date: { $lte: toISO } }).select('amount date').lean(),
      toDate
    );

    const qualityReviewAvailable = false;
    const qualityReviewMessage = 'Quality review data unavailable - source not configured';
    const taxDataAvailable = false;
    const taxMessage = 'Tax data unavailable - source not configured';

    const roleByName = new Map(
      (users as any[]).map((u) => [String(u.name || '').trim(), String(u.role || '')])
    );

    // -----------------------------
    // Team table (best-effort based on name strings)
    // -----------------------------
    const activeByName = new Map<string, number>();
    const allCases = await Case.find().select('assignedTo status').lean();
    for (const c of allCases as any[]) {
      const isActive = String(c.status || '').toLowerCase() !== 'closed';
      if (!isActive) continue;
      const name = String(c.assignedTo || '—').trim();
      if (selectedMemberName && name !== selectedMemberName) continue;
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
    const caseIds = Array.from(new Set((tasksCompleted as any[]).map((t) => String(t.caseId)).filter(Boolean)));
    const paidInvoicesByCaseId = new Map<string, number>();
    for (const inv of invoicesByPaymentDate as any[]) {
      const caseId = String(inv.caseId || '');
      if (!caseId) continue;
      paidInvoicesByCaseId.set(caseId, (paidInvoicesByCaseId.get(caseId) || 0) + (Number(inv.amount) || 0));
    }
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
      if (selectedMemberName && name !== selectedMemberName) continue;
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
      const casePaymentAmount = paidInvoicesByCaseId.get(caseId) || 0;
      const taskShare = casePaymentAmount / Math.max(1, completedTaskCountByCase.get(caseId) || 1);
      const roleShare = roleEarningShare(roleByName.get(name));
      grossHandledByName.set(name, (grossHandledByName.get(name) || 0) + taskShare);
      const earnedShare = taskShare * (roleShare.percent / 100);
      earnedByName.set(name, (earnedByName.get(name) || 0) + earnedShare);
      firmRetainedByName.set(name, (firmRetainedByName.get(name) || 0) + Math.max(0, taskShare - earnedShare));
    }

    const overdueFilter: any = { status: { $ne: 'Completed' } };
    if (selectedMemberName) overdueFilter.assignee = selectedMemberName;
    const overdueTasks = await Task.find(overdueFilter).select('assignee').lean();
    const overdueByName = new Map<string, number>();
    for (const t of overdueTasks as any[]) {
      const name = String(t.assignee || '—').trim();
      overdueByName.set(name, (overdueByName.get(name) || 0) + 1);
    }

    const hoursByName = new Map<string, number>();
    for (const l of timeLogs as any[]) {
      const name = String(l.userName || '—').trim();
      if (selectedMemberName && name !== selectedMemberName) continue;
      hoursByName.set(name, (hoursByName.get(name) || 0) + (Number(l.hours) || 0));
    }

    const prospectCountsByUser = new Map<string, number>(
      (prospectsByCreator as any[]).map((item) => [String(item._id), Number(item.count) || 0])
    );
    const reportCountsByUser = new Map<string, number>(
      (reportsByGenerator as any[]).map((item) => [String(item._id), Number(item.count) || 0])
    );

    const team = (users as any[])
      .map((u) => {
        const name = String(u.name || '—').trim();
        const roleShare = roleEarningShare(u.role);
        const taskCount = completedTasksByName.get(name) || 0;
        const prospectCount = prospectCountsByUser.get(String(u._id)) || 0;
        const reportCount = reportCountsByUser.get(String(u._id)) || 0;
        const assistantProductivity = roleShare.label.includes('Executive Assistant')
          ? taskCount + prospectCount + reportCount
          : taskCount;

        return {
          id: String(u._id),
          name,
          role: u.role,
          earningRoleLabel: roleShare.label,
          earningSharePercent: roleShare.percent,
          activeCases: activeByName.get(name) || 0,
          tasksCompleted: assistantProductivity,
          assistantTasksCompleted: taskCount,
          prospectsCreated: prospectCount,
          reportsGenerated: reportCount,
          billableHours: Math.round(((hoursByName.get(name) || 0) * 10)) / 10,
          invoicePaymentsReceived: Math.round((grossHandledByName.get(name) || 0) * 100) / 100,
          earnedFees: Math.round((earnedByName.get(name) || 0) * 100) / 100,
          revenueAttributed: Math.round((earnedByName.get(name) || 0) * 100) / 100,
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
      .filter((member) => !selectedMemberName || member.name === selectedMemberName)
      .sort((a, b) => b.activeCases - a.activeCases);

    const caseAnalyticsByPath = new Map<string, { type: string; active: number; closed: number; durationTotal: number; durationCount: number }>();
    const casesForAnalytics = await Case.find()
      .select('caseType matterType workflow legalServicePath status updatedAt createdAt')
      .lean();
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

    const caseTypeById = new Map((casesForInvoices as any[]).map((c) => [String(c._id), selectedPathLabel(c)]));
    const revenueByType = new Map<string, number>();
    for (const inv of invoicesByInvoiceDate as any[]) {
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

    const productivityRows = (tasksCompleted as any[])
      .filter((task) => !selectedMemberName || String(task.assignee || '').trim() === selectedMemberName)
      .map((task) => {
        const staffName = String(task.assignee || '—').trim();
        const role = String(roleByName.get(staffName) || '').trim();
        const tpaPercent = getTaskParticipationAllocation(role);
        const matter = taskCaseMap.get(String(task.caseId || ''));
        const matterLabel = matter
          ? String(matter.caseNo || matter.parties || matter.matterType || matter.workflow || '—')
          : '—';
        const progress = getTaskProgressPercent(task);
        const collectedFee = paidInvoicesByCaseId.get(String(task.caseId || '')) || 0;
        const workflowPercentValue = matter?.workflowProgress?.percent;
        const workflowPercent =
          workflowPercentValue === null || workflowPercentValue === undefined
            ? progress.percent || 0
            : Number(workflowPercentValue) || 0;
        const taskProgressPercent = workflowPercent;
        const taskFeeCollected = Math.round((collectedFee * (taskProgressPercent / 100)) * 100) / 100;
        const timeliness = getTimelinessScore(task);
        const qualityScore = Number.isFinite(Number(task.qualityScore)) ? Number(task.qualityScore) : null;
        const feeEarned =
          qualityScore == null || !timeliness
            ? null
            : Math.round((taskFeeCollected * (tpaPercent / 100) * (timeliness.score / 100) * (qualityScore / 100)) * 100) / 100;

        return {
          id: String(task._id),
          completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null,
          staff: staffName,
          role,
          matter: matterLabel,
          task: String(task.title || 'Task'),
          taskFeeCollected,
          taskFee: taskFeeCollected,
          tpaPercent,
          timelinessScore: timeliness ? timeliness.score : null,
          timelinessConsumedPercent: timeliness ? Math.round(timeliness.consumedPercent * 10) / 10 : null,
          qualityScore,
          formula:
            qualityScore == null
              ? 'Pending quality score'
              : !timeliness
                ? 'Pending timeliness score'
                : `${Math.round(collectedFee * 100) / 100} x ${taskProgressPercent}% = ${Math.round(taskFeeCollected * 100) / 100}`,
          feeEarned,
          keyActionsCompleted: progress.completed,
          keyActionsTotal: progress.total,
          taskProgressPercent,
          timelinessStatus: timeliness ? timeliness.status : 'Late',
        };
      })
      .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));

    const productivitySummary = {
      completedTasks: productivityRows.length,
      totalTaskFeeCollected: Math.round(productivityRows.reduce((sum, row) => sum + (row.taskFeeCollected || row.taskFee || 0), 0) * 100) / 100,
      totalTaskFee: Math.round(productivityRows.reduce((sum, row) => sum + (row.taskFeeCollected || row.taskFee || 0), 0) * 100) / 100,
      totalFeeEarned: Math.round(
        productivityRows.reduce((sum, row) => sum + (row.feeEarned || 0), 0) * 100
      ) / 100,
      pendingQualityScores: productivityRows.filter((row) => row.qualityScore == null).length,
      averageQualityScore: (() => {
        const scored = productivityRows.filter((row) => row.qualityScore != null);
        if (!scored.length) return null;
        return Math.round((scored.reduce((sum, row) => sum + (row.qualityScore || 0), 0) / scored.length) * 10) / 10;
      })(),
      averageTimelinessScore: (() => {
        const scored = productivityRows.filter((row) => row.timelinessScore != null);
        if (!scored.length) return null;
        return Math.round((scored.reduce((sum, row) => sum + (row.timelinessScore || 0), 0) / scored.length) * 10) / 10;
      })(),
    };

    const monthsMap = new Map<string, { month: string; billed: number; collected: number }>();
    for (const inv of invoicesByInvoiceDate as any[]) {
      const dt = new Date(inv.date);
      const key = monthKey(dt);
      const item = monthsMap.get(key) || { month: key, billed: 0, collected: 0 };
      item.billed += Number(inv.amount) || 0;
      monthsMap.set(key, item);
    }
    for (const inv of invoicesByPaymentDate as any[]) {
      if (selectedMemberName && !selectedMatterIds.has(String(inv.caseId || ''))) continue;
      const dt = inv.updatedAt ? new Date(inv.updatedAt) : toDate;
      const key = monthKey(dt);
      const item = monthsMap.get(key) || { month: key, billed: 0, collected: 0 };
      item.collected += Number(inv.amount) || 0;
      monthsMap.set(key, item);
    }
    const months = Array.from(monthsMap.values()).sort((a, b) => a.month.localeCompare(b.month));

    const expensesInRange = await PettyCashExpense.find({
      date: { $gte: fromISO, $lte: toISO },
    })
      .select('amount refundAmount category chargeType title date caseNoSnapshot partiesSnapshot')
      .lean();

    const clientRelatedExpenses = (expensesInRange as any[])
      .filter((expense) => expense.chargeType === 'client' && (!selectedMemberName || selectedMatterIds.has(String(expense.caseId || ''))))
      .reduce((sum, expense) => sum + getDirectMatterCost(expense), 0);

    const firmOperatingExpensesInRange = (expensesInRange as any[])
      .filter((expense) => expense.chargeType !== 'client')
      .reduce((sum, expense) => sum + getDirectMatterCost(expense), 0);

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

    const selectedMemberMetrics = selectedMemberName
      ? {
        name: selectedMemberName,
        role: selectedMember?.role || 'Unknown',
        tasksCompleted: completedTasksByName.get(selectedMemberName) || 0,
        outstandingTasks: overdueByName.get(selectedMemberName) || 0,
        revenueGenerated: Math.round((grossHandledByName.get(selectedMemberName) || 0) * 100) / 100,
        paymentsReceived: Math.round(
          selectedMatters.reduce((sum, matter: any) => sum + (paidInvoicesByCaseId.get(String(matter._id)) || 0), 0) * 100
        ) / 100,
        outstandingBalance: outstanding,
        feesEarned: Math.round((earnedByName.get(selectedMemberName) || 0) * 100) / 100,
        qualityReviewStatus: qualityReviewMessage,
      }
      : null;

    return res.json({
      range: { from: fromISO, to: toISO },
      dateBasis,
      selectedMember: selectedMemberMetrics,
      kpis: {
        activeCases,
        totalContractValue: Math.round(totalContractValue * 100) / 100,
        contractValue: Math.round(totalContractValue * 100) / 100,
        totalBilled: Math.round(totalBilled * 100) / 100,
        billed: Math.round(totalBilled * 100) / 100,
        totalCollected: Math.round(totalCollected * 100) / 100,
        collected: Math.round(totalCollected * 100) / 100,
        progressValue: Math.round(progressValue * 100) / 100,
        outstanding,
        totalDirectMatterCosts: Math.round(totalDirectMatterCosts * 100) / 100,
        directMatterCosts: Math.round(totalDirectMatterCosts * 100) / 100,
        grossProfit: Math.round(grossProfit * 100) / 100,
        grossProfitMargin,
          firmOperatingExpenses: Math.round(firmOperatingExpensesInRange * 100) / 100,
        netProfit: Math.round(netProfit * 100) / 100,
        netProfitMargin,
        billableHours,
        clientRelatedExpenses: Math.round(clientRelatedExpenses * 100) / 100,
        taxDataAvailable,
        taxMessage,
        qualityReviewAvailable,
        qualityReviewMessage,
      },
      ageingReport,
      team,
      productivitySummary,
      productivityRows,
      caseTypes,
      months,
      expenseTypes,
    });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || 'Failed to load firm reports.' });
  }
};
