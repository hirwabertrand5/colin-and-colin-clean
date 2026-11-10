import mongoose from 'mongoose';
import Retainer from '../models/retainerModel';
import Period from '../models/retainerPeriodModel';
import Receipt from '../models/retainerReceiptModel';
import Case from '../models/caseModel';
import Invoice from '../models/invoiceModel';
import User from '../models/userModel';
import Workflow from '../models/workflowInstanceModel';
import Template from '../models/workflowTemplateModel';
import Ledger from '../models/staffEarningsLedgerModel';
import { normalizeEffectiveWorkflowSteps, resolveStepWorkTime } from '../utils/caseEarnedFees';
import { getContractValue } from '../utils/financialMetrics';
import { buildRoleByName, baseMemberName, resolveMemberTpa } from '../utils/workflowPercentages';
import { allocateRetainer, DEPARTMENTS, decimal, retainerDepartmentOf } from '../utils/retainerAllocation';
import type { StaffEarningsRow } from '../utils/staffEarningsLedger';

export const ordinaryInvoiceFilter = { retainerReceiptId: { $exists: false } };
export const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
export const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Africa/Kigali',
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const id = (value: any) => mongoose.Types.ObjectId.isValid(String(value || '')) ? String(value) : fail('Invalid record id.');
const wholeAmount = (value: any) => Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) < 1e12
  ? Number(value) : fail('Enter a positive whole RWF amount below one trillion.');
// Approval/submission can happen in a later month. Prefer evidence of when
// the work was actually finished without changing ordinary matter TPA policy.
const performedAt = (step: any): Date | null => {
  const doneAt = step?.doneAt ? new Date(step.doneAt) : null;
  if (doneAt && Number.isFinite(doneAt.getTime())) return doneAt;
  const actions = Array.isArray(step?.actions) ? step.actions : [];
  if (actions.length && actions.every((a: any) => a.done)) {
    const times = actions.map((a: any) => Date.parse(a.doneAt)).filter(Number.isFinite);
    if (times.length) return new Date(Math.max(...times));
  }
  return resolveStepWorkTime(step);
};
const transact = async (operation: (session: mongoose.ClientSession) => Promise<any>) => {
  const session = await mongoose.startSession();
  try { let result: any; await session.withTransaction(async () => { result = await operation(session); }); return result; }
  finally { await session.endSession(); }
};

export async function createPeriod(retainerId: string, month: string, actor: string) {
  id(retainerId);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail('Choose a valid service month.');
  const existing = await Period.findOne({ retainerId, month }).lean();
  if (existing) return existing; // Retrying never creates a second monthly fee.
  const retainer: any = await Retainer.findById(retainerId).lean();
  if (!retainer) fail('Retainer not found.', 404);
  if (!['monthly', 'hybrid'].includes(retainer.billingModel)) fail('Record the fixed monthly fee in the retainer agreement before preparing the Monthly Retainer Statement.');
  if (retainer.status !== 'Active') fail('Activate the agreement before opening a new month.');
  if (month < retainer.startDate.slice(0, 7) || (retainer.endDate && month > retainer.endDate.slice(0, 7))) fail('Month is outside the agreement term.');
  const dueDate = `${month}-${String(retainer.billingDay || 1).padStart(2, '0')}`;
  try {
    return (await Period.create({ retainerId, month, clientName: retainer.clientName, retainerNo: retainer.retainerNo,
      fixedFee: wholeAmount(retainer.monthlyFee), dueDate, utilisationThreshold: retainer.utilisationThreshold || 150, createdBy: actor,
      history: [{ action: 'OPENED', actor, at: new Date() }] })).toObject();
  } catch (error: any) {
    if (error.code === 11000) return Period.findOne({ retainerId, month }).lean();
    throw error;
  }
}

export async function getPeriod(periodId: string, retainerId?: string) {
  const period = await Period.findOne({ _id: id(periodId), ...(retainerId ? { retainerId: id(retainerId) } : {}) }).lean();
  if (!period) fail('Monthly statement not found.', 404);
  const receipts = await Receipt.find({ periodId }).sort({ receivedOn: 1 }).lean();
  return { ...period, receipts, allocation: allocateRetainer(period, receipts) };
}

