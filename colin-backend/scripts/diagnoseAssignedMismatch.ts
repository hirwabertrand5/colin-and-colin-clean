/**
 * Focused diagnosis for users whose dashboard "Assigned Matters" disagrees
 * with reality. Prints, per problem user, the exact identity strings stored on
 * their matters (assignedTo / initiator / reviewer / signerApprover) next to
 * the user's name+email, so we can see exactly why the dashboard regex missed
 * them.
 *
 * Run:  npx tsx scripts/auditAssignedMattersAllUsers.ts   (to find who)
 *       npx tsx scripts/diagnoseAssignedMismatch.ts Chance
 */
import './mongoDnsShim';
import mongoose from 'mongoose';

import Case from '../src/models/caseModel';
import User from '../src/models/userModel';

const DIRECT_URI =
  'mongodb://colin_admin:YUZtj0K8Szc2crTR@ac-uitoomc-shard-00-00.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-01.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-02.f5g0wlj.mongodb.net:27017/colin_db?ssl=true&tls=true&authSource=admin&replicaSet=atlas-vhtefl-shard-0&retryWrites=true&w=majority&serverSelectionTimeoutMS=25000';

const norm = (v: unknown) => String(v || '').trim().toLowerCase();
const identitiesOf = (c: any) =>
  [c?.assignedTo, c?.caseAssignments?.initiator, c?.caseAssignments?.reviewer, c?.caseAssignments?.signerApprover]
    .map((v) => String(v ?? ''));

const main = async () => {
  const target = process.argv[2];
  await mongoose.connect(DIRECT_URI);

  const users: any[] = await User.find({}).select('_id name email role').lean().exec();
  const cases: any[] = await Case.find({}).select('_id caseNo status assignedTo caseAssignments').lean().exec();

  const chosen = target ? users.filter((u) => norm(u.name) === norm(target)) : users;
  for (const user of chosen) {
    const keys = [norm(user.name), norm(user.email)].filter(Boolean);
    const matched = (cases as any[]).filter((c) =>
      identitiesOf(c).map(norm).some((id) => id && keys.includes(id))
    );
    console.log('\n======================================================');
    console.log(`USER: "${user.name}"  email="${user.email}"  role=${user.role}`);
    console.log(`  normalized keys = ${JSON.stringify(keys)}`);
    console.log(`  matched by EXACT normalized identity: ${matched.length}`);
    // Show the distinct raw identity values that matched, to reveal formatting.
    const distinct = new Map<string, number>();
    for (const c of matched) {
      for (const raw of identitiesOf(c)) {
        const n = norm(raw);
        if (n && keys.includes(n)) {
          distinct.set(raw, (distinct.get(raw) || 0) + 1);
        }
      }
    }
    console.log('  raw identity values on those matters:');
    for (const [raw, count] of distinct) console.log(`    "${raw}"  (x${count})`);

    // Also: how many matters mention the user if we do a LOOSE contains match?
    const loose = (cases as any[]).filter((c) => {
      const first = String(user.name || '').trim().toLowerCase();
      return identitiesOf(c).some((id) => id && first && norm(id).includes(first));
    });
    if (loose.length !== matched.length) {
      console.log(`  loose-contains would match ${loose.length} (vs exact ${matched.length}) — formatting mismatch likely`);
      const sample = loose.filter((c) => !matched.includes(c)).slice(0, 8);
      for (const c of sample) console.log(`    extra: caseNo=${c.caseNo} status=${c.status} identities=${JSON.stringify(identitiesOf(c))}`);
    }
  }

  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
