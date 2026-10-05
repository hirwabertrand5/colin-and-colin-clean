import { computeCaseEarnedFees, normalizeEffectiveWorkflowSteps, resolveStepWorkTimeWithSource } from './caseEarnedFees';
import { allocateCollectedValueAcrossKeyActions, calculateCollectedKeyActionEarnings } from './keyActionEarnings';
import { baseMemberName, buildRoleByName } from './workflowPercentages';

/**
 * Period-based Staff Earnings aggregation.
 *
 * ATTRIBUTION RULE (the point of this module)
 * --------------------------------------------
 * A Key Action is attributed to the period that contains its WORK-COMPLETION
 * timestamp — never the invoice date, never the payment date, never "today".
 * The timestamp comes from the backend via resolveStepWorkTimeWithSource
 * (submitted → last action ticked → completed → reviewed), and the winning
 * field is reported as `completionSource` so the row is auditable.
 *
 * This is deliberately different from the existing Firm Reports productivity
 * rows, which are scoped by PAYMENT date. Payment date answers "when did the
 * money arrive"; completion date answers "when did the staff member do the
 * work". Mixing them double-counts across periods, so they stay separate and
 * both are surfaced.
 *
 * MONEY RULES — all delegated to the existing engine, never re-derived here:
 *   1. gross action value = contract value x the action's configured %.
 *   2. eligible collected base is capped by `allocateCollectedValueAcrossKeyActions`,
 *      which spreads the matter's collected cash across completed actions in
 *      proportion to their value. Because the whole is distributed by a fixed
 *      ratio, no collected amount is ever counted twice.
 *   3. earned fee = base x TPA% x timeliness x quality via computeCaseEarnedFees
 *      (the same engine behind Case Workspace / dashboards / firm reports).
 *
 * Nothing is invented: a missing percentage, score, TPA or timestamp yields
 * `null` plus an explicit `statusNote` explaining the effect on the amount.
 */

/** Human labels for which stored timestamp attributed the work. */
export const COMPLETION_SOURCE_LABELS: Record<string, string> = {
  submitted: 'Submitted for review (submittedAt)',
  lastActionTicked: 'Last Key Action ticked (doneAt)',
  completed: 'Workflow section completed (completedAt)',
  reviewed: 'Reviewed (reviewedAt)',
  task: 'Task completed (task.completedAt)',
};

export const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const paidTotal = (entries: Array<{ amount: number }> | undefined) =>
  round2((entries || []).reduce((sum, entry) => sum + (Number(entry?.amount) || 0), 0));

export type StaffEarningsRowStatus = 'ready' | 'awaiting-collection' | 'awaiting-input' | 'incomplete';

export type StaffEarningsRow = {
  /** Stable row identity — caseId + key action + staff + assignment role. */
  key: string;
  caseId: string;
  matterNo: string;
  matterName: string;
  matterType: string | null;
  staffKey: string;
  staffName: string;
  systemRole: string | null;
  assignmentRole: string;
  tpaPercent: number;
  tpaSource: string | null;
  keyActionKey: string;
  keyActionTitle: string;
  stageKey: string | null;
  stageTitle: string | null;
  /** ISO-8601 instant the work was completed (UTC) — drives the period filter. */
  completionAt: string | null;
  completionSource: string | null;
  completionSourceLabel: string | null;
  /** Local-time rendering of the instant, with the server's UTC offset. */
  completionAtLocal: string | null;
  timeZoneOffsetMinutes: number | null;
  timeZone: string | null;
  contractValue: number;
  keyActionPercent: number | null;
  grossActionValue: number;
  /** Total confirmed paid collections on the matter within the collection scope. */
  collectedAmount: number;
  /** The capped, allocated share of collected cash this action may earn on. */
  eligibleCollectedBase: number;
  /** Work value not yet backed by collections (unpaid / not yet eligible). */
  uncollectedActionValue: number;
  timelinessScore: number | null;
  qualityScore: number | null;
  /** The authoritative staff earned fee from computeCaseEarnedFees. */
  earnedFee: number | null;
  currency: string;
  formula: string;
  status: StaffEarningsRowStatus;
  statusNote: string | null;
  /** Missing inputs, named explicitly rather than silently defaulted. */
  missingInputs: string[];
  /** Payment timestamps of the invoices that funded this matter. */
  paymentTimestamps: Array<{ invoiceNo: string; paidAt: string | null; amount: number }>;
  /** True when the row is inside the selected work-completion period. */
  inPeriod: boolean;
};