export async function workCandidates(retainerId: string) {
  const matters: any[] = await Case.find({ retainerId: id(retainerId) }).lean();
  const recorded: any[] = await Period.find({ retainerId }).select('services').lean();
  const reversible = new Set<string>();
  for (const p of recorded) for (const s of p.services) if (s.voidedAt) reversible.add(`${s.caseId}:${s.actionKey}`);
  for (const p of recorded) for (const s of p.services) if (!s.voidedAt) reversible.delete(`${s.caseId}:${s.actionKey}`);
  const ids = matters.map((m) => m._id);
  const [instances, templates] = await Promise.all([
    Workflow.find({ caseId: { $in: ids } }).lean(),
    Template.find({ _id: { $in: matters.map((m) => m.workflowTemplateId).filter(Boolean) } }).lean(),
  ]);
  return matters.flatMap((matter) => {
    const instance: any = instances.find((w: any) => String(w.caseId) === String(matter._id));
    const template: any = templates.find((t: any) => String(t._id) === String(matter.workflowTemplateId));
    return normalizeEffectiveWorkflowSteps(instance, template)
      .filter((step: any) => step.status === 'Completed' && (!(matter.retainerCoveredActionKeys || []).includes(step.stepKey) || reversible.has(`${matter._id}:${step.stepKey}`)))
      .map((step: any) => ({ caseId: String(matter._id), matterNo: matter.caseNo, actionKey: step.stepKey,
        title: step.title || step.stepKey,
        performedOn: performedAt(step)?.toLocaleDateString('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Africa/Kigali' }),
        ordinaryFee: Math.round(Number(step.feeAmount) || getContractValue(matter) * (Number(step.percentage) || 0) / 100),
        department: retainerDepartmentOf(matter),
        assignedStaff: [matter.assignedTo, ...Object.values(matter.caseAssignments || {})].filter(Boolean) }));
  });
}

export async function addService(periodId: string, input: any, actor: string) {
  return transact(async (session) => {
    const period: any = await Period.findById(id(periodId)).session(session);
    if (!period) fail('Monthly statement not found.', 404);
    if (period.status !== 'Open') fail('Reopen the month with a reason before changing approved work.', 409);
    const retainer: any = await Retainer.findById(period.retainerId).session(session);
    const matter: any = await Case.findById(id(input.caseId)).session(session);
    if (!matter || String(matter.retainerId) !== String(period.retainerId)) fail('Select a matter linked to this retainer.');
    const actionKey = String(input.actionKey || '').trim();
    if (!actionKey) fail('Select an approved workflow action.');
    const prior = period.services.filter((s: any) => String(s.caseId) === String(matter._id) && s.actionKey === actionKey);
    if ((matter.retainerCoveredActionKeys || []).includes(actionKey) && (!prior.length || prior.some((s: any) => !s.voidedAt))) fail('This action is already recorded in a retainer month.', 409);
    const instance: any = await Workflow.findOne({ caseId: matter._id }).session(session);
    const template: any = matter.workflowTemplateId ? await Template.findById(matter.workflowTemplateId).session(session) : null;
    const step = normalizeEffectiveWorkflowSteps(instance, template).find((s: any) => s.stepKey === actionKey);
    if (!step || step.status !== 'Completed') fail('Only completed and approved workflow actions can be recognised.');
    const workAt = performedAt(step);
    const performedOn = workAt?.toLocaleDateString('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Africa/Kigali' });
    if (!performedOn || performedOn.slice(0, 7) !== period.month) fail('The approved action must have been performed in the selected service month.');
    if (performedOn! < retainer.startDate || (retainer.endDate && performedOn! > retainer.endDate)) fail('Work falls outside the agreement term.');
    const alreadyEarned = await Ledger.exists({ caseId: matter._id, keyActionKey: actionKey, earnedFee: { $gt: 0 } }).session(session);
    if (alreadyEarned) fail('This action already has ordinary staff earnings. Reconcile those earnings before transferring it to a retainer.', 409);
    const ordinaryFee = wholeAmount(input.ordinaryFee);
    if (!DEPARTMENTS.includes(input.department)) fail('Choose Dispute Resolution or Transaction & Advisory.');
    const selectedDepartment = retainerDepartmentOf(matter);
    if (selectedDepartment && input.department !== selectedDepartment) fail(`The matter's selected department is ${selectedDepartment}. Record the service in that department.`);
    const contributors = Array.isArray(input.contributors) ? input.contributors : [];
    if (!contributors.length || contributors.length > 50 || new Set(contributors.map((c: any) => String(c.userId))).size !== contributors.length) fail('Choose distinct contributing staff.');
    if (contributors.some((c: any) => !Number.isFinite(Number(c.share)) || Number(c.share) <= 0 || Number(c.share) > 100) ||
      Math.abs(contributors.reduce((sum: number, c: any) => sum + Number(c.share), 0) - 100) > 0.0001) fail('Staff contributions must total exactly 100%.');
    const users: any[] = await User.find({ _id: { $in: contributors.map((c: any) => id(c.userId)) }, isActive: { $ne: false }, role: { $ne: 'client' } }).session(session).lean();
    if (users.length !== contributors.length) fail('All contributors must be active staff users.');
    const snapshots = contributors.map((c: any) => {
      const user = users.find((u) => String(u._id) === String(c.userId));
      const rate = resolveMemberTpa(user.name, buildRoleByName([user]), workAt!);
      return { userId: user._id, name: user.name, role: user.role, share: Number(c.share), tpaPercent: rate.tpaPercent, tpaSource: rate.source || 'Historical staff TPA' };
    });
    if (input.outOfScope && retainer.scopeApprovalRequired !== false && !String(input.scopeApproval || '').trim()) fail('Record the approval reference for work outside the agreement scope.');
    // A stable claim on the matter prevents every ordinary earnings engine
    // from earning on this workflow action, even after unlinking the retainer.
    matter.retainerCoveredActionKeys = Array.from(new Set([...(matter.retainerCoveredActionKeys || []), actionKey]));
    await matter.save({ session });
    period.services.push({ caseId: matter._id, matterNo: matter.caseNo, actionKey,
      title: String(input.title || step.title || actionKey).trim(), performedOn, ordinaryFee, department: input.department,
      contributors: snapshots, approvedBy: actor, approvedAt: new Date(), scopeApproval: input.scopeApproval });
    period.history.push({ action: 'SERVICE_RECOGNISED', reason: `${matter.caseNo}: ${actionKey}`, actor, at: new Date() });
    await period.save({ session });
    return period._id;
  });
}

