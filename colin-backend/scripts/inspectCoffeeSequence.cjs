/** Read-only snapshot for the explicitly requested coffee-company sequence repair. */
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const { EJSON } = require('bson');
const CASE_ID = '6ae4aa603303df92c293acad';
const TEMPLATE_ID = '6a41454d462ec344673ad89b';
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);

async function readSnapshot(db, session) {
  const options = session ? { session } : {};
  const id = new mongoose.Types.ObjectId(CASE_ID);
  const matter = await db.collection('cases').findOne({ _id: id }, options);
  const workflow = await db.collection('workflowinstances').findOne({ caseId: id }, options);
  const template = await db.collection('workflowtemplates').findOne({ _id: new mongoose.Types.ObjectId(TEMPLATE_ID) }, options);
  const tasks = await db.collection('tasks').find({ caseId: id }, options).sort({ _id: 1 }).toArray();
  const ledger = await db.collection('staffearningsledgers').find({ caseId: id }, options).sort({ _id: 1 }).toArray();
  return { inspectedAt: new Date(), databaseName: db.databaseName, matter, workflow, template, tasks, ledger };
}

async function connect() {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  require('node:dns').setServers(['8.8.8.8', '1.1.1.1']);
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('No configured database connection.');
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false, maxPoolSize: 1, maxConnecting: 1,
    serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, socketTimeoutMS: 20000, family: 4,
    compressors: ['zlib'], zlibCompressionLevel: 3 });
}

async function main() {
  await connect();
  try {
    const snapshot = await readSnapshot(mongoose.connection.db);
    const folder = path.resolve(__dirname, '../.local-operations'); fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `coffee-sequence-inspection-${Date.now()}.ejson`);
    fs.writeFileSync(file, EJSON.stringify(snapshot, null, 2));
    const { orderWorkflowSteps } = require('../dist/utils/workflowSchedule');
    const ordered = orderWorkflowSteps(snapshot.workflow?.steps || []);
    console.log(JSON.stringify({ snapshot: file, caseNo: snapshot.matter?.caseNo, workflow: snapshot.matter?.workflow,
      progress: snapshot.matter?.workflowProgress?.percent, currentStepKey: snapshot.workflow?.currentStepKey,
      updatedAt: snapshot.workflow?.updatedAt, steps: ordered.map((s, i) => ({ number: i + 1, key: s.stepKey, title: s.title,
        status: s.status, doneAt: s.doneAt, submittedAt: s.submittedAt, reviewedAt: s.reviewedAt, completedAt: s.completedAt,
        customOrder: s.customOrder, overridden: s.overridden })) }, null, 2));
  } finally { await mongoose.disconnect(); }
}
module.exports = { CASE_ID, TEMPLATE_ID, readSnapshot, connect };
if (require.main === module) main().catch(error => {
  console.error(String(error.message).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[database connection redacted]'));
  process.exitCode = 1;
});