export type StaffEarningsSummaryRow = {
  staffKey: string;
  staffName: string;
  systemRole: string | null;
  mattersCount: number;
  keyActionsCount: number;
  grossActionValue: number;
  eligibleCollectedBase: number;
  /** Null when nothing for this person was scorable — never coerced to 0. */
  earnedFee: number | null;
  rowsAwaitingCollection: number;
  rowsAwaitingInput: number;
  currency: string;
};

export type BuildStaffEarningsInput = {
  matters: any[];
  templatesById: Map<string, any>;
  instancesByCaseId: Map<string, any>;
  tasksByCaseId: Map<string, any[]>;
  /**
   * Confirmed PAID collections per matter, already scoped to the chosen
   * collection window. `paidAt` is the payment timestamp (invoice.updatedAt),
   * kept strictly separate from the work-completion timestamp.
   */
  paidInvoicesByCaseId: Map<string, Array<{ invoiceNo: string; amount: number; paidAt: Date | null }>>;
  users?: any[];
  roleByName?: Map<string, string>;
  /** Inclusive bounds of the WORK-completion period. */
  from: Date;
  to: Date;
  staffKeyFilter?: string | null | undefined;
  roleFilter?: string | null | undefined;
  matterIdFilter?: string | null | undefined;
  timeZone?: string | undefined;
};

/** Render an instant with its UTC offset so the evidence is unambiguous. */
const localStamp = (date: Date | null, timeZone?: string) => {
  if (!date) return null;
  try {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absolute = Math.abs(offsetMinutes);
    const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
    return `${formatted.replace(',', '')} ${offset}`;
  } catch {
    return date.toISOString();
  }
};

const findInstanceStep = (instance: any, actionKey: string) => {
  const steps: any[] = Array.isArray(instance?.steps) ? instance.steps : [];
  return steps.find((step: any) => String(step?.stepKey || '') === actionKey) || null;
};

const normalizeLabel = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

/** Match a Task to a Key Action using the same precedence as the earnings engine. */
const findTaskForAction = (tasks: any[], templateSteps: any[], actionKey: string) => {
  const templateStep = templateSteps.find((step: any) => String(step?.key || '') === actionKey);
  const actionTitle = normalizeLabel(templateStep?.title);
  return (tasks || []).find((task: any) => {
    const explicit = String(task?.workflowStepKey || '').trim();
    if (explicit) return explicit === actionKey;
    return Boolean(actionTitle) && [task?.title, task?.description].some((value) => normalizeLabel(value) === actionTitle);
  });
};

type BuildRowArgs = {
  matter: any;
  caseId: string;
  action: any;
  member: { assignmentRole: string; name: string };
  memberFee: any;
  staffKey: string;
  systemRole: string | null;
  stageKey: string | null;
  stageTitle: string | null;
  completionAt: Date | null;
  completionSource: string | null;
  hasTimestamp: boolean;
  inPeriod: boolean;
  contractValue: number;
  keyActionPercent: number | null;
  grossActionValue: number;
  collectedAmount: number;
  eligibleCollectedBase: number;
  tpaPercent: number;
  timelinessScore: number | null;
  qualityScore: number | null;
  earnedFee: number | null;
  currency: string;
  paymentStamps: StaffEarningsRow['paymentTimestamps'];
  timeZone?: string | undefined;
};

/**
 * Assemble one row, including the explicit status/missing-input explanation.
 *
 * Money is NEVER invented: work value, eligible collected base and earned fee
 * stay three separate, separately labelled numbers, and any missing input is
 * named together with its effect on the displayed amount.
 */
