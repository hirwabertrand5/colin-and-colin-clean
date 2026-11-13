/** Verify the real scoped conversion on an isolated local replica set only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { EJSON } = require('bson');
const { buildPlan, main } = require('./migrateCoffeeLegalOpinion.cjs');

async function verify() {
  const folder = path.resolve(__dirname, '../.local-operations');
  const file = fs.readdirSync(folder).filter(f => f.startsWith('coffee-workflow-inspection-')).sort().at(-1);
  assert(file, 'Run the read-only inspection first; this test needs the scoped snapshot');
  const source = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
  const plan = buildPlan(source);
  assert.equal(plan.percent, 55.5);
  assert.equal(plan.mappings.length, 15);
  assert.equal(plan.workflow.archivedSteps.length, source.workflows[0].steps.length + (source.workflows[0].archivedSteps || []).length);
  assert.equal(plan.workflow.steps[0].status, 'In Progress', 'Written instructions are not assumed merely from a client interview');
  const conflict = plan.workflow.steps.find(s => s.stepKey === 'key_action_2');
  assert.equal(+new Date(conflict.submittedAt), +new Date(source.workflows[0].steps[0].submittedAt), 'Conflict check maps by meaning, not numeric key');
  assert.equal(plan.workflow.steps.find(s => s.stepKey === 'key_action_11').status, 'Not Started', 'Unproven assumptions work remains unapproved');
  const corrupted = structuredClone(source); corrupted.workflows[0].steps[0].status = 'Not Started';
  assert.throws(() => buildPlan(corrupted), /Completed work changed/);

  const db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: path.resolve(__dirname, '../node_modules/.cache/mongodb-memory-server/test-mongod.exe') },
    replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 120000 }] });
  const oldUri = process.env.MONGO_URI, oldArgv = process.argv;
  try {
    process.env.MONGO_URI = db.getUri('coffee_migration_test');
    mongoose.set('autoIndex', false);
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
    const Case = require('../dist/models/caseModel').default;
    const Workflow = require('../dist/models/workflowInstanceModel').default;
    const Template = require('../dist/models/workflowTemplateModel').default;
    const Task = require('../dist/models/taskModel').default;
    const Ledger = require('../dist/models/staffEarningsLedgerModel').default;
    const cast = (Model, record) => Model.hydrate(record).toObject();
    const collections = { cases: [Case, source.matters], workflowinstances: [Workflow, source.workflows],
      workflowtemplates: [Template, [...source.legalOpinionTemplates, ...source.linkedTemplates]], tasks: [Task, source.tasks], staffearningsledgers: [Ledger, source.ledger] };
    for (const [collection, [Model, records]] of Object.entries(collections)) {
      if (records.length) await mongoose.connection.db.collection(collection).insertMany(records.map(r => cast(Model, r)));
    }
    const id = new mongoose.Types.ObjectId('6ae4aa603303df92c293acad');
    const sentinel = { _id: new mongoose.Types.ObjectId(), caseNo: 'UNCHANGED-SENTINEL', status: 'Active', parties: 'Unrelated matter', assignedTo: 'Unrelated owner' };
    await mongoose.connection.db.collection('cases').insertOne(sentinel);
    const users = [...new Map(source.ledger.map(e => [e.staffKey, { _id: new mongoose.Types.ObjectId(), name: e.staffName, role: e.systemRole,
      email: `${e.staffKey.replace(/\s/g, '')}@migration.invalid`, isActive: true }])).values()];
    await mongoose.connection.db.collection('users').insertMany(users);
    await mongoose.connection.db.collection('invoices').insertOne({ caseId: id, invoiceNo: 'ISOLATED-FIXTURE', amount: 300000, status: 'Paid', paidAt: new Date('2026-10-30') });
    const before = await mongoose.connection.db.collection('cases').findOne({ _id: id });
    const templateBefore = await mongoose.connection.db.collection('workflowtemplates').find().toArray();
    const ledgerBefore = await mongoose.connection.db.collection('staffearningsledgers').find().toArray();
    await mongoose.disconnect();
    process.argv = [process.execPath, __filename, '--apply'];
    await main();
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
    const native = mongoose.connection.db;
    const after = await native.collection('cases').findOne({ _id: id });
    const workflow = await native.collection('workflowinstances').findOne({ caseId: id });
    assert.equal(after.workflow, 'Legal opinion');
    assert.equal(after.workflowProgress.percent, 55.5);
    assert.deepEqual(after.caseAssignments, before.caseAssignments);
    assert.equal(after.assignedTo, before.assignedTo);
    for (const field of ['caseType', 'legalServicePath', 'budget', 'status', 'createdAt', 'assignmentHandoverHistory', 'caseManagement']) assert.deepEqual(after[field], before[field], `${field} preserved`);
    assert.deepEqual(await native.collection('cases').findOne({ _id: sentinel._id }), sentinel, 'Unrelated case unchanged');
    assert.deepEqual(await native.collection('workflowtemplates').find().toArray(), templateBefore, 'All shared templates unchanged');
    assert.equal(workflow.steps.length, 33);
    assert.equal(workflow.steps.filter(s => s.status === 'Completed').length, 15);
    const oldSteps = Workflow.hydrate(source.workflows[0]).toObject().steps;
    for (const original of oldSteps) {
      const archived = workflow.archivedSteps.find(s => s.stepKey === original.stepKey && s.title === original.title);
      assert(archived);
      for (const field of ['status', 'doneAt', 'submittedAt', 'reviewedAt', 'completedAt', 'tpaSnapshots', 'outputs']) assert.deepEqual(archived[field], original[field], `History ${original.stepKey}.${field} preserved`);
    }
    const tasks = await native.collection('tasks').find({ caseId: id }).toArray();
    assert.equal(tasks.length, 33);
    const archivedLedger = await native.collection('staffearningsledgers').find({ workflowMigrationId: { $exists: true } }).toArray();
    assert.equal(archivedLedger.length, ledgerBefore.length);
    for (const old of ledgerBefore) {
      const kept = archivedLedger.find(e => String(e._id) === String(old._id));
      assert(kept);
      for (const field of ['earnedFee', 'completionAt', 'rateActivityAt', 'tpaPercent', 'inputHistory', 'keyActionTitle']) assert.deepEqual(kept[field], old[field], `Original ledger ${field} retained`);
    }
    const activeLedger = await native.collection('staffearningsledgers').find({ workflowMigrationId: { $exists: false } }).toArray();
    assert(activeLedger.length > 0, 'Current workflow gets distinct financial snapshots');
    assert(activeLedger.every(e => workflow.steps.some(s => s.stepKey === e.keyActionKey && s.title === e.keyActionTitle)), 'Active financial rows only reference Legal Opinion actions');
    const { reconcileInstanceTemplateWithCanonical } = require('../dist/controllers/workflowController');
    assert.equal(await reconcileInstanceTemplateWithCanonical(after, workflow, { dryRun: true }), null, 'Opening the case must not restore Labour actions');
    assert.equal(await native.collection('caseworkflowmigrations').countDocuments(), 1);
    assert.equal(await native.collection('auditlogs').countDocuments({ action: 'WORKFLOW_TEMPLATE_ALIGNED' }), 1);
    const retained = EJSON.stringify(await native.collection('cases').findOne({ _id: id }));
    await mongoose.disconnect();
    await assert.rejects(main(), /Expected original Labour workflow/, 'Cannot accidentally apply twice');
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
    assert.equal(EJSON.stringify(await mongoose.connection.db.collection('cases').findOne({ _id: id })), retained);
    console.log('PASS: isolated transactional migration, standard weights, semantic mapping, exact timestamps, all old work/ledger retained, case-only scope, canonical stability and repeat protection');
  } finally {
    process.argv = oldArgv;
    if (oldUri === undefined) delete process.env.MONGO_URI; else process.env.MONGO_URI = oldUri;
    await mongoose.disconnect(); await db.stop();
  }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
