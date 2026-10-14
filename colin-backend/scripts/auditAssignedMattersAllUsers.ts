/**
 * Live "Assigned Matters" audit across EVERY user.
 *
 * The dashboard card says: "Matters where you're Initiator, Reviewer or
 * Signer/Approver (all time)". The truth for that statement is: every matter
 * where the user is the assignedTo lawyer OR one of the three assignment
 * slots, across ALL statuses (active, closed, temporarily closed).
 *
 * This script, for each real user in the DB:
 *   1. Runs the REAL getStaffDashboardSummary (All Time) and reads the number
 *      the card shows: period.mattersWithActivity (and the raw mattersAssigned).
 *   2. Independently recounts "reality" straight from the case collection using
 *      the same identity rule (assignedTo / initiator / reviewer / signerApprover,
 *      by name AND email).
 *   3. Flags any user where the dashboard number != reality.
 *
 * Run on a machine with DB access (the sandbox may need the mongoDnsShim):
 *   npx tsx scripts/auditAssignedMattersAllUsers.ts
 */
import './mongoDnsShim';
import mongoose from 'mongoose';

import { getStaffDashboardSummary } from '../src/controllers/dashboardController';
import { AuthRequest } from '../src/middleware/authMiddleware';
import Case from '../src/models/caseModel';
import User from '../src/models/userModel';

const DIRECT_URI =
  'mongodb://colin_admin:YUZtj0K8Szc2crTR@ac-uitoomc-shard-00-00.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-01.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-02.f5g0wlj.mongodb.net:27017/colin_db?ssl=true&tls=true&authSource=admin&replicaSet=atlas-vhtefl-shard-0&retryWrites=true&w=majority&serverSelectionTimeoutMS=25000';

const norm = (v: unknown) => String(v || '').trim().toLowerCase();

const identitiesOf = (c: any) =>
  [c?.assignedTo, c?.caseAssignments?.initiator, c?.caseAssignments?.reviewer, c?.caseAssignments?.signerApprover]
    .map(norm)
    .filter(Boolean);

const matchesUser = (c: any, keys: string[]) => {
  const ids = identitiesOf(c);
  return keys.some((k) => k && ids.includes(k));
};

const runSummary = async (user: any, query: any = {}): Promise<Record<string, any>> => {
  const req = {
    user: { id: String(user._id), name: user.name, email: user.email, role: user.role },
    query,
  } as unknown as AuthRequest;
  let payload: Record<string, any> = {};
  const res: any = { status() { return this; }, json(v: any) { payload = v; return v; } };
  await getStaffDashboardSummary(req, res);
  return payload;
};

const main = async () => {
  await mongoose.connect(DIRECT_URI);
  console.log('CONNECTED');

  const [users, cases] = await Promise.all([
    User.find({}).select('_id name email role isActive').lean().exec(),
    Case.find({}).select('_id caseNo status assignedTo caseAssignments').lean().exec(),
  ]);

  const normStatus = (s: unknown) => String(s || '').trim().toLowerCase();
  const statusBuckets = (keys: string[]) => {
    let active = 0, closed = 0, temp = 0, other = 0;
    for (const c of cases as any[]) {
      if (!matchesUser(c, keys)) continue;
      const s = normStatus(c?.status);
      if (s === 'closed') closed += 1;
      else if (s === 'temporarily closed' || s === 'temp closed') temp += 1;
      else if (s === 'in progress' || s === 'active' || s === 'open' || s === 'pending') active += 1;
      else other += 1;
    }
    return { active, closed, temp, other };
  };

  let mismatches = 0;
  const rows: string[] = [];
  for (const user of users as any[]) {
    const keys = [norm(user.name), norm(user.email)].filter(Boolean);
    const reality = (cases as any[]).filter((c) => matchesUser(c, keys)).length;
    let cardAssigned = 0;
    let cardActivity = 0;
    let error = '';
    try {
      const s = await runSummary(user, {});
      cardAssigned = Number(s?.mattersAssigned || 0);
      cardActivity = Number(s?.period?.mattersWithActivity || 0);
    } catch (e: any) {
      error = String(e?.message || e).slice(0, 120);
    }
    const ok = !error && cardAssigned === reality && cardActivity === reality;
    const bucket = statusBuckets(keys);
    if (!ok) mismatches += 1;
    rows.push(
      `${ok ? 'OK  ' : 'MISMATCH'} ${String(user.name).padEnd(24)} role=${String(user.role).padEnd(20)} ` +
      `reality=${reality} card(mattersAssigned)=${cardAssigned} card(withActivity)=${cardActivity} ` +
      `[active=${bucket.active} closed=${bucket.closed} temp=${bucket.temp} other=${bucket.other}]${error ? ' ERR=' + error : ''}`
    );
  }

  const shortlisted = rows.filter((r) => r.startsWith('MISMATCH'));
  console.log('---- MATCHING USERS (sample) ----');
  console.log(rows.filter((r) => r.startsWith('OK  ')).slice(0, 40).join('\n'));
  console.log('\n---- MISMATCHED USERS ----');
  console.log(shortlisted.length ? shortlisted.join('\n') : '(none — every dashboard matches reality)');
  console.log(`\nUsers checked: ${rows.length}, mismatches: ${mismatches}`);

  await mongoose.disconnect();
  if (mismatches) process.exitCode = 1;
};

main().catch((e) => { console.error(e); process.exit(1); });