export async function recordReceipt(periodId: string, input: any, actor: string) {
  return transact(async (session) => {
    const period: any = await Period.findById(id(periodId)).session(session);
    if (!period) fail('Monthly statement not found.', 404);
    let amount = wholeAmount(input.amount), receivedOn = String(input.receivedOn || '');
    let reference = String(input.reference || '').trim();
    let invoice: any = null;
    if (input.sourceInvoiceId) {
      invoice = await Invoice.findById(id(input.sourceInvoiceId)).session(session);
      if (!invoice || invoice.status !== 'Paid' || invoice.retainerReceiptId) fail('Select a paid invoice that has not already been transferred.');
      const matter = await Case.findOne({ _id: invoice.caseId, retainerId: period.retainerId }).session(session);
      if (!matter) fail('The invoice must belong to a matter linked to this retainer.');
      if (await Ledger.exists({ caseId: invoice.caseId, earnedFee: { $gt: 0 } }).session(session)) fail('Reconcile existing ordinary earnings before transferring this invoice.', 409);
      amount = wholeAmount(invoice.amount);
      receivedOn = new Date(invoice.updatedAt).toLocaleDateString('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Africa/Kigali' });
      reference = invoice.invoiceNo;
    }
    if (!validDay(receivedOn) || receivedOn > localToday()) fail('Enter a valid receipt date up to today.');
    if (!reference || reference.length > 180) fail('A bank/payment reference is required (maximum 180 characters).');
    const [receipt] = await Receipt.create([{ periodId: period._id, retainerId: period.retainerId, amount, receivedOn,
      reference, referenceKey: reference.toLowerCase().replace(/\s+/g, ' '), recordedBy: actor,
      ...(invoice ? { sourceInvoiceId: invoice._id } : {}) }], { session });
    if (invoice) await Invoice.updateOne({ _id: invoice._id }, { $set: { retainerReceiptId: receipt!._id } }, { session, timestamps: false });
    // Serialize receipts with closure/service changes and preserve a visible audit trail.
    period.history.push({ action: 'RECEIPT_RECORDED', reason: `${reference}: RWF ${amount}`, actor, at: new Date() });
    await period.save({ session });
    return receipt;
  });
}

