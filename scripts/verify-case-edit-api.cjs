/** Real case handlers against a disposable local database. Never reads MONGO_URI. */
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { existsSync } = require('node:fs');
const path = require('node:path');
const express = require('../colin-backend/node_modules/express');
const mongoose = require('../colin-backend/node_modules/mongoose');
const { MongoMemoryReplSet } = require('../colin-backend/node_modules/mongodb-memory-server');
const { createCase, getCaseById, updateCase } = require('../colin-backend/dist/controllers/caseController');
const Case = require('../colin-backend/dist/models/caseModel').default;
const Template = require('../colin-backend/dist/models/workflowTemplateModel').default;
const Workflow = require('../colin-backend/dist/models/workflowInstanceModel').default;
const Audit = require('../colin-backend/dist/models/auditLogModel').default;

async function main() {
  delete process.env.RESEND_API_KEY;
  const binary = path.resolve(__dirname, '../colin-backend/node_modules/.cache/mongodb-memory-server/test-mongod.exe');
  assert(existsSync(binary), 'Provide the cached test-mongod.exe to run this isolated verification.');
  console.log('Starting isolated test replica set...');
  const db = await MongoMemoryReplSet.create({ binary: { systemBinary: binary, version: '7.0.14' }, instanceOpts: [{ launchTimeout: 120000 }], replSet: { count: 1, storageEngine: 'wiredTiger' } });
  let server;
  try {
    await mongoose.connect(db.getUri(), { dbName: 'case_edit_verification' });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { name: 'Verification Partner', role: 'managing_partner' }; next(); });
    app.post('/cases', createCase);
    app.get('/cases/:id', getCaseById);
    app.put('/cases/:id', updateCase);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (url, body, method = body ? 'PUT' : 'GET') => {
      const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    };
    const legalServicePath = [
      { id: 'dispute_resolution', label: 'A. Dispute Resolution' },
      { id: 'litigation', label: 'Litigation' },
      { id: 'civil_litigation', label: 'Civil Litigation' },
      { id: 'debt_recovery_enforcement', label: 'Debt recovery & enforcement' },
    ];
    const template = await Template.create({ name: 'Debt recovery verification', matterType: 'DEBT RECOVERY', caseType: 'Litigation Cases',
      stages: [{ key: 'recovery', title: 'Recovery', order: 1, percentage: 100 }],
      steps: [{ key: 'letter', title: 'Deliver the LBA', stageKey: 'recovery', order: 1, percentage: 100, actions: ['Send letter'], sla: { days: 7 } }],
    });
    const created = await request('/cases', { caseNo: 'TEST-EDIT-001', parties: 'Synthetic client', caseType: 'Litigation Cases', assignedTo: 'Verification Initiator',
      workflowTemplateId: String(template._id), workflowStartDate: '2026-11-01', budget: '600000', legalServicePath }, 'POST');
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const url = '/cases/' + created.data._id;
    assert.deepEqual((await request(url)).data.legalServicePath, legalServicePath);
    console.log('PASS: creation and fetch preserve the entire classification.');

    const workflowBefore = JSON.parse(JSON.stringify(await Workflow.findOne({ caseId: created.data._id }).lean()));
    const edited = await request(url, { description: 'Updated case summary' });
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    assert.equal(edited.data.description, 'Updated case summary');
    assert.deepEqual(edited.data.legalServicePath, legalServicePath);
    assert.equal(edited.data.workflowTemplateId, String(template._id));
    assert.deepEqual(JSON.parse(JSON.stringify(await Workflow.findOne({ caseId: created.data._id }).lean())), workflowBefore);
    console.log('PASS: saving editable details preserves classification, workflow, and steps.');

    assert.equal((await request(url, { legalServicePath, description: 'Round-trip unchanged path' })).status, 200);
    for (const changed of [[], null, legalServicePath.slice(0, 3), [...legalServicePath].reverse(), legalServicePath.map((item, index) => index === 3 ? { ...item, label: 'Different label' } : item), legalServicePath.map((item, index) => index === 3 ? { ...item, id: 'different_service' } : item)]) {
      const denied = await request(url, { legalServicePath: changed, description: 'Must not persist' });
      assert.equal(denied.status, 400);
      assert.match(denied.data.message, /Classification is locked/);
    }
    const after = (await request(url)).data;
    assert.equal(after.description, 'Round-trip unchanged path');
    assert.deepEqual(after.legalServicePath, legalServicePath);
    const audits = await Audit.find({ caseId: created.data._id }).lean();
    assert(!audits.some(item => String(item.detail).includes('Legal service classification updated')));
    console.log('PASS: unchanged paths remain compatible; changes, removals, reordering, and forged labels are rejected atomically.');

    for (const payload of [{ $set: { legalServicePath: [] } }, { $unset: { legalServicePath: 1 } }, { 'legalServicePath.3.label': 'Changed' }]) {
      assert.equal((await request(url, payload)).status, 400);
    }
    const templateChange = await request(url, { workflowTemplateId: String(new mongoose.Types.ObjectId()) });
    assert.equal(templateChange.status, 400);
    assert.match(templateChange.data.message, /workflow template is locked/);
    console.log('PASS: operator updates cannot bypass the lock; existing workflow lock remains enforced.');

    const legacy = await Case.create({ caseNo: 'TEST-LEGACY', parties: 'Historical client', caseType: 'Litigation Cases', assignedTo: 'Verification Initiator' });
    const legacyUrl = '/cases/' + legacy._id;
    assert.equal((await request(legacyUrl, { description: 'Legacy edit', legalServicePath: [] })).status, 200);
    assert.equal((await request(legacyUrl, { legalServicePath })).status, 400);
    const adopted = await request(legacyUrl, { workflowTemplateId: String(template._id) });
    assert.equal(adopted.status, 200, JSON.stringify(adopted.data));
    assert.equal(adopted.data.workflowTemplateId, String(template._id));
    assert.deepEqual(adopted.data.legalServicePath, []);
    console.log('PASS: legacy cases can be edited and adopt a workflow without changing their saved classification.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    await db.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
