import './mongoDnsShim';
import mongoose from 'mongoose';

const URI =
  'mongodb://colin_admin:YUZtj0K8Szc2crTR@ac-uitoomc-shard-00-00.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-01.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-02.f5g0wlj.mongodb.net:27017/colin_db?ssl=true&tls=true&authSource=admin&replicaSet=atlas-vhtefl-shard-0&retryWrites=true&w=majority&serverSelectionTimeoutMS=25000';

const norm = (v: unknown) => String(v || '').trim().toLowerCase();

const main = async () => {
  await mongoose.connect(URI);
  const db = mongoose.connection.db!;

  // The distinct composite display string EXACTLY as stored.
  const composite = 'Initiator: Richard | Reviewer: Badiel Rubangutsangabo | Signer/Approver: Managing Partner';
  const compositeCases = await db.collection('cases').find({ assignedTo: composite }).project({ caseNo: 1, status: 1 }).toArray();
  console.log(`cases with assignedTo EXACTLY = "${composite}":`, compositeCases.length);

  // How many case.assignedTo fields are composite display strings (contain 'Initiator:')?
  const compositeCount = await db.collection('cases').countDocuments({ assignedTo: /Initiator:\s/i });
  const totalCases = await db.collection('cases').countDocuments({});
  console.log(`cases with a composite display string in assignedTo: ${compositeCount} / ${totalCases}`);

  // Sample some composites to see the variety of names used.
  const samples: any[] = await db.collection('cases').find({ assignedTo: /Initiator:\s/i }).project({ assignedTo: 1, caseAssignments: 1 }).limit(12).toArray();
  const reviewers = new Set<string>();
  for (const s of samples) reviewers.add(String(s.caseAssignments?.reviewer || '(none)'));
  console.log('sample reviewers stored on composite-assignedTo matters:', [...reviewers].join(' | '));

  // Is Badiel the assignee/supervisor on tasks of those composite matters (full vs short)?
  const ids = samples.map((s: any) => String(s._id));
  const tasks: any[] = await db.collection('tasks').find({ caseId: { $in: ids } }).project({ assignee: 1, supervisor: 1, taskStages: 1 }).limit(200).toArray();
  const badgeilTaskNames = new Set<string>();
  for (const t of tasks) {
    for (const v of [t.assignee, t.supervisor, ...(Array.isArray(t.taskStages) ? t.taskStages.map((x: any) => x.staffMember) : [])]) {
      if (typeof v === 'string' && /badiel/i.test(v)) badgeilTaskNames.add(JSON.stringify(v));
    }
  }
  console.log('Badiel name form(s) on tasks of composite matters:', badgeilTaskNames.size ? [...badgeilTaskNames].join(', ') : '(none)');

  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
