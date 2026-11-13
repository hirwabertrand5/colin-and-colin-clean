/** Isolated original comparison, task lifecycle alignment and audit-restart verification. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { EJSON } = require('bson');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { finalize, buildFinalPlan } = require('./finalizeCoffeeWorkflow.cjs');
const { readSnapshot, CASE_ID } = require('./inspectCoffeeSequence.cjs');
const { classifyWorkflowWork, summarizeWorkflowWork } = require('../dist/utils/workflowWorkTime');

async function main() {
  const folder = path.resolve(__dirname, '../.local-operations');
  const file = fs.readdirSync(folder).filter(name => name.startsWith('coffee-timing-after-')).sort().at(-1);
  assert(file, 'Requires the prior timing correction snapshot');
  const source = EJSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
  const audit = [{ _id: new mongoose.Types.ObjectId(), caseId: source.matter._id, actorName: 'Original actor', action: 'CASE_CREATED', message: 'Before reset', createdAt: new Date('2026-10-30') },
    { _id: new mongoose.Types.ObjectId(), caseId: source.matter._id, actorName: 'Original actor', action: 'WORKFLOW_STEP_COMPLETED', message: 'Original work', createdAt: new Date('2026-11-02') }];
  source.audits = audit;
  const plan = buildFinalPlan(source);
  assert.equal(plan.original.submitted, 19); assert.equal(plan.original.onTime, 19); assert.equal(plan.original.late, 0);
  assert.equal(plan.summary.onTime, 25); assert.equal(plan.summary.late, 0);
  assert.equal(plan.summary.readyToSubmit, 10); assert.equal(plan.summary.approved, 15);
  assert.equal(plan.nextWorkKey, 'key_action_26');
  assert.equal(plan.taskChanges.length, 9);
  for (const status of ['Done','Awaiting Review','Awaiting Approval','Completed']) {
    for (const [submitted, result] of [['2026-11-10T11:59:59Z', 'on-time'], ['2026-11-10T12:00:01Z', 'late']]) {
      const step = { status, dueAt: '2026-11-10T12:00Z', carriedWork: { sourceTemplateId: 'old', sourceStepKeys: ['source'],
        submittedAt: submitted, recordedAt: '2026-11-13' }, submittedAt: '2026-11-13T12:00Z', completedAt: '2026-11-14T12:00Z' };
      assert.equal(classifyWorkflowWork(step).outcome, result, `${status}: original timing survives every review phase`);
    }
  }
  const gap = EJSON.parse(EJSON.stringify(source)); gap.workflow.steps[0].status = 'In Progress';
  assert.throws(() => buildFinalPlan(gap), /Sequence still has gaps/);
  console.log('PASS: original 19 on-time submissions, current 25 on-time actions, all lifecycle stages, late handling, sequence guard and 9 task-state discrepancies');
  delete process.env.MONGO_URI; delete process.env.MONGODB_URI; delete process.env.RESEND_API_KEY;
  process.env.NOTIFICATION_EMAIL_ENABLED = 'false'; process.env.JWT_SECRET = 'isolated-finalization-test-only';
  const binary = path.resolve(__dirname, '../node_modules/.cache/mongodb-memory-server/test-mongod.exe'); assert(fs.existsSync(binary));
  const replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: binary }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 120000 }] });
  let server;
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'coffee_finalization', autoIndex: false, autoCreate: false });
    const db = mongoose.connection.db;
    const manager = { _id: new mongoose.Types.ObjectId(), name: 'Managing Partner', role: 'managing_director', email: 'manager@isolated.invalid', isActive: true, passwordHash: 'test-only' };
    for (const [name, docs] of Object.entries({ cases: [source.matter], workflowinstances: [source.workflow], workflowtemplates: [source.template],
      tasks: source.tasks, staffearningsledgers: source.ledger, auditlogs: audit, users: [manager] })) if (docs.length) await db.collection(name).insertMany(docs);
    await db.collection('invoices').insertOne({ caseId: source.matter._id, invoiceNo: 'ISOLATED-FINAL', amount: 300000, status: 'Paid', paidAt: new Date('2026-10-30') });
    const other = { _id: new mongoose.Types.ObjectId(), caseNo: 'UNCHANGED', status: 'Active' };
    const otherAudit = { _id: new mongoose.Types.ObjectId(), caseId: other._id, action: 'CASE_CREATED', actorName: 'Other actor', message: 'Must remain visible', createdAt: new Date() };
    await db.collection('cases').insertOne(other); await db.collection('auditlogs').insertOne(otherAudit);
    assert.equal((await finalize(db)).applied, false);
    await assert.rejects(finalize(db, { apply: true }), /explicitly requested/);
    const result = await finalize(db, { apply: true, resetAudit: true }); assert(result.applied);
    const after = await readSnapshot(db);
    assert.deepEqual(after.workflow, source.workflow); assert.deepEqual(after.matter, source.matter);
    assert.deepEqual(after.ledger, source.ledger); assert.deepEqual(after.template, source.template);
    assert.equal(after.tasks.filter(task => plan.taskChanges.some(change => String(change.id) === String(task._id)) && task.status === 'In Progress').length, 9);
    const visible = await db.collection('auditlogs').find({ caseId: source.matter._id }).toArray();
    assert.equal(visible.length, 1); assert.equal(visible[0].action, 'CASE_AUDIT_RESTARTED');
    const archived = await db.collection('caseauditarchiveentries').find({ caseId: source.matter._id }).sort({ _id: 1 }).toArray();
    assert.equal(archived.length, audit.length);
    for (const original of audit) {
      const saved = archived.find(item => String(item._id) === String(original._id));
      for (const key of Object.keys(original)) assert.deepEqual(saved[key], original[key], `Archived ${key} must be exact`);
    }
    assert.deepEqual(await db.collection('auditlogs').findOne({ _id: otherAudit._id }), otherAudit);
    assert.deepEqual(await db.collection('cases').findOne({ _id: other._id }), other);
    assert.equal(await db.collection('caseauditresets').countDocuments(), 1);

    const app = require('../dist/app').default;
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api/case-management/cases/${CASE_ID}`;
    const headers = { Authorization: `Bearer ${jwt.sign({ id: String(manager._id) }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' };
    for (const [endpoint, expected] of [['request-review','Awaiting Review'], ['request-approval','Awaiting Approval'], ['approve','Completed']]) {
      const response = await fetch(`${base}/${endpoint}`, { method: 'POST', headers, body: JSON.stringify({ stepKey: 'key_action_1' }) });
      const state = await response.json(); assert.equal(response.status, 200, state.message);
      const step = state.steps.find(step => step.stepKey === 'key_action_1');
      assert.equal(step.status, expected); assert.equal(step.timing.outcome, 'on-time');
      assert.equal(+new Date(step.timing.at), +new Date(source.workflow.steps[0].carriedWork.submittedAt));
      const summary = summarizeWorkflowWork(state.steps);
      assert.equal(summary.onTime, 25); assert.equal(summary.late, 0);
    }
    const future = await db.collection('auditlogs').find({ caseId: source.matter._id }).toArray();
    assert(future.length > 1 && future.some(log => log.action === 'CASE_MANAGEMENT_REQUESTED_REVIEW'), 'New changes must create new visible audit entries normally');
    assert((await finalize(db, { apply: true, resetAudit: true })).alreadyFinalized);
    assert.equal(await db.collection('auditlogs').countDocuments({ caseId: source.matter._id }), future.length, 'Retry must not clear new audit history');
    console.log('PASS: transactional audit archive/restart, exact case scope, 9 task corrections, preserved work/finance, source timing through real review/approval endpoints, new audit events and retry protection');
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await replica.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
