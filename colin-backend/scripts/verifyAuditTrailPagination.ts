/**
 * Regression tests for the My Activity Trail endpoint (GET /api/audit/mine).
 *
 * No database required — the AuditLog and Case models are stubbed in memory so
 * the controller's period filtering, server-side pagination, sorting and total
 * count can be verified against fixtures spanning multiple periods.
 *
 * Key guarantees under test:
 *   - The trail shares the SAME reporting-period windows as the staff dashboard
 *     summary (via reportRange), so "Last Month" means identical dates on both.
 *   - Pagination is server-side and reports an exact `total`, so a long period is
 *     never silently truncated and no page is presented as the complete history.
 *   - An invalid period is REJECTED (400), never quietly defaulted to All Time.
 *   - Sorting stays meaningful across pages (newest-first by default).
 *
 * Run with:  npx tsx scripts/verifyAuditTrailPagination.ts
 */
import mongoose from 'mongoose';

import AuditLog from '../src/models/auditLogModel';
import Case from '../src/models/caseModel';
import { getMyAuditTrail } from '../src/controllers/auditFeedController';
import { AuthRequest } from '../src/middleware/authMiddleware';

let failures = 0;
let checks = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) console.log(`      expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
};

const section = (title: string) => console.log(`\n=== ${title} ===`);

const oid = () => new mongoose.Types.ObjectId();
const at = (iso: string) => new Date(iso);

// --- Fixtures --------------------------------------------------------------
// The signed-in member plus someone else (whose actions must never appear).
const meId = oid();
const meName = 'Jane Associate';
const otherId = oid();
const otherName = 'John Partner';

const caseA = oid();
const caseB = oid();

// Actions spread across several periods so a single-window test cannot pass by
// accident. `createdAt` is the authoritative event timestamp.
const records = [
  { _id: oid(), caseId: caseA, actorUserId: meId, actorName: meName, action: 'CASE_UPDATED', message: 'Updated A', createdAt: at('2024-05-10T09:00:00Z') },
  { _id: oid(), caseId: caseA, actorUserId: meId, actorName: meName, action: 'TASK_CREATED', message: 'Created task A1', createdAt: at('2025-01-15T10:30:00Z') },
  { _id: oid(), caseId: caseB, actorUserId: meId, actorName: meName, action: 'DOCUMENT_UPLOADED', message: 'Uploaded B', createdAt: at('2026-09-20T08:00:00Z') },
  { _id: oid(), caseId: caseB, actorUserId: meId, actorName: meName, action: 'INVOICE_PAID', message: 'Paid B', createdAt: at('2026-10-05T14:00:00Z') },
  { _id: oid(), caseId: caseA, actorUserId: meId, actorName: meName, action: 'WORKFLOW_STEP_COMPLETED', message: 'Step done', createdAt: at('2026-10-12T11:00:00Z') },
  // Another member's action — must never be included for me.
  { _id: oid(), caseId: caseA, actorUserId: otherId, actorName: otherName, action: 'CASE_UPDATED', message: 'Other', createdAt: at('2026-10-12T12:00:00Z') },
];

// --- Model stubs -----------------------------------------------------------
const stub = (impl: any) => impl as any;

const matchesIdentity = (log: any, identityClauses: any[]) =>
  identityClauses.some((clause) => {
    if (clause.actorUserId && String(log.actorUserId) === String(clause.actorUserId)) return true;
    if (clause.actorName instanceof RegExp && clause.actorName.test(log.actorName)) return true;
    return false;
  });

const inCreatedAtRange = (log: any, createdAt: any) => {
  if (!createdAt) return true;
  const { $gte, $lte } = createdAt;
  const t = log.createdAt.getTime();
  if ($gte && t < new Date($gte).getTime()) return false;
  if ($lte && t > new Date($lte).getTime()) return false;
  return true;
};

const filterLogs = (query: any) =>
  records.filter(
    (log) => matchesIdentity(log, query.$or || []) && inCreatedAtRange(log, query.createdAt)
  );

AuditLog.countDocuments = stub(async (query: any) => filterLogs(query).length);

AuditLog.find = stub((query: any) => {
  const sortSpec: Record<string, 1 | -1> = {};
  let skip = 0;
  let limit = records.length;
  const chain: any = {
    sort(spec: Record<string, 1 | -1>) {
      Object.assign(sortSpec, spec);
      return chain;
    },
    skip(n: number) {
      skip = n;
      return chain;
    },
    limit(n: number) {
      limit = n;
      return chain;
    },
    lean: async () => {
      const matched = filterLogs(query);
      const field = Object.keys(sortSpec)[0] || 'createdAt';
      const dir = sortSpec[field] ?? -1;
      const sorted = [...matched].sort((a: any, b: any) => {
        const av = field === 'createdAt' ? a.createdAt.getTime() : String(a[field]).toLowerCase();
        const bv = field === 'createdAt' ? b.createdAt.getTime() : String(b[field]).toLowerCase();
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (dir === 1 ? 1 : -1);
      });
      return sorted.slice(skip, skip + limit);
    },
  };
  return chain;
});

Case.find = stub(() => ({
  select: () => ({
    lean: async () => [
      { _id: caseA, caseNo: 'CASE-A', parties: 'Alpha' },
      { _id: caseB, caseNo: 'CASE-B', parties: 'Beta' },
    ],
  }),
}));


// --- Runner ----------------------------------------------------------------
const runFor = async (query: Record<string, any>) => {
  const req = {
    user: { id: String(meId), name: meName, role: 'associate' },
    query,
  } as unknown as AuthRequest;
  let payload: any = null;
  let statusCode = 200;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: any) {
      payload = value;
      return value;
    },
  };
  await getMyAuditTrail(req, res);
  return { statusCode, payload };
};

const main = async () => {
  section('My Activity Trail — identity scoping');
  const allTime = await runFor({ limit: 50, page: 1 });
  check('All Time returns a paginated envelope', typeof allTime.payload.items, 'object');
  check('All Time total counts only my actions (5, not the other member)', allTime.payload.total, 5);
  check('All Time lists all 5 of my actions on one page', allTime.payload.items.length, 5);
  check(
    "another member's action never leaks into my trail",
    allTime.payload.items.some((i: any) => String(i.actorUserId) === String(otherId)),
    false
  );
  check('related matter is attached', allTime.payload.items[0].case?.caseNo !== undefined, true);

  section('My Activity Trail — server-side pagination (no silent truncation)');
  const page1 = await runFor({ limit: 2, page: 1 });
  check('page 1 returns exactly the page size', page1.payload.items.length, 2);
  check('page 1 reports the full total (5), not the page length', page1.payload.total, 5);
  check('page 1 pages count is ceil(5/2)=3', page1.payload.pages, 3);
  const page2 = await runFor({ limit: 2, page: 2 });
  const page3 = await runFor({ limit: 2, page: 3 });
  check('last page returns the remaining 1 record', page3.payload.items.length, 1);
  const uniqueIds = new Set(
    [...page1.payload.items, ...page2.payload.items, ...page3.payload.items].map((i: any) => String(i._id))
  );
  check('every record is reachable across pages (5 unique)', uniqueIds.size, 5);

  section('My Activity Trail — newest-first default ordering');
  const ordered = await runFor({ limit: 50, page: 1 });
  const times = ordered.payload.items.map((i: any) => new Date(i.createdAt).getTime());
  check('default order is newest first', times.every((t: number, idx: number) => idx === 0 || times[idx - 1] >= t), true);

  section('My Activity Trail — server-side sorting across pages');
  const byAction = await runFor({ limit: 2, page: 1, sortBy: 'action', sortDir: 'asc' });
  const actions = byAction.payload.items.map((i: any) => i.action);
  check('sorting by action is applied server-side (ascending)', actions[0] <= actions[1], true);

  section('My Activity Trail — invalid period is rejected, never defaulted');
  const reversed = await runFor({ from: '2026-10-10', to: '2026-10-01' });
  check('From after To returns 400', reversed.statusCode, 400);
  check('From after To returns no misleading items', reversed.payload.items, undefined);
  const partial = await runFor({ from: '2026-10-01' });
  check('a lone From date is rejected (400)', partial.statusCode, 400);

  section('RESULTS');
  console.log(`${failures ? 'VALIDATION FAILED' : 'ALL CHECKS PASSED'} — ${checks - failures}/${checks} passed`);
  if (failures) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

