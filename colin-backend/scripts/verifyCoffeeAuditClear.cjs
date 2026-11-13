/** Verify the destructive audit operation's backup/scope/retry behavior locally only. */
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { clearAudit } = require('./clearCoffeeAudit.cjs');
const { CASE_ID } = require('./inspectCoffeeSequence.cjs');

async function main() {
  const binary = path.resolve(__dirname, '../node_modules/.cache/mongodb-memory-server/test-mongod.exe'); assert(fs.existsSync(binary));
  const replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: binary }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 120000 }] });
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'audit_clear_test', autoCreate: false, autoIndex: false });
    const db = mongoose.connection.db, id = new mongoose.Types.ObjectId(CASE_ID);
    const matter = { _id: id, caseNo: 'CASE-2026-00047', parties: 'RWANDA FARMERS COFFEE COMPANY', assignedTo: 'Unchanged', workflowProgress: { percent: 55.5 } };
    const other = { _id: new mongoose.Types.ObjectId(), caseNo: 'OTHER', parties: 'Other matter' };
    await db.collection('cases').insertMany([matter, other]);
    const old = [1,2].map(n => ({ _id: new mongoose.Types.ObjectId(), caseId: id, message: `Old event ${n}`, createdAt: new Date('2026-11-10') }));
    const unrelated = { _id: new mongoose.Types.ObjectId(), caseId: other._id, message: 'Retained' };
    await db.collection('auditlogs').insertMany([...old, unrelated]);
    const requestId = 'isolated-clear-request';
    assert.equal((await clearAudit(db, { requestId })).auditRecords, 2);
    assert.equal(await db.collection('auditlogs').countDocuments({ caseId: id }), 2, 'Preview cannot clear records');
    await assert.rejects(clearAudit(db, { apply: true }), /request id/);
    const result = await clearAudit(db, { apply: true, requestId });
    assert.equal(result.visibleAuditRecords, 0); assert.equal(result.cleared, 2);
    const archived = await db.collection('caseauditarchiveentries').find({ caseId: id }).toArray();
    assert.equal(archived.length, old.length);
    for (const event of old) {
      const saved = archived.find(log => String(log._id) === String(event._id));
      for (const field of Object.keys(event)) assert.deepEqual(saved[field], event[field]);
    }
    assert.deepEqual(await db.collection('cases').findOne({ _id: id }), matter);
    assert.deepEqual(await db.collection('auditlogs').findOne({ _id: unrelated._id }), unrelated);
    const future = { _id: new mongoose.Types.ObjectId(), caseId: id, message: 'New activity' };
    await db.collection('auditlogs').insertOne(future);
    assert((await clearAudit(db, { apply: true, requestId })).alreadyClearedForRequest);
    assert.deepEqual(await db.collection('auditlogs').findOne({ _id: future._id }), future, 'A retry must not erase new activity');
    console.log('PASS: empty visible audit, complete archived backup, exact case scope, unchanged matter and new activity preserved on retry');
  } finally { await mongoose.disconnect(); await replica.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
