/** Restore original-work timing for this matter only; preview unless --apply. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { EJSON } = require('bson');
const { CASE_ID, TEMPLATE_ID, connect, readSnapshot } = require('./inspectCoffeeSequence.cjs');
const { EQUIVALENTS } = require('./migrateCoffeeLegalOpinion.cjs');
const { buildRoleByName, baseMemberName, resolveMemberTpa } = require('../dist/utils/workflowPercentages');
const { resolveTpaAttribution, findAppliedTpa } = require('../dist/utils/tpaAttribution');
const clone = value => EJSON.parse(EJSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(EJSON.stringify(value)).digest('hex');
const guard = value => hash([value.matter, value.workflow, value.template, value.tasks, value.ledger]);
const OLD_TEMPLATE_ID = '6ac7d144aaebe80bd2c9e0ce';
const folder = path.resolve(__dirname, '../.local-operations');

// These are work components the user explicitly confirmed were finished.
// Their individual timestamps were not separately recorded. Carry the
// supporting original activity's timing and keep its source explicit rather
// than inventing a new submission/review/approval in the target workflow.
const CONFIRMED_TIMING = [
  [1, [2], 'Original client instructions/intake'],
  [3, [4, 5], 'Original jurisdiction and engagement scope'],
  [11, [12], 'Original factual completeness and gaps assessment'],
  [12, [16, 18], 'Original legal research and merits findings'],
  [15, [12], 'Original factual gaps requiring confirmation'],
  [18, [19], 'User-confirmed component of the originally submitted opinion'],
  [19, [19], 'User-confirmed drafting component of the originally submitted opinion'],
  [20, [19], 'User-confirmed conclusions in the originally submitted opinion'],
  [22, [19], 'User-confirmed qualifications in the originally submitted opinion'],
  [23, [19], 'User-confirmed addressee/scope check of the originally submitted opinion'],
];

function buildTimingPlan(snapshot, users, at = new Date()) {
  const { matter, workflow, template } = snapshot;
  assert(matter && String(matter._id) === CASE_ID && matter.caseNo === 'CASE-2026-00047' && matter.parties === 'RWANDA FARMERS COFFEE COMPANY');
  assert.equal(matter.status, 'Active');
  assert(workflow && String(workflow.templateId) === TEMPLATE_ID && String(template._id) === TEMPLATE_ID);
  assert.equal(workflow.steps.length, 33);
  assert.equal(workflow.steps.filter(step => step.status === 'Completed').length, 15, 'Approval states changed; inspect again');
  const next = clone(workflow);
  const archived = new Map((workflow.archivedSteps || []).filter(step => step.archivedFromTemplate).map(step => [step.stepKey, step]));
  const roles = buildRoleByName(users);
  const changes = [];
  for (const [number, keys, rationale] of [...EQUIVALENTS, ...CONFIRMED_TIMING]) {
    const key = `key_action_${number}`;
    const step = next.steps.find(s => s.stepKey === key);
    assert(step && ['Completed', 'Done'].includes(step.status), `Review changed lifecycle for ${key}`);
    const sources = keys.map(n => archived.get(`key_action_${n}`));
    assert(sources.every(s => s?.status === 'Completed' && s.startAt && s.dueAt && s.doneAt && s.submittedAt), `Missing original timing evidence for ${key}`);
    const earliest = field => new Date(Math.min(...sources.map(s => +new Date(s[field]))));
    const latest = field => new Date(Math.max(...sources.map(s => +new Date(s[field]))));
    const timing = { sourceTemplateId: OLD_TEMPLATE_ID, sourceStepKeys: sources.map(s => s.stepKey),
      startAt: earliest('startAt'), dueAt: latest('dueAt'), doneAt: latest('doneAt'), submittedAt: latest('submittedAt'), recordedAt: new Date(at) };
    if (step.carriedWork) {
      for (const field of ['sourceTemplateId', 'sourceStepKeys', 'startAt', 'dueAt', 'doneAt', 'submittedAt']) assert.deepEqual(step.carriedWork[field], timing[field], 'Existing source timing differs; inspect before changing it');
      continue;
    }
    const before = clone(step);
    step.carriedWork = timing;
    step.startAt = timing.startAt; step.dueAt = timing.dueAt;
    if (step.status === 'Done') {
      assert(!step.submittedAt && !step.reviewedAt && !step.completedAt, 'Pending target-workflow reviews remain unrecorded');
      step.doneAt = timing.doneAt;
      const attribution = resolveTpaAttribution(matter, step, 'Initiator');
      assert(attribution.name && attribution.at);
      const snapshots = clone(step.tpaSnapshots || []);
      if (!findAppliedTpa(snapshots, attribution.name, 'Initiator', attribution.at)) {
        const originalRate = sources.flatMap(s => s.tpaSnapshots || []).find(tpa =>
          tpa.assignmentRole === 'Initiator' && tpa.staffKey === baseMemberName(attribution.name) && +new Date(tpa.activityAt) === +attribution.at);
        const resolved = resolveMemberTpa(attribution.name, roles, attribution.at);
        assert(originalRate || resolved.source !== 'none', 'No applicable original activity rate');
        snapshots.push(originalRate ? clone(originalRate) : { staffKey: baseMemberName(attribution.name), staffName: attribution.name,
          assignmentRole: 'Initiator', activityAt: attribution.at, rate: resolved.tpaPercent, recordedAt: new Date(at) });
      }
      step.tpaSnapshots = snapshots;
    } else {
      for (const field of ['doneAt', 'submittedAt', 'reviewedAt', 'completedAt', 'tpaSnapshots']) assert.deepEqual(step[field], before[field], `Existing approval ${key}.${field} must remain unchanged`);
    }
    changes.push({ key, rationale, sourceKeys: timing.sourceStepKeys, oldTiming: { startAt: before.startAt, dueAt: before.dueAt, doneAt: before.doneAt }, originalTiming: timing });
  }
  assert.equal(new Set([...EQUIVALENTS, ...CONFIRMED_TIMING].map(([number]) => number)).size, 25);
  if (changes.length) { next.updatedAt = new Date(at); next.__v = (next.__v || 0) + 1; }
  const taskChanges = snapshot.tasks.filter(task => changes.some(change => change.key === task.workflowStepKey)).map(task => {
    const step = next.steps.find(s => s.stepKey === task.workflowStepKey);
    return { id: task._id, startDate: new Date(step.startAt).toISOString(), dueDate: new Date(step.dueAt).toISOString() };
  });
  return { next, changes, taskChanges, at: new Date(at) };
}

const getUsers = (db, session) => db.collection('users').find({}, { ...(session ? { session } : {}), projection: { name: 1, role: 1, tpaHistory: 1 } }).sort({ _id: 1 }).toArray();

async function repairTiming(db, { apply = false, at = new Date() } = {}) {
  const before = await readSnapshot(db);
  const users = await getUsers(db);
  const plan = buildTimingPlan(before, users, at);
  const summary = { caseNo: before.matter.caseNo, timingRecords: plan.changes.length, pendingReviews: plan.next.steps.filter(step => step.status === 'Done').length,
    approvedProgress: before.matter.workflowProgress.percent, originalSubmissionDates: [...new Set(plan.changes.map(change => change.originalTiming.submittedAt.toISOString().slice(0,10)))].sort() };
  if (!apply || !plan.changes.length) return { applied: false, alreadyCorrect: !plan.changes.length, ...summary };
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `coffee-timing-before-${Date.now()}.ejson`), EJSON.stringify(before, null, 2));
  const session = await mongoose.startSession(); let repairId;
  try {
    await session.withTransaction(async () => {
      assert.equal(guard(await readSnapshot(db, session)), guard(before), 'Matter changed concurrently; no timing correction applied');
      assert.equal(hash(await getUsers(db, session)), hash(users), 'Staff activity rates changed concurrently');
      repairId = new mongoose.Types.ObjectId();
      await db.collection('caseworkflowrepairs').insertOne({ _id: repairId, caseId: before.matter._id, kind: 'original-work-timing-restored',
        createdAt: plan.at, before, changes: plan.changes,
        confirmation: 'User requested original workflow submission times and deadline outcomes be carried into the Legal Opinion workflow; approval states are unchanged',
      }, { session });
      const wfResult = await db.collection('workflowinstances').replaceOne({ _id: before.workflow._id, caseId: before.matter._id,
        updatedAt: before.workflow.updatedAt, __v: before.workflow.__v }, plan.next, { session });
      assert.equal(wfResult.modifiedCount, 1);
      if (plan.taskChanges.length) {
        const taskResult = await db.collection('tasks').bulkWrite(plan.taskChanges.map(task => ({ updateOne: {
          filter: { _id: task.id, caseId: before.matter._id }, update: { $set: { startDate: task.startDate, dueDate: task.dueDate } },
        } })), { session });
        assert.equal(taskResult.matchedCount, plan.taskChanges.length);
      }
      await db.collection('auditlogs').insertOne({ caseId: before.matter._id, actorName: 'User-authorized original timing correction',
        action: 'WORKFLOW_TEMPLATE_ALIGNED', message: 'Restored original workflow work/submission timing and deadlines; review and approval states preserved',
        detail: JSON.stringify({ repairId: String(repairId), changes: plan.changes }), createdAt: plan.at }, { session });
      const check = await readSnapshot(db, session);
      assert.deepEqual(check.workflow, plan.next);
      assert.deepEqual(check.matter, before.matter, 'Case progress and assignees must remain unchanged');
      assert.deepEqual(check.template, before.template);
      assert.deepEqual(check.ledger, before.ledger, 'Existing financial snapshots must not be rewritten');
      const expectedTasks = clone(before.tasks);
      for (const update of plan.taskChanges) Object.assign(expectedTasks.find(task => String(task._id) === String(update.id)), { startDate: update.startDate, dueDate: update.dueDate });
      assert.deepEqual(check.tasks, expectedTasks, 'Only task timing fields may change');
      assert.deepEqual(check.workflow.archivedSteps, before.workflow.archivedSteps);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', wtimeoutMS: 15000 }, maxCommitTimeMS: 15000 });
  } finally { await session.endSession(); }
  const after = await readSnapshot(db);
  assert.deepEqual(after.workflow, plan.next, 'Committed timing read-back must match');
  fs.writeFileSync(path.join(folder, `coffee-timing-after-${Date.now()}.ejson`), EJSON.stringify(after, null, 2));
  return { applied: true, repairId: String(repairId), ...summary };
}

module.exports = { buildTimingPlan, repairTiming, CONFIRMED_TIMING };
if (require.main === module) (async () => {
  await connect();
  try { console.log(JSON.stringify(await repairTiming(mongoose.connection.db, { apply: process.argv.includes('--apply') }))); }
  finally { await mongoose.disconnect(); }
})().catch(error => { console.error(String(error.message).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[database connection redacted]')); process.exitCode = 1; });
