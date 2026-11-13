/** Verify source approval carryover, score bands and financial consistency in isolated MongoDB only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { EJSON } = require('bson');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { buildPlan, completeCarryover } = require('./completeCoffeeCarryover.cjs');
const { readSnapshot, CASE_ID } = require('./inspectCoffeeSequence.cjs');
const { classifyWorkflowWork, timelinessBand, scoreWorkflowTimeliness } = require('../dist/utils/workflowWorkTime');
const { computeStepWorkTimelinessScore } = require('../dist/utils/caseEarnedFees');

async function main() {
  const folder = path.resolve(__dirname, '../.local-operations');
  const file = fs.readdirSync(folder).filter(name => name.startsWith('coffee-full-comparison-')).sort().at(-1); assert(file);
  const source = EJSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
  const plan = buildPlan(source);
  assert.equal(plan.restored.length, 10); assert.equal(plan.progress.percent, 81.5);
  assert.equal(plan.next.currentStepKey, 'key_action_26');
  assert(plan.next.steps.slice(0,25).every(step => step.status === 'Completed' && step.submittedAt && step.reviewedAt && step.completedAt));
  assert.equal(plan.next.steps[25].status, 'In Progress');
  assert(plan.next.steps.slice(26).every(step => step.status === 'Not Started'));
  const originals = new Map(source.workflow.archivedSteps.map(step => [step.stepKey, step]));
  for (const step of plan.next.steps.slice(0,25)) {
    const old = source.workflow.steps.find(item => item.stepKey === step.stepKey);
    assert.equal(computeStepWorkTimelinessScore(step), computeStepWorkTimelinessScore(old));
    if (old.status === 'Done') {
      for (const field of ['submittedAt','reviewedAt','completedAt']) assert.equal(+new Date(step[field]), Math.max(...step.carriedWork.sourceStepKeys.map(key => +new Date(originals.get(key)[field]))));
    } else {
      for (const field of ['submittedAt','reviewedAt','completedAt','tpaSnapshots']) assert.deepEqual(step[field], old[field]);
    }
  }
  for (const [score,color] of [[100,'blue'],[75,'blue'],[74,'green'],[45,'green'],[44,'yellow'],[15,'yellow'],[14,'red'],[0,'red'],[null,'gray']]) assert.equal(timelinessBand(score).color, color);
  assert.equal(scoreWorkflowTimeliness({ startAt: '2026-11-01T12:00Z', dueAt: '2026-11-02T12:00Z' }, new Date('invalid')), null);
  assert.equal(plan.colors.red, 11, 'The original opinion work has a 14% score and must be red');
  assert.equal(plan.colors.blue, 11); assert.equal(plan.colors.green, 3);
  const wrong = EJSON.parse(EJSON.stringify(source)); wrong.workflow.archivedSteps.find(step => step.stepKey === 'key_action_19').reviewedAt = undefined;
  assert.throws(() => buildPlan(wrong), /original approval chain/);
  console.log('PASS: 10 approvals restored from actual original records, scores unchanged, percentage boundaries, 14% red, standard-weight progress 81.5% and later work preserved');

  delete process.env.MONGO_URI; delete process.env.MONGODB_URI; delete process.env.RESEND_API_KEY;
  process.env.NOTIFICATION_EMAIL_ENABLED = 'false'; process.env.JWT_SECRET = 'isolated-approved-carryover-only';
  const binary = path.resolve(__dirname, '../node_modules/.cache/mongodb-memory-server/test-mongod.exe'); assert(fs.existsSync(binary));
  const replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: binary }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 120000 }] });
  let server;
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'coffee_approved_test', autoCreate: false, autoIndex: false });
    const db = mongoose.connection.db;
    const manager = { _id: new mongoose.Types.ObjectId(), name: 'Managing Partner', role: 'managing_director', email: 'manager@approved.invalid', isActive: true, passwordHash: 'test-only' };
    const users = [...new Map(source.ledger.map(row => [row.staffKey, { _id: new mongoose.Types.ObjectId(), name: row.staffName, role: row.systemRole, email: `${row.staffKey.replace(/\s/g,'')}@approved.invalid`, isActive: true, passwordHash: 'test-only' }])).values()];
    const managerIndex = users.findIndex(user => user.name === manager.name); if (managerIndex >= 0) users[managerIndex] = manager; else users.push(manager);
    for (const [name,docs] of Object.entries({ cases: [source.matter], workflowinstances: [source.workflow], workflowtemplates: [source.template], tasks: source.tasks, staffearningsledgers: source.ledger, users })) if (docs.length) await db.collection(name).insertMany(docs);
    await db.collection('invoices').insertOne({ caseId: source.matter._id, invoiceNo: 'ISOLATED-APPROVED', amount: 300000, status: 'Paid', paidAt: new Date('2026-10-30') });
    const other = { _id: new mongoose.Types.ObjectId(), caseNo: 'UNCHANGED', status: 'Active' };
    await db.collection('cases').insertOne(other);
    assert.equal((await completeCarryover(db)).applied, false);
    assert.deepEqual((await readSnapshot(db)).workflow, source.workflow);
    const result = await completeCarryover(db, { apply: true }); assert(result.applied);
    const after = await readSnapshot(db);
    assert.equal(after.workflow.steps.filter(step => step.status === 'Completed').length, 25);
    assert.equal(after.matter.workflowProgress.percent, 81.5); assert.equal(after.matter.workflowProgress.completedValue.amount, 244500);
    assert.equal(after.matter.workflowProgress.currentStepKey, 'key_action_26');
    assert.deepEqual(after.matter.caseAssignments, source.matter.caseAssignments);
    assert.equal(after.matter.assignedTo, source.matter.assignedTo);
    assert.deepEqual(after.workflow.archivedSteps, source.workflow.archivedSteps);
    assert.deepEqual(after.template, source.template);
    assert.deepEqual(await db.collection('cases').findOne({ _id: other._id }), other);
    assert.equal(after.tasks.filter(task => task.status === 'Completed').length, 25);
    assert(after.tasks.filter(task => task.status === 'Completed').every(task => task.approvedAt && task.taskStages.every(stage => stage.status === 'Completed')));
    for (const old of source.ledger.filter(row => row.workflowMigrationId)) assert.deepEqual(after.ledger.find(row => String(row._id) === String(old._id)), old);
    assert(result.ledger.activeRows > 0);
    // The batch write must be exactly equivalent to the normal production
    // snapshot path, including frozen TPA rates and each action's earned fees.
    const { snapshotCaseEarnings } = require('../dist/services/earningSnapshotService');
    const ledgerBeforeNormalSnapshot = await db.collection('staffearningsledgers').find().sort({ _id: 1 }).toArray();
    await snapshotCaseEarnings(source.matter._id);
    assert.deepEqual(await db.collection('staffearningsledgers').find().sort({ _id: 1 }).toArray(), ledgerBeforeNormalSnapshot, 'Normal snapshot must be idempotent after reconciliation');
    assert((await completeCarryover(db, { apply: true })).alreadyCorrect);
    assert.equal(await db.collection('caseworkflowrepairs').countDocuments({ kind: 'original-approval-chain-restored' }), 1);

    const app = require('../dist/app').default;
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const headers = { Authorization: `Bearer ${jwt.sign({ id: String(manager._id) }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' };
    const state = await (await fetch(`${base}/case-management/cases/${CASE_ID}`, { headers })).json();
    assert.equal(state.steps.filter(step => step.status === 'Completed').length, 25);
    assert.equal(state.earnedFees.completedPercent, 81.5);
    assert.equal(state.steps[18].timelinessScore, 14); assert.equal(state.steps[18].timing.performance.color, 'red');
    const denied = await fetch(`${base}/case-management/cases/${CASE_ID}/request-review`, { method: 'POST', headers, body: JSON.stringify({ stepKey: 'key_action_1' }) });
    assert.equal(denied.status, 400, 'Already-approved migrated work cannot be submitted for review again');
    const staff = await (await fetch(`${base}/reports/firm?range=all&scope=profitability`, { headers })).json();
    assert(Array.isArray(staff.team), staff.message);
    const fees = state.earnedFees.team.reduce((sum,row) => sum + (row.earnedFee || 0), 0);
    assert(Number.isFinite(fees));
    console.log('PASS: transaction, case-only scope, original approval timestamps, unchanged assignees/templates/history, tasks/progress, exact earnings-engine parity, idempotence and real Case Management API');
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await replica.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
