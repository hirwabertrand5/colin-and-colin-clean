import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';

import Case from '../models/caseModel';
import Task from '../models/taskModel';
import Event from '../models/eventModel';
import Document from '../models/documentModel';
import Invoice from '../models/invoiceModel';
import User from '../models/userModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import WorkflowTemplate from '../models/workflowTemplateModel';

import { computeCaseEarnedFees, normalizeEffectiveWorkflowSteps } from '../utils/caseEarnedFees';
import { resolveDeadlineDateTime } from '../utils/deadlineUtils';
import { getTpaPercent } from '../utils/workflowPercentages';

const isAdmin = (role?: string) =>
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

const startOfMonthDate = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const toISODate = (d: Date) => d.toISOString().slice(0, 10);

export const getExecutiveAssistantDashboard = async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    if (!isAdmin(role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const todayISO = isoToday();
    const monthStartISO = startOfMonthISO();
    const monthStartDate = startOfMonthDate();

    // ----------------------------
    // Stats (MTD)
    // ----------------------------
    const [casesCreatedMTD, documentsUploadedMTD, scheduledEventsMTD, tasksCoordinatedMTD] =
      await Promise.all([
        Case.countDocuments({ createdAt: { $gte: monthStartDate } }),
        Document.countDocuments({ createdAt: { $gte: monthStartDate } }),
        Event.countDocuments({ date: { $gte: monthStartISO, $lte: todayISO } }),
        Task.countDocuments({ createdAt: { $gte: monthStartDate } }),
      ]);

    // ----------------------------
    // Today schedule (events today)
    // ----------------------------
    const todayEvents = await Event.find({ date: todayISO })
      .sort({ time: 1 })
      .limit(20)
      .lean();

    // Attach case labels to events
    const todayCaseIds = Array.from(new Set(todayEvents.map((e: any) => String(e.caseId)).filter(Boolean)));
    const todayCases = await Case.find({ _id: { $in: todayCaseIds } }).select('_id caseNo parties').lean();
    const caseMap = new Map(todayCases.map((c: any) => [String(c._id), c]));

    const todaySchedule = todayEvents.map((e: any) => {
      const c = caseMap.get(String(e.caseId));
      const caseLabel = c ? c.caseNo || c.parties : '';
      return {
        id: String(e._id),
        time: e.time || '—',
        title: caseLabel ? `${e.title} — ${caseLabel}` : e.title,
        type: e.type,
        description: e.description || '',
      };
    });

    // ----------------------------
    // Pending follow-up (tasks)
    // - show tasks not completed, soonest due first
    // ----------------------------
    const pendingTasks = await Task.find({ status: { $ne: 'Completed' } })
      .sort({ dueDate: 1, priority: 1 })
      .limit(10)
      .lean();

    // attach case labels to tasks
    const pendingCaseIds = Array.from(new Set(pendingTasks.map((t: any) => String(t.caseId)).filter(Boolean)));
    const pendingCases = await Case.find({ _id: { $in: pendingCaseIds } }).select('_id caseNo parties').lean();
    const pendingCaseMap = new Map(pendingCases.map((c: any) => [String(c._id), c]));

    const pendingFollowUp = pendingTasks.map((t: any) => {
      const c = pendingCaseMap.get(String(t.caseId));
      const caseLabel = c ? c.caseNo || c.parties : '';
      return {
        id: String(t._id),
        type: t.requiresApproval && t.approvalStatus === 'Pending' ? 'Approval' : 'Task',
        title: caseLabel ? `${t.title} — ${caseLabel}` : t.title,
        assignedTo: t.assignee || '—',
        status: t.status,
        dueDate: t.dueDate || '—',
        priority: t.priority || 'Medium',
      };
    });

    // ----------------------------
    // Recent cases (last 5)
    // ----------------------------
    const recent = await Case.find().sort({ createdAt: -1 }).limit(5).lean();

    const recentCases = recent.map((c: any) => ({
      id: String(c._id),
      name: c.caseNo || c.parties || '—',
      status: c.status || '—',
      client: c.parties || '—',
      createdDate: c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '',
    }));

    // ----------------------------
    // Response
    // ----------------------------
    res.json({
      stats: {
        casesCreatedMTD,
        documentsUploadedMTD,
        scheduledEventsMTD,
        tasksCoordinatedMTD,
      },
      today: {
        dateISO: todayISO,
        label: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      },
      todaySchedule,
      pendingFollowUp,
      recentCases,
    });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to load executive assistant dashboard.' });
  }
};

// ---------------------------------------------------------------------------
// Staff member dashboard summary
// ---------------------------------------------------------------------------

const normalizeKey = (value: unknown) => String(value || '').trim().toLowerCase();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const round1 = (value: number) => Math.round((Number(value) || 0) * 10) / 10;
const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

const averageOf = (values: number[]) =>
  values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

type StaffDashboardMatterRow = {
  caseId: string;
  caseNo: string;
  parties: string;
  status: string;
  role: string;
  tpaPercent: number;
  timelinessScore: number | null;
  qualityScore: number | null;
  collectedBase: number;
  earnedFee: number | null;
  completed: boolean;
  outstanding: boolean;
  overdueSections: number;
};

