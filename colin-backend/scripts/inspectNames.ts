import './mongoDnsShim';
import mongoose from 'mongoose';

const URI =
  'mongodb://colin_admin:YUZtj0K8Szc2crTR@ac-uitoomc-shard-00-00.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-01.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-02.f5g0wlj.mongodb.net:27017/colin_db?ssl=true&tls=true&authSource=admin&replicaSet=atlas-vhtefl-shard-0&retryWrites=true&w=majority&serverSelectionTimeoutMS=25000';

const norm = (v: unknown) => String(v || '').trim().toLowerCase();

const main = async () => {
  await mongoose.connect(URI);
  const db = mongoose.connection.db!;

  // Every identity name stored on cases (caseAssignments slots only — NOT the composite assignedTo).
  const names = new Map<string, number>(); // normalized full name -> occurrences
  const cases: any[] = await db.collection('cases').find({}).project({ caseAssignments: 1 }).toArray();
  for (const c of cases) {
    const ca = c.caseAssignments || {};
    for (const slot of [ca.initiator, ca.reviewer, ca.signerApprover]) {
      const n = norm(slot);
      if (!n || n.includes('|')) continue;
      names.set(n, (names.get(n) || 0) + 1);
    }
  }
  console.log('distinct caseAssignments names stored:', names.size);
  console.log([...names.entries()].map(([n, c]) => `${n}(${c})`).sort().join('\n'));

  // First-token collision among these stored names (the ONLY risk for first+last matching).
  const firstToken = new Map<string, Set<string>>();
  for (const n of names.keys()) {
    const first = n.split(/\s+/)[0];
    firstToken.set(first, (firstToken.get(first) || new Set()).add(n));
  }
  const collisions = [...firstToken.entries()].filter(([, set]) => set.size > 1);
  console.log('\nFIRST-TOKEN collisions among caseAssignments names (would break first+last matching):');
  console.log(collisions.length ? collisions.map(([f, set]) => `${f}: ${[...set].join(', ')}`).join('\n') : 'NONE');

  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
