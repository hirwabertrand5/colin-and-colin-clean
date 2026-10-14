/**
 * Focused regression check for the "Assigned Matters" count.
 *
 * Reproduces the reported bug: a member (Badiel) is the `assignedTo` lawyer on
 * several matters but is NOT named in `caseAssignments` (a different person is
 * the Initiator). The Earned Fees `team` only builds the three caseAssignments
 * slots, so this member has no scored row there — yet those matters are still
 * genuinely assigned to them and must be counted on the dashboard.
 *
 * Run with:  npx tsx scripts/verifyAssignedMattersCount.ts
 */
import mongoose from 'mongoose';

import Case from '../src/models/caseModel';
import Task from '../src/models/taskModel';
import Invoice from '../src/models/invoiceModel';
import User from '../src/models/userModel';
import WorkflowInstance from '../src/models/workflowInstanceModel';
import WorkflowTemplate from '../src/models/workflowTemplateModel';
import { getStaffDashboardSummary } from '../src/controllers/dashboardController';
import { AuthRequest } from '../src/middleware/authMiddleware';

const oid = () => new mongoose.Types.ObjectId();
const stub = (impl: any) => impl as any;

const ME = 'Badiel';
const OTHER = 'Someone Else'; // the Initiator on every matter (never Badiel)

// 10 matters assigned to Badiel via `assignedTo` ONLY (a different Initiator),
// across every status the user sees in the Matters tables.
const makeCase = (no: string, status: string) => ({
  _id: oid(),
  caseNo: no,
  parties: `Client ${no}`,
  status,
  assignedTo: ME,
  caseAssignments: { initiator: OTHER }, // Badiel is NOT initiator/reviewer/approver
  workflowProgress: { status: status === 'Closed' ? 'Completed' : 'In Progress', percent: 50 },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

const matters = [
  makeCase('CASE-A1', 'In Progress'),
  makeCase('CASE-A2', 'In Progress'),
  makeCase('CASE-A3', 'In Progress'),
  makeCase('CASE-A4', 'In Progress'),
  makeCase('CASE-A5', 'In Progress'),
  makeCase('CASE-A6', 'In Progress'),
  makeCase('CASE-A7', 'In Progress'), // 7 active
  makeCase('CASE-C1', 'Closed'),
  makeCase('CASE-C2', 'Closed'), // 2 closed
  makeCase('CASE-T1', 'Temporarily Closed'), // 1 temporarily closed
];

const users = [{ _id: oid(), name: ME, role: 'associate' }, { _id: oid(), name: OTHER, role: 'managing_partner' }];

const matchesIdentity = (caseDoc: any, regex: RegExp) =>
  [caseDoc?.assignedTo, caseDoc?.caseAssignments?.initiator, caseDoc?.caseAssignments?.reviewer, caseDoc?.caseAssignments?.signerApprover]
    .some((value) => typeof value === 'string' && regex.test(value));

// Only matters where the signed-in user is an assignee (mirrors the real query).
Case.find = stub((filter: any) => {
  const clauses: any[] = Array.isArray(filter?.$or) ? filter.$or : [];
  const matched = matters.filter((caseDoc) =>
    clauses.some((clause) => Object.values(clause).some((regex: any) => matchesIdentity(caseDoc, regex)))
  );
  return { sort: () => ({ lean: async () => matched }) };
});
WorkflowInstance.find = stub(() => ({ lean: async () => [] }));
WorkflowTemplate.find = stub(() => ({ lean: async () => [] }));
Task.find = stub(() => ({ lean: async () => [] }));
Invoice.find = stub(() => ({ select: () => ({ lean: async () => [] }) }));
User.find = stub(() => ({ select: () => ({ lean: async () => users }) }));

const runFor = async (user: any, query: any = {}): Promise<Record<string, any>> => {
  const req = {
    user: { id: String(user._id), name: user.name, email: `${user.name.toLowerCase()}@test.local`, role: user.role },
    query,
  } as unknown as AuthRequest;
  let payload: Record<string, any> = {};
  const res: any = {
    status() { return this; },
    json(value: any) { payload = value; return value; },
  };
  await getStaffDashboardSummary(req, res);
  return payload;
};

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
};

const main = async () => {
  const me = users[0];
  const allTime = await runFor(me, {});

  // The dashboard must count EVERY assigned matter, across all statuses.
  check('Badiel mattersAssigned equals all 10 assigned matters', allTime.mattersAssigned, 10);
  check('All Time Assigned Matters (mattersWithActivity) equals 10, not 6', allTime.period.mattersWithActivity, 10);
  check('every assigned matter is listed as a row', allTime.rows.length, 10);
  check(
    'assignedTo-only matters carry an honest "Assigned" role label',
    allTime.rows.every((row: any) => row.role === 'Assigned'),
    true
  );
  check(
    'assignedTo-only matters show a null (pending) earned fee, not a fabricated 0',
    allTime.rows.every((row: any) => row.earnedFee === null),
    true
  );

  // A member who is genuinely an Initiator keeps working exactly as before.
  const other = await runFor(users[1], {});
  check('the Initiator (Someone Else) still counts all 10 matters', other.mattersAssigned, 10);
  check(
    'the Initiator rows keep their Initiator role label',
    other.rows.every((row: any) => row.role === 'Initiator'),
    true
  );

  if (failures) { console.log(`\n${failures} CHECK(S) FAILED`); process.exitCode = 1; }
  else { console.log('\nALL CHECKS PASSED'); }
};

main().catch((error) => { console.error(error); process.exit(1); });
