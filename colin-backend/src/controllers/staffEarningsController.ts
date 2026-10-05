import type { Response } from 'express';

import Case from '../models/caseModel';
import Task from '../models/taskModel';
import Invoice from '../models/invoiceModel';
import User from '../models/userModel';
import WorkflowTemplate from '../models/workflowTemplateModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import StaffEarningsLedger from '../models/staffEarningsLedgerModel';

import { AuthRequest } from '../middleware/authMiddleware';
import { resolveOptionalReportRange } from '../utils/reportRange';
import { buildRoleByName, baseMemberName, TASK_TPA_SHARES } from '../utils/workflowPercentages';
import {
  buildLedgerEntryKey,
  buildStaffEarningsRows,
  filterRowsToPeriod,
  round2,
  summarizeStaffEarnings,
} from '../utils/staffEarningsLedger';

/**
 * GET /api/reports/staff-earnings
 *
 * Period-based Staff Earnings report, attributed to the period in which each
 * Key Action was COMPLETED (not invoiced, not paid).
 *
 * Query parameters
 *   range       daily | weekly | monthly | quarterly | yearly | ytd | custom
 *   from,to     YYYY-MM-DD (required when range=custom)
 *   staffKey    normalized staff key — one person, or omitted for all staff
 *   role        system role filter (e.g. associate)
 *   matterId    a single matter
 *   collectionScope   all | period | custom  (which paid invoices fund the cap)
 *   collectionFrom / collectionTo            explicit collection window
 *   persist     'true' to write event-time snapshots into the audit ledger
 *
 * The two period meanings are kept strictly apart:
 *   - WORK period     = when the work was completed (drives the rows)
 *   - COLLECTION period = when the money arrived (caps the eligible base)
 * `collectionScope=all` (default) lets all confirmed payments fund completed
 * work, which is the correct cap for a work-based report.
 */

const STAFF_EARNINGS_ROLES = [
  'managing_director',
  'managing_partner',
  'executive_managing_partner',
  'executive_assistant',
];

const isDateString = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Append a confirmed payment to a matter's collection bucket. */
const paidInvoicesByScope = (
  target: Map<string, Array<{ invoiceNo: string; amount: number; paidAt: Date | null }>>,
  caseId: string,
  entry: { invoiceNo: string; amount: number; paidAt: Date | null }
) => {
  target.set(caseId, [...(target.get(caseId) || []), entry]);
};

