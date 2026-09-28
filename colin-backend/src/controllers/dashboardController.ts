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
import {
  isWithinReportRange,
  resolveOptionalReportRange,
  type ResolvedReportRange,
} from '../utils/reportRange';

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
    // Fetch enough rows to retain ten after excluding tasks whose matter was
    // closed. Closed-matter tasks must not reappear as pending/overdue work.
    const pendingTaskCandidates = await Task.find({ status: { $ne: 'Completed' } })
      .sort({ dueDate: 1, priority: 1 })
      .limit(100)
      .lean();

    // attach case labels to tasks
    const pendingCaseIds = Array.from(new Set(pendingTaskCandidates.map((t: any) => String(t.caseId)).filter(Boolean)));
    const pendingCases = await Case.find({ _id: { $in: pendingCaseIds } })
      .select('_id caseNo parties status workflowProgress')
      .lean();
    const pendingCaseMap = new Map(pendingCases.map((c: any) => [String(c._id), c]));
    const pendingTasks = pendingTaskCandidates
      .filter((task: any) => {
        const caseDoc: any = pendingCaseMap.get(String(task.caseId));
        return !caseDoc || (
          String(caseDoc.status || '').trim().toLowerCase() !== 'closed' &&
          String(caseDoc.workflowProgress?.status || '').trim() !== 'Completed'
        );
      })
      .slice(0, 10);

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
  /** Set only when a period was requested — eligible collected value received in the period. */
  collectedBaseInPeriod?: number;
  /** Set only when a period was requested — your earned fee from the period's payments. */
  earnedFeeInPeriod?: number | null;
};

/** Period-scoped figures. Present only when the caller sends range/from/to. */
type StaffDashboardPeriod = {
  key: string;
  label: string;
  from: string;
  to: string;
  /** Your earned fee from payments received inside the period. */
  feesEarned: number | null;
  /** Collected value received inside the period across your matters. */
  collectedValue: number;
  /** Key Actions you checked inside the period. */
  keyActionsChecked: number;
  /** Workflow sections completed inside the period. */
  sectionsCompleted: number;
  /** Tasks completed inside the period where you were the assignee or a stage member. */
  tasksCompleted: number;
  /** Your matters whose workflow completed inside the period. */
  mattersCompleted: number;
  /** Average Timeliness of your task stages completed inside the period. */
  averageTimelinessScore: number | null;
  /** Average Quality of your task stages completed inside the period. */
  averageQualityScore: number | null;
};

const buildStaffPeriod = (
  range: ResolvedReportRange | null,
  values?: Partial<Omit<StaffDashboardPeriod, 'key' | 'label' | 'from' | 'to'>>
): StaffDashboardPeriod | undefined => {
  if (!range) return undefined;
  return {
    key: range.key,
    label: range.label,
    from: range.displayFrom,
    to: range.displayTo,
    feesEarned: values?.feesEarned ?? null,
    collectedValue: values?.collectedValue ?? 0,
    keyActionsChecked: values?.keyActionsChecked ?? 0,
    sectionsCompleted: values?.sectionsCompleted ?? 0,
    tasksCompleted: values?.tasksCompleted ?? 0,
    mattersCompleted: values?.mattersCompleted ?? 0,
    averageTimelinessScore: values?.averageTimelinessScore ?? null,
    averageQualityScore: values?.averageQualityScore ?? null,
  };
};

