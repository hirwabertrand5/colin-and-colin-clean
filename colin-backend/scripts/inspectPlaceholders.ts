import './mongoDnsShim';
import mongoose from 'mongoose';

const URI =
  'mongodb://colin_admin:YUZtj0K8Szc2crTR@ac-uitoomc-shard-00-00.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-01.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-02.f5g0wlj.mongodb.net:27017/colin_db?ssl=true&tls=true&authSource=admin&replicaSet=atlas-vhtefl-shard-0&retryWrites=true&w=majority&serverSelectionTimeoutMS=25000';

const norm = (v: unknown) => String(v || '').trim().toLowerCase();

const main = async () => {
  await mongoose.connect(URI);
  const db = mongoose.connection.db!;

  // 1) Inspect the 3 suspicious "placeholder" accounts.
  for (const name of ['initiator', 'reviewer', 'approver']) {
    const u: any = await db.collection('users').findOne({ name: new RegExp(`^${name}$`, 'i') });
    console.log(`${name}:`, u && { name: u.name, email: u.email, role: u.role, createdAt: u.createdAt, _id: String(u._id) });
  }

  // 2) How are the 4 orphan Badiel matters' tasks stored? (who is assignee/supervisor/stage)
  const orphanCaseNos = await db.collection('cases')
    .find({ 'caseAssignments.reviewer': /^Badiel Rubangutsangabo$/i, assignedTo: /Initiator:/i })
    .project({ _id: 1, caseNo: 1 })
    .toArray();
  console.log('\norphan Badiel full-name matters:', orphanCaseNos.map((c: any) => `${c.caseNo}(${c._id})`).join(', '));

  // 3) Confirm every stored name across the system that CONTAINS 'badiel'.
  const distinctBadiel = new Set<string>();
  const scan = async (collection: string, fields: string[]) => {
    const docs: any[] = await db.collection(collection).find({}).project(fields.reduce((acc, f) => (acc[f] = 1, acc), {} as any)).toArray();
    for (const d of docs) {
      const collect = (v: any) => { if (typeof v === 'string' && /badiel/i.test(v)) distinctBadiel.add(JSON.stringify(v)); };
      for (const f of fields) {
        const val = d[f];
        if (Array.isArray(val)) val.forEach((x: any) => typeof x === 'string' ? collect(x) : (x && typeof x === 'object' && x.staffMember && collect(x.staffMember)));
        else collect(val);
      }
    }
  };
  await scan('cases', ['assignedTo', 'caseAssignments']);
  await scan('tasks', ['assignee', 'supervisor', 'taskStages']);

  console.log('\ndistinct stored strings containing "badiel":');
  for (const s of distinctBadiel) console.log('  ' + s);

  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