export const getStaffEarningsReport = async (req: AuthRequest, res: Response) => {
  try {
    // Safety net mirroring the route's authorize() guard.
    if (!STAFF_EARNINGS_ROLES.includes(String(req.user?.role || ''))) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const { range, from, to, staffKey, role, matterId, collectionScope, collectionFrom, collectionTo, persist } =
      req.query as any;

    // ---- WORK period: the basis of the report -----------------------------
    const workRange = resolveOptionalReportRange({ range, from, to });
    if (workRange && 'error' in workRange) {
      return res.status(400).json({ message: workRange.error });
    }
    if (!workRange || !('from' in workRange)) {
      return res.status(400).json({ message: 'A reporting period is required (range, or from + to).' });
    }


    const scope = String(collectionScope || 'all').trim().toLowerCase();
    let collectionFromDate: Date | null = null;
    let collectionToDate: Date | null = null;
    if (scope === 'custom') {
      if (!isDateString(collectionFrom) || !isDateString(collectionTo)) {
        return res.status(400).json({ message: 'A custom collection window needs both collectionFrom and collectionTo.' });
      }
      collectionFromDate = new Date(`${collectionFrom}T00:00:00.000`);
      collectionToDate = new Date(`${collectionTo}T23:59:59.999`);
      if (
        Number.isNaN(collectionFromDate.getTime()) ||
        Number.isNaN(collectionToDate.getTime()) ||
        collectionFromDate.getTime() > collectionToDate.getTime()
      ) {
        return res.status(400).json({ message: 'Invalid collection window.' });
      }
    } else if (scope === 'period') {
      collectionFromDate = workRange.from;
      collectionToDate = workRange.to;
    }

    const staffFilter = String(staffKey || '').trim().toLowerCase() || null;
    const roleFilter = String(role || '').trim().toLowerCase() || null;
    const matterFilter = String(matterId || '').trim() || null;

    // ---- Load the data the shared engine needs ----------------------------
    const matterQuery: any = {};
    if (matterFilter) matterQuery._id = matterFilter;
    if (staffFilter) {
      // Matched on the base name so "Steven - Associate" still resolves to the
      // "Steven" user record, exactly as resolveMemberTpa does.
      const pattern = new RegExp(`^${escapeRegExp(staffFilter)}`, 'i');
      const base = staffFilter.split(' ')[0] || staffFilter;
      const basePattern = new RegExp(`^${escapeRegExp(base)}`, 'i');
      const slots = ['assignedTo', 'caseAssignments.initiator', 'caseAssignments.reviewer', 'caseAssignments.signerApprover'];
      matterQuery.$or = slots.flatMap((field) => [{ [field]: pattern }, { [field]: basePattern }]);
    }

    const [matters, users] = await Promise.all([
      Case.find(matterQuery)
        .select(
          '_id caseNo parties matterType workflow workflowTemplateId assignedTo caseAssignments workflowProgress billingSettings caseManagement'
        )
        .lean(),
      User.find({ isActive: { $ne: false } }).select('_id name role isActive').lean(),
    ]);

    const matterIds = (matters as any[]).map((matter) => String(matter._id));
    const templateIds = Array.from(
      new Set((matters as any[]).map((matter) => String(matter.workflowTemplateId || '')).filter(Boolean))
    );

    const [instances, templates, tasks, paidInvoices] = await Promise.all([
      matterIds.length
        ? WorkflowInstance.find({ caseId: { $in: matterIds } }).select('caseId templateId status steps').lean()
        : Promise.resolve([]),
      templateIds.length
        ? WorkflowTemplate.find({ _id: { $in: templateIds } }).select('_id stages steps').lean()
        : Promise.resolve([]),
      matterIds.length
        ? Task.find({ caseId: { $in: matterIds } })
            .select(
              'caseId assignee supervisor title description workflowStepKey workflowStageKey completedAt updatedAt dueDate createdAt startDate checklist qualityScore status taskStages'
            )
            .lean()
        : Promise.resolve([]),
      matterIds.length
        ? Invoice.find({ caseId: { $in: matterIds }, status: 'Paid' })
            .select('invoiceNo caseId amount date updatedAt')
            .lean()
        : Promise.resolve([]),
    ]);

    const instancesByCaseId = new Map(
      (instances as any[]).map((instance: any) => [String(instance.caseId || ''), instance])
    );
    const templatesById = new Map((templates as any[]).map((template: any) => [String(template._id), template]));
    const tasksByCaseId = new Map<string, any[]>();
    for (const task of tasks as any[]) {
      const caseId = String(task?.caseId || '');
      if (caseId) tasksByCaseId.set(caseId, [...(tasksByCaseId.get(caseId) || []), task]);
    }

    // ---- COLLECTION scope: the cap, scoped independently of the work period -
    const paidInvoicesByCaseId = new Map<string, Array<{ invoiceNo: string; amount: number; paidAt: Date | null }>>();
    for (const invoice of paidInvoices as any[]) {
      const caseId = String(invoice?.caseId || '');
      if (!caseId) continue;
      const paidAt = invoice.updatedAt ? new Date(invoice.updatedAt) : null;
      if (collectionFromDate && collectionToDate) {
        const paidMs = paidAt ? paidAt.getTime() : Number.NaN;
        if (!Number.isFinite(paidMs) || paidMs < collectionFromDate.getTime() || paidMs > collectionToDate.getTime()) {
          continue;
        }
      }
      paidInvoicesByScope(paidInvoicesByCaseId, caseId, {
        invoiceNo: String(invoice.invoiceNo || ''),
        amount: round2(Number(invoice.amount) || 0),
        paidAt,
      });
    }


    const allRows = buildStaffEarningsRows({
      matters: matters as any[],
      templatesById,
      instancesByCaseId,
      tasksByCaseId,
      paidInvoicesByCaseId,
      users: users as any[],
      roleByName: buildRoleByName(users as any[]),
      from: workRange.from,
      to: workRange.to,
      staffKeyFilter: staffFilter,
      roleFilter,
      matterIdFilter: matterFilter,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    });

    const rows = filterRowsToPeriod(allRows);
    const summary = summarizeStaffEarnings(rows);

    // ---- Optional: freeze event-time inputs into the audit ledger ----------
    let ledger = { persisted: 0, created: 0, superseded: 0 };
    if (String(persist || '').toLowerCase() === 'true') {
      ledger = await persistLedgerEntries(rows, String(req.user?.name || 'System'));
    }

    // Attach the stored snapshot identity/revision so the UI can show whether a
    // figure is already anchored in the audit history.
    const stored = rows.length
      ? await StaffEarningsLedger.find({
          entryKey: { $in: rows.map((row) => buildLedgerEntryKey(row)) },
        })
          .select('entryKey revision')
          .lean()
      : [];
    const revisionByKey = new Map(
      stored.map((entry: any) => [String(entry.entryKey), Number(entry.revision) || 1])
    );
    const hydrated = rows.map((row) => {
      const entryKey = buildLedgerEntryKey(row);
      return { ...row, ledgerEntryKey: entryKey, ledgerRevision: revisionByKey.get(entryKey) ?? null };
    });

    // Work value, eligible collected base and earned fee are reduced separately so
    // none of the three can ever be presented as another.
    const totals = summary.reduce(
      (acc, entry) => ({
        earnedFee:
          entry.earnedFee == null ? acc.earnedFee : round2((acc.earnedFee ?? 0) + (entry.earnedFee ?? 0)),
        grossActionValue: round2(acc.grossActionValue + entry.grossActionValue),
        eligibleCollectedBase: round2(acc.eligibleCollectedBase + entry.eligibleCollectedBase),
      }),
      { earnedFee: null as number | null, grossActionValue: 0, eligibleCollectedBase: 0 }
    );

    return res.json({
      period: {
        key: workRange.key,
        label: workRange.label,
        from: workRange.displayFrom,
        to: workRange.displayTo,
        fromISO: workRange.fromISO,
        toISO: workRange.toISO,
        /** Which timestamp put a Key Action into this period. */
        basis: 'keyActionCompletion' as const,
        basisLabel:
          'Attributed to the period containing the Key Action completion timestamp (submitted → last action ticked → completed → reviewed).',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      },
      collection: {
        scope,
        label:
          scope === 'period'
            ? 'Payments received inside the reporting period'
            : scope === 'custom'
              ? `Payments received ${collectionFrom} → ${collectionTo}`
              : 'All confirmed paid collections to date',
        from: collectionFromDate ? collectionFromDate.toISOString() : null,
        to: collectionToDate ? collectionToDate.toISOString() : null,
        note: 'Collections cap the eligible base; they do not decide which period the work belongs to.',
      },
      filters: { staffKey: staffFilter, role: roleFilter, matterId: matterFilter },
      rows: hydrated,
      summary,
      totals,
      counts: {
        rowsInPeriod: rows.length,
        rowsOutsidePeriod: allRows.length - rows.length,
        rowsAwaitingCollection: hydrated.filter((row) => row.status === 'awaiting-collection').length,
        rowsAwaitingInput: hydrated.filter((row) => row.status === 'awaiting-input').length,
        mattersEvaluated: matterIds.length,
      },
      ledger,
      staffOptions: (users as any[])
        .map((user) => ({
          key: baseMemberName(user.name),
          name: String(user.name || ''),
          role: String(user.role || '') || null,
        }))
        .filter((user) => user.key),
      roles: Object.keys(TASK_TPA_SHARES),
      currency: hydrated[0]?.currency || 'RWF',
    });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || 'Failed to load the staff earnings report.' });
  }
};

