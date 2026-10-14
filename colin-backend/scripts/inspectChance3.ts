import './mongoDnsShim';
import mongoose from 'mongoose';

import { getStaffDashboardSummary } from '../src/controllers/dashboardController';
import { AuthRequest } from '../src/middleware/authMiddleware';
import { identityMatches } from '../src/utils/caseAssignments';
import Case from '../src/models/caseModel';

const URI =
  'mongodb://colin_admin:YUZtj0K8Szc2crTR@ac-uitoomc-shard-00-00.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-01.f5g0wlj.mongodb.net:27017,ac-uitoomc-shard-00-02.f5g0wlj.mongodb.net:27017/colin_db?ssl=true&tls=true&authSource=admin&replicaSet=atlas-vhtefl-shard-0&retryWrites=true&w=majority&serverSelectionTimeoutMS=25000';

const norm = (v: unknown) => String(v || '').trim().toLowerCase();

const main = async () => {
  await mongoose.connect(URI);
  const db = mongoose.connection.db!;
  const users: any[] = await db.collection('users').find({}).project({ name: 1, email: 1, role: 1 }).toArray();

  const all: any[] = await Case.find({})
    .select('caseNo status assignedTo caseAssignments workflowProgress')
    .lean()
    .exec();

  let mismatches = 0;

  for (const user of users) {
    const meName = user.name;
    const meEmail = user.email;
    const keys = [meName, meEmail].filter(Boolean).map(norm);

    // Frontend canonical identity match — the reference definition of "assigned".
    const identityMatch = all.filter((c: any) => {
      const slots = [c.assignedTo, c.caseAssignments?.initiator, c.caseAssignments?.reviewer, c.caseAssignments?.signerApprover];
      return keys.some((k) => slots.some((v) => identityMatches(v, k)));
    });

    // Backend controller result — same identity query used by the real endpoint.
    let status = 0;
    let payload: any = {};
    const req = {
      user: { id: String(user._id), name: meName, email: meEmail, role: user.role },
      query: {},
    } as unknown as AuthRequest;
    const res: any = {
      status(code: number) { status = code; return this; },
      json(v: any) { payload = v; return v; },
    };
    await getStaffDashboardSummary(req, res);
    const backendAssigned = payload?.mattersAssigned;
    const backendWithActivity = payload?.period?.mattersWithActivity;
    const rowsLength = payload?.rows?.length ?? 0;

    const ok =
      identityMatch.length === backendAssigned &&
      identityMatch.length === backendWithActivity &&
      identityMatch.length === rowsLength;

    if (!ok) mismatches += 1;

    console.log(
      `${ok ? 'OK  ' : 'FAIL'} ${meName.padEnd(25)} role=${String(user.role).padEnd(22)} ` +
      `frontendCanonical=${identityMatch.length} backendAssigned=${backendAssigned} ` +
      `backendWithActivity=${backendWithActivity} backendRows=${rowsLength}`
    );
  }

  console.log(`\nUsers checked: ${users.length}, mismatches: ${mismatches}`);
  await mongoose.disconnect();
};

main().catch((e) => { console.error('THREW:', e); process.exit(1); });
