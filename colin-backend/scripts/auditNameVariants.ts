import './mongoDnsShim';
import mongoose from 'mongoose';

const URI =
  'mongodb://colin_admin:YUZtj0K8Szc2crTR@ac-uitoomc-shard-00-00.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-01.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-02.f5g0wlj.mongodb.net:27017/colin_db?ssl=true&tls=true&authSource=admin&replicaSet=atlas-vhtefl-shard-0&retryWrites=true&w=majority&serverSelectionTimeoutMS=25000';

const norm = (v: unknown) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const tokens = (v: unknown) => norm(v).split(' ').filter(Boolean);

// Variant match: same person, possibly typed with more/fewer name parts.
// Rule: first token equal AND (either has no 2nd token OR last tokens equal).
const isNameVariant = (stored: string, user: string) => {
  const s = tokens(stored);
  const u = tokens(user);
  if (!s.length || !u.length) return false;
  if (s.join(' ') === u.join(' ')) return true; // exact
  if (s[0] !== u[0]) return false;
  if (s.length > 1 && u.length > 1) return s[s.length - 1] === u[u.length - 1];
  return true;
};

const main = async () => {
  await mongoose.connect(URI);
  const db = mongoose.connection.db!;

  const users: any[] = await db.collection('users').find({}).project({ name: 1, email: 1, role: 1 }).toArray();
  const cases: any[] = await db.collection('cases').find({}).project({ caseNo: 1, status: 1, assignedTo: 1, caseAssignments: 1 }).toArray();

  const distinctForms = new Map<string, number>();
  for (const c of cases) {
    for (const v of [c.assignedTo, c.caseAssignments?.initiator, c.caseAssignments?.reviewer, c.caseAssignments?.signerApprover]) {
      const n = norm(v);
      if (!n) continue;
      distinctForms.set(n, (distinctForms.get(n) || 0) + 1);
    }
  }

  console.log('==== USER RECORDS ====');
  for (const u of users) console.log(`  ${JSON.stringify(u.name)}  <${u.email}>  role=${u.role}`);

  console.log('\n==== STORED IDENTITY FORMS (normalized, count) ====');
  for (const [form, count] of [...distinctForms.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}x  ${JSON.stringify(form)}`);
  }

  const byFirst = new Map<string, string[]>();
  for (const u of users) {
    const f = tokens(u.name)[0] || norm(u.name);
    byFirst.set(f, [...(byFirst.get(f) || []), String(u.name)]);
  }
  console.log('\n==== FIRST-TOKEN COLLISIONS AMONG USERS (variant-match risk) ====');
  let collisions = 0;
  for (const [f, names] of byFirst) {
    if (names.length > 1) { console.log(`  "${f}" -> ${names.join(', ')}`); collisions++; }
  }
  if (!collisions) console.log('  (none)');

  console.log('\n==== PER-USER: EXACT (dashboard) vs VARIANT (true identity) ====');
  const bucket = (arr: any[]) => ({
    total: arr.length,
    active: arr.filter((x) => norm(x.status) !== 'closed' && norm(x.status) !== 'temporarily closed').length,
    closed: arr.filter((x) => norm(x.status) === 'closed').length,
    temp: arr.filter((x) => norm(x.status) === 'temporarily closed').length,
  });

  for (const u of users) {
    const name = String(u.name || '');
    if (!name) continue;
    const exact: any[] = [];
    const variant: any[] = [];
    for (const c of cases) {
      const vals = [c.assignedTo, c.caseAssignments?.initiator, c.caseAssignments?.reviewer, c.caseAssignments?.signerApprover];
      if (vals.some((v) => norm(v) === norm(name) || norm(v) === norm(u.email))) exact.push(c);
      if (vals.some((v) => isNameVariant(String(v || ''), name) || norm(v) === norm(u.email))) variant.push(c);
    }
    const e = bucket(exact);
    const v = bucket(variant);
    console.log(`  ${name.padEnd(22)} exact=${e.total} (${e.active}/${e.closed}/${e.temp})   variant=${v.total} (${v.active}/${v.closed}/${v.temp})   GAP=${v.total - e.total}`);
  }

  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