const emptyStaffSummary = (meName: string, tpaPercent: number, period?: StaffDashboardPeriod) => ({
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
  ...(period ? { period } : {}),
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
 *
 * Optional period: when the caller sends `range` (daily | weekly | monthly |
 * quarterly | yearly | ytd) or `from` + `to`, the response additionally carries
 * a `period` block with the figures earned / completed inside that window and
 * per-matter in-period columns. Without those parameters the response is
 * byte-for-byte the all-time summary it has always been.
 */
export const getStaffDashboardSummary = async (req: AuthRequest, res: Response) => {
  try {
    const meName = String(req.user?.name || '').trim();
    const meEmail = String(req.user?.email || '').trim();
    if (!meName && !meEmail) return res.status(401).json({ message: 'Unauthorized.' });

    // Optional reporting period — resolved with the same helper Firm Reports
    // uses, so a period always means the exact same window in both places.
    const periodResolution = resolveOptionalReportRange(req.query as any);
    if (periodResolution && 'error' in periodResolution) {
      return res.status(400).json({ message: periodResolution.error });
    }
    const period = periodResolution || null;

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

    if (!matters.length) return res.json(emptyStaffSummary(meName, roleTpaPercent, buildStaffPeriod(period)));

    const caseIds = matters.map((matter) => matter._id);
    const [instances, tasks, paidInvoices] = await Promise.all([
      WorkflowInstance.find({ caseId: { $in: caseIds } }).lean(),
      Task.find({ caseId: { $in: caseIds } }).lean(),
      Invoice.find({ caseId: { $in: caseIds }, status: 'Paid' })
        .select('caseId amount updatedAt')
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

    // Payments received inside the requested period. The payment date is the
    // moment the invoice was marked Paid (its updatedAt), exactly like the
    // Firm Reports "Payment Date" basis.
    const collectedInPeriodByCase = new Map<string, number>();
    if (period) {
      for (const invoice of invoiceList) {
        if (!isWithinReportRange(invoice?.updatedAt, period)) continue;
        const key = String(invoice?.caseId || '');
        if (!key) continue;
        collectedInPeriodByCase.set(
          key,
          (collectedInPeriodByCase.get(key) || 0) + Math.max(0, Number(invoice?.amount) || 0)
        );
      }
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

    // Period-scoped accumulators (only filled when a period was requested).
    let periodFeesEarned = 0;
    let hasPeriodFee = false;
    let periodCollectedValue = 0;
    let periodKeyActionsChecked = 0;
    let periodSectionsCompleted = 0;
    let periodTasksCompleted = 0;
    let periodMattersCompleted = 0;
    const periodTimelinessScores: number[] = [];
    const periodQualityScores: number[] = [];

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

      // ---- Period-scoped figures for this matter (requested periods only) ----
      let collectedBaseInPeriod: number | undefined;
      let earnedFeeInPeriod: number | null | undefined;
      if (period) {
        const collectedInPeriod = collectedInPeriodByCase.get(caseId) || 0;
        periodCollectedValue += collectedInPeriod;

        // Same engine and role table as the all-time row — only the collected
        // value is restricted to payments received inside the period.
        const earnedInPeriod = computeCaseEarnedFees({
          caseDoc: matter,
          template,
          workflowInstance: { ...(instance || {}), steps: effectiveSteps },
          tasks: tasksByCase.get(caseId) || [],
          collectedAmount: collectedInPeriod,
          roleByName,
        });
        const myPeriodRows = earnedInPeriod.team.filter((member) => meKeys.includes(normalizeKey(member.name)));
        const myPeriodFees = myPeriodRows
          .map((member) => member.earnedFee)
          .filter((value): value is number => value != null);
        earnedFeeInPeriod = myPeriodFees.length ? round2(myPeriodFees.reduce((sum, value) => sum + value, 0)) : null;
        collectedBaseInPeriod = myPeriodRows.reduce(
          (max, member) => Math.max(max, Number(member.taskFeeCollected) || 0),
          0
        );
        if (earnedFeeInPeriod != null) {
          periodFeesEarned += earnedFeeInPeriod;
          hasPeriodFee = true;
        }

        for (const step of steps) {
          if (
            String((step as any)?.status || '').toLowerCase() === 'completed' &&
            isWithinReportRange((step as any)?.completedAt, period)
          ) {
            periodSectionsCompleted += 1;
          }
          const stepActions = Array.isArray((step as any)?.actions) ? (step as any).actions : [];
          for (const action of stepActions) {
            if (action?.done && isWithinReportRange(action?.doneAt, period)) periodKeyActionsChecked += 1;
          }
        }

        if (completed) {
          const completionAt =
            steps.reduce<Date | null>((latest, step: any) => {
              const at = step?.completedAt ? new Date(step.completedAt) : null;
              if (!at || Number.isNaN(at.getTime())) return latest;
              return !latest || at.getTime() > latest.getTime() ? at : latest;
            }, null) || (instance?.updatedAt ? new Date(instance.updatedAt) : null);
          if (isWithinReportRange(completionAt, period)) periodMattersCompleted += 1;
        }
      }

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
        ...(period
          ? { collectedBaseInPeriod: round2(collectedBaseInPeriod || 0), earnedFeeInPeriod: earnedFeeInPeriod ?? null }
          : {}),
      });
    }

    // ---- Period-scoped task metrics (assignee or workflow-stage member = me) ----
    if (period) {
      for (const task of taskList) {
        const involvesMe =
          meKeys.includes(normalizeKey(task?.assignee)) ||
          (Array.isArray(task?.taskStages) &&
            task.taskStages.some((stage: any) => meKeys.includes(normalizeKey(stage?.staffMember))));
        if (!involvesMe) continue;

        if (
          String(task?.status || '').toLowerCase() === 'completed' &&
          isWithinReportRange(task?.completedAt, period)
        ) {
          periodTasksCompleted += 1;
        }

        for (const stage of Array.isArray(task?.taskStages) ? task.taskStages : []) {
          if (!meKeys.includes(normalizeKey(stage?.staffMember))) continue;
          if (!isWithinReportRange(stage?.completedAt, period)) continue;
          if (stage?.timelinessScore != null) periodTimelinessScores.push(Number(stage.timelinessScore));
          if (stage?.qualityScore != null) periodQualityScores.push(Number(stage.qualityScore));
        }
      }
    }

    const periodSummary = buildStaffPeriod(period, {
      feesEarned: hasPeriodFee ? round2(periodFeesEarned) : null,
      collectedValue: round2(periodCollectedValue),
      keyActionsChecked: periodKeyActionsChecked,
      sectionsCompleted: periodSectionsCompleted,
      tasksCompleted: periodTasksCompleted,
      mattersCompleted: periodMattersCompleted,
      averageTimelinessScore: averageOf(periodTimelinessScores),
      averageQualityScore: averageOf(periodQualityScores),
    });

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
      ...(periodSummary ? { period: periodSummary } : {}),
    });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || 'Failed to load staff dashboard summary.' });
  }
};

