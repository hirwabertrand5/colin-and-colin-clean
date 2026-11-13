/** User-requested visible audit clear for exactly one matter; preserves archived copies. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { EJSON } = require('bson');
const { connect, CASE_ID } = require('./inspectCoffeeSequence.cjs');
const hash = value => crypto.createHash('sha256').update(EJSON.stringify(value)).digest('hex');
const folder = path.resolve(__dirname, '../.local-operations');

async function read(db, session) {
  const options = session ? { session } : {};
  const id = new mongoose.Types.ObjectId(CASE_ID);
  const matter = await db.collection('cases').findOne({ _id: id }, { ...options, projection: { _id: 1, caseNo: 1, parties: 1 } });
  assert(matter && matter.caseNo === 'CASE-2026-00047' && matter.parties === 'RWANDA FARMERS COFFEE COMPANY', 'Exact requested matter required');
  const logs = await db.collection('auditlogs').find({ caseId: id }, options).sort({ _id: 1 }).toArray();
  return { matter, logs };
}

async function clearAudit(db, { apply = false, requestId } = {}) {
  assert(typeof requestId === 'string' && /^[a-z0-9-]{8,100}$/.test(requestId), 'A distinct request id is required for safe retry');
  const id = new mongoose.Types.ObjectId(CASE_ID);
  const prior = await db.collection('caseauditclearances').findOne({ caseId: id, requestId });
  if (prior) return { applied: false, alreadyClearedForRequest: true, cleared: prior.count, clearedAt: prior.createdAt };
  const before = await read(db);
  if (!apply) return { applied: false, caseNo: before.matter.caseNo, auditRecords: before.logs.length };
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `coffee-audit-clear-backup-${Date.now()}.ejson`);
  fs.writeFileSync(file, EJSON.stringify(before, null, 2));
  assert.equal(hash(EJSON.parse(fs.readFileSync(file, 'utf8'))), hash(before), 'Backup must be readable and complete');
  const session = await mongoose.startSession(); const at = new Date(); let clearanceId;
  try {
    await session.withTransaction(async () => {
      assert.equal(hash(await read(db, session)), hash(before), 'Audit changed concurrently; retry from a fresh read');
      assert(!await db.collection('caseauditclearances').findOne({ caseId: id, requestId }, { session }), 'Request already applied');
      clearanceId = new mongoose.Types.ObjectId();
      await db.collection('caseauditclearances').insertOne({ _id: clearanceId, caseId: id, requestId, createdAt: at,
        count: before.logs.length, reason: 'Explicit user request to clear the visible audit log after removing the timing summary',
        localBackupName: path.basename(file), backupHash: hash(before) }, { session });
      if (before.logs.length) {
        await db.collection('caseauditarchiveentries').insertMany(before.logs.map(log => ({
          ...log, originalAuditId: log._id, clearanceId, archivedAt: at,
        })), { session });
        assert.equal(await db.collection('caseauditarchiveentries').countDocuments({ clearanceId }, { session }), before.logs.length);
        const deleted = await db.collection('auditlogs').deleteMany({ caseId: id, _id: { $in: before.logs.map(log => log._id) } }, { session });
        assert.equal(deleted.deletedCount, before.logs.length);
      }
      assert.equal(await db.collection('auditlogs').countDocuments({ caseId: id }, { session }), 0);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', wtimeoutMS: 15000 }, maxCommitTimeMS: 15000 });
  } finally { await session.endSession(); }
  const remaining = await db.collection('auditlogs').countDocuments({ caseId: id });
  return { applied: true, caseNo: before.matter.caseNo, cleared: before.logs.length, visibleAuditRecords: remaining, clearanceId: String(clearanceId) };
}

module.exports = { clearAudit };
if (require.main === module) (async () => {
  const requestId = process.argv.find(arg => arg.startsWith('--request-id='))?.slice('--request-id='.length);
  await connect();
  try { console.log(JSON.stringify(await clearAudit(mongoose.connection.db, { apply: process.argv.includes('--apply'), requestId }))); }
  finally { await mongoose.disconnect(); }
})().catch(error => { console.error(String(error.message).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[redacted]')); process.exitCode = 1; });