const emptyStaffSummary = (meName: string, tpaPercent: number) => ({
  user: { name: meName },
  tpaPercent,
  currency: 'RWF',
  mattersAssigned: 0,
  mattersOutstanding: 0,
  mattersCompleted: 0,
  overdueSections: 0,
  averageTimelinessScore: null as number | null,
  averageQualityScore: null as number | null,
  feesEarnedTotal: null as number | null,
  collectedBaseTotal: 0,
  rows: [] as StaffDashboardMatterRow[],
});

/**
 * Staff member dashboard summary.
 *
 * Every value is derived from the matters the signed-in user is assigned to
 * (assignedTo / Initiator / Reviewer / Signer-Approver) so the dashboard always
 * agrees with the Case Workspace:
 *
 * - Active matters     = matters assigned to the user.
 * - Tasks outstanding  = assigned matters whose Key Actions are not all checked.
 * - Overdue tasks      = workflow sections (steps) past their deadline in open matters.
 * - On-time completion = average Timeliness of the user's row in each matter's
 *                        Earned Fees table (Case Workspace).
 * - Quality score      = average Quality Score of the user's row in each matter's
 *                        Earned Fees table (Case Workspace).
 * - Tasks completed    = assigned matters whose workflow is completed.
 * - Fees earned        = sum of the user's "Earned fee" column across the matters
 *                        they are assigned to (Case Workspace -> Earned Fees).
 */