/**
 * Freeze the event-time inputs for each row.
 *
 * Idempotent by design: `entryKey` is deterministic, so re-running the report
 * for the same period UPDATES the existing entry instead of inserting a second
 * one. When the frozen inputs differ from what is stored (a Quality Score
 * entered later, a percentage corrected) the revision is bumped and the change
 * recorded — history stays auditable and earnings are never duplicated.
 *
 * A re-opened Key Action that is re-ticked resolves to the SAME entryKey, so a
 * correction supersedes the prior figure instead of paying for the work twice.
 */
const persistLedgerEntries = async (rows: any[], recordedBy: string) => {
  let created = 0;
  let superseded = 0;
  let persisted = 0;

  for (const row of rows) {
    if (!row.completionAt) continue;
    const entryKey = buildLedgerEntryKey(row);
    const inputs = {
      contractValue: row.contractValue,
      keyActionPercent: row.keyActionPercent,
      grossActionValue: row.grossActionValue,
      collectedAmount: row.collectedAmount,
      eligibleCollectedBase: row.eligibleCollectedBase,
      tpaPercent: row.tpaPercent,
      timelinessScore: row.timelinessScore,
      qualityScore: row.qualityScore,
      earnedFee: row.earnedFee,
      currency: row.currency,
      completionAt: new Date(row.completionAt),
    };

    const existing: any = await StaffEarningsLedger.findOne({ entryKey }).lean();

    if (!existing) {
      await StaffEarningsLedger.create({
        entryKey,
        revision: 1,
        caseId: row.caseId,
        keyActionKey: row.keyActionKey,
        keyActionTitle: row.keyActionTitle,
        stageKey: row.stageKey,
        stageTitle: row.stageTitle,
        staffKey: row.staffKey,
        staffName: row.staffName,
        systemRole: row.systemRole,
        assignmentRole: row.assignmentRole,
        tpaSource: row.tpaSource,
        completionSource: row.completionSource,
        timeZone: row.timeZone,
        ...inputs,
        statusNote: row.statusNote,
        recordedBy,
      });
      created += 1;
      persisted += 1;
      continue;
    }

    // Only bump the revision when a frozen input actually changed.
    const changed =
      Number(existing.contractValue) !== inputs.contractValue ||
      (existing.keyActionPercent ?? null) !== (inputs.keyActionPercent ?? null) ||
      Number(existing.eligibleCollectedBase) !== inputs.eligibleCollectedBase ||
      Number(existing.tpaPercent) !== inputs.tpaPercent ||
      (existing.timelinessScore ?? null) !== (inputs.timelinessScore ?? null) ||
      (existing.qualityScore ?? null) !== (inputs.qualityScore ?? null) ||
      (existing.earnedFee ?? null) !== (inputs.earnedFee ?? null) ||
      new Date(existing.completionAt).getTime() !== inputs.completionAt.getTime();

    if (!changed) {
      persisted += 1;
      continue;
    }

    await StaffEarningsLedger.updateOne(
      { entryKey },
      {
        $set: {
          ...inputs,
          revision: Number(existing.revision || 1) + 1,
          statusNote: row.statusNote,
          correctionReason: 'Inputs recalculated — superseded by a later revision of the same earning event.',
          recordedBy,
        },
      }
    );
    superseded += 1;
    persisted += 1;
  }

  return { persisted, created, superseded };
};
