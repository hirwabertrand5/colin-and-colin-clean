import mongoose, { ClientSession } from 'mongoose';
import Case from '../models/caseModel';
import User from '../models/userModel';
import Ledger from '../models/staffEarningsLedgerModel';
import AuditLog from '../models/auditLogModel';
import Workflow from '../models/workflowInstanceModel';
import Template from '../models/workflowTemplateModel';
import Task from '../models/taskModel';
import Invoice from '../models/invoiceModel';
import { CASE_ASSIGNMENT_ROLE_CONFIG } from '../utils/caseAssignmentContinuity';
import { AppliedTpaSnapshot, findAppliedTpa, resolveTpaAttribution } from '../utils/tpaAttribution';
import { baseMemberName, buildRoleByName, computeEarnedFee, resolveMemberTpa } from '../utils/workflowPercentages';
import { buildLedgerEntryKey, buildStaffEarningsRows } from '../utils/staffEarningsLedger';

/** Called before the source document is saved, including within existing transactions. */
export async function captureActivityRates(doc: any, workflow: boolean) {
  if (!doc.caseId) return;
  const session: ClientSession | null = doc.$session();
  // MongoDB transactions must not run parallel operations on one session.
  const matter = await Case.findById(doc.caseId).session(session).lean();
  const users = await User.find({}).select('name role tpaHistory').session(session).lean();
  const stored = await Ledger.find({ caseId: doc.caseId }).session(session).lean();
  const previous = doc.isNew ? null : await (workflow ? Workflow.findById(doc._id).session(session).lean() : Task.findById(doc._id).session(session).lean());
  if (!matter) return;
  const roles = buildRoleByName(users);
  const steps = workflow ? doc.steps : [undefined];
  for (const step of steps) {
    const target = step || doc;
    // Clients cannot replace or erase already-applied snapshots.
    const prior: any = previous;
    const oldTarget = workflow ? prior?.steps?.find((old: any) => old.stepKey === step.stepKey) : prior;
    const snapshots: AppliedTpaSnapshot[] = (oldTarget?.tpaSnapshots || []).map((saved: any) => ({ ...saved }));
    for (const { role } of CASE_ASSIGNMENT_ROLE_CONFIG) {
      const attribution = resolveTpaAttribution(matter, step, role, workflow ? undefined : doc.completedAt);
      if (!attribution.name || !attribution.at) continue;
      if (!workflow && doc.status !== 'Completed') continue;
      if (findAppliedTpa(snapshots, attribution.name, role, attribution.at)) continue;
      const saved = stored.find(entry => entry.staffKey === baseMemberName(attribution.name) && entry.assignmentRole === role &&
        (workflow ? entry.keyActionKey === step.stepKey : entry.keyActionKey === doc.workflowStepKey));
      snapshots.push({ staffKey: baseMemberName(attribution.name), staffName: attribution.name, assignmentRole: role,
        activityAt: attribution.at, rate: saved?.tpaPercent ?? resolveMemberTpa(attribution.name, roles, attribution.at).tpaPercent, recordedAt: new Date() });
    }
    target.tpaSnapshots = snapshots;
  }
}

/** Reuse the report engine; no alternate collection, quality or timeliness formula. */
export async function loadEarningRows(caseIds?: string[], session: ClientSession | null = null) {
  const matters: any[] = await Case.find(caseIds ? { _id: { $in: caseIds } } : {}).session(session).lean();
  const ids = matters.map(m => m._id);
  const instances = await Workflow.find({ caseId: { $in: ids } }).session(session).lean();
  const templates = await Template.find({ _id: { $in: matters.map(m => m.workflowTemplateId).filter(Boolean) } }).session(session).lean();
  const tasks = await Task.find({ caseId: { $in: ids } }).session(session).lean();
  const invoices = await Invoice.find({ caseId: { $in: ids }, status: 'Paid' }).session(session).lean();
  const users = await User.find({}).select('name role tpaHistory').session(session).lean();
  const tasksByCaseId = new Map<string, any[]>();
  for (const task of tasks) tasksByCaseId.set(String(task.caseId), [...(tasksByCaseId.get(String(task.caseId)) || []), task]);
  const paidInvoicesByCaseId = new Map<string, any[]>();
  for (const invoice of invoices) paidInvoicesByCaseId.set(String(invoice.caseId), [...(paidInvoicesByCaseId.get(String(invoice.caseId)) || []),
    { invoiceNo: invoice.invoiceNo, amount: invoice.amount, paidAt: invoice.updatedAt }]);
  return buildStaffEarningsRows({ matters, users, templatesById: new Map(templates.map(t => [String(t._id), t])),
    instancesByCaseId: new Map(instances.map(i => [String(i.caseId), i])), tasksByCaseId, paidInvoicesByCaseId,
    from: new Date(0), to: new Date('9999-12-31T23:59:59Z'), timeZone: 'Africa/Kigali' });
}

