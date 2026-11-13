/** Exact-matter reconciliation and user-requested audit restart. Preview by default. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { EJSON } = require('bson');
const { CASE_ID, TEMPLATE_ID, connect, readSnapshot } = require('./inspectCoffeeSequence.cjs');
const { classifyWorkflowWork, summarizeWorkflowWork } = require('../dist/utils/workflowWorkTime');
const { orderWorkflowSteps } = require('../dist/utils/workflowSchedule');
const { isStepWorkDone } = require('../dist/models/workflowInstanceModel');
const clone = value => EJSON.parse(EJSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(EJSON.stringify(value)).digest('hex');
const guard = value => hash([value.matter, value.workflow, value.template, value.tasks, value.ledger, value.audits]);

async function readAll(db, session) {
  const snapshot = await readSnapshot(db, session);
  snapshot.audits = await db.collection('auditlogs').find({ caseId: snapshot.matter._id }, session ? { session } : {}).sort({ _id: 1 }).toArray();
  return snapshot;
}

function buildFinalPlan(before) {
  const { matter, workflow, template, tasks } = before;
  assert(matter && String(matter._id) === CASE_ID && matter.caseNo === 'CASE-2026-00047' && matter.parties === 'RWANDA FARMERS COFFEE COMPANY');
  assert.equal(String(workflow.templateId), TEMPLATE_ID);
  assert.equal(String(template._id), TEMPLATE_ID);
  const ordered = orderWorkflowSteps(workflow.steps, template);
  assert.equal(ordered.length, 33);
  const archived = new Map((workflow.archivedSteps || []).filter(step => step.archivedFromTemplate).map(step => [step.stepKey, step]));
  const originalSubmitted = [...archived.values()].filter(step => step.submittedAt);
  assert.equal(originalSubmitted.length, 19, 'Unexpected original submission history; inspect before resetting audit');
  const originalResults = originalSubmitted.map(step => ({ key: step.stepKey, submittedAt: step.submittedAt,
    dueAt: step.dueAt, outcome: classifyWorkflowWork(step).outcome }));
  const firstPending = ordered.findIndex(step => !isStepWorkDone(step));
  assert(firstPending >= 0);
  assert(ordered.slice(firstPending).every(step => !isStepWorkDone(step)), 'Sequence still has gaps; do not reset the audit');
  for (const step of ordered.filter(isStepWorkDone)) {
    const source = step.carriedWork;
    assert(source && source.sourceStepKeys.length && source.submittedAt && source.dueAt, `Missing original timing for ${step.stepKey}`);
    const sources = source.sourceStepKeys.map(key => archived.get(key));
    assert(sources.every(item => item?.submittedAt && item.dueAt), 'Original source not found');
    assert.equal(+new Date(source.submittedAt), Math.max(...sources.map(item => +new Date(item.submittedAt))), 'Carried submission must exactly match source history');
    assert.equal(+new Date(step.dueAt), Math.max(...sources.map(item => +new Date(item.dueAt))), 'Effective deadline must match the recorded source');
    // Preserve genuinely late source work, including a combined target action
    // whose sources have different deadlines; never hide it with the latest due.
    const expected = sources.some(item => classifyWorkflowWork(item).outcome === 'late') ? 'late' : 'on-time';
    assert.equal(classifyWorkflowWork(step).outcome, expected, 'The carried result must preserve the original outcome');
  }
  const nextWork = ordered[firstPending];
  const taskChanges = [];
  for (const task of tasks) {
    const step = ordered.find(item => item.stepKey === task.workflowStepKey);
    if (!step) continue;
    assert.equal(task.title, step.title, 'A task title is linked to the wrong action');
    if (step.status === 'Completed') assert.equal(task.status, 'Completed', 'An approval and task disagree');
    if (step.status !== 'Completed' && isStepWorkDone(step) && task.status === 'Not Started') {
      taskChanges.push({ id: task._id, key: step.stepKey, patch: { status: 'In Progress', workflowStage: 'In Progress' } });
    }
    assert(!(task.status === 'Completed' && step.status !== 'Completed'), 'A task is completed without workflow approval');
  }
  const matterPatch = {};
  const progress = clone(matter.workflowProgress);
  if (progress.currentStepKey !== nextWork.stepKey || progress.currentStepTitle !== nextWork.title || +new Date(progress.currentStepDueAt) !== +new Date(nextWork.dueAt)) {
    Object.assign(progress, { currentStepKey: nextWork.stepKey, currentStepTitle: nextWork.title,
      currentStepStartAt: nextWork.startAt, currentStepDueAt: nextWork.dueAt, nextDueAt: nextWork.dueAt });
    matterPatch.workflowProgress = progress;
  }
  const summary = summarizeWorkflowWork(ordered);
  return { taskChanges, matterPatch, nextWorkKey: nextWork.stepKey, summary,
    original: { submitted: originalResults.length, onTime: originalResults.filter(row => row.outcome === 'on-time').length,
      late: originalResults.filter(row => row.outcome === 'late').length, records: originalResults },
    auditRecords: before.audits.length };
}

async function finalize(db, { apply = false, resetAudit = false } = {}) {
  const before = await readAll(db);
  const previousReset = before.audits.find(log => log.action === 'CASE_AUDIT_RESTARTED');
  if (previousReset) return { applied: false, alreadyFinalized: true, resetAt: previousReset.createdAt };
  const plan = buildFinalPlan(before);
  const summary = { caseNo: before.matter.caseNo, originalSubmitted: plan.original.submitted,
    originalOnTime: plan.original.onTime, originalLate: plan.original.late, current: plan.summary,
    nextWorkKey: plan.nextWorkKey, taskCorrections: plan.taskChanges.length, auditRecords: plan.auditRecords };
  if (!apply) return { applied: false, ...summary };
  assert(resetAudit, 'Audit restart must be explicitly requested');
  const folder = path.resolve(__dirname, '../.local-operations'); fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `coffee-final-audit-backup-${Date.now()}.ejson`);
  fs.writeFileSync(file, EJSON.stringify(before, null, 2));
  assert(fs.statSync(file).size > 0, 'Local backup required before clearing audit');
  const session = await mongoose.startSession(); let resetId; const at = new Date();
  try {
    await session.withTransaction(async () => {
      assert.equal(guard(await readAll(db, session)), guard(before), 'Concurrent matter/audit changes detected; nothing cleared');
      resetId = new mongoose.Types.ObjectId();
      const { audits, ...caseBackup } = before;
      await db.collection('caseauditresets').insertOne({ _id: resetId, caseId: before.matter._id, createdAt: at,
        reason: 'User-requested final original timing/lifecycle/sequence reconciliation and audit restart',
        before: caseBackup, comparison: plan, auditArchiveCount: audits.length, localBackupName: path.basename(file) }, { session });
      if (audits.length) await db.collection('caseauditarchiveentries').insertMany(audits.map(audit => ({
        ...audit, originalAuditId: audit._id, resetId, archivedAt: at,
      })), { session });
      if (plan.taskChanges.length) {
        const result = await db.collection('tasks').bulkWrite(plan.taskChanges.map(task => ({ updateOne: {
          filter: { _id: task.id, caseId: before.matter._id }, update: { $set: { ...task.patch, updatedAt: at } },
        } })), { session });
        assert.equal(result.modifiedCount, plan.taskChanges.length);
      }
      if (plan.matterPatch.workflowProgress) {
        const result = await db.collection('cases').updateOne({ _id: before.matter._id, updatedAt: before.matter.updatedAt },
          { $set: { ...plan.matterPatch, updatedAt: at }, $inc: { __v: 1 } }, { session });
        assert.equal(result.modifiedCount, 1);
      }
      // Delete exactly the backed-up records for this case; never touch a new
      // concurrent audit or another matter's history.
      if (audits.length) {
        assert.equal(await db.collection('caseauditarchiveentries').countDocuments({ resetId }, { session }), audits.length);
        const deleted = await db.collection('auditlogs').deleteMany({ caseId: before.matter._id, _id: { $in: audits.map(audit => audit._id) } }, { session });
        assert.equal(deleted.deletedCount, audits.length);
      }
      await db.collection('auditlogs').insertOne({ caseId: before.matter._id, actorName: 'User-authorized workflow reconciliation',
        action: 'CASE_AUDIT_RESTARTED', message: 'Audit restarted after original timing, work sequence and approval state were checked',
        detail: JSON.stringify({ resetId: String(resetId), archivedEntries: audits.length, originalSubmitted: plan.original.submitted,
          originalOnTime: plan.original.onTime, originalLate: plan.original.late, current: plan.summary,
          nextWorkKey: plan.nextWorkKey, taskCorrections: plan.taskChanges.map(task => task.key) }), createdAt: at }, { session });
      const check = await readAll(db, session);
      assert.deepEqual(check.workflow, before.workflow, 'Confirmed work and original approvals remain intact');
      assert.deepEqual(check.ledger, before.ledger);
      assert.deepEqual(check.template, before.template);
      assert.deepEqual(check.matter.caseAssignments, before.matter.caseAssignments);
      assert.equal(check.matter.workflowProgress.percent, before.matter.workflowProgress.percent);
      assert.equal(check.audits.length, 1);
      assert.equal(check.audits[0].action, 'CASE_AUDIT_RESTARTED');
      const expectedTasks = clone(before.tasks);
      for (const task of plan.taskChanges) Object.assign(expectedTasks.find(item => String(item._id) === String(task.id)), task.patch, { updatedAt: at });
      assert.deepEqual(check.tasks, expectedTasks);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', wtimeoutMS: 15000 }, maxCommitTimeMS: 15000 });
  } finally { await session.endSession(); }
  const after = await readAll(db);
  assert(after.audits.some(log => log.action === 'CASE_AUDIT_RESTARTED' && +log.createdAt === +at));
  fs.writeFileSync(path.join(folder, `coffee-final-after-${Date.now()}.ejson`), EJSON.stringify(after, null, 2));
  return { applied: true, resetId: String(resetId), ...summary };
}

module.exports = { buildFinalPlan, finalize };
if (require.main === module) (async () => {
  await connect();
  try { console.log(JSON.stringify(await finalize(mongoose.connection.db, { apply: process.argv.includes('--apply'), resetAudit: process.argv.includes('--reset-audit') }))); }
  finally { await mongoose.disconnect(); }
})().catch(error => { console.error(String(error.message).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[redacted]')); process.exitCode = 1; });
