import './mongoDnsShim';
import mongoose from 'mongoose';

const URI =
  'mongodb://colin_admin:YUZtj0K8Szc2crTR@ac-uitoomc-shard-00-00.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-01.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-02.f5g0wlj.mongodb.net:27017/colin_db?ssl=true&tls=true&authSource=admin&replicaSet=atlas-vhtefl-shard-0&retryWrites=true&w=majority&serverSelectionTimeoutMS=25000';

const norm = (v: unknown) => String(v || '').trim().toLowerCase();

const main = async () => {
  await mongoose.connect(URI);
  const db = mongoose.connection.db!;
  const users: any[] = await db.collection('users').find({}).project({ name: 1, email: 1, role: 1 }).toArray();

  // Real people only (exclude placeholder junk accounts).
  const PLACEHOLDERS = new Set(['initiator', 'reviewer', 'approver']);
  const real = users.filter((u) => !PLACEHOLDERS.has(norm(u.name)));

  // First-name collision check among REAL users (would make first-name matching unsafe).
  const firstNames = new Map<string, string[]>();
  for (const u of real) {
    const first = norm(u.name).split(/\s+/)[0];
    firstNames.set(first, [...(firstNames.get(first) || []), String(u.name)]);
  }
  const collisions = [...firstNames.entries()].filter(([, names]) => names.length > 1);
  console.log('REAL users:', real.map((u) => u.name).join(', '));
  console.log('first-name collisions among REAL users:', collisions.length ? JSON.stringify(collisions) : 'none');

  // Any REAL user whose name is a prefix of another REAL user's full name?
  const prefixPairs: string[] = [];
  for (const a of real) for (const b of real) {
    if (a._id === b._id) continue;
    const na = norm(a.name), nb = norm(b.name);
    if (na !== nb && nb.startsWith(na + ' ')) prefixPairs.push(`"${a.name}" is a prefix of "${b.name}"`);
  }
  console.log('prefix relationships among REAL users:', prefixPairs.length ? prefixPairs.join('; ') : 'none');

  // 2) Are the 4 orphan Badiel tasks stored with the full name or short?
  const orphanIds = (await db.collection('cases').find({ 'caseAssignments.reviewer': /^Badiel Rubangutsangabo$/i }).project({ _id: 1 }).toArray()).map((c: any) => String(c._id));
  const orphanTasks: any[] = await db.collection('tasks').find({ caseId: { $in: orphanIds } }).project({ assignee: 1, supervisor: 1, taskStages: 1 }).toArray();
  const badielInOrphanTasks = new Set<string>();
  for (const t of orphanTasks) {
    for (const v of [t.assignee, t.supervisor, ...(Array.isArray(t.taskStages) ? t.taskStages.map((s: any) => s.staffMember) : [])]) {
      if (typeof v === 'string' && /badiel/i.test(v)) badielInOrphanTasks.add(JSON.stringify(v));
    }
  }
  console.log('\nBadiel strings inside the orphan matters\' TASKS:', badielInOrphanTasks.size ? [...badielInOrphanTasks].join(', ') : '(none — tasks not attributed to Badiel there)');

  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