/** Event identity is unique. Frozen rates never change as further payments arrive. */
export async function persistEarningSnapshots(rows: any[], recordedBy: string, session: ClientSession | null = null) {
  if (!session && rows.some(row => row.completionAt)) {
    const owned = await mongoose.startSession();
    try {
      let result = { created: 0, superseded: 0, persisted: 0 };
      await owned.withTransaction(async () => { result = await persistEarningSnapshots(rows, recordedBy, owned); });
      return result;
    } finally { await owned.endSession(); }
  }
  let created = 0;
  let superseded = 0;
  for (const row of rows) {
    if (!row.completionAt) continue;
    const entryKey = buildLedgerEntryKey(row);
    const existing: any = await Ledger.findOne({ entryKey }).session(session).lean();
    const inputs = {
      contractValue: row.contractValue, keyActionPercent: row.keyActionPercent, grossActionValue: row.grossActionValue,
      collectedAmount: row.collectedAmount, eligibleCollectedBase: row.eligibleCollectedBase,
      tpaPercent: existing?.tpaPercent ?? row.tpaPercent,
      timelinessScore: row.timelinessScore, qualityScore: row.qualityScore,
      earnedFee: computeEarnedFee(row.eligibleCollectedBase, existing?.tpaPercent ?? row.tpaPercent, row.timelinessScore, row.qualityScore),
      rateActivityAt: existing?.rateActivityAt || (row.rateActivityAt ? new Date(row.rateActivityAt) : null),
      currency: row.currency, completionAt: new Date(row.completionAt), statusNote: row.statusNote,
    };
    if (!existing) {
      const result = await Ledger.updateOne({ entryKey }, { $setOnInsert: { ...row, ...inputs, entryKey, revision: 1, recordedBy } }, { ...(session ? { session } : {}), upsert: true, runValidators: true });
      if (result.upsertedCount) created++;
      continue;
    }
    const changed = Object.entries(inputs).some(([key, value]) => (key === 'completionAt' || key === 'rateActivityAt')
      ? (existing[key] ? +new Date(existing[key]) : null) !== (value ? +new Date(value as Date) : null) : (existing[key] ?? null) !== (value ?? null));
    if (!changed) continue;
    const result = await Ledger.updateOne({ entryKey, revision: existing.revision }, {
      $set: { ...inputs, recordedBy, correctionReason: 'Collection or scoring inputs changed; original applied TPA retained.' },
      $inc: { revision: 1 }, $push: { inputHistory: { ...existing, _id: undefined, inputHistory: undefined, retainedAt: new Date() } },
    }, { ...(session ? { session } : {}), runValidators: true });
    if (!result.modifiedCount) throw new Error('Earning snapshot changed concurrently. Retry the activity.');
    await AuditLog.create([{ caseId: row.caseId, actorName: recordedBy, action: 'EARNING_SNAPSHOT_REFRESHED',
      message: 'Collection/scoring inputs refreshed with original TPA retained', detail: JSON.stringify({ entryKey, revision: existing.revision + 1 }) }], { session });
    superseded++;
  }
  return { created, superseded, persisted: rows.filter(row => row.completionAt).length };
}

export async function snapshotCaseEarnings(caseId: unknown, session: ClientSession | null = null) {
  if (!caseId || !mongoose.isValidObjectId(caseId)) return;
  if (session) {
    await persistEarningSnapshots(await loadEarningRows([String(caseId)], session), 'Automatic activity snapshot', session);
    return;
  }
  const owned = await mongoose.startSession();
  try {
    await owned.withTransaction(async () => {
      await persistEarningSnapshots(await loadEarningRows([String(caseId)], owned), 'Automatic activity snapshot', owned);
    });
  } finally { await owned.endSession(); }
}
