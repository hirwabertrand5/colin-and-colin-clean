/** Case-only reconciliation of user-confirmed completed work to its original approvals. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { EJSON } = require('bson');
const { CASE_ID, TEMPLATE_ID, connect, readSnapshot } = require('./inspectCoffeeSequence.cjs');
const { orderWorkflowSteps } = require('../dist/utils/workflowSchedule');
const { computeCompletedPercentFromInstance, computeStageBreakdownFromInstance, computeEarnedFee } = require('../dist/utils/workflowPercentages');
const { classifyWorkflowWork } = require('../dist/utils/workflowWorkTime');
const clone = value => EJSON.parse(EJSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(EJSON.stringify(value)).digest('hex');
const guard = s => hash([s.matter, s.workflow, s.template, s.tasks, s.ledger]);
const folder = path.resolve(__dirname, '../.local-operations');

function buildPlan(snapshot, at = new Date()) {
  const { matter, workflow, template } = snapshot;
  assert(matter && String(matter._id) === CASE_ID && matter.caseNo === 'CASE-2026-00047' && matter.parties === 'RWANDA FARMERS COFFEE COMPANY');
  assert.equal(matter.status, 'Active');
  assert.equal(String(workflow.templateId), TEMPLATE_ID);
  assert.equal(workflow.steps.length, 33);
  const ordered = orderWorkflowSteps(workflow.steps, template);
  const history = new Map(workflow.archivedSteps.filter(s => s.archivedFromTemplate).map(s => [s.stepKey, s]));
  const next = clone(workflow);
  const restored = [], configured = [];
  for (const original of ordered.slice(0, 25)) {
    assert(['Done', 'Completed'].includes(original.status), 'A migrated action has new in-flight work; inspect before reconciling');
    assert(original.carriedWork?.sourceStepKeys?.length, 'Original activity mapping required');
    const sources = original.carriedWork.sourceStepKeys.map(key => history.get(key));
    assert(sources.every(s => s?.status === 'Completed' && s.submittedAt && s.reviewedAt && s.completedAt), 'Every carried approval needs the original approval chain');
    const step = next.steps.find(s => s.stepKey === original.stepKey);
    if (step.status === 'Done') {
      assert(!step.submittedAt && !step.reviewedAt && !step.completedAt, 'Do not replace a later target-workflow review event');
      for (const field of ['doneAt', 'submittedAt', 'reviewedAt', 'completedAt']) step[field] = new Date(Math.max(...sources.map(s => +new Date(s[field]))));
      step.status = 'Completed';
      const primary = sources.slice().sort((a,b) => +new Date(b.completedAt) - +new Date(a.completedAt))[0];
      step.tpaSnapshots = clone(primary.tpaSnapshots || []);
      restored.push(step.stepKey);
    }
    if (step.carriedWork.colorBasis !== 'percentage-bands') {
      step.carriedWork.colorBasis = 'percentage-bands'; configured.push(step.stepKey);
    }
    assert.equal(classifyWorkflowWork(step).score, classifyWorkflowWork(original).score, 'Keep the real source score rather than changing it to obtain a preferred colour');
  }
  const nextWork = next.steps.find(s => s.stepKey === ordered[25].stepKey);
  assert(['Not Started','In Progress'].includes(nextWork.status), 'Next action changed concurrently; inspect again');
  if (nextWork.status === 'Not Started') nextWork.status = 'In Progress';
  next.currentStepKey = nextWork.stepKey; next.status = 'Active';
  const percent = computeCompletedPercentFromInstance(next.steps);
  const planned = Number(matter.workflowProgress?.plannedValue?.amount) || Number(String(matter.budget || '').replace(/[^\d.]/g, '')) || 0;
  const completedValue = Math.round(planned * percent / 100);
  const progress = { ...clone(matter.workflowProgress), percent, status: 'In Progress', currentStepKey: nextWork.stepKey,
    currentStepTitle: nextWork.title, currentStepStartAt: nextWork.startAt, currentStepDueAt: nextWork.dueAt, nextDueAt: nextWork.dueAt,
    stagePercent: computeStageBreakdownFromInstance(next.steps), completedValue: { amount: completedValue, currency: 'RWF' } };
  if (nextWork.extensionHistory?.length) progress.currentStepExtension = clone(nextWork.extensionHistory.at(-1)); else delete progress.currentStepExtension;
  const tasks = clone(snapshot.tasks);
  for (const task of tasks) {
    const step = next.steps.find(s => s.stepKey === task.workflowStepKey);
    if (!step) continue;
    if (step.status === 'Completed') {
      task.status = 'Completed'; task.workflowStage = 'Completed';
      task.submittedAt = step.submittedAt; task.completedAt = step.completedAt; task.approvedAt = step.completedAt;
      task.approvalStatus = task.requiresApproval ? 'Approved' : 'Not Required';
      if (!task.approvedBy) task.approvedBy = matter.caseAssignments.signerApprover;
      for (const stage of task.taskStages || []) {
        stage.status = 'Completed';
        stage.completedAt = stage.role === 'Initiator' ? step.submittedAt : stage.role === 'Reviewer' ? step.reviewedAt : step.completedAt;
      }
    } else if (step.stepKey === nextWork.stepKey && task.status === 'Not Started') {
      task.status = 'In Progress'; task.workflowStage = 'In Progress';
    }
  }
  const changed = restored.length > 0 || configured.length > 0;
  if (changed) { next.updatedAt = new Date(at); next.__v = (next.__v || 0) + 1; }
  return { next, progress, completedValue, tasks, restored, configured, changed, at: new Date(at),
    colors: Object.fromEntries(['blue','green','yellow','red'].map(color => [color, next.steps.slice(0,25).filter(step => classifyWorkflowWork(step).performance.color === color).length])) };
}

async function refreshLedger(db, caseId, session, at) {
  const { loadEarningRows } = require('../dist/services/earningSnapshotService');
  const { buildLedgerEntryKey } = require('../dist/utils/staffEarningsLedger');
  const Ledger = require('../dist/models/staffEarningsLedgerModel').default;
  const rows = (await loadEarningRows([String(caseId)], session)).filter(row => row.completionAt);
  const oldRows = await db.collection('staffearningsledgers').find({ caseId }, { session }).toArray();
  const byKey = new Map(oldRows.map(entry => [entry.entryKey, entry]));
  const operations = []; let created = 0, refreshed = 0;
  for (const row of rows) {
    const entryKey = buildLedgerEntryKey(row), old = byKey.get(entryKey);
    const inputs = { contractValue: row.contractValue, keyActionPercent: row.keyActionPercent, grossActionValue: row.grossActionValue,
      collectedAmount: row.collectedAmount, eligibleCollectedBase: row.eligibleCollectedBase, tpaPercent: old?.tpaPercent ?? row.tpaPercent,
      timelinessScore: row.timelinessScore, qualityScore: row.qualityScore,
      earnedFee: computeEarnedFee(row.eligibleCollectedBase, old?.tpaPercent ?? row.tpaPercent, row.timelinessScore, row.qualityScore),
      rateActivityAt: old?.rateActivityAt || (row.rateActivityAt ? new Date(row.rateActivityAt) : null),
      currency: row.currency, completionAt: new Date(row.completionAt), statusNote: row.statusNote };
    if (!old) {
      const doc = new Ledger({ ...row, ...inputs, entryKey, revision: 1, recordedBy: 'Original approved-work carryover', createdAt: at, updatedAt: at });
      const error = doc.validateSync(); if (error) throw error;
      operations.push({ insertOne: { document: doc.toObject() } }); created++;
    } else {
      const changed = Object.entries(inputs).some(([key,value]) => ['completionAt','rateActivityAt'].includes(key)
        ? (old[key] ? +new Date(old[key]) : null) !== (value ? +new Date(value) : null) : (old[key] ?? null) !== (value ?? null));
      if (!changed) continue;
      const retained = { ...old, _id: undefined, inputHistory: undefined, retainedAt: at };
      operations.push({ updateOne: { filter: { _id: old._id, caseId, revision: old.revision }, update: {
        $set: { ...inputs, updatedAt: at, recordedBy: 'Original approved-work carryover', correctionReason: 'User requested the migrated completed work retain its original reviewed/approved state; original applied rates retained.' },
        $inc: { revision: 1 }, $push: { inputHistory: retained },
      } } }); refreshed++;
    }
  }
  if (operations.length) {
    const result = await db.collection('staffearningsledgers').bulkWrite(operations, { session });
    assert.equal(result.insertedCount, created); assert.equal(result.modifiedCount, refreshed);
  }
  return { created, refreshed, activeRows: rows.length };
}

async function completeCarryover(db, { apply = false } = {}) {
  const before = await readSnapshot(db), plan = buildPlan(before);
  const summary = { caseNo: before.matter.caseNo, approvalsRestored: plan.restored.length, approved: 25,
    approvedProgress: plan.progress.percent, nextWorkKey: plan.next.currentStepKey, colors: plan.colors };
  if (!apply || !plan.changed) return { applied: false, alreadyCorrect: !plan.changed, ...summary };
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `coffee-approved-carryover-before-${Date.now()}.ejson`), EJSON.stringify(before, null, 2));
  const session = await mongoose.startSession(); let repairId, ledger;
  try {
    await session.withTransaction(async () => {
      assert.equal(guard(await readSnapshot(db, session)), guard(before), 'Concurrent change detected; nothing applied');
      repairId = new mongoose.Types.ObjectId();
      await db.collection('caseworkflowrepairs').insertOne({ _id: repairId, caseId: before.matter._id, kind: 'original-approval-chain-restored',
        createdAt: plan.at, before, restoredKeys: plan.restored, colorBasis: 'percentage-bands',
        reason: 'User explicitly requested the migrated completed work be treated as already reviewed and approved; restore original recorded approval events' }, { session });
      const saved = await db.collection('workflowinstances').replaceOne({ _id: before.workflow._id, updatedAt: before.workflow.updatedAt, __v: before.workflow.__v }, plan.next, { session });
      assert.equal(saved.modifiedCount, 1);
      const caseResult = await db.collection('cases').updateOne({ _id: before.matter._id, updatedAt: before.matter.updatedAt }, {
        $set: { workflowProgress: plan.progress, 'billingSettings.accruedUnbilled': plan.completedValue, updatedAt: plan.at }, $inc: { __v: 1 },
      }, { session }); assert.equal(caseResult.modifiedCount, 1);
      const taskWrites = plan.tasks.filter(task => hash(task) !== hash(before.tasks.find(old => String(old._id) === String(task._id)))).map(task => ({ replaceOne: {
        filter: { _id: task._id, caseId: before.matter._id }, replacement: { ...task, updatedAt: plan.at },
      } }));
      if (taskWrites.length) { const result = await db.collection('tasks').bulkWrite(taskWrites, { session }); assert.equal(result.matchedCount, taskWrites.length); }
      ledger = await refreshLedger(db, before.matter._id, session, plan.at);
      await db.collection('auditlogs').insertOne({ caseId: before.matter._id, actorName: 'User-authorized workflow completion correction',
        action: 'WORKFLOW_TEMPLATE_ALIGNED', message: 'Restored original recorded review/approval events for migrated completed work and enabled percentage-based timing colours for this matter',
        detail: JSON.stringify({ repairId: String(repairId), restoredKeys: plan.restored, progress: plan.progress.percent, colors: plan.colors, ledger }), createdAt: plan.at }, { session });
      const check = await readSnapshot(db, session);
      assert.deepEqual(check.workflow, plan.next); assert.deepEqual(check.template, before.template);
      assert.deepEqual(check.matter.caseAssignments, before.matter.caseAssignments);
      assert.equal(check.matter.assignedTo, before.matter.assignedTo);
      assert.equal(check.matter.workflowProgress.percent, plan.progress.percent);
      assert.equal(check.tasks.filter(task => task.status === 'Completed').length, 25);
      for (const old of before.ledger.filter(entry => entry.workflowMigrationId)) assert.deepEqual(check.ledger.find(entry => String(entry._id) === String(old._id)), old, 'Archived original earnings history is immutable');
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', wtimeoutMS: 15000 }, maxCommitTimeMS: 15000 });
  } finally { await session.endSession(); }
  const after = await readSnapshot(db); assert.deepEqual(after.workflow, plan.next);
  fs.writeFileSync(path.join(folder, `coffee-approved-carryover-after-${Date.now()}.ejson`), EJSON.stringify(after, null, 2));
  return { applied: true, repairId: String(repairId), ledger, ...summary };
}
module.exports = { buildPlan, completeCarryover };
if (require.main === module) (async () => {
  await connect();
  try { console.log(JSON.stringify(await completeCarryover(mongoose.connection.db, { apply: process.argv.includes('--apply') }))); }
  finally { await mongoose.disconnect(); }
})().catch(error => { console.error(String(error.message).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[redacted]')); process.exitCode = 1; });