const buildRow = (args: BuildRowArgs): StaffEarningsRow => {
  const {
    matter,
    caseId,
    action,
    member,
    memberFee,
    staffKey,
    systemRole,
    stageKey,
    stageTitle,
    completionAt,
    completionSource,
    hasTimestamp,
    inPeriod,
    contractValue,
    keyActionPercent,
    grossActionValue,
    collectedAmount,
    eligibleCollectedBase,
    tpaPercent,
    timelinessScore,
    qualityScore,
    earnedFee,
    currency,
    paymentStamps,
    timeZone,
  } = args;

  // ---- Explicit missing inputs, never a silent default ----
  const missingInputs: string[] = [];
  if (keyActionPercent == null) missingInputs.push('Key Action percentage is not configured');
  if (!tpaPercent) missingInputs.push('No TPA share for this staff member (role not mapped)');
  if (timelinessScore == null) missingInputs.push('Timeliness not scored (missing start / due / completion timestamps)');
  if (qualityScore == null) missingInputs.push('Quality Score not entered in Case Management');
  if (!hasTimestamp) missingInputs.push('No completion timestamp recorded for this Key Action');
  if (eligibleCollectedBase <= 0 && grossActionValue > 0) {
    missingInputs.push('No confirmed paid collections cover this Key Action yet');
  }

  let status: StaffEarningsRowStatus;
  let statusNote: string | null;
  if (!hasTimestamp) {
    status = 'incomplete';
    statusNote =
      'No work-completion timestamp is stored for this Key Action, so it cannot be attributed to a reporting period.';
  } else if (!inPeriod) {
    status = 'incomplete';
    statusNote = 'Work was completed outside the selected reporting period.';
  } else if (eligibleCollectedBase <= 0 && grossActionValue > 0) {
    status = 'awaiting-collection';
    statusNote =
      'Work is complete but no confirmed paid invoice collections cover this matter, so the earned fee is not yet eligible. The uncollected work value is shown separately.';
  } else if (earnedFee == null) {
    status = 'awaiting-input';
    statusNote = `Earned fee cannot be calculated yet — ${missingInputs.join('; ')}.`;
  } else {
    status = 'ready';
    statusNote = missingInputs.length ? `Calculated with incomplete inputs: ${missingInputs.join('; ')}.` : null;
  }

  const fmtPct = (num: number | null) => (num == null ? '_' : `${num}%`);
  const formula = `${round2(eligibleCollectedBase)} x ${tpaPercent}% x ${fmtPct(timelinessScore)} x ${fmtPct(qualityScore)} = ${
    earnedFee == null ? '_' : round2(earnedFee)
  }`;

  return {
    key: `${caseId}:${action.key}:${staffKey}:${member.assignmentRole}`,
    caseId,
    matterNo: String(matter?.caseNo || ''),
    matterName: String(matter?.parties || ''),
    matterType: String(matter?.matterType || matter?.workflow || '') || null,
    staffKey,
    staffName: String(member.name),
    systemRole,
    assignmentRole: member.assignmentRole,
    tpaPercent,
    tpaSource: memberFee?.tpaSource ?? null,
    keyActionKey: action.key,
    keyActionTitle: action.title,
    stageKey,
    stageTitle,
    completionAt: hasTimestamp && completionAt ? completionAt.toISOString() : null,
    completionSource,
    completionSourceLabel: completionSource ? COMPLETION_SOURCE_LABELS[completionSource] || completionSource : null,
    completionAtLocal: hasTimestamp && completionAt ? localStamp(completionAt, timeZone) : null,
    timeZoneOffsetMinutes: hasTimestamp && completionAt ? -completionAt.getTimezoneOffset() : null,
    timeZone: timeZone || null,
    contractValue,
    keyActionPercent,
    grossActionValue,
    collectedAmount,
    eligibleCollectedBase,
    uncollectedActionValue: round2(Math.max(0, grossActionValue - eligibleCollectedBase)),
    timelinessScore,
    qualityScore,
    earnedFee,
    currency,
    formula,
    status,
    statusNote,
    missingInputs,
    paymentTimestamps: paymentStamps,
    inPeriod,
  };
};



/**
 * Build the report rows: one row per staff member x matter x completed Key
 * Action, with the whole calculation exposed so the figure can be defended.
 *
 * Rows completed OUTSIDE the window are still returned, flagged
 * `inPeriod: false`, so the UI can state what was excluded rather than
 * silently dropping work.
 */
