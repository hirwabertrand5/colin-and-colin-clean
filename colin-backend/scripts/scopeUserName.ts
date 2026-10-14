import './mongoDnsShim';
import mongoose from 'mongoose';

const URI =
  'mongodb://colin_admin:YUZtj0K8Szc2crTR@ac-uitoomc-shard-00-00.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-01.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-02.f5g0wlj.mongodb.net:27017/colin_db?ssl=true&tls=true&authSource=admin&replicaSet=atlas-vhtefl-shard-0&retryWrites=true&w=majority&serverSelectionTimeoutMS=25000';

const norm = (v: unknown) => String(v || '').trim().toLowerCase();

// Case identity slots only (matching assignment names), NOT tasks.
const caseSlots = (d: any): string[] =>
  [d?.assignedTo, d?.caseAssignments?.initiator, d?.caseAssignments?.reviewer, d?.caseAssignments?.signerApprover]
    .map(norm)
    .filter(Boolean);

// Task assignee/supervisor/stage-member slots.
const taskSlots = (t: any): string[] => {
  const out = [norm(t?.assignee), norm(t?.supervisor)];
  if (Array.isArray(t?.taskStages)) out.push(...t.taskStages.map((s: any) => norm(s?.staffMember)));
  return out.filter(Boolean);
};

const main = async () => {
  await mongoose.connect(URI);
  const db = mongoose.connection.db!;

  const users: any[] = await db.collection('users').find({}).project({ name: 1, email: 1, role: 1 }).toArray();
  const cases: any[] = await db.collection('cases').find({}).project({ caseNo: 1, status: 1, assignedTo: 1, caseAssignments: 1 }).toArray();
  const tasks: any[] = await db.collection('tasks').find({}).project({ assignee: 1, supervisor: 1, taskStages: 1 }).toArray();

  const totalPairs = users.length * cases.length;
  let shortAmbig = 0, longAmbig = 0, firstNameCollisions = 0;
  const ambigUsers: string[] = [];

  for (const u of users) {
    const userName = norm(u.name);
    const email = norm(u.email);
    const first = userName.split(/\s+/)[0];
    const shortNameCases = cases.filter((c) => caseSlots(c).some((v) => v === userName || v === email)).length;
    const shortNameTasks = tasks.filter((t) => taskSlots(t).some((v) => v === userName)).length;

    // "Long-name" containment: does this user's name appear as a SUBSTRING inside
    // any other (longer) name stored on a matter/task? That's the over-count risk.
    const longNameCases = cases.filter((c) => caseSlots(c).some((v) => v !== userName && v !== email && v.includes(userName))).length;
    const longNameTasks = tasks.filter((t) => taskSlots(t).some((v) => v !== userName && v.includes(userName))).length;

    // First-name collision: does another user share the first token of this name?
    const firstNameCollision = users.some((o) => o._id !== u._id && norm(o.name) !== userName && norm(o.name).startsWith(first + ' '));

    if (shortNameCases < longNameCases || shortNameTasks < longNameTasks) {
      ambigUsers.push(`${u.name}: exactCase=${shortNameCases} exactTask=${shortNameTasks} vs longCase=${longNameCases} longTask=${longNameTasks}`);
      shortAmbig += shortNameCases + shortNameTasks;
      longAmbig += longNameCases + longNameTasks;
    }
    if (firstNameCollision) firstNameCollisions += 1;
  }

  console.log(`users=${users.length} cases=${cases.length} tasks=${tasks.length} pairs=${totalPairs}`);
  console.log(`users where long-name containment would find MORE than exact: ${ambigUsers.length}`);
  for (const l of ambigUsers) console.log('  ' + l);
  console.log(`first-name collisions across user accounts: ${firstNameCollisions}`);

  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
