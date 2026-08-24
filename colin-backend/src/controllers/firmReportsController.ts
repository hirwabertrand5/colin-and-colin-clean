import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';

import Case from '../models/caseModel';
import Task from '../models/taskModel';
import Invoice from '../models/invoiceModel';
import User from '../models/userModel';
import { resolveDeadlineDateTime } from '../utils/deadlineUtils';
import PettyCashExpense from '../models/pettyCashExpenseModel';
import ClientReport from '../models/clientReportModel';
import Prospect from '../models/prospectModel';
import WorkflowTemplate from '../models/workflowTemplateModel';
import {
  getCollectedValueFromProgress,
  getDirectMatterCost,
  getContractValue,
  parseMoneyValue,
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

const selectedPathLabel = (c: any, workflowTemplateMatterTypeById?: Map<string, string>) => {
  const path = Array.isArray(c?.legalServicePath) ? c.legalServicePath : [];
  const selected = path
    .map((item: any) => String(item?.label || '').trim())
    .filter(Boolean);
  if (selected.length) return selected.join(' / ');

  const workflowTemplateId = String(c?.workflowTemplateId || '').trim();
  const workflowTemplateMatterType = workflowTemplateId && workflowTemplateMatterTypeById
    ? String(workflowTemplateMatterTypeById.get(workflowTemplateId) || '').trim()
    : '';

  return String(
    c?.caseTypeLabel ||
    c?.matterType ||
    c?.workflow ||
    workflowTemplateMatterType ||
    c?.caseType ||
    'Unclassified'
  );
};

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

const normalizeName = (value: unknown) => String(value || '').trim().toLowerCase();
const isOpenCase = (c: any) => String(c?.status || '').trim().toLowerCase() !== 'closed';

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
    const parsed = resolveDeadlineDateTime(raw);
    if (!parsed) return null;
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

const getTaskChecklistCompletionPercent = (task: any) => {
  const checklist = Array.isArray(task?.checklist) ? task.checklist : [];
  const total = checklist.length;
  if (!total) return 0;
  const completed = checklist.filter((item: any) => Boolean(item?.completed)).length;
  return Math.round((completed / total) * 100);
};

const getTaskWorkflowProgressPercent = (matter: any, task: any) => {
  const workflowPercentValue = matter?.workflowProgress?.percent;
  if (workflowPercentValue !== null && workflowPercentValue !== undefined) {
    const parsed = Number(workflowPercentValue);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return getTaskChecklistCompletionPercent(task);
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
    const selectedMemberNameNormalized = selectedMemberName ? normalizeName(selectedMemberName) : null;

    // -----------------------------
    // KPIs
    // -----------------------------
    let activeCases = 0;

    const invoicesByInvoiceDateQuery = { date: { $gte: fromISO, $lte: toISO } };
    const invoicesByPaymentDateQuery = { status: 'Paid', updatedAt: { $gte: fromDate, $lte: toDate } };
    const tasksByDateQuery = { status: 'Completed', completedAt: { $gte: fromDate, $lte: toDate } };

    const [invoicesByInvoiceDate, invoicesByPaymentDate, tasksCompleted, allTaskLinks, users, prospectsByCreator, reportsByGenerator] = await Promise.all([
      Invoice.find(invoicesByInvoiceDateQuery).select('amount status date caseId proofUrl createdAt updatedAt').lean(),
      Invoice.find(invoicesByPaymentDateQuery).select('amount status date caseId proofUrl createdAt updatedAt').lean(),
      Task.find(tasksByDateQuery).select('assignee supervisor title completedAt updatedAt dueDate caseId createdAt checklist qualityScore').lean(),
      Task.find().select('caseId assignee supervisor').lean(),
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
      .select('_id assignedTo workflowTemplateId matterType workflow legalServicePath caseType caseTypeLabel')
      .lean();

    const allCases = await Case.find().select('_id assignedTo status workflowTemplateId matterType workflow legalServicePath caseType caseTypeLabel').lean();
    const caseById = new Map((allCases as any[]).map((c) => [String(c._id), c]));
    const workflowTemplateIds = Array.from(new Set((allCases as any[])
      .map((c) => String(c.workflowTemplateId || '').trim())
      .filter(Boolean)));
    const workflowTemplateMatterTypeById = new Map(
      workflowTemplateIds.length
        ? ((await WorkflowTemplate.find({ _id: { $in: workflowTemplateIds } }).select('_id matterType').lean()) as any[])
          .map((template) => [String(template._id), String(template.matterType || '').trim()])
        : []
    );

    const linkedCaseIdsByName = new Map<string, Set<string>>();
    for (const c of allCases as any[]) {
      const name = normalizeName(c.assignedTo);
      if (!name) continue;
      const current = linkedCaseIdsByName.get(name) || new Set<string>();
      current.add(String(c._id));
      linkedCaseIdsByName.set(name, current);
    }
    for (const task of allTaskLinks as any[]) {
      const caseId = String(task.caseId || '');
      const linkedNames = [task.assignee, task.supervisor].map(normalizeName).filter(Boolean);
      if (!caseId || !linkedNames.length) continue;
      for (const name of linkedNames) {
        const current = linkedCaseIdsByName.get(name) || new Set<string>();
        current.add(caseId);
        linkedCaseIdsByName.set(name, current);
      }
    }

    const financialMatters = await Case.find(
      selectedMemberNameNormalized
        ? { _id: { $in: Array.from(linkedCaseIdsByName.get(selectedMemberNameNormalized) || []) } }
        : {}
    )
      .select('_id assignedTo status caseNo parties budget updatedAt workflowProgress billingSettings legalServicePath matterType workflow workflowTemplateId caseType caseTypeLabel')
      .lean();
    const selectedMatters = financialMatters as any[];
    const selectedMatterIds = new Set(selectedMatters.map((matter) => String(matter._id)));
    const taskCaseIds = Array.from(new Set((tasksCompleted as any[]).map((task) => String(task.caseId || '')).filter(Boolean)));
    const taskCases = taskCaseIds.length
      ? await Case.find({ _id: { $in: taskCaseIds } })
        .select('_id caseNo parties budget workflowProgress billingSettings matterType workflow workflowTemplateId legalServicePath caseType caseTypeLabel')
        .lean()
      : [];
    const taskCaseMap = new Map((taskCases as any[]).map((matter) => [String(matter._id), matter]));

    const baseInvoices = dateBasis === 'paymentDate' ? invoicesByPaymentDate : invoicesByInvoiceDate;
    const selectedInvoices = baseInvoices.filter((inv: any) => selectedMatterIds.has(String(inv.caseId)));

    const totalContractValue = selectedMatters.reduce((sum: number, matter: any) => sum + getContractValue(matter), 0);
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

    const ageingReport = getAgeingBuckets(
      await Invoice.find({ status: { $ne: 'Paid' }, date: { $lte: toISO } }).select('amount date').lean(),
      toDate
    );

    const qualityReviewAvailable = false;
    const qualityReviewMessage = 'Quality review data unavailable - source not configured';
    const taxDataAvailable = false;
    const taxMessage = 'Tax data unavailable - source not configured';

    const roleByName = new Map(
      (users as any[]).map((u) => [normalizeName(u.name), String(u.role || '')])
    );

    // -----------------------------
    // Team table (best-effort based on name strings)
    // -----------------------------
    const activeCaseIdsByName = new Map<string, Set<string>>();
    const allOpenCaseIds = new Set<string>();
    for (const c of allCases as any[]) {
      if (!isOpenCase(c)) continue;
      allOpenCaseIds.add(String(c._id));
      const name = normalizeName(c.assignedTo);
      if (!name) continue;
      const current = activeCaseIdsByName.get(name) || new Set<string>();
      current.add(String(c._id));
      activeCaseIdsByName.set(name, current);
    }
    for (const task of allTaskLinks as any[]) {
      const caseId = String(task.caseId || '');
      const caseDoc = caseById.get(caseId);
      if (!caseId || !caseDoc || !isOpenCase(caseDoc)) continue;
      const linkedNames = [task.assignee, task.supervisor].map(normalizeName).filter(Boolean);
      if (!linkedNames.length) continue;
      for (const name of linkedNames) {
        const current = activeCaseIdsByName.get(name) || new Set<string>();
        current.add(caseId);
        activeCaseIdsByName.set(name, current);
      }
    }
    activeCases = selectedMemberNameNormalized
      ? (activeCaseIdsByName.get(selectedMemberNameNormalized)?.size || 0)
      : allOpenCaseIds.size;

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
    const earnedByName = new Map<string, number>();
    const grossHandledByName = new Map<string, number>();
    const firmRetainedByName = new Map<string, number>();

    const getTaskProductivityFinancials = (task: any) => {
      const staffName = String(task.assignee || '—').trim();
      const role = String(roleByName.get(normalizeName(staffName)) || '').trim();
      const tpaPercent = getTaskParticipationAllocation(role);
      const matter = taskCaseMap.get(String(task.caseId || ''));
      const collectedFee = paidInvoicesByCaseId.get(String(task.caseId || '')) || 0;
      const taskProgressPercent = getTaskWorkflowProgressPercent(matter, task);
      const taskFeeCollected = Math.round((collectedFee * (taskProgressPercent / 100)) * 100) / 100;
      const timeliness = getTimelinessScore(task);
      const qualityScore = Number.isFinite(Number(task.qualityScore)) ? Number(task.qualityScore) : null;
      const feeEarned =
        qualityScore == null || !timeliness
          ? null
          : Math.round((taskFeeCollected * (tpaPercent / 100) * (timeliness.score / 100) * (qualityScore / 100)) * 100) / 100;

      return {
        role,
        tpaPercent,
        matter,
        taskFeeCollected,
        taskProgressPercent,
        timeliness,
        qualityScore,
        feeEarned,
      };
    };

    for (const t of tasksCompleted as any[]) {
      const name = normalizeName(t.assignee);
      if (selectedMemberNameNormalized && name !== selectedMemberNameNormalized) continue;
      completedTasksByName.set(name, (completedTasksByName.get(name) || 0) + 1);
      const due = resolveDeadlineDateTime(t.dueDate);
      const completed = t.completedAt ? new Date(t.completedAt) : undefined;
      if (completed && due && Number.isFinite(due.getTime())) {
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
      const financials = getTaskProductivityFinancials(t);
      grossHandledByName.set(name, (grossHandledByName.get(name) || 0) + financials.taskFeeCollected);
      earnedByName.set(name, (earnedByName.get(name) || 0) + (financials.feeEarned || 0));
      firmRetainedByName.set(
        name,
        (firmRetainedByName.get(name) || 0) + Math.max(0, financials.taskFeeCollected - (financials.feeEarned || 0))
      );
    }

    const overdueFilter: any = { status: { $ne: 'Completed' } };
    if (selectedMemberName) overdueFilter.assignee = selectedMemberName;
    const overdueTasks = await Task.find(overdueFilter).select('assignee').lean();
    const overdueByName = new Map<string, number>();
    for (const t of overdueTasks as any[]) {
      const name = normalizeName(t.assignee);
      overdueByName.set(name, (overdueByName.get(name) || 0) + 1);
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
        const normalizedName = normalizeName(name);
        const roleShare = roleEarningShare(u.role);
        const taskCount = completedTasksByName.get(normalizedName) || 0;
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
          activeCases: activeCaseIdsByName.get(normalizedName)?.size || 0,
          tasksCompleted: assistantProductivity,
          assistantTasksCompleted: taskCount,
          prospectsCreated: prospectCount,
          reportsGenerated: reportCount,
          invoicePaymentsReceived: Math.round((grossHandledByName.get(normalizedName) || 0) * 100) / 100,
          earnedFees: Math.round((earnedByName.get(normalizedName) || 0) * 100) / 100,
          revenueAttributed: Math.round((earnedByName.get(normalizedName) || 0) * 100) / 100,
          grossFeesHandled: Math.round((grossHandledByName.get(normalizedName) || 0) * 100) / 100,
          firmRetainedEarnings: Math.round((firmRetainedByName.get(normalizedName) || 0) * 100) / 100,
          earlyTasks: earlyByName.get(normalizedName) || 0,
          onTimeTasks: onTimeByName.get(normalizedName) || 0,
          lateTasks: lateByName.get(normalizedName) || 0,
          overdueTasks: overdueByName.get(normalizedName) || 0,
          excellentTasks: excellentByName.get(normalizedName) || 0,
          goodTasks: goodByName.get(normalizedName) || 0,
          delayedTasks: delayedByName.get(normalizedName) || 0,
          riskTasks: riskByName.get(normalizedName) || 0,
          averageTimeUsedPercent: (() => {
            const values = usedPercentByName.get(normalizedName) || [];
            if (!values.length) return null;
            return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
          })(),
        };
      })
      .filter((member) => !selectedMemberNameNormalized || normalizeName(member.name) === selectedMemberNameNormalized)
      .sort((a, b) => b.activeCases - a.activeCases);

    const caseAnalyticsByPath = new Map<string, { type: string; active: number; closed: number; durationTotal: number; durationCount: number }>();
    const casesForAnalytics = await Case.find()
      .select('caseType caseTypeLabel matterType workflow workflowTemplateId legalServicePath status updatedAt createdAt')
      .lean();
    for (const c of casesForAnalytics as any[]) {
      const type = selectedPathLabel(c, workflowTemplateMatterTypeById);
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

    const caseTypeById = new Map((casesForInvoices as any[]).map((c) => [String(c._id), selectedPathLabel(c, workflowTemplateMatterTypeById)]));
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
      .filter((task) => !selectedMemberNameNormalized || normalizeName(task.assignee) === selectedMemberNameNormalized)
      .map((task) => {
        const staffName = String(task.assignee || '—').trim();
        const financials = getTaskProductivityFinancials(task);
        const matterLabel = financials.matter
          ? String(financials.matter.caseNo || financials.matter.parties || financials.matter.matterType || financials.matter.workflow || '—')
          : '—';
        const checklist = Array.isArray(task?.checklist) ? task.checklist : [];
        const progressCompleted = checklist.filter((item: any) => Boolean(item?.completed)).length;
        const progressTotal = checklist.length;
        const roundedTaskFeeCollected = Math.round(financials.taskFeeCollected * 100) / 100;
        const roundedFeeEarned = financials.feeEarned == null ? null : Math.round(financials.feeEarned * 100) / 100;

        return {
          id: String(task._id),
          completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null,
          staff: staffName,
          role: financials.role,
          matter: matterLabel,
          task: String(task.title || 'Task'),
          taskFeeCollected: financials.taskFeeCollected,
          taskFee: financials.taskFeeCollected,
          tpaPercent: financials.tpaPercent,
          timelinessScore: financials.timeliness ? financials.timeliness.score : null,
          timelinessConsumedPercent: financials.timeliness ? Math.round(financials.timeliness.consumedPercent * 10) / 10 : null,
          qualityScore: financials.qualityScore,
          formula:
            financials.qualityScore == null
              ? 'Pending quality score'
              : !financials.timeliness
                ? 'Pending timeliness score'
                : `${roundedTaskFeeCollected} x ${financials.tpaPercent}% x ${financials.timeliness.score}% x ${financials.qualityScore}% = ${roundedFeeEarned}`,
          feeEarned: financials.feeEarned,
          keyActionsCompleted: progressCompleted,
          keyActionsTotal: progressTotal,
          taskProgressPercent: financials.taskProgressPercent,
          timelinessStatus: financials.timeliness ? financials.timeliness.status : 'Late',
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
      if (selectedMemberNameNormalized && !selectedMatterIds.has(String(inv.caseId || ''))) continue;
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
      .filter((expense) => expense.chargeType === 'client' && (!selectedMemberNameNormalized || selectedMatterIds.has(String(expense.caseId || ''))))
      .reduce((sum, expense) => sum + getDirectMatterCost(expense), 0);

    const firmOperatingExpensesInRange = (expensesInRange as any[])
      .filter((expense) => expense.chargeType !== 'client')
      .reduce((sum, expense) => sum + getDirectMatterCost(expense), 0);

    const expenseTypeMap = new Map<string, { type: string; amount: number; count: number; clientRelatedAmount: number }>();
    for (const expense of expensesInRange as any[]) {
      const type = String(expense.itemDescription || expense.title || expense.category || 'Unclassified').trim() || 'Unclassified';
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

    const clientProfitabilityMatters = await Case.find()
      .select('_id caseNo parties clientName status budget workflowProgress billingSettings legalServicePath matterType workflow workflowTemplateId caseType caseTypeLabel')
      .lean();
    const clientProfitabilityProspects = await Prospect.find({
      $or: [
        { convertedToMatters: null },
        { convertedToMatters: { $exists: false } },
      ],
    })
      .select('_id clientName parties stage estimatedFeeValue quotationAmount estimatedMatterValue depositAmount legalServicePath')
      .lean();

    const clientProfitabilityByKey = new Map<string, {
      partyName: string;
      matterCount: number;
      activeMatters: number;
      completedMatters: number;
      contractValue: number;
      totalBilled: number;
      totalCollected: number;
      directMatterCosts: number;
      retainerValue: number;
      collectionDaysTotal: number;
      collectionDaysCount: number;
      revenueByPracticeArea: Map<string, number>;
      practiceAreaCounts: Map<string, number>;
    }>();
    const clientKeyByCaseId = new Map<string, string>();
    const practiceLabelByCaseId = new Map<string, string>();
    const matterFinancialsByCaseId = new Map<string, { billed: number; collected: number; directMatterCosts: number }>();
    const matterDetailsByCaseId = new Map<string, any>();
    const clientDetailsByKey = new Map<string, any[]>();
    for (const matter of clientProfitabilityMatters as any[]) {
      const partyName = String(matter.parties || matter.clientName || matter.caseNo || 'Unassigned party').trim() || 'Unassigned party';
      const key = normalizeName(partyName) || String(matter._id);
      const caseId = String(matter._id);
      clientKeyByCaseId.set(String(matter._id), key);
      practiceLabelByCaseId.set(String(matter._id), selectedPathLabel(matter, workflowTemplateMatterTypeById));

      const detail = {
        id: caseId,
        recordType: 'Matter',
        recordLabel: String(matter.caseNo || matter.parties || 'Matter'),
        matterNo: String(matter.caseNo || ''),
        status: String(matter.status || 'Open'),
        practiceArea: selectedPathLabel(matter, workflowTemplateMatterTypeById),
        contractValue: roundMoney(getContractValue(matter)),
        totalBilled: 0,
        collected: 0,
        outstanding: 0,
        directMatterCosts: 0,
        grossProfit: 0,
        grossProfitMargin: 0,
        assignedLawyer: String(matter.assignedTo || 'Unassigned'),
        nextDeadline: matter?.workflowProgress?.nextDueAt
          ? resolveDeadlineDateTime(matter.workflowProgress.nextDueAt)?.toISOString() || null
          : null,
      };
      matterDetailsByCaseId.set(caseId, detail);
      const existingDetails = clientDetailsByKey.get(key) || [];
      existingDetails.push(detail);
      clientDetailsByKey.set(key, existingDetails);

      const current = clientProfitabilityByKey.get(key) || {
        partyName,
        matterCount: 0,
        activeMatters: 0,
        completedMatters: 0,
        contractValue: 0,
        totalBilled: 0,
        totalCollected: 0,
        directMatterCosts: 0,
        retainerValue: 0,
        collectionDaysTotal: 0,
        collectionDaysCount: 0,
        revenueByPracticeArea: new Map<string, number>(),
        practiceAreaCounts: new Map<string, number>(),
      };

      current.partyName = partyName;
      current.matterCount += 1;
      if (isOpenCase(matter)) current.activeMatters += 1;
      else current.completedMatters += 1;
      current.contractValue += getContractValue(matter);
      current.retainerValue += parseMoneyValue(matter?.billingSettings?.prepaidTotal);
      const matterPracticeArea = selectedPathLabel(matter, workflowTemplateMatterTypeById);
      if (matterPracticeArea && matterPracticeArea !== 'Unclassified') {
        current.practiceAreaCounts.set(matterPracticeArea, (current.practiceAreaCounts.get(matterPracticeArea) || 0) + 1);
      }
      clientProfitabilityByKey.set(key, current);
    }

    for (const prospect of clientProfitabilityProspects as any[]) {
      const partyName = String(prospect.parties || prospect.clientName || 'Unassigned party').trim() || 'Unassigned party';
      const key = normalizeName(partyName) || String(prospect._id);
      const prospectDetail = {
        id: String(prospect._id),
        recordType: 'Prospect',
        recordLabel: String(prospect.prospectNo || prospect.clientName || 'Prospect'),
        matterNo: String(prospect.prospectNo || ''),
        status: String(prospect.stage || 'Inquiry'),
        practiceArea: Array.isArray(prospect.legalServicePath) && prospect.legalServicePath.length
          ? prospect.legalServicePath.map((item: any) => String(item?.label || '').trim()).filter(Boolean).join(' / ')
          : String(prospect.practiceArea || 'Prospect'),
        contractValue: roundMoney(parseMoneyValue(prospect?.estimatedFeeValue || prospect?.quotationAmount || prospect?.estimatedMatterValue || 0)),
        totalBilled: 0,
        collected: 0,
        outstanding: 0,
        directMatterCosts: 0,
        grossProfit: 0,
        grossProfitMargin: 0,
        assignedLawyer: String(prospect.assignedTo || 'Pipeline'),
        nextDeadline: null,
      };
      const existingProspectDetails = clientDetailsByKey.get(key) || [];
      existingProspectDetails.push(prospectDetail);
      clientDetailsByKey.set(key, existingProspectDetails);
      const current = clientProfitabilityByKey.get(key) || {
        partyName,
        matterCount: 0,
        activeMatters: 0,
        completedMatters: 0,
        contractValue: 0,
        totalBilled: 0,
        totalCollected: 0,
        directMatterCosts: 0,
        retainerValue: 0,
        collectionDaysTotal: 0,
        collectionDaysCount: 0,
        revenueByPracticeArea: new Map<string, number>(),
        practiceAreaCounts: new Map<string, number>(),
      };

      current.partyName = partyName;
      current.matterCount += 1;
      if (String(prospect.stage || '').trim().toLowerCase() === 'non-converted') current.completedMatters += 1;
      else current.activeMatters += 1;
      current.contractValue += parseMoneyValue(prospect?.estimatedFeeValue || prospect?.quotationAmount || 0);
      current.retainerValue += parseMoneyValue(prospect?.depositAmount);
      const prospectPracticeArea = Array.isArray(prospect.legalServicePath) && prospect.legalServicePath.length
        ? prospect.legalServicePath.map((item: any) => String(item?.label || '').trim()).filter(Boolean).join(' / ')
        : String(prospect.practiceArea || 'Prospect');
      if (prospectPracticeArea && prospectPracticeArea !== 'Prospect') {
        current.practiceAreaCounts.set(prospectPracticeArea, (current.practiceAreaCounts.get(prospectPracticeArea) || 0) + 1);
      }
      clientProfitabilityByKey.set(key, current);
    }

    const clientMatterIds = new Set<string>(Array.from(clientKeyByCaseId.keys()));
    for (const inv of baseInvoices as any[]) {
      const caseId = String(inv.caseId || '');
      if (!caseId || !clientMatterIds.has(caseId)) continue;
      const key = clientKeyByCaseId.get(caseId);
      if (!key) continue;
      const current = clientProfitabilityByKey.get(key);
      if (!current) continue;
      const amount = Number(inv.amount) || 0;
      current.totalBilled += amount;
      const financials = matterFinancialsByCaseId.get(caseId) || { billed: 0, collected: 0, directMatterCosts: 0 };
      financials.billed += amount;
      matterFinancialsByCaseId.set(caseId, financials);
      const practiceLabel = practiceLabelByCaseId.get(caseId) || 'Unclassified';
      current.revenueByPracticeArea.set(practiceLabel, (current.revenueByPracticeArea.get(practiceLabel) || 0) + amount);
    }

    for (const inv of invoicesByPaymentDate as any[]) {
      const caseId = String(inv.caseId || '');
      if (!caseId || !clientMatterIds.has(caseId)) continue;
      const key = clientKeyByCaseId.get(caseId);
      if (!key) continue;
      const current = clientProfitabilityByKey.get(key);
      if (!current) continue;
      const amount = Number(inv.amount) || 0;
      current.totalCollected += amount;
      const financials = matterFinancialsByCaseId.get(caseId) || { billed: 0, collected: 0, directMatterCosts: 0 };
      financials.collected += amount;
      matterFinancialsByCaseId.set(caseId, financials);
      const invoiceDate = inv.date ? new Date(`${String(inv.date).slice(0, 10)}T00:00:00.000Z`) : null;
      const paymentDate = inv.updatedAt ? new Date(inv.updatedAt) : null;
      if (invoiceDate && paymentDate && Number.isFinite(invoiceDate.getTime()) && Number.isFinite(paymentDate.getTime())) {
        const diffDays = Math.max(0, (paymentDate.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));
        current.collectionDaysTotal += diffDays;
        current.collectionDaysCount += 1;
      }
    }

    for (const expense of expensesInRange as any[]) {
      if (expense.chargeType !== 'client') continue;
      const caseId = String(expense.caseId || '');
      if (!caseId || !clientMatterIds.has(caseId)) continue;
      const key = clientKeyByCaseId.get(caseId);
      if (!key) continue;
      const current = clientProfitabilityByKey.get(key);
      if (!current) continue;
      const cost = getDirectMatterCost(expense);
      current.directMatterCosts += cost;
      const financials = matterFinancialsByCaseId.get(caseId) || { billed: 0, collected: 0, directMatterCosts: 0 };
      financials.directMatterCosts += cost;
      matterFinancialsByCaseId.set(caseId, financials);
    }

    for (const [caseId, financials] of matterFinancialsByCaseId.entries()) {
      const detail = matterDetailsByCaseId.get(caseId);
      if (!detail) continue;
      detail.totalBilled = roundMoney(financials.billed);
      detail.collected = roundMoney(financials.collected);
      detail.directMatterCosts = roundMoney(financials.directMatterCosts);
      detail.outstanding = roundMoney(financials.billed - financials.collected);
      detail.grossProfit = roundMoney(financials.collected - financials.directMatterCosts);
      detail.grossProfitMargin = financials.collected > 0 ? Math.round(((financials.collected - financials.directMatterCosts) / financials.collected) * 100) : 0;
    }

    const clientProfitability = Array.from(clientProfitabilityByKey.values())
      .map((row) => {
        const grossProfit = row.totalCollected - row.directMatterCosts;
        const grossProfitMargin = row.totalCollected > 0 ? Math.round((grossProfit / row.totalCollected) * 100) : 0;
        const revenueByPracticeArea = Array.from(row.revenueByPracticeArea.entries())
          .map(([type, amount]) => ({
            type,
            amount: roundMoney(amount),
          }))
          .sort((a, b) => b.amount - a.amount || a.type.localeCompare(b.type));
        const practiceAreaCounts = Array.from(row.practiceAreaCounts.entries())
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
        const practiceArea = practiceAreaCounts[0]?.type || revenueByPracticeArea[0]?.type || 'Unclassified';

        return {
          partyName: row.partyName,
          matterCount: row.matterCount,
          activeMatters: row.activeMatters,
          completedMatters: row.completedMatters,
          contractValue: roundMoney(row.contractValue),
          totalBilled: roundMoney(row.totalBilled),
          collected: roundMoney(row.totalCollected),
          outstanding: roundMoney(row.totalBilled - row.totalCollected),
          directMatterCosts: roundMoney(row.directMatterCosts),
          grossProfit: roundMoney(grossProfit),
          grossProfitMargin,
          collectionPeriodDays: row.collectionDaysCount > 0 ? roundMoney(row.collectionDaysTotal / row.collectionDaysCount) : null,
          retainerValue: roundMoney(row.retainerValue),
          primaryPracticeArea: practiceArea,
          matterDetails: (clientDetailsByKey.get(normalizeName(row.partyName)) || [])
            .map((item) => ({
              ...item,
              contractValue: roundMoney(item.contractValue),
              totalBilled: roundMoney(item.totalBilled),
              collected: roundMoney(item.collected),
              outstanding: roundMoney(item.outstanding),
              directMatterCosts: roundMoney(item.directMatterCosts),
              grossProfit: roundMoney(item.grossProfit),
              grossProfitMargin: item.grossProfitMargin,
            }))
            .sort((a, b) => String(a.recordType).localeCompare(String(b.recordType)) || String(a.recordLabel).localeCompare(String(b.recordLabel))),
          revenueByPracticeArea,
        };
      })
      .sort((a, b) => a.partyName.localeCompare(b.partyName));

    const selectedMemberMetrics = selectedMemberName
      ? {
        name: selectedMemberName,
        role: selectedMember?.role || 'Unknown',
        tasksCompleted: completedTasksByName.get(selectedMemberNameNormalized || '') || 0,
        outstandingTasks: overdueByName.get(selectedMemberNameNormalized || '') || 0,
        revenueGenerated: Math.round((grossHandledByName.get(selectedMemberNameNormalized || '') || 0) * 100) / 100,
        paymentsReceived: Math.round(
          selectedMatters.reduce((sum, matter: any) => sum + (paidInvoicesByCaseId.get(String(matter._id)) || 0), 0) * 100
        ) / 100,
        outstandingBalance: outstanding,
        feesEarned: Math.round((earnedByName.get(selectedMemberNameNormalized || '') || 0) * 100) / 100,
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
      clientProfitability,
      months,
      expenseTypes,
    });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || 'Failed to load firm reports.' });
  }
};


