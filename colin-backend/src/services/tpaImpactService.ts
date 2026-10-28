import { ClientSession } from 'mongoose';
import Case from '../models/caseModel';
import Workflow from '../models/workflowInstanceModel';
import Task from '../models/taskModel';
import Ledger from '../models/staffEarningsLedgerModel';
import { CASE_ASSIGNMENT_ROLE_CONFIG } from '../utils/caseAssignmentContinuity';
import { findAppliedTpa, resolveTpaAttribution } from '../utils/tpaAttribution';
import { baseMemberName, computeEarnedFee, getTpaPercent } from '../utils/workflowPercentages';
import { resolveTpaRate } from '../utils/tpaRates';
import { loadEarningRows } from './earningSnapshotService';

/** Counts actual contributor activities, not just optional ledger rows. */
export async function previewTpaImpact(user: any, proposed: any[], session: ClientSession | null = null) {
  const staffKey = baseMemberName(user.name);
  const matters = await Case.find({}).select('caseAssignments assignedTo assignmentHandoverHistory').session(session).lean();
  const instances = await Workflow.find({}).select('caseId steps').session(session).lean();
  const tasks = await Task.find({ status: 'Completed' }).session(session).lean();
  const ledger = await Ledger.find({ staffKey }).session(session).lean();
  const rows = await loadEarningRows(undefined, session);
  const mattersById = new Map(matters.map(m => [String(m._id), m]));
  const activities = new Map<string, any>();
  const add = (caseId: unknown, actionKey: string, role: string, at: Date | undefined, snapshot: any) => {
    if (!at) return;
    const id = `${caseId}:${actionKey}:${role}:${+at}`;
    const saved = ledger.find(entry => String(entry.caseId) === String(caseId) && entry.keyActionKey === actionKey && entry.assignmentRole === role);
    const before = saved?.tpaPercent ?? snapshot?.rate ?? resolveTpaRate(user.tpaHistory || [], at, getTpaPercent(user.role));
    const after = resolveTpaRate(proposed, at, getTpaPercent(user.role));
    if (before === after) return;
    const row = rows.find(row => row.caseId === String(caseId) && row.keyActionKey === actionKey && row.staffKey === staffKey && row.assignmentRole === role);
    const financial = saved || row;
    const beforeFee = financial ? computeEarnedFee(financial.eligibleCollectedBase, before, financial.timelinessScore, financial.qualityScore) : null;
    const afterFee = financial ? computeEarnedFee(financial.eligibleCollectedBase, after, financial.timelinessScore, financial.qualityScore) : null;
    activities.set(id, { id, caseId: String(caseId), keyActionKey: actionKey, assignmentRole: role, activityAt: at.toISOString(),
      previousRate: before, proposedRate: after, saved: Boolean(saved), frozen: Boolean(saved || snapshot),
      currency: row?.currency || saved?.currency || null,
      delta: beforeFee != null && afterFee != null ? afterFee - beforeFee : null });
  };
  for (const instance of instances) {
    const matter = mattersById.get(String(instance.caseId));
    if (!matter) continue;
    for (const step of instance.steps) for (const { role } of CASE_ASSIGNMENT_ROLE_CONFIG) {
      const attribution = resolveTpaAttribution(matter, step, role);
      if (baseMemberName(attribution.name) !== staffKey) continue;
      add(instance.caseId, step.stepKey, role, attribution.at, attribution.at ? findAppliedTpa(step.tpaSnapshots || [], attribution.name, role, attribution.at) : null);
    }
  }
  for (const row of rows.filter(row => row.staffKey === staffKey && row.completionAt)) {
    const matter = mattersById.get(row.caseId);
    const instance = instances.find(i => String(i.caseId) === row.caseId);
    if (instance?.steps.some(step => step.stepKey === row.keyActionKey)) continue;
    const task = tasks.find(task => String(task.caseId) === row.caseId && task.workflowStepKey === row.keyActionKey);
    const at = resolveTpaAttribution(matter, undefined, row.assignmentRole as any, task?.completedAt || row.completionAt!).at;
    add(row.caseId, row.keyActionKey, row.assignmentRole, at, at ? findAppliedTpa(task?.tpaSnapshots || [], user.name, row.assignmentRole, at) : null);
  }
  // Include saved events even if their source action was later archived or removed.
  for (const entry of ledger) {
    const sourceExists = instances.some(instance => String(instance.caseId) === String(entry.caseId) && instance.steps.some(step => step.stepKey === entry.keyActionKey)) ||
      tasks.some(task => String(task.caseId) === String(entry.caseId) && task.workflowStepKey === entry.keyActionKey);
    if (sourceExists) continue;
    const represented = [...activities.values()].some(a => a.caseId === String(entry.caseId) && a.keyActionKey === entry.keyActionKey && a.assignmentRole === entry.assignmentRole);
    if (!represented) add(entry.caseId, entry.keyActionKey, entry.assignmentRole, entry.rateActivityAt || entry.completionAt, entry);
  }
  const list = [...activities.values()];
  const byCurrency: Record<string, { proposedDelta: number; appliedDelta: number }> = {};
  for (const activity of list) if (activity.delta != null && activity.currency) {
    const bucket = byCurrency[activity.currency] ||= { proposedDelta: 0, appliedDelta: 0 };
    bucket.proposedDelta = Math.round((bucket.proposedDelta + activity.delta) * 100) / 100;
    if (!activity.frozen) bucket.appliedDelta = Math.round((bucket.appliedDelta + activity.delta) * 100) / 100;
  }
  return { affectedActivities: list.length, savedEarningsAffected: list.filter(a => a.saved).length,
    preservedSnapshots: list.filter(a => a.frozen).length, unsnapshottedActivities: list.filter(a => !a.frozen).length,
    unpricedActivities: list.filter(a => a.delta == null).length, financialImpact: byCurrency,
    activities: list,
    message: list.some(a => a.saved) ? 'Saved earnings would change. An explicit financial correction is required; this rate change is blocked.'
      : 'Applied activity snapshots remain unchanged. Backdating changes only activities without an applied snapshot. Amounts use current confirmed collections and available scores.' };
}