export async function changePeriod(periodId: string, action: string, input: any, actor: string) {
  return transact(async (session) => {
    const period: any = await Period.findById(id(periodId)).session(session);
    if (!period) fail('Monthly statement not found.', 404);
    const reason = String(input.reason || '').trim();
    const previousFee = period.fixedFee;
    if (action !== 'close' && reason.length < 5) fail('Give a reason of at least five characters.');
    if (action === 'close') {
      period.status = 'Closed'; period.closedAt = new Date(); period.closedBy = actor;
    } else if (action === 'reopen') {
      period.status = 'Open';
    } else if (action === 'amend-fee') {
      if (period.status !== 'Open') fail('Reopen the month before amending its fixed fee.', 409);
      period.fixedFee = wholeAmount(input.fixedFee);
    } else if (action === 'void-service') {
      if (period.status !== 'Open') fail('Reopen the month before correcting work.', 409);
      const service = period.services.id(id(input.serviceId));
      if (!service || service.voidedAt) fail('Active service not found.', 404);
      service.voidedAt = new Date(); service.voidedBy = actor; service.voidReason = reason;
      // Keep the action claim: a void is a reversal, not permission to pay it twice.
    } else if (action === 'restore-receipt') {
      const receipt: any = await Receipt.findOne({ _id: id(input.receiptId), periodId: period._id }).session(session);
      if (!receipt || !receipt.voidedAt) fail('Reversed receipt not found.', 404);
      receipt.set('voidedAt', undefined); receipt.set('voidReason', undefined); receipt.set('voidedBy', undefined);
      await receipt.save({ session });
    } else if (action === 'void-receipt') {
      const receipt: any = await Receipt.findOne({ _id: id(input.receiptId), periodId: period._id }).session(session);
      if (!receipt || receipt.voidedAt) fail('Active receipt not found.', 404);
      receipt.voidedAt = new Date(); receipt.voidReason = reason; receipt.voidedBy = actor;
      await receipt.save({ session });
    } else fail('Unsupported monthly action.');
    period.history.push({ action: action.toUpperCase(), reason: action === 'amend-fee' ? `${reason}; fixed fee ${previousFee} → ${period.fixedFee}` : reason, actor, at: new Date() });
    await period.save({ session });
  });
}

/** Cash uses receipt date; production/TPA use performed date. Allocations are
 * attribution of that cash and are never added to firm revenue a second time. */
export async function retainerFinancials(from?: string | null, to?: string | null, asOf?: string | null) {
  const periods: any[] = await Period.find({}).lean();
  const receiptCutoff = asOf || to;
  const receipts: any[] = await Receipt.find({ voidedAt: { $exists: false }, ...(receiptCutoff ? { receivedOn: { $lte: receiptCutoff } } : {}) }).lean();
  const inside = (day: string) => (!from || day >= from) && (!to || day <= to);
  const statements = periods.map((period) => {
    const payments = receipts.filter((r) => String(r.periodId) === String(period._id));
    const allocation = allocateRetainer(period, payments);
    const scopedAllocation = allocateRetainer(period, payments.filter((r) => inside(r.receivedOn)));
    const work = allocation.services.filter((s) => inside(s.performedOn));
    return { ...period, receipts: payments, allocation, cashAllocation: scopedAllocation, work,
      feeInRange: inside(period.dueDate) ? period.fixedFee : 0,
      cashInRange: scopedAllocation.actualReceived,
      workInRange: work.reduce((n, s) => n + s.ordinaryFee, 0),
      tpaInRange: decimal(work.reduce((n, s) => n + s.contributors.reduce((m: number, c: any) => m + c.earnedTpa, 0), 0)) };
  });
  // Distribute the final monthly credit over its receipts with whole-franc
  // conservation. Adjacent receipt windows reconcile to the monthly statement.
  for (const p of statements) {
    const services = p.allocation.services;
    const scoped = services.map(() => 0);
    let unused = 0;
    for (const payment of p.allocation.receiptAllocations.filter((r: any) => inside(r.receivedOn))) {
      payment.serviceCredits.forEach((share: number, i: number) => { scoped[i] = scoped[i]! + share; });
      unused += payment.firmUnutilisedRevenue;
    }
    const creditedServices = services.map((s: any, i: number) => ({ ...s, allocatedRevenue: scoped[i] || 0 }));
    p.cashAllocation = { ...p.cashAllocation,
      allocableRevenue: p.cashInRange - unused, firmUnutilisedRevenue: unused,
      departments: p.allocation.departments.map((d: any) => ({ ...d, allocatedRevenue: creditedServices.filter((s: any) => s.department === d.department).reduce((n: number, s: any) => n + s.allocatedRevenue, 0) })),
      services: creditedServices };
  }
  return { statements,
    billed: statements.reduce((n, p) => n + p.feeInRange, 0),
    collected: statements.reduce((n, p) => n + p.cashInRange, 0),
    workValue: statements.reduce((n, p) => n + p.workInRange, 0),
    staffTpa: decimal(statements.reduce((n, p) => n + p.tpaInRange, 0)),
    outstanding: statements.reduce((n, p) => n + ((!to || p.dueDate <= to) ? p.allocation.outstanding : 0), 0),
    unutilisedRevenue: decimal(statements.reduce((n, p) => n + p.cashAllocation.firmUnutilisedRevenue, 0)),
  };
}

