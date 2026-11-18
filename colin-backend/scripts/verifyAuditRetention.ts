/** Disposable MongoDB only. Never loads .env or production records. */
import assert from 'node:assert/strict';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import AuditLog from '../src/models/auditLogModel';
import User from '../src/models/userModel';
import Case from '../src/models/caseModel';
import { enforceAuditRetention } from '../src/utils/auditRetention';
import { getMyAuditTrail, getRecentAuditFeed } from '../src/controllers/auditFeedController';
import { getAuditForCase } from '../src/controllers/auditController';

async function main() {
  delete process.env.MONGO_URI;
  const replica = await MongoMemoryReplSet.create({
    binary: { version: '7.0.14', systemBinary: path.resolve(__dirname, '../node_modules/.cache/mongodb-memory-server/test-mongod.exe') },
    replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 120000 }],
  });
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'audit_retention_test' });
    const staffA = new mongoose.Types.ObjectId(), staffB = new mongoose.Types.ObjectId(), matterId = new mongoose.Types.ObjectId();
    await User.collection.insertMany([
      { _id: staffA, name: 'Alice', role: 'associate', email: 'alice@retention.invalid' }, { _id: staffB, name: 'Bob', role: 'associate', email: 'bob@retention.invalid' },
    ]);
    await Case.collection.insertOne({ _id: matterId, caseNo: 'TEST', parties: 'Fixture parties' });
    const base = { caseId: matterId, action: 'CASE_UPDATED', message: 'Retention fixture' };
    const fixture = (actorName: string, index: number, actorUserId?: mongoose.Types.ObjectId) => ({
      ...base, _id: new mongoose.Types.ObjectId(), actorName, ...(actorUserId ? { actorUserId } : {}),
      createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, index)),
    });
    const alice = Array.from({ length: 45 }, (_, i) => fixture(i % 2 ? ' Alice ' : 'ALICE', i, i % 3 ? staffA : undefined));
    const bob = Array.from({ length: 25 }, (_, i) => fixture('Bob', i, staffB));
    const system = Array.from({ length: 23 }, (_, i) => fixture('System', i));
    await AuditLog.collection.insertMany([...alice, ...bob, ...system]);
    const preview = await enforceAuditRetention(AuditLog);
    assert.equal(preview.before, 93); assert.equal(preview.wouldDelete, 33); assert.equal(preview.retained, 60);
    assert.equal(await AuditLog.countDocuments(), 93, 'Dry run does not delete');
    const applied = await enforceAuditRetention(AuditLog, true);
    assert.equal(applied.deleted, 33); assert.equal(await AuditLog.countDocuments(), 60);
    const kept = await AuditLog.find({ actorKey: `user:${staffA}` }).sort({ createdAt: -1, _id: -1 }).lean();
    assert.deepEqual(kept.map(row => String(row._id)), alice.slice(-20).reverse().map(row => String(row._id)), 'Exactly the newest 20 survive');
    assert(kept.every(row => String(row.actorUserId) === String(staffA)), 'Legacy name records resolve to staff ID');
    await AuditLog.create({ ...base, actorName: 'Alice', actorUserId: staffA });
    assert.equal(await AuditLog.countDocuments({ actorUserId: staffA }), 20, 'Create prunes old records');
    await new AuditLog({ ...base, actorName: ' alice ' }).save();
    assert.equal(await AuditLog.countDocuments({ actorUserId: staffA }), 20, 'Save resolves name-only actors');
    await AuditLog.insertMany(Array.from({ length: 8 }, () => ({ ...base, actorName: 'Alice', actorUserId: staffA })));
    assert.equal(await AuditLog.countDocuments({ actorUserId: staffA }), 20, 'Bulk insert prunes');
    const beforeAbort = await AuditLog.find({ actorUserId: staffA }).sort({ _id: 1 }).select('_id').lean();
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      await AuditLog.create([{ ...base, actorName: 'Alice', actorUserId: staffA }], { session });
      assert.equal(await AuditLog.countDocuments({ actorUserId: staffA }).session(session), 20);
      await session.abortTransaction();
      assert.deepEqual(await AuditLog.find({ actorUserId: staffA }).sort({ _id: 1 }).select('_id').lean(), beforeAbort, 'Rollback restores pruned records');
      await session.withTransaction(async () => {
        await AuditLog.insertMany(Array.from({ length: 5 }, () => ({ ...base, actorName: 'Bob', actorUserId: staffB })), { session });
        assert.equal(await AuditLog.countDocuments({ actorUserId: staffB }).session(session), 20, 'InsertMany retention uses its transaction');
      });
    } finally { await session.endSession(); }
    await Promise.all(Array.from({ length: 6 }, () => AuditLog.create({ ...base, actorName: 'Alice', actorUserId: staffA })));
    assert.equal(await AuditLog.countDocuments({ actorUserId: staffA }), 20, 'Concurrent writes stay capped');
    const invoke = async (handler: any, query = {}, params = {}) => {
      let body: any, status = 200;
      await handler({ user: { id: String(staffA), name: 'Alice' }, query, params }, {
        status(value: number) { status = value; return this; }, json(value: any) { body = value; return this; },
      });
      assert.equal(status, 200, JSON.stringify(body)); return body;
    };
    const feed = await invoke(getMyAuditTrail, { limit: '200' });
    assert.equal(feed.total, 20); assert.equal(feed.items.length, 20); assert.equal(feed.limit, 20);
    const paged = await invoke(getMyAuditTrail, { limit: '10', page: '999', sortBy: 'action', sortDir: 'asc' });
    assert.equal(paged.page, 2); assert.equal(paged.total, 20);
    assert.equal((await invoke(getRecentAuditFeed, { limit: '200' })).length, 20);
    assert.equal((await invoke(getAuditForCase, {}, { caseId: String(matterId) })).length, 20);
    const rerun = await enforceAuditRetention(AuditLog, true);
    assert.equal(rerun.deleted, 0, 'Retention migration is idempotent');
    console.log('PASS: newest 20 per staff, legacy identities, dry run, save/create/insertMany, transaction commit/rollback, concurrent writes, capped feeds and idempotent cleanup.');
  } finally { await mongoose.disconnect(); await replica.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
