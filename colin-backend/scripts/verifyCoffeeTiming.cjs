/** Verify original timing, result colours and case-only persistence on local disposable MongoDB. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const { once } = require('node:events');
const { buildSync } = require('../../node_modules/esbuild');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { EJSON } = require('bson');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { buildTimingPlan, repairTiming } = require('./repairCoffeeTiming.cjs');
const { readSnapshot, CASE_ID } = require('./inspectCoffeeSequence.cjs');
const { resolveStepWorkTimeWithSource, computeStepWorkTimelinessScore } = require('../dist/utils/caseEarnedFees');
const { resolveWorkflowWorkTime, parseWorkTimestamp } = require('../dist/utils/workflowWorkTime');
const { buildUpdatedInstanceSteps } = require('../dist/controllers/workflowController');
const { alignInstanceStepsToTemplate } = require('../dist/utils/workflowAlignment');

const built = buildSync({ entryPoints: [path.resolve(__dirname, '../../src/utils/workflowDeadline.ts')], bundle: true, format: 'cjs', platform: 'node', write: false });
const browserModule = new Module(__filename, module);
browserModule._compile(built.outputFiles[0].text, __filename);
const { getKeyActionDeadlineClock, getUrgencyClass } = browserModule.exports;
const stringify = value => EJSON.stringify(value);

async function main() {
  const folder = path.resolve(__dirname, '../.local-operations');
  const file = fs.readdirSync(folder).filter(name => name.startsWith('coffee-sequence-inspection-')).sort().at(-1);
  assert(file, 'Requires a fresh scoped inspection');
  const source = EJSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
  const users = [{ name: 'Chance', role: 'trainee_associate' }, { name: 'Xavier', role: 'senior_associate' }, { name: 'Managing Partner', role: 'managing_director' }]
    .map((user, i) => ({ ...user, _id: new mongoose.Types.ObjectId(), email: `timing-${i}@isolated.invalid`, isActive: true, passwordHash: 'test-only' }));
  const at = new Date();
  const plan = buildTimingPlan(source, users, at);
  assert.equal(plan.changes.length, 25);
  for (const change of plan.changes) {
    const step = plan.next.steps.find(step => step.stepKey === change.key);
    const backend = resolveStepWorkTimeWithSource(step);
    assert.equal(+backend.at, +change.originalTiming.submittedAt);
    const clock = getKeyActionDeadlineClock(step, new Date('2030-01-01'));
    assert.equal(+clock.finishedAt, +backend.at);
    assert.equal(clock.countdown, 'Done on time'); assert.equal(clock.color, 'green');
    assert(computeStepWorkTimelinessScore(step) !== null);
    assert.equal(step.status, source.workflow.steps.find(s => s.stepKey === step.stepKey).status);
  }
  const due = '2026-11-10T12:00:00Z';
  const boundary = { status: 'Completed', dueAt: due, doneAt: '2026-11-10T10:00:00Z', submittedAt: '2026-11-10T11:00:00Z', completedAt: '2026-11-15T12:00:00Z' };
  assert.equal(getKeyActionDeadlineClock(boundary).color, 'green', 'Last-48-hours warning cannot colour on-time completed work red');
  assert.equal(getKeyActionDeadlineClock({ ...boundary, submittedAt: due }).countdown, 'Done on time');
  const late = getKeyActionDeadlineClock({ ...boundary, submittedAt: '2026-11-10T12:00:01Z' });
  assert.equal(late.color, 'red'); assert.equal(late.countdown, 'Done <1m late', 'Submission, not an earlier checkbox or later approval, determines the result');
  const unknown = getKeyActionDeadlineClock({ status: 'Done', dueAt: due }, new Date('2030-01-01'));
  assert.equal(unknown.color, 'gray'); assert.equal(unknown.countdown, 'Completion time unavailable');
  assert.equal(getKeyActionDeadlineClock({ status: 'In Progress', dueAt: due }, new Date('2026-11-10T11:00Z')).color, 'red', 'Open deadline warnings remain unchanged');
  assert.equal(parseWorkTimestamp('2026-11-10T00:00:00Z').toISOString(), '2026-11-10T00:00:00.000Z');
  assert.equal(+parseWorkTimestamp(new Date('2026-11-10T00:00Z')), +new Date('2026-11-10T00:00Z'));
  assert.equal(+resolveWorkflowWorkTime({ actions: [{ done: true, doneAt: '2026-11-10T10:00Z' }, { done: true, doneAt: '2026-11-10T11:00Z' }] }).at, +new Date('2026-11-10T11:00Z'));
  for (const sync of [buildUpdatedInstanceSteps(plan.next.steps, source.template, new Date(source.matter.createdAt)),
    alignInstanceStepsToTemplate(plan.next.steps, source.template, new Date(source.matter.createdAt)).steps]) {
    for (const step of sync.filter(step => step.carriedWork)) {
      const original = plan.next.steps.find(item => item.stepKey === step.stepKey);
      assert.equal(+new Date(step.dueAt), +new Date(original.dueAt), 'Template sync must not overwrite a finished action deadline');
      assert.deepEqual(step.carriedWork, original.carriedWork);
    }
  }
  console.log('PASS: original submissions match API and browser; on-time/late boundaries, missing times, midnight instants, old checklist fallback and template sync');

  delete process.env.MONGO_URI; delete process.env.MONGODB_URI; delete process.env.RESEND_API_KEY;
  process.env.NOTIFICATION_EMAIL_ENABLED = 'false'; process.env.JWT_SECRET = 'isolated-timing-test-only';
  const binary = path.resolve(__dirname, '../node_modules/.cache/mongodb-memory-server/test-mongod.exe');
  assert(fs.existsSync(binary));
  const replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: binary }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 120000 }] });
  let server;
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'coffee_timing_test', autoCreate: false, autoIndex: false });
    const db = mongoose.connection.db;
    for (const [name, docs] of Object.entries({ cases: [source.matter], workflowinstances: [source.workflow], workflowtemplates: [source.template], tasks: source.tasks, staffearningsledgers: source.ledger, users })) {
      if (docs.length) await db.collection(name).insertMany(docs);
    }
    await db.collection('invoices').insertOne({ caseId: source.matter._id, invoiceNo: 'ISOLATED-TIMING', status: 'Paid', amount: 300000, paidAt: new Date('2026-10-30') });
    const sentinel = { _id: new mongoose.Types.ObjectId(), caseNo: 'UNRELATED', status: 'Active' };
    await db.collection('cases').insertOne(sentinel);
    const before = await readSnapshot(db);
    assert.equal((await repairTiming(db)).applied, false);
    assert.equal(stringify((await readSnapshot(db)).workflow), stringify(before.workflow));
    assert((await repairTiming(db, { apply: true, at })).applied);
    const after = await readSnapshot(db);
    assert.deepEqual(after.matter, before.matter);
    assert.deepEqual(after.ledger, before.ledger);
    assert.deepEqual(after.template, before.template);
    assert.deepEqual(after.workflow.archivedSteps, before.workflow.archivedSteps);
    assert.deepEqual(await db.collection('cases').findOne({ _id: sentinel._id }), sentinel);
    for (const old of before.workflow.steps) {
      const step = after.workflow.steps.find(item => item.stepKey === old.stepKey);
      assert.equal(step.status, old.status);
      for (const field of ['submittedAt', 'reviewedAt', 'completedAt', 'outputs', 'reviewHistory']) assert.deepEqual(step[field], old[field]);
      if (old.status === 'Completed') assert.deepEqual(step.tpaSnapshots, old.tpaSnapshots);
    }
    assert((await repairTiming(db, { apply: true })).alreadyCorrect, 'Retry cannot overwrite the source timing or create duplicate audits');
    assert.equal(await db.collection('caseworkflowrepairs').countDocuments(), 1);
    assert.equal(await db.collection('auditlogs').countDocuments(), 1);
    const Workflow = require('../dist/models/workflowInstanceModel').default;
    const hydrated = await Workflow.findById(source.workflow._id);
    assert.equal(hydrated.steps[0].carriedWork.sourceTemplateId, '6ac7d144aaebe80bd2c9e0ce', 'Mongoose retains the timing evidence');

    const app = require('../dist/app').default;
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}/api`;
    const headers = { Authorization: `Bearer ${jwt.sign({ id: String(users[2]._id) }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' };
    const management = await (await fetch(`${origin}/case-management/cases/${CASE_ID}`, { headers })).json();
    assert.equal(management.steps[0].carriedWork.sourceTemplateId, '6ac7d144aaebe80bd2c9e0ce');
    assert.equal(+new Date(management.steps[0].carriedWork.submittedAt), +plan.next.steps[0].carriedWork.submittedAt);
    const submit = await fetch(`${origin}/case-management/cases/${CASE_ID}/request-review`, { method: 'POST', headers, body: JSON.stringify({ stepKey: 'key_action_1' }) });
    assert.equal(submit.status, 200, await submit.text());
    const resubmitted = await Workflow.findById(source.workflow._id).lean();
    const resubmittedStep = resubmitted.steps.find(step => step.stepKey === 'key_action_1');
    assert.equal(resubmittedStep.status, 'Awaiting Review');
    assert(+new Date(resubmittedStep.submittedAt) >= +at, 'New target submission time stays distinct from historical work');
    assert.equal(+resolveStepWorkTimeWithSource(resubmittedStep).at, +plan.next.steps[0].carriedWork.submittedAt);
    assert.equal(getKeyActionDeadlineClock(resubmittedStep).color, 'green');
    const reopen = await fetch(`${origin}/workflows/cases/${CASE_ID}/steps/key_action_1/reopen`, { method: 'POST', headers, body: '{}' });
    assert.equal(reopen.status, 200, await reopen.text());
    const reopened = await Workflow.findById(source.workflow._id).lean();
    assert(!reopened.steps[0].carriedWork, 'Reopened new work must not inherit the prior work clock');
    console.log('PASS: transactional timing correction, approval/assignment/progress/ledger preservation, audit backups, repeat protection, Case Management API, later submission and reopening');
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await replica.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