export const buildStaffEarningsRows = (input: BuildStaffEarningsInput): StaffEarningsRow[] => {
  const {
    matters,
    templatesById,
    instancesByCaseId,
    tasksByCaseId,
    paidInvoicesByCaseId,
    users,
    from,
    to,
    staffKeyFilter,
    roleFilter,
    matterIdFilter,
    timeZone,
  } = input;

  const roleByName = input.roleByName ?? buildRoleByName(users || []);
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const rows: StaffEarningsRow[] = [];

  for (const matter of matters || []) {
    const caseId = String(matter?._id || '');
    if (!caseId) continue;
    if (matterIdFilter && caseId !== String(matterIdFilter)) continue;

    const template = templatesById.get(String(matter?.workflowTemplateId || ''));
    const instance = instancesByCaseId.get(caseId);
    const caseTasks = tasksByCaseId.get(caseId) || [];
    const templateSteps: any[] = Array.isArray(template?.steps) ? template.steps : [];
    const instanceWithSteps = { ...(instance || {}), steps: normalizeEffectiveWorkflowSteps(instance, template) };

    // The ONE source of truth for money. collectedAmount is the confirmed paid
    // total inside the chosen collection scope — never an estimate.
    const payments = paidInvoicesByCaseId.get(caseId) || [];
    const collectedAmount = paidTotal(payments);

    const earnings = calculateCollectedKeyActionEarnings({
      matter,
      template,
      workflowInstance: instanceWithSteps,
      tasks: caseTasks,
      collectedAmount,
    });

    const matterFees = computeCaseEarnedFees({
      caseDoc: matter,
      template,
      workflowInstance: instanceWithSteps,
      tasks: caseTasks,
      collectedAmount,
      roleByName,
    });

    // The existing, auditable allocation of collected cash across completed
    // actions, proportional to value. Reused verbatim — never re-invented.
    const actionValueByKey = allocateCollectedValueAcrossKeyActions(earnings);
    const totalEligible = round2(
      Array.from(actionValueByKey.values()).reduce((sum, value) => sum + (Number(value) || 0), 0)
    );
    const memberByKey = new Map(
      matterFees.team.map((member: any) => [baseMemberName(member.name), member])
    );

    const assignments = matter?.caseAssignments || {};
    const team = [
      { assignmentRole: 'Initiator', name: String(assignments.initiator || matter?.assignedTo || '').trim() },
      { assignmentRole: 'Reviewer', name: String(assignments.reviewer || '').trim() },
      { assignmentRole: 'Signer/Approver', name: String(assignments.signerApprover || '').trim() },
    ].filter((member) => member.name);

    const currency = matterFees.currency || 'RWF';
    const paymentStamps: StaffEarningsRow['paymentTimestamps'] = payments.map((payment) => ({
      invoiceNo: String(payment.invoiceNo || ''),
      paidAt: payment.paidAt ? new Date(payment.paidAt).toISOString() : null,
      amount: round2(Number(payment.amount) || 0),
    }));

    for (const action of earnings.completedActions) {
      const templateStep = templateSteps.find((step: any) => String(step?.key || '') === action.key);
      const instanceStep = findInstanceStep(instance, action.key);
      const stageKey = String(templateStep?.stageKey || instanceStep?.stageKey || '') || null;
      const stageTitle =
        String(
          templateStep?.stageTitle ||
            instanceStep?.stageTitle ||
            (Array.isArray(template?.stages)
              ? template.stages.find((stage: any) => String(stage?.key || '') === stageKey)?.title
              : '') ||
            ''
        ) || stageKey;

      // ---- The period-attribution timestamp, straight from the backend ----
      const stepWork = instanceStep ? resolveStepWorkTimeWithSource(instanceStep) : { at: null, source: null };
      const linkedTask = findTaskForAction(caseTasks, templateSteps, action.key);
      const taskRaw = linkedTask ? linkedTask.completedAt || linkedTask.updatedAt : null;
      const taskTime = taskRaw ? new Date(taskRaw as any) : null;
      const taskTimeValid = taskTime && Number.isFinite(taskTime.getTime()) && taskTime.getTime() > 0 ? taskTime : null;
      const completionAt = stepWork.at || taskTimeValid;
      const completionSource = stepWork.at ? stepWork.source : taskTimeValid ? 'task' : null;
      const completionMs = completionAt ? completionAt.getTime() : Number.NaN;
      const hasTimestamp = Number.isFinite(completionMs);
      const inPeriod = hasTimestamp && completionMs >= fromMs && completionMs <= toMs;

      // Money for this action, from the shared allocation.
      const eligibleCollectedBase = actionValueByKey.get(action.key) || 0;
      const keyActionPercent = action.percentage ?? null;
      const grossActionValue = round2(earnings.contractValue * ((keyActionPercent ?? 0) / 100));

      for (const member of team) {
        const staffKey = baseMemberName(member.name);
        const memberFee = memberByKey.get(staffKey);
        const systemRole = String(memberFee?.userRole || roleByName.get(staffKey) || '').trim() || null;
        if (staffKeyFilter && staffKey !== staffKeyFilter) continue;
        if (roleFilter && systemRole !== roleFilter) continue;

        // The member's own TPA / timeliness / quality plus their authoritative
        // earned fee, spread across this matter's actions in proportion to the
        // eligible base — so rows always re-add to the dashboard total.
        const tpaPercent = Number(memberFee?.tpaPercent) || 0;
        const timelinessScore = memberFee?.timelinessScore ?? null;
        const qualityScore = memberFee?.qualityScore ?? null;
        const share = totalEligible > 0 ? eligibleCollectedBase / totalEligible : 0;
        const memberEarned = memberFee?.earnedFee ?? null;
        const earnedFee = memberEarned == null ? null : round2(memberEarned * share);

        rows.push(
          buildRow({
            matter,
            caseId,
            action,
            member,
            memberFee,
            staffKey,
            systemRole,
            stageKey,
            stageTitle,
            completionAt: hasTimestamp ? completionAt : null,
            completionSource,
            hasTimestamp,
            inPeriod,
            contractValue: earnings.contractValue,
            keyActionPercent,
            grossActionValue,
            collectedAmount,
            eligibleCollectedBase,
            tpaPercent,
            timelinessScore,
            qualityScore,
            earnedFee,
            currency,
            paymentStamps,
            timeZone,
          })
        );
      }
    }
  }

  return rows;
};

