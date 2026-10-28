import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';

import { SINGLE_CURRENCY } from '../utils/currency';

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
import { identityMatches } from '../utils/caseAssignments';
import { buildRoleByName, resolveMemberTpa, getTpaPercent, normalizeMemberName } from '../utils/workflowPercentages';
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
        // The follow-up opens the matter's Case Management tab, so the frontend
        // needs the matter and the workflow section it belongs to.
        caseId: t.caseId ? String(t.caseId) : '',
        workflowStepKey: t.workflowStepKey || '',
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
  /** Planned contract value of the matter (Case Workspace → Contract Value). */
  contractValue: number;
  collectedBase: number;
  earnedFee: number | null;
  /** False when this is a retained handover/earnings record, not live work. */
  isCurrentAssignment: boolean;
  /** True when this earnings row was earned through a delegated Independent Task. */
  isIndependentContributor?: boolean;
  completed: boolean;
  outstanding: boolean;
  overdueSections: number;
  /**
   * True when this matter had ANY activity inside the selected period (a section
   * completed, the matter completed, a task completed, or a payment received).
   * Lets the dashboard list only the matters a period actually covers. Absent
   * for the all-time view, where every assigned matter is in scope.
   */
  inPeriod?: boolean;
  /** Set only when a period was requested — eligible collected value received in the period. */
  collectedBaseInPeriod?: number;
  /** Set only when a period was requested — your earned fee from the period's payments. */
  earnedFeeInPeriod?: number | null;
};

/** Period-scoped figures. ALWAYS present — for All Time it carries the all-time
 * equivalents so the dashboard can render one uniform card set for every period. */
type StaffDashboardPeriod = {
  key: string;
  label: string;
  from: string;
  to: string;
  /** True when no date window was applied (All Time) — every figure is all-time. */
  isAllTime: boolean;
  /** Your earned fee from payments received inside the period (all-time total when All Time). */
  feesEarned: number | null;
  /** Collected value received inside the period across your matters. */
  collectedValue: number;
  /** Key Actions you checked inside the period. */
  keyActionsChecked: number;
  /** Workflow sections completed inside the period. */
  sectionsCompleted: number;
  /** Tasks completed inside the period where you were the assignee or a stage member. */
  tasksCompleted: number;
  /**
   * Tasks assigned to you that were still outstanding as of the END of the
   * period — they existed by then and had not been completed by then. For All
   * Time this is simply the tasks still open today. Reconstructed honestly from
   * each task's creation and completion dates; never an invented value.
   */
  tasksOutstanding: number;
  /** Your matters whose workflow completed inside the period. */
  mattersCompleted: number;
  /** Your matters that had any activity inside the period. */
  mattersWithActivity: number;
  /** Matters assigned to you that were created inside the period (entry date). */
  mattersCreatedInPeriod: number;
  /** Average Timeliness of your Earned Fees rows in matters worked in the period. */
  averageTimelinessScore: number | null;
  /** Average Quality of your Earned Fees rows in matters worked in the period. */
  averageQualityScore: number | null;
  /**
   * Sum of the contract values of the matters that qualify for this reporting
   * scope — every assigned matter for All Time, only the matters with in-period
   * activity for a selected period. This is CONTRACT VALUE, not cash collected
   * or revenue earned, and it is never derived from payment amounts.
   */
  contractValue: number;
};

