import './mongoDnsShim';
import mongoose from 'mongoose';

const URI =
  'mongodb://colin_admin:YUZtj0K8Szc2crTR@ac-uitoomc-shard-00-00.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-01.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-02.f5g0wlj.mongodb.net:27017/colin_db?ssl=true&tls=true&authSource=admin&replicaSet=atlas-vhtefl-shard-0&retryWrites=true&w=majority&serverSelectionTimeoutMS=25000';

const norm = (v: unknown) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const toks = (v: unknown) => norm(v).split(' ').filter(Boolean);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// precise variant matcher (proposed)
const isVariant = (stored: string, user: string) => {
  const s = toks(stored), u = toks(user);
  if (!s.length || !u.length) return false;
  if (s.join(' ') === u.join(' ')) return true;
  if (s[0] !== u[0]) return false;
  if (s.length > 1 && u.length > 1) return s[s.length - 1] === u[u.length - 1];
  return true;
};

const main = async () => {
  await mongoose.connect(URI);
  const db = mongoose.connection.db!;
  const users: any[] = await db.collection('users').find({}).project({ name: 1, email: 1 }).toArray();
  const cases: any[] = await db.collection('cases').find({}).project({ caseNo: 1, status: 1, assignedTo: 1, caseAssignments: 1 }).toArray();

  const buck = (n: { a: number; c: number; t: number }) => `${n.a}/${n.c}/${n.t}=${n.a + n.c + n.t}`;
  const stat = (status: string) => (norm(status) === 'closed' ? 'c' : norm(status) === 'temporarily closed' ? 't' : 'a');

  console.log('user'.padEnd(20), 'unanchored(Matters)', 'variant(proposed)', 'same?');
  let allSame = true;
  for (const u of users) {
    const name = String(u.name || '');
    if (!name) continue;
    const email = String(u.email || '');
    const rxUnanchored = name ? new RegExp(esc(name), 'i') : null;
    const rxEmail = email ? new RegExp(esc(email), 'i') : null;

    let un = { a: 0, c: 0, t: 0 };
    let va = { a: 0, c: 0, t: 0 };
    for (const c of cases) {
      const vals = [c.assignedTo, c.caseAssignments?.initiator, c.caseAssignments?.reviewer, c.caseAssignments?.signerApprover].map((v) => String(v || ''));
      const unHit = (rxUnanchored && vals.some((v) => rxUnanchored.test(v))) || (rxEmail && vals.some((v) => rxEmail.test(v)));
      const vaHit = vals.some((v) => isVariant(v, name) || (email && norm(v) === norm(email)));
      if (unHit) { const k = stat(c.status); un[k] += 1; }
      if (vaHit) { const k = stat(c.status); va[k] += 1; }
    }
    const same = buck(un) === buck(va);
    if (!same) allSame = false;
    console.log(name.padEnd(20), buck(un).padEnd(18), buck(va).padEnd(18), same ? 'YES' : '*** DIFFER ***');
  }
  console.log('\nAll users identical under unanchored vs variant rule:', allSame);

  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
