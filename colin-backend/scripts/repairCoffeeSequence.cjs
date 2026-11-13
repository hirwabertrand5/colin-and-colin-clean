/** Scoped sequence correction. --apply requires explicit confirmation of earlier work. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const mongoose = require('mongoose');
const { EJSON } = require('bson');
const { CASE_ID, TEMPLATE_ID, readSnapshot, connect } = require('./inspectCoffeeSequence.cjs');
const { orderWorkflowSteps, selectNextWorkPendingStepKey, selectNextScheduledStepKey } = require('../dist/utils/workflowSchedule');
const { isStepWorkDone } = require('../dist/models/workflowInstanceModel');
const { buildRoleByName, resolveMemberTpa, baseMemberName, computeCompletedPercentFromInstance } = require('../dist/utils/workflowPercentages');
const { resolveTpaAttribution, findAppliedTpa } = require('../dist/utils/tpaAttribution');
const clone = value => EJSON.parse(EJSON.stringify(value));
const digest = value => crypto.createHash('sha256').update(EJSON.stringify(value)).digest('hex');
const guard = snapshot => digest([snapshot.matter, snapshot.workflow, snapshot.template, snapshot.tasks, snapshot.ledger]);
const folder = path.resolve(__dirname, '../.local-operations');

function buildPlan(snapshot, users, at = new Date()) {
  const { matter, workflow, template } = snapshot;
  assert(matter && String(matter._id) === CASE_ID && matter.caseNo === 'CASE-2026-00047' && matter.parties === 'RWANDA FARMERS COFFEE COMPANY', 'Exact requested matter required');
  assert.equal(matter.status, 'Active');
  assert(workflow && String(workflow.caseId) === CASE_ID && String(workflow.templateId) === TEMPLATE_ID);
  assert(template && String(template._id) === TEMPLATE_ID && template.steps.length === 33);
  const ordered = orderWorkflowSteps(workflow.steps, template);
  const boundary = ordered.findIndex(step => step.stepKey === 'key_action_25');
  assert.equal(boundary, 24, 'Review this correction if the template sequence changes');
  assert.equal(ordered[boundary].status, 'Completed', 'Expected last migrated approval required');
  assert.equal(workflow.steps.filter(step => step.status === 'Completed').length, 15, 'Approval state has changed; inspect again');
  const gaps = ordered.slice(0, boundary + 1).filter(step => !isStepWorkDone(step));
  const next = clone(workflow);
  const roles = buildRoleByName(users);
  for (const gap of gaps) {
    assert(['Not Started', 'In Progress'].includes(gap.status));
    assert(!gap.submittedAt && !gap.reviewedAt && !gap.completedAt, 'Do not overwrite any recorded review lifecycle');
    const step = next.steps.find(s => s.stepKey === gap.stepKey);
    step.status = 'Done';
    // User confirmed the work; no historical time was supplied. Record the
    // correction time and leave submission, review and approval unrecorded.
    if (!step.doneAt) step.doneAt = new Date(at);
    const attribution = resolveTpaAttribution(matter, step, 'Initiator');
    assert(attribution.name && attribution.at, 'The actual assigned initiator must be identifiable');
    const tpa = resolveMemberTpa(attribution.name, roles, attribution.at);
    assert(tpa.source !== 'none', 'Missing applicable staff rate; inspect before recording work');
    const snapshots = clone(step.tpaSnapshots || []);
    if (!findAppliedTpa(snapshots, attribution.name, 'Initiator', attribution.at)) snapshots.push({
      staffKey: baseMemberName(attribution.name), staffName: attribution.name, assignmentRole: 'Initiator',
      activityAt: attribution.at, rate: tpa.tpaPercent, recordedAt: new Date(at),
    });
    step.tpaSnapshots = snapshots;
  }
  const nextWorkKey = selectNextWorkPendingStepKey(next.steps);
  const reviewKey = selectNextScheduledStepKey(next.steps);
  const current = next.steps.find(step => step.stepKey === (nextWorkKey || reviewKey));
  const extension = current?.extensionHistory?.at(-1);
  const progress = { ...clone(matter.workflowProgress), currentStepKey: current?.stepKey,
    currentStepTitle: current?.title, currentStepStartAt: current?.startAt, currentStepDueAt: current?.dueAt,
    nextDueAt: current?.dueAt };
  if (extension) progress.currentStepExtension = clone(extension); else delete progress.currentStepExtension;
  assert.equal(computeCompletedPercentFromInstance(next.steps), matter.workflowProgress.percent, 'Unreviewed ticks must not increase approved progress');
  if (gaps.length) { next.updatedAt = new Date(at); next.__v = (next.__v || 0) + 1; }
  // Keep the review pointer on its existing unapproved action. The case's
  // displayed work pointer advances independently to the next unticked action.
  assert.equal(next.steps.find(step => step.stepKey === next.currentStepKey)?.status, 'Done');
  assert(orderWorkflowSteps(next.steps, template).slice(0, boundary + 1).every(isStepWorkDone));
  for (const original of workflow.steps) if (!gaps.some(gap => gap.stepKey === original.stepKey)) {
    assert.deepEqual(next.steps.find(step => step.stepKey === original.stepKey), original, 'Existing work and approvals remain byte-for-byte unchanged');
  }
  return { next, progress, gaps: gaps.map(step => ({ key: step.stepKey, title: step.title, previousStatus: step.status })),
    nextWorkKey, approvedProgress: matter.workflowProgress.percent, at: new Date(at) };
}

async function readUsers(db, session) {
  return db.collection('users').find({}, { ...(session ? { session } : {}), projection: { name: 1, role: 1, tpaHistory: 1 } }).sort({ _id: 1 }).toArray();
}

async function repair(db, { apply = false, confirmed = false, at = new Date() } = {}) {
  const before = await readSnapshot(db);
  const users = await readUsers(db);
  const plan = buildPlan(before, users, at);
  const summary = { caseNo: before.matter.caseNo, actionsToTick: plan.gaps.map(gap => gap.key),
    nextWorkKey: plan.nextWorkKey, approvedProgress: plan.approvedProgress };
  if (!apply || !plan.gaps.length) return { applied: false, alreadyCorrect: !plan.gaps.length, ...summary };
  assert(confirmed, 'Explicit user confirmation of earlier completed work is required');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `coffee-sequence-before-${Date.now()}.ejson`), EJSON.stringify(before, null, 2));
  const session = await mongoose.startSession();
  let repairId;
  try {
    await session.withTransaction(async () => {
      const fresh = await readSnapshot(db, session);
      assert.equal(guard(fresh), guard(before), 'Matter or history changed concurrently; no correction applied');
      assert.equal(digest(await readUsers(db, session)), digest(users), 'Staff rates changed concurrently; retry from a fresh inspection');
      repairId = new mongoose.Types.ObjectId();
      await db.collection('caseworkflowrepairs').insertOne({ _id: repairId, caseId: before.matter._id,
        kind: 'confirmed-work-sequence-correction', createdAt: plan.at, before,
        confirmation: 'User confirmed earlier unticked actions were finished; record work done pending review and preserve existing approvals',
        changedKeys: plan.gaps.map(gap => gap.key), nextWorkKey: plan.nextWorkKey }, { session });
      const wfResult = await db.collection('workflowinstances').replaceOne({ _id: before.workflow._id, caseId: before.matter._id,
        updatedAt: before.workflow.updatedAt, __v: before.workflow.__v }, plan.next, { session });
      assert.equal(wfResult.modifiedCount, 1);
      const caseResult = await db.collection('cases').updateOne({ _id: before.matter._id, updatedAt: before.matter.updatedAt }, {
        $set: { workflowProgress: plan.progress, updatedAt: plan.at }, $inc: { __v: 1 },
      }, { session });
      assert.equal(caseResult.modifiedCount, 1);
      await db.collection('auditlogs').insertMany(plan.gaps.map(gap => ({ caseId: before.matter._id,
        actorName: 'User-authorized sequence correction', action: 'WORKFLOW_STEP_COMPLETED',
        message: 'Recorded confirmed earlier work as done; review and approval still required',
        detail: JSON.stringify({ repairId: String(repairId), stepKey: gap.key, title: gap.title,
          from: gap.previousStatus, to: 'Done', originalCompletionTime: 'not provided', recordedAt: plan.at }), createdAt: plan.at,
      })), { session });
      const check = await readSnapshot(db, session);
      assert.deepEqual(check.workflow, plan.next);
      assert.deepEqual(check.tasks, before.tasks, 'This correction must not rewrite task history');
      assert.deepEqual(check.ledger, before.ledger, 'Unreviewed ticks must not change earned fees or their snapshots');
      assert.deepEqual(check.template, before.template, 'The shared Legal Opinion sequence is unchanged');
      const expectedCase = { ...clone(before.matter), workflowProgress: plan.progress, updatedAt: plan.at, __v: (before.matter.__v || 0) + 1 };
      assert.deepEqual(check.matter, expectedCase, 'Only the displayed work pointer may change on the matter');
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', wtimeoutMS: 15000 }, maxCommitTimeMS: 15000 });
  } finally { await session.endSession(); }
  const after = await readSnapshot(db);
  assert.deepEqual(after.workflow, plan.next, 'Fresh committed read must match the repair');
  assert.deepEqual(after.matter.caseAssignments, before.matter.caseAssignments);
  fs.writeFileSync(path.join(folder, `coffee-sequence-after-${Date.now()}.ejson`), EJSON.stringify(after, null, 2));
  return { applied: true, repairId: String(repairId), ...summary };
}

async function main() {
  await connect();
  try {
    const result = await repair(mongoose.connection.db, { apply: process.argv.includes('--apply'), confirmed: process.argv.includes('--confirm-earlier-work-done') });
    console.log(JSON.stringify(result));
  } finally { await mongoose.disconnect(); }
}
module.exports = { buildPlan, repair };
if (require.main === module) main().catch(error => {
  console.error(String(error.message).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[database connection redacted]'));
  process.exitCode = 1;
});
