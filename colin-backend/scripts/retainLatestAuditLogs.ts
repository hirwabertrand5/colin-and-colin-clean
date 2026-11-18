/** Only the audit collection is changed; dry run unless --apply is explicit. */
import path from 'node:path';
import { setServers } from 'node:dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import AuditLog from '../src/models/auditLogModel';
import { enforceAuditRetention } from '../src/utils/auditRetention';

async function main() {
  dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  if (!process.env.MONGO_URI) throw new Error('Database connection is not configured.');
  setServers(['8.8.8.8', '1.1.1.1']);
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    const result = await enforceAuditRetention(AuditLog, process.argv.includes('--apply'));
    console.log(JSON.stringify(result));
    if (result.applied) {
      const overLimit = await AuditLog.aggregate([
        { $group: { _id: '$actorKey', count: { $sum: 1 } } }, { $match: { count: { $gt: 20 } } },
        { $count: 'groups' },
      ]);
      console.log(JSON.stringify({ remaining: await AuditLog.countDocuments(), groupsOverLimit: overLimit[0]?.groups || 0 }));
    }
  } finally { await mongoose.disconnect(); }
}
main().catch(error => {
  console.error(String(error?.message || 'Audit retention failed').replace(/mongodb(?:\+srv)?:\/\/\S+/g, '[database connection]'));
  process.exitCode = 1;
});