const buildStaffPeriod = (
  range: ResolvedReportRange | null,
  values?: Partial<Omit<StaffDashboardPeriod, 'key' | 'label' | 'from' | 'to' | 'isAllTime'>>
): StaffDashboardPeriod => {
  // All Time is a first-class reporting scope: it always returns a block so the
  // dashboard renders the SAME cards, just with all-time figures. `from`/`to`
  // are empty strings because there is no date window to describe.
  if (!range) {
    return {
      key: 'all',
      label: 'All time',
      from: '',
      to: '',
      isAllTime: true,
      feesEarned: values?.feesEarned ?? null,
      collectedValue: values?.collectedValue ?? 0,
      keyActionsChecked: values?.keyActionsChecked ?? 0,
      sectionsCompleted: values?.sectionsCompleted ?? 0,
      tasksCompleted: values?.tasksCompleted ?? 0,
      tasksOutstanding: values?.tasksOutstanding ?? 0,
      mattersCompleted: values?.mattersCompleted ?? 0,
      mattersWithActivity: values?.mattersWithActivity ?? 0,
      mattersCreatedInPeriod: values?.mattersCreatedInPeriod ?? 0,
      averageTimelinessScore: values?.averageTimelinessScore ?? null,
      averageQualityScore: values?.averageQualityScore ?? null,
      contractValue: values?.contractValue ?? 0,
    };
  }
  return {
    key: range.key,
    label: range.label,
    from: range.displayFrom,
    to: range.displayTo,
    isAllTime: false,
    feesEarned: values?.feesEarned ?? null,
    collectedValue: values?.collectedValue ?? 0,
    keyActionsChecked: values?.keyActionsChecked ?? 0,
    sectionsCompleted: values?.sectionsCompleted ?? 0,
    tasksCompleted: values?.tasksCompleted ?? 0,
    tasksOutstanding: values?.tasksOutstanding ?? 0,
    mattersCompleted: values?.mattersCompleted ?? 0,
    mattersWithActivity: values?.mattersWithActivity ?? 0,
    mattersCreatedInPeriod: values?.mattersCreatedInPeriod ?? 0,
    averageTimelinessScore: values?.averageTimelinessScore ?? null,
    averageQualityScore: values?.averageQualityScore ?? null,
    contractValue: values?.contractValue ?? 0,
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
  // A reporting block is ALWAYS returned (All Time when no range) so the card
  // set never changes shape between All Time and a selected period.
  period: period ?? buildStaffPeriod(null),
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

    const currentTpaUser = await User.findById(req.user?.id).select('name role tpaHistory').lean();
    const roleTpaPercent = currentTpaUser ? resolveMemberTpa(currentTpaUser.name, buildRoleByName([currentTpaUser])).tpaPercent : getTpaPercent(String(req.user?.role || ''));
    // Names may be stored as an account first name or the full picker label;
    // use the platform's canonical comparison everywhere a dashboard decides
    // whether a value belongs to the signed-in member.
    const matchesCurrentUser = (value: unknown) =>
      [meName, meEmail].some((identity) => identity && identityMatches(value, identity));

    // Identity match must be CANONICAL, not byte-exact. A member is referenced
    // sometimes by their account name ("Badiel") and sometimes by the full name a
    // person-picker stored ("Badiel Rubangutsangabo"). A strict `^Badiel$` match
    // silently dropped those matters — the reported "6 instead of 10". So the
    // NAME identity matches an optional trailing name (same first token), while
    // the EMAIL identity stays exact (an email is never a name prefix).
    const nameIdentityRegexes = meName
      ? [new RegExp(`^${escapeRegExp(meName)}(\\s.+)?$`, 'i')]
      : [];
    const emailIdentityRegexes = meEmail
      ? [new RegExp(`^${escapeRegExp(meEmail)}$`, 'i')]
      : [];
    const identityRegexes = [...nameIdentityRegexes, ...emailIdentityRegexes];

    // A delegated independent task grants a narrow workflow role, not general
    // case-workspace access. It must nevertheless put the contributor's fee
    // row on their personal dashboard once they have performed that role.
    const independentContributorCaseIds: any[] = identityRegexes.length
      ? await WorkflowInstance.distinct('caseId', {
          $or: identityRegexes.map((identity) => ({ 'steps.independentContributors.name': identity })),
        })
      : [];
    const matterVisibilityFilters: any[] = identityRegexes.flatMap((identity) => [
            { assignedTo: identity },
            { 'caseAssignments.initiator': identity },
            { 'caseAssignments.reviewer': identity },
            { 'caseAssignments.signerApprover': identity },
            // Former owners keep dashboard/report visibility for the work they
            // completed before a handover.
            { 'assignmentHandoverHistory.previousAssignee': identity },
            { 'assignmentHandoverHistory.nextAssignee': identity },
          ]);
    if (independentContributorCaseIds.length) {
      matterVisibilityFilters.push({ _id: { $in: independentContributorCaseIds } });
    }
    const matters: any[] = matterVisibilityFilters.length
      ? await Case.find({ $or: matterVisibilityFilters })
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
    // Firm Reports "Payment Date" basis. For All Time (no period) every paid
    // invoice qualifies, so the in-scope map is simply the all-time totals.
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
    } else {
      for (const [key, value] of collectedByCase) collectedInPeriodByCase.set(key, value);
    }

    // Resolve each assigned member's system role so the TPA column follows the
    // same role-based table as the Case Workspace Earned Fees table. The users
    // collection is loaded whole and keyed case/whitespace-insensitively.
    const users: any[] = await User.find({}).select('name role tpaHistory').lean();
    const roleByName = buildRoleByName(users);
    if (meName && req.user?.role) roleByName.set(normalizeMemberName(meName), String(req.user.role));

    const rows: StaffDashboardMatterRow[] = [];
    const timelinessScores: number[] = [];
    const qualityScores: number[] = [];
    let mattersCompleted = 0;
    let mattersOutstanding = 0;
    let overdueSections = 0;
    let currentMattersAssigned = 0;
    let collectedBaseTotal = 0;
    let feesEarnedTotal = 0;
    let hasScoredFee = false;
    let currency = 'RWF';

    // Period-scoped accumulators. When NO period is requested these still run —
    // `isWithinReportRange(x, null)` is true for every record — so All Time
    // produces the exact same figures with the same code path. This is what lets
    // the dashboard show ONE card set for every period.
    let periodFeesEarned = 0;
    let hasPeriodFee = false;
    let periodCollectedValue = 0;
    let periodKeyActionsChecked = 0;
    let periodSectionsCompleted = 0;
    let periodTasksCompleted = 0;
    let periodTasksOutstanding = 0;
    let periodMattersCompleted = 0;
    let periodMattersWithActivity = 0;
    let periodMattersCreatedInPeriod = 0;
    // Sum of contract values for the matters that qualify in this scope. All
    // Time = every assigned matter; a selected period = only in-period matters.
    let periodContractValue = 0;
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

      const allStepsCompleted =
        steps.length > 0 && steps.every((step: any) => String(step?.status || '').toLowerCase() === 'completed');
      const outstanding = !completed && !allStepsCompleted;

      const matterOverdueSections = completed
        ? 0
        : steps.filter((step: any) => {
            if (String(step?.status || '').toLowerCase() === 'completed') return false;
            const dueAt = resolveDeadlineDateTime(step?.dueAt);
            return dueAt ? dueAt.getTime() < Date.now() : false;
          }).length;

      // Same engine as the Case Workspace / Case Management Earned Fees table.
      const earned = computeCaseEarnedFees({
        caseDoc: matter,
        template,
        workflowInstance: { ...(instance || {}), steps: effectiveSteps },
        tasks: tasksByCase.get(caseId) || [],
        collectedAmount: collectedByCase.get(caseId) || 0,
        roleByName,
      });

      // Earned-Fees rows for me — matched canonically so a full-name stored slot
      // ("Badiel Rubangutsangabo") still counts for the account ("Badiel").
      const myRows = earned.team.filter((member) => matchesCurrentUser(member.name));
      const hasIndependentContribution = myRows.some((member) => member.isIndependentContributor);

      currency = SINGLE_CURRENCY;

      // Every matter returned by the identity query above is one this member is
      // genuinely assigned to (assignedTo / Initiator / Reviewer / Signer-Approver),
      // across ALL statuses (active, closed, temporarily closed). It must NOT be
      // dropped just because the member has no row in the matter's Earned Fees
      // team: `earned.team` only builds the three caseAssignments slots (using
      // assignedTo purely as an Initiator fallback), so a matter where this member
      // is the assignedTo lawyer but someone else is the Initiator has no `myRows`
      // here. The old `if (!myRows.length) continue;` skipped exactly those, so
      // "Assigned Matters" undercounted (e.g. 6 instead of 10). Keep the matter and
      // count it, with null scores (the honest "Pending") until it is scored.
      const matchesMe = matchesCurrentUser;
      const directRoles: string[] = [];
      if (matchesMe(matter?.caseAssignments?.initiator)) directRoles.push('Initiator');
      if (matchesMe(matter?.caseAssignments?.reviewer)) directRoles.push('Reviewer');
      if (matchesMe(matter?.caseAssignments?.signerApprover)) directRoles.push('Signer/Approver');
      if (directRoles.length === 0 && matchesMe(matter?.assignedTo)) {
        directRoles.push('Assigned');
      }
      // A handover keeps the former owner's fee row and report visibility, but
      // must never make that person look responsible for the case's remaining
      // work.  Live portfolio/task counters are therefore based only on a
      // current assignment slot; earnings still include historical rows below.
      const isCurrentAssignment = directRoles.length > 0;
      if (isCurrentAssignment) {
        currentMattersAssigned += 1;
        if (completed) mattersCompleted += 1;
        if (outstanding) mattersOutstanding += 1;
        overdueSections += matterOverdueSections;
      }

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
      const roles = Array.from(
        new Set(
          (myRows.length ? myRows.map((member) => String(member.role || '')) : directRoles).filter(Boolean)
        )
      );

      if (timelinessScore != null) timelinessScores.push(timelinessScore);
      if (qualityScore != null) qualityScores.push(qualityScore);
      if (earnedFee != null) {
        feesEarnedTotal += earnedFee;
        hasScoredFee = true;
      }
      collectedBaseTotal += collectedBase;

      // ---- Reporting-scope figures for this matter --------------------------
      // This block runs for EVERY request. With no period (All Time),
      // `isWithinReportRange(x, null)` is true for every record, so All Time
      // produces the same figures through the same code path — which is what
      // lets the dashboard show one uniform card set for all periods.
      let collectedBaseInPeriod: number | undefined;
      let earnedFeeInPeriod: number | null | undefined;
      // Does this matter have any work that belongs to the selected scope?
      // Decided BEFORE the score is averaged, so a matter only contributes its
      // Timeliness/Quality when it genuinely had in-scope activity.
      let hadInPeriodWork = false;
      // All Time: every CURRENT assignment is in scope. A former owner remains
      // visible in fee history but is not counted as an active assigned matter.
      if (!period && (isCurrentAssignment || hasIndependentContribution)) hadInPeriodWork = true;

      const collectedInPeriod = collectedInPeriodByCase.get(caseId) || 0;

      // Same engine and role table as the all-time row — only the collected
      // value is restricted to payments received inside the scope. When there is
      // no period the collected base is identical to the all-time row, so the
      // already-computed projection is reused instead of recomputed (no duplicate
      // work, no risk of the two drifting apart).
      const earnedInPeriod = period
        ? computeCaseEarnedFees({
            caseDoc: matter,
            template,
            workflowInstance: { ...(instance || {}), steps: effectiveSteps },
            tasks: tasksByCase.get(caseId) || [],
            collectedAmount: collectedInPeriod,
            roleByName,
          })
        : earned;
      const myPeriodRows = earnedInPeriod.team.filter((member) => matchesCurrentUser(member.name));
      const myPeriodFees = myPeriodRows
        .map((member) => member.earnedFee)
        .filter((value): value is number => value != null);
      earnedFeeInPeriod = myPeriodFees.length ? round2(myPeriodFees.reduce((sum, value) => sum + value, 0)) : null;
      collectedBaseInPeriod = myPeriodRows.reduce(
        (max, member) => Math.max(max, Number(member.taskFeeCollected) || 0),
        0
      );
      // This dashboard is personal: never show a matter's entire payment as a
      // member's collected base.  Use the same action base attached to that
      // member's earned-fee rows (the max avoids counting the same Key Action
      // once per delivery role when one person holds multiple roles).
      periodCollectedValue += collectedBaseInPeriod;
      // A payment counts as live portfolio activity only for the current owner.
      if (isCurrentAssignment && collectedBaseInPeriod > 0) hadInPeriodWork = true;
      if (earnedFeeInPeriod != null) {
        periodFeesEarned += earnedFeeInPeriod;
        hasPeriodFee = true;
        // A temporary contributor has no standing case assignment, but their
        // earned amount is still personal work and must remain visible in a
        // payment-period dashboard.
        if (hasIndependentContribution) hadInPeriodWork = true;
      }

      // ---- Key Actions checked & Sections completed in the scope ------------
      // A "Key Action" is ONE individual workflow STEP. A "Section" (stage) is a
      // GROUP of steps that share a stageKey and is only "completed" when EVERY
      // one of its Key Actions is done — exactly how the Case Workspace groups
      // them (computeStageBreakdownFromInstance). So Key Actions Checked is
      // normally >= Sections Completed and the two are genuinely different
      // counts. (The previous code incremented BOTH by 1 per completed step,
      // which forced them equal and hid the section → key-action hierarchy.)
      const stepsByStage = new Map<
        string,
        { total: number; completed: number; lastCompletedAt: Date | null }
      >();
      for (const step of steps) {
        const stepCompleted = String((step as any)?.status || '').toLowerCase() === 'completed';

        // Key Action checked = an individual step completed inside the scope.
        if (isCurrentAssignment && stepCompleted && isWithinReportRange((step as any)?.completedAt, period)) {
          periodKeyActionsChecked += 1;
          hadInPeriodWork = true;
        }

        // Accumulate per-section (stage) completion so a Section is only counted
        // when ALL of its Key Actions are done. Steps with no stageKey fall back
        // to their own stepKey, so an ungrouped step is its own section.
        const stageKey =
          String((step as any)?.stageKey || '').trim() || `__step_${String((step as any)?.stepKey || '')}`;
        const bucket = stepsByStage.get(stageKey) || { total: 0, completed: 0, lastCompletedAt: null };
        bucket.total += 1;
        if (stepCompleted) {
          bucket.completed += 1;
          const at = (step as any)?.completedAt ? new Date((step as any).completedAt) : null;
          if (
            at &&
            !Number.isNaN(at.getTime()) &&
            (!bucket.lastCompletedAt || at.getTime() > bucket.lastCompletedAt.getTime())
          ) {
            bucket.lastCompletedAt = at;
          }
        }
        stepsByStage.set(stageKey, bucket);
      }

      // A Section is completed in the scope when every one of its Key Actions is
      // done AND the section finished (its LAST Key Action completed) inside it.
      // For All Time there is no window, so a fully-complete section counts
      // regardless of when it finished.
      for (const bucket of stepsByStage.values()) {
        if (bucket.total <= 0 || bucket.completed < bucket.total) continue;
        const completedInScope = period
          ? Boolean(bucket.lastCompletedAt && isWithinReportRange(bucket.lastCompletedAt, period))
          : true;
        if (isCurrentAssignment && completedInScope) {
          periodSectionsCompleted += 1;
          hadInPeriodWork = true;
        }
      }

      if (isCurrentAssignment && completed) {
        const completionAt =
          steps.reduce<Date | null>((latest, step: any) => {
            const at = step?.completedAt ? new Date(step.completedAt) : null;
            if (!at || Number.isNaN(at.getTime())) return latest;
            return !latest || at.getTime() > latest.getTime() ? at : latest;
          }, null) || (instance?.updatedAt ? new Date(instance.updatedAt) : null);
        if (isWithinReportRange(completionAt, period)) {
          periodMattersCompleted += 1;
          hadInPeriodWork = true;
        }
      }

      // Reporting-scope Timeliness / Quality use the SAME earned-fees rows that
      // produce the all-time figures — only the matters are restricted to those
      // with in-scope activity. Reading only `taskStages` left these permanently
      // null, because staged per-Key-Action task records are not populated for
      // most matters.
      if (hadInPeriodWork) {
        periodMattersWithActivity += 1;
        // Total Contract Value for this scope: the sum of the contract values of
        // the qualifying matters. This is CONTRACT VALUE only — never cash
        // collected or revenue earned.
        periodContractValue += round2(Number(earned.contractValue) || 0);
        if (timelinessScore != null) periodTimelinessScores.push(timelinessScore);
        if (qualityScore != null) periodQualityScores.push(qualityScore);
      }

      // "Entry date" scope: matters assigned to you that were OPENED in the
      // scope. Assignment time is not stored, so creation is the only honest
      // entry date available — never a fabricated one.
      if (isCurrentAssignment && isWithinReportRange(matter?.createdAt, period)) {
        periodMattersCreatedInPeriod += 1;
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
        // The matter's own contract value, straight from the same earned-fees
        // engine that produced the fee columns — never re-derived here.
        contractValue: round2(Number(earned.contractValue) || 0),
        collectedBase: round2(collectedBase),
        earnedFee,
        isCurrentAssignment,
        isIndependentContributor: hasIndependentContribution,
        completed,
        outstanding: isCurrentAssignment && outstanding,
        overdueSections: isCurrentAssignment ? matterOverdueSections : 0,
        ...(period
          ? {
              inPeriod: hadInPeriodWork,
              collectedBaseInPeriod: round2(collectedBaseInPeriod || 0),
              earnedFeeInPeriod: earnedFeeInPeriod ?? null,
            }
          : {}),
      });
    }

    // ---- Reporting-scope task metrics (assignee or workflow-stage member = me) --
    // Runs for every request; with no period (All Time) every completed task of
    // mine counts, giving All Time the same "Tasks Completed" figure the periods
    // show, through the same code path.
    //
    // "Tasks Outstanding" for the scope = tasks that were still open as of the
    // END of the window: they existed by then (created on/before the period end,
    // or with no creation date) and had not been completed by then. For All Time
    // (no window) this is simply the tasks still not completed today. This is a
    // point-in-time reconstruction from real dates, not an invented value.
    const scopeEnd = period ? period.toExclusive.getTime() : Date.now();
    for (const task of taskList) {
      const stages = Array.isArray(task?.taskStages) ? task.taskStages : [];
      const currentlyOwnsTask =
        matchesCurrentUser(task?.assignee) ||
        matchesCurrentUser(task?.supervisor) ||
        stages.some(
          (stage: any) =>
            matchesCurrentUser(stage?.staffMember) &&
            String(stage?.status || '').toLowerCase() !== 'completed'
        );
      if (!currentlyOwnsTask) continue;

      if (
        String(task?.status || '').toLowerCase() === 'completed' &&
        isWithinReportRange(task?.completedAt, period)
      ) {
        periodTasksCompleted += 1;
      }

      // Outstanding as of the scope end: existed by then and not yet completed.
      const createdAt = task?.createdAt ? new Date(task.createdAt).getTime() : NaN;
      const completedAt = task?.completedAt ? new Date(task.completedAt).getTime() : NaN;
      const existedByScopeEnd = Number.isNaN(createdAt) || createdAt < scopeEnd;
      const notCompletedByScopeEnd =
        String(task?.status || '').toLowerCase() !== 'completed' ||
        Number.isNaN(completedAt) ||
        completedAt >= scopeEnd;
      if (existedByScopeEnd && notCompletedByScopeEnd) periodTasksOutstanding += 1;

      for (const stage of stages) {
        if (!matchesCurrentUser(stage?.staffMember)) continue;
        if (!isWithinReportRange(stage?.completedAt, period)) continue;
        if (stage?.timelinessScore != null) periodTimelinessScores.push(Number(stage.timelinessScore));
        if (stage?.qualityScore != null) periodQualityScores.push(Number(stage.qualityScore));
      }
    }

    // One reporting block is ALWAYS returned (All Time when no range) so the
    // dashboard renders the same cards for every period.
    const periodSummary = buildStaffPeriod(period, {
      feesEarned: hasPeriodFee ? round2(periodFeesEarned) : null,
      collectedValue: round2(periodCollectedValue),
      keyActionsChecked: periodKeyActionsChecked,
      sectionsCompleted: periodSectionsCompleted,
      tasksCompleted: periodTasksCompleted,
      tasksOutstanding: periodTasksOutstanding,
      mattersCompleted: periodMattersCompleted,
      mattersWithActivity: periodMattersWithActivity,
      mattersCreatedInPeriod: periodMattersCreatedInPeriod,
      averageTimelinessScore: averageOf(periodTimelinessScores),
      averageQualityScore: averageOf(periodQualityScores),
      contractValue: round2(periodContractValue),
    });

    return res.json({
      user: { name: meName },
      tpaPercent: roleTpaPercent,
      currency,
      mattersAssigned: currentMattersAssigned,
      mattersOutstanding,
      mattersCompleted,
      overdueSections,
      averageTimelinessScore: averageOf(timelinessScores),
      averageQualityScore: averageOf(qualityScores),
      feesEarnedTotal: hasScoredFee ? round2(feesEarnedTotal) : null,
      collectedBaseTotal: round2(collectedBaseTotal),
      rows,
      period: periodSummary,
    });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || 'Failed to load staff dashboard summary.' });
  }
};

