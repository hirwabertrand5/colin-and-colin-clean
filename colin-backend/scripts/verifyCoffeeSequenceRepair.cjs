/** Run the scoped data repair and sequential tick guard on a disposable local database. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { EJSON } = require('bson');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { buildPlan, repair } = require('./repairCoffeeSequence.cjs');
const { readSnapshot, CASE_ID } = require('./inspectCoffeeSequence.cjs');
const { isStepWorkDone } = require('../dist/models/workflowInstanceModel');
const { orderWorkflowSteps } = require('../dist/utils/workflowSchedule');

async function main() {
  const folder = path.resolve(__dirname, '../.local-operations');
  const file = fs.readdirSync(folder).filter(name => name.startsWith('coffee-sequence-inspection-')).sort().at(-1);
  assert(file, 'Requires the read-only current sequence inspection');
  const source = EJSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
  const users = [
    { _id: new mongoose.Types.ObjectId(), name: 'Chance', role: 'trainee_associate', tpaHistory: [] },
    { _id: new mongoose.Types.ObjectId(), name: 'Xavier', role: 'senior_associate', tpaHistory: [] },
    { _id: new mongoose.Types.ObjectId(), name: 'Managing Partner', role: 'managing_director', tpaHistory: [] },
  ].map((user, i) => ({ ...user, email: `sequence-${i}@isolated.invalid`, isActive: true, passwordHash: 'test-only' }));
  const at = new Date();
  const plan = buildPlan(source, users, at);
  assert.deepEqual(plan.gaps.map(gap => gap.key), [1,3,11,12,15,18,19,20,22,23].map(n => `key_action_${n}`));
  assert.equal(plan.approvedProgress, 55.5);
  assert.equal(plan.nextWorkKey, 'key_action_26');
  for (const gap of plan.gaps) {
    const step = plan.next.steps.find(s => s.stepKey === gap.key);
    assert.equal(step.status, 'Done'); assert.equal(+step.doneAt, +at);
    assert(!step.submittedAt && !step.reviewedAt && !step.completedAt, 'No unrecorded submission or approval may be manufactured');
    assert(step.tpaSnapshots.some(tpa => tpa.assignmentRole === 'Initiator' && +tpa.activityAt === +at));
  }
  delete process.env.MONGO_URI; delete process.env.MONGODB_URI; delete process.env.RESEND_API_KEY;
  process.env.NOTIFICATION_EMAIL_ENABLED = 'false'; process.env.JWT_SECRET = 'isolated-sequence-repair-test-only';
  const binary = path.resolve(__dirname, '../node_modules/.cache/mongodb-memory-server/test-mongod.exe');
  assert(fs.existsSync(binary), 'Uses only the existing local MongoDB binary');
  const replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: binary },
    replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 120000 }] });
  let server;
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'coffee_sequence_repair_test', autoCreate: false, autoIndex: false, compressors: ['zlib'] });
    const db = mongoose.connection.db;
    for (const [name, records] of Object.entries({ cases: [source.matter], workflowinstances: [source.workflow], workflowtemplates: [source.template],
      tasks: source.tasks, staffearningsledgers: source.ledger, users })) {
      if (records.length) await db.collection(name).insertMany(records);
    }
    await db.collection('invoices').insertOne({ caseId: source.matter._id, invoiceNo: 'SEQUENCE-ISOLATED', amount: 300000, status: 'Paid', paidAt: new Date('2026-10-30') });
    const sentinel = { _id: new mongoose.Types.ObjectId(), caseNo: 'UNRELATED', status: 'Active', parties: 'Other matter' };
    await db.collection('cases').insertOne(sentinel);
    const preview = await repair(db);
    assert.equal(preview.applied, false);
    assert.deepEqual((await readSnapshot(db)).workflow, source.workflow, 'Preview is read-only');
    await assert.rejects(repair(db, { apply: true, confirmed: false }), /confirmation/);
    const applied = await repair(db, { apply: true, confirmed: true, at });
    assert(applied.applied);
    const after = await readSnapshot(db);
    const ordered = orderWorkflowSteps(after.workflow.steps, after.template);
    assert(ordered.slice(0, 25).every(isStepWorkDone));
    assert(ordered.slice(25).every(step => !isStepWorkDone(step)), 'Later work remains unticked');
    assert.equal(after.matter.workflowProgress.currentStepKey, 'key_action_26');
    assert.equal(after.matter.workflowProgress.percent, 55.5);
    assert.deepEqual(after.matter.caseAssignments, source.matter.caseAssignments);
    assert.deepEqual(after.ledger, source.ledger);
    assert.deepEqual(after.tasks, source.tasks);
    assert.deepEqual(after.template, source.template);
    assert.deepEqual(after.workflow.archivedSteps, source.workflow.archivedSteps);
    assert.deepEqual(await db.collection('cases').findOne({ _id: sentinel._id }), sentinel);
    assert.equal(await db.collection('caseworkflowrepairs').countDocuments(), 1);
    assert.equal(await db.collection('auditlogs').countDocuments(), 10);
    assert((await repair(db, { apply: true, confirmed: true })).alreadyCorrect, 'Repeat operation must not alter timestamps or create more audit records');
    assert.equal(await db.collection('auditlogs').countDocuments(), 10);

    // Verify the real endpoint now unlocks the next work action, while it
    // continues to reject attempts to skip an untouched later action.
    const app = require('../dist/app').default;
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}/api/workflows/cases/${CASE_ID}/steps`;
    const token = jwt.sign({ id: String(users[2]._id) }, process.env.JWT_SECRET);
    const tick = async number => {
      const response = await fetch(`${origin}/key_action_${number}/complete`, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await tick(27)).status, 409, 'Action 27 must still wait for action 26');
    const next = await tick(26);
    assert.equal(next.status, 200, next.body.message);
    assert.equal(next.body.steps.find(step => step.stepKey === 'key_action_26').status, 'Done');
    assert.equal((await tick(27)).status, 200, 'The next action unlocks immediately after ticking its predecessor');
    console.log('PASS: 10 gaps repaired as Done; actions 1–25 sequentially ticked, 26 next, approvals/progress/assignees/history/ledger unchanged, shared template and unrelated matter untouched, audit/backup retained, repeat protection and real HTTP sequence guard passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect(); await replica.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