export async function retainerEarningsRows(from: Date, to: Date, filters: { staffKey?: string | null; role?: string | null; matterId?: string | null } = {}): Promise<StaffEarningsRow[]> {
  const financials = await retainerFinancials(null, null);
  const rows: StaffEarningsRow[] = [];
  for (const p of financials.statements) for (const s of p.allocation.services) for (const c of s.contributors) {
    const staffKey = baseMemberName(c.name);
    const at = `${s.performedOn}T12:00:00+02:00`;
    if (Date.parse(at) < from.getTime() || Date.parse(at) > to.getTime()) continue;
    if (filters.staffKey && staffKey !== filters.staffKey) continue;
    if (filters.role && c.role !== filters.role) continue;
    if (filters.matterId && String(s.caseId) !== filters.matterId) continue;
    rows.push({ source: 'retainer', retainerId: String(p.retainerId), retainerPeriodId: String(p._id),
      key: `retainer:${p._id}:${s._id}:${c.userId}`, caseId: String(s.caseId), matterNo: s.matterNo || p.retainerNo || '',
      matterName: p.clientName, matterType: s.department, staffKey, staffName: c.name, systemRole: c.role,
      assignmentRole: 'retainer-contributor', tpaPercent: c.tpaPercent, tpaSource: c.tpaSource,
      keyActionKey: s.actionKey, keyActionTitle: s.title, stageKey: null, stageTitle: `${p.month} retainer`,
      completionAt: at, completionSource: 'retainer-approved-work', completionSourceLabel: 'Approved workflow tasks completed during the month',
      completionAtLocal: s.performedOn, timeZone: process.env.APP_TIMEZONE || 'Africa/Kigali', timeZoneOffsetMinutes: 120,
      contractValue: p.fixedFee, keyActionPercent: c.share, grossActionValue: c.production,
      collectedAmount: p.allocation.actualReceived, eligibleCollectedBase: c.allocatedRevenue,
      uncollectedActionValue: Math.max(0, c.production - c.allocatedRevenue), timelinessScore: null, qualityScore: null,
      earnedFee: c.earnedTpa, currency: 'RWF', formula: `${c.production} × ${c.tpaPercent}% = ${c.earnedTpa}`,
      status: 'ready', statusNote: 'Individual TPA = individual monthly production × applicable TPA %. Actual revenue received is recorded separately.', missingInputs: [],
      paymentTimestamps: [], inPeriod: true });
  }
  return rows;
}

export function toProductivityRow(row: StaffEarningsRow) {
  return { id: row.key, source: 'retainer', caseId: row.caseId, caseCompleted: false, completedAt: row.completionAt,
    staff: row.staffName, role: row.systemRole, assignmentRole: row.assignmentRole, matter: row.matterNo,
    task: row.keyActionTitle, taskFeeCollected: row.eligibleCollectedBase, taskFee: row.eligibleCollectedBase,
    productionValue: row.grossActionValue, tpaPercent: row.tpaPercent, timelinessScore: null, qualityScore: null,
    formula: row.formula, feeEarned: row.earnedFee, keyActionsCompleted: 1, keyActionsTotal: 1,
    keyActionPercent: row.keyActionPercent, workflowStage: row.stageTitle, timelinessStatus: 'Individual monthly production',
    collectedAmount: row.collectedAmount, eligibleCollectedValue: row.eligibleCollectedBase };
}