/** Only rows whose WORK was completed inside the window. */
export const filterRowsToPeriod = (rows: StaffEarningsRow[]): StaffEarningsRow[] => rows.filter((row) => row.inPeriod);

/**
 * Per-staff totals. `earnedFee` stays null when nothing for that person was
 * scorable — never coerced to 0, so "no score yet" cannot read as "no pay".
 */
export const summarizeStaffEarnings = (rows: StaffEarningsRow[]): StaffEarningsSummaryRow[] => {
  type Entry = StaffEarningsSummaryRow & { matters: Set<string> };
  const byStaff = new Map<string, Entry>();

  for (const row of rows) {
    let entry = byStaff.get(row.staffKey);
    if (!entry) {
      entry = {
        staffKey: row.staffKey,
        staffName: row.staffName,
        systemRole: row.systemRole,
        matters: new Set<string>(),
        mattersCount: 0,
        keyActionsCount: 0,
        grossActionValue: 0,
        eligibleCollectedBase: 0,
        earnedFee: null,
        rowsAwaitingCollection: 0,
        rowsAwaitingInput: 0,
        currency: row.currency,
      };
      byStaff.set(row.staffKey, entry);
    }
    entry.matters.add(row.caseId);
    entry.mattersCount = entry.matters.size;
    entry.keyActionsCount += 1;
    entry.grossActionValue = round2(entry.grossActionValue + row.grossActionValue);
    entry.eligibleCollectedBase = round2(entry.eligibleCollectedBase + row.eligibleCollectedBase);
    if (row.earnedFee != null) entry.earnedFee = round2((entry.earnedFee ?? 0) + row.earnedFee);
    if (row.status === 'awaiting-collection') entry.rowsAwaitingCollection += 1;
    if (row.status === 'awaiting-input') entry.rowsAwaitingInput += 1;
  }

  return Array.from(byStaff.values()).map((entry) => {
    const { matters, ...rest } = entry;
    void matters;
    return rest;
  });
};

/**
 * Deterministic identity of an earning event.
 *
 * Deliberately EXCLUDES the money inputs so that a later correction (a new
 * Quality Score, a changed percentage) supersedes the SAME event instead of
 * creating a second row. Re-opening and re-ticking is a correction of that
 * work, not extra pay, so it can never double-count.
 */
export const buildLedgerEntryKey = (row: Pick<StaffEarningsRow, 'caseId' | 'keyActionKey' | 'staffKey' | 'assignmentRole'>) =>
  `${row.caseId}:${row.keyActionKey}:${row.staffKey}:${row.assignmentRole}`;