export const getStaffDashboardSummary = async (req: AuthRequest, res: Response) => {
  try {
    const meName = String(req.user?.name || '').trim();
    const meEmail = String(req.user?.email || '').trim();
    if (!meName && !meEmail) return res.status(401).json({ message: 'Unauthorized.' });

    const roleTpaPercent = getTpaPercent(String(req.user?.role || ''));
    const meKeys = [meName, meEmail].map(normalizeKey).filter(Boolean);
    const identityRegexes = [meName, meEmail]
      .filter(Boolean)
      .map((value) => new RegExp(`^${escapeRegExp(value)}$`, 'i'));

    const matters: any[] = identityRegexes.length
      ? await Case.find({
          $or: identityRegexes.flatMap((identity) => [
            { assignedTo: identity },
            { 'caseAssignments.initiator': identity },
            { 'caseAssignments.reviewer': identity },
            { 'caseAssignments.signerApprover': identity },
          ]),
        })
          .sort({ updatedAt: -1 })
          .lean()
      : [];

    if (!matters.length) return res.json(emptyStaffSummary(meName, roleTpaPercent));

    const caseIds = matters.map((matter) => matter._id);
    const [instances, tasks, paidInvoices] = await Promise.all([
      WorkflowInstance.find({ caseId: { $in: caseIds } }).lean(),
      Task.find({ caseId: { $in: caseIds } }).lean(),
      Invoice.find({ caseId: { $in: caseIds }, status: 'Paid' })
        .select('caseId amount')
        .lean(),
    ]);

    const instanceList = instances as any[];
    const taskList = tasks as any[];
    const invoiceList = paidInvoices as any[];

    const templateIds = Array.from(
      new Set(instanceList.map((instance) => String(instance?.templateId || '')).filter(Boolean))
    );
    const templates: any[] = templateIds.length
      ? await WorkflowTemplate.find({ _id: { $in: templateIds } }).lean()
      : [];
    const templatesById = new Map<string, any>(
      templates.map((template: any) => [String(template?._id || ''), template])
    );

    const instancesByCase = new Map<string, any>(
      instanceList.map((instance: any) => [String(instance?.caseId || ''), instance])
    );
    const tasksByCase = new Map<string, any[]>();
    for (const task of taskList) {
      const key = String(task?.caseId || '');
      if (!key) continue;
      tasksByCase.set(key, [...(tasksByCase.get(key) || []), task]);
    }
    const collectedByCase = new Map<string, number>();
    for (const invoice of invoiceList) {
      const key = String(invoice?.caseId || '');
      if (!key) continue;
      collectedByCase.set(key, (collectedByCase.get(key) || 0) + Math.max(0, Number(invoice?.amount) || 0));
    }

    // Resolve each assigned member's system role so the TPA column follows the
    // same role-based table as the Case Workspace Earned Fees table.
    const memberNames = new Set<string>();
    for (const matter of matters) {
      const assignments = matter?.caseAssignments || {};
      [assignments.initiator || matter?.assignedTo, assignments.reviewer, assignments.signerApprover]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .forEach((name) => memberNames.add(name));
    }
    const users: any[] = memberNames.size
      ? await User.find({ name: { $in: Array.from(memberNames) } })
          .select('name role')
          .lean()
      : [];
    const roleByName = new Map<string, string>();
    for (const user of users) {
      const key = normalizeKey(user?.name);
      if (key && !roleByName.has(key)) roleByName.set(key, String(user?.role || ''));
    }
    if (meName && req.user?.role) roleByName.set(normalizeKey(meName), String(req.user.role));

    const rows: StaffDashboardMatterRow[] = [];
    const timelinessScores: number[] = [];
    const qualityScores: number[] = [];
    let mattersCompleted = 0;
    let mattersOutstanding = 0;
    let overdueSections = 0;
    let collectedBaseTotal = 0;
    let feesEarnedTotal = 0;
    let hasScoredFee = false;
    let currency = 'RWF';

    for (const matter of matters) {
      const caseId = String(matter?._id || '');
      const instance = instancesByCase.get(caseId);
      const template = instance ? templatesById.get(String(instance?.templateId || '')) : null;
      const effectiveSteps = normalizeEffectiveWorkflowSteps(instance, template);
      const steps: any[] = Array.isArray(effectiveSteps) ? effectiveSteps : [];

      // Completion follows the workflow instance; case/workflow fallbacks cover
      // matters that were closed before the workflow engine existed.
      const completed =
        String(instance?.status || '').toLowerCase() === 'completed' ||
        String(matter?.workflowProgress?.status || '').toLowerCase() === 'completed' ||
        String(matter?.status || '').toLowerCase() === 'closed';

      const actions = steps.flatMap((step) => (Array.isArray(step?.actions) ? step.actions : []));
      const allKeyActionsChecked = actions.length > 0 && actions.every((action: any) => Boolean(action?.done));
      const allStepsCompleted =
        steps.length > 0 && steps.every((step: any) => String(step?.status || '').toLowerCase() === 'completed');
      const outstanding = !completed && !(allKeyActionsChecked || allStepsCompleted);

      const matterOverdueSections = completed
        ? 0
        : steps.filter((step: any) => {
            if (String(step?.status || '').toLowerCase() === 'completed') return false;
            const dueAt = resolveDeadlineDateTime(step?.dueAt);
            return dueAt ? dueAt.getTime() < Date.now() : false;
          }).length;

      if (completed) mattersCompleted += 1;
      if (outstanding) mattersOutstanding += 1;
      overdueSections += matterOverdueSections;

      // Same engine as the Case Workspace / Case Management Earned Fees table.
      const earned = computeCaseEarnedFees({
        caseDoc: matter,
        template,
        workflowInstance: { ...(instance || {}), steps: effectiveSteps },
        tasks: tasksByCase.get(caseId) || [],
        collectedAmount: collectedByCase.get(caseId) || 0,
        roleByName,
      });

      const myRows = earned.team.filter((member) => meKeys.includes(normalizeKey(member.name)));
      if (!myRows.length) continue;

      currency = String(
        matter?.workflowProgress?.plannedValue?.currency || matter?.billingSettings?.currency || currency
      );

      const myTimeliness = myRows
        .map((member) => member.timelinessScore)
        .filter((value): value is number => value != null);
      const myQuality = myRows.map((member) => member.qualityScore).filter((value): value is number => value != null);
      const myFees = myRows.map((member) => member.earnedFee).filter((value): value is number => value != null);
      const collectedBase = myRows.reduce(
        (max, member) => Math.max(max, Number(member.taskFeeCollected) || 0),
        0
      );

      const timelinessScore = myTimeliness.length
        ? round1(myTimeliness.reduce((sum, value) => sum + value, 0) / myTimeliness.length)
        : null;
      const qualityScore = myQuality.length
        ? round1(myQuality.reduce((sum, value) => sum + value, 0) / myQuality.length)
        : null;
      const earnedFee = myFees.length ? round2(myFees.reduce((sum, value) => sum + value, 0)) : null;
      const tpaPercent = myRows.find((member) => member.tpaPercent > 0)?.tpaPercent ?? roleTpaPercent;
      const roles = Array.from(new Set(myRows.map((member) => String(member.role || '')).filter(Boolean)));

      if (timelinessScore != null) timelinessScores.push(timelinessScore);
      if (qualityScore != null) qualityScores.push(qualityScore);
      if (earnedFee != null) {
        feesEarnedTotal += earnedFee;
        hasScoredFee = true;
      }
      collectedBaseTotal += collectedBase;

      rows.push({
        caseId,
        caseNo: String(matter?.caseNo || ''),
        parties: String(matter?.parties || ''),
        status: String(matter?.status || ''),
        role: roles.join(' · '),
        tpaPercent,
        timelinessScore,
        qualityScore,
        collectedBase: round2(collectedBase),
        earnedFee,
        completed,
        outstanding,
        overdueSections: matterOverdueSections,
      });
    }

    return res.json({
      user: { name: meName },
      tpaPercent: roleTpaPercent,
      currency,
      mattersAssigned: matters.length,
      mattersOutstanding,
      mattersCompleted,
      overdueSections,
      averageTimelinessScore: averageOf(timelinessScores),
      averageQualityScore: averageOf(qualityScores),
      feesEarnedTotal: hasScoredFee ? round2(feesEarnedTotal) : null,
      collectedBaseTotal: round2(collectedBaseTotal),
      rows,
    });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || 'Failed to load staff dashboard summary.' });
  }
};

