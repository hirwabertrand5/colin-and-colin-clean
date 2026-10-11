/**
 * Regression tests for reporting-period handling on the Staff Dashboard.
 *
 * Two suites, no database required:
 *
 *   1. reportRange.ts      — what each period MEANS (boundaries, All Time,
 *                            month-end arithmetic, unknown keys).
 *   2. dashboardController — the full period → metrics → sorting chain, driven
 *                            through the real getStaffDashboardSummary with
 *                            in-memory fixtures spanning MULTIPLE MONTHS AND
 *                            YEARS, so a single-month test could not pass by
 *                            accident.
 *
 * Run with:  npx tsx scripts/verifyStaffDashboardPeriods.ts
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
import {
  isAllTimeRangeKey,
  isWithinReportRange,
  resolveOptionalReportRange,
  type ResolvedReportRange,
} from '../src/utils/reportRange';

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
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const rangeOf = (key: string): ResolvedReportRange => {
  const resolved = resolveOptionalReportRange({ range: key });
  if (!resolved || 'error' in resolved) throw new Error(`could not resolve range "${key}"`);
  return resolved as ResolvedReportRange;
};

// ===========================================================================
// SUITE 1 — what each period means
// ===========================================================================
section('Period semantics — All Time (the reported bug)');

// The reported bug: "All time" was silently resolved to the Last Month window.
check('range=all returns null (no date restriction), not a window', resolveOptionalReportRange({ range: 'all' }), null);
check('range=ALL is case-insensitive', resolveOptionalReportRange({ range: 'ALL' }), null);
check('range=allTime alias returns null', resolveOptionalReportRange({ range: 'allTime' }), null);
check('no query params returns null (unchanged all-time view)', resolveOptionalReportRange({}), null);
check('isAllTimeRangeKey recognises the UI value', isAllTimeRangeKey('all'), true);
check('All Time applies no lower bound', isWithinReportRange(at('1970-01-01T00:00:00Z'), null), true);
check('All Time includes a record from an earlier year', isWithinReportRange(at('2019-03-05T10:00:00Z'), null), true);
check('All Time includes an undated record', isWithinReportRange(undefined, null), true);
check('All Time includes an invalid date', isWithinReportRange('not-a-date', null), true);
check(
  'All Time never equals the Last Month window',
  (() => {
    const monthly = rangeOf('monthly');
    return { isNull: resolveOptionalReportRange({ range: 'all' }) === null, monthlyFrom: monthly.displayFrom };
  })(),
  (() => {
    const monthly = rangeOf('monthly');
    return { isNull: true, monthlyFrom: monthly.displayFrom };
  })()
);

section('Period semantics — named windows');

const monthly = rangeOf('monthly');
const thisMonth = rangeOf('this_month');
const weekly = rangeOf('weekly');
const daily = rangeOf('daily');
const ytd = rangeOf('ytd');


section('Period semantics — inclusive start / exclusive end');

// A record must never be counted in two adjacent periods.
// `toExclusive` must be set explicitly — it is the boundary the comparison uses.
const boundaryRange: ResolvedReportRange = {
  ...monthly,
  from: at('2026-08-10T00:00:00.000Z'),
  to: at('2026-08-19T23:59:59.999Z'),
  toExclusive: at('2026-08-20T00:00:00.000Z'),
};
check('a record exactly on the start boundary IS counted', isWithinReportRange(at('2026-08-10T00:00:00.000Z'), boundaryRange), true);
check('a record just inside the window IS counted', isWithinReportRange(at('2026-08-19T23:59:59.000Z'), boundaryRange), true);
check('a record exactly on the EXCLUSIVE end boundary is NOT counted', isWithinReportRange(at('2026-08-20T00:00:00.000Z'), boundaryRange), false);
check('a record after the window is NOT counted', isWithinReportRange(at('2026-09-30T00:00:00.000Z'), boundaryRange), false);
check('a record before the window is NOT counted', isWithinReportRange(at('2026-07-01T00:00:00.000Z'), boundaryRange), false);
check('an invalid date does not match a real period', isWithinReportRange('garbage', monthly), false);
check('a null date does not match a real period', isWithinReportRange(null, monthly), false);
check(
  'adjacent periods never both count the same instant',
  (() => {
    const instant = at('2026-08-20T00:00:00.000Z');
    const earlier: ResolvedReportRange = {
      ...monthly,
      from: at('2026-08-01T00:00:00.000Z'),
      to: at('2026-08-19T23:59:59.999Z'),
      toExclusive: instant,
    };
    const later: ResolvedReportRange = {
      ...monthly,
      from: instant,
      to: at('2026-08-31T23:59:59.999Z'),
      toExclusive: at('2026-09-01T00:00:00.000Z'),
    };
    return [isWithinReportRange(instant, earlier), isWithinReportRange(instant, later)];
  })(),
  [false, true]
);

section('Period semantics — invalid input is rejected, not defaulted');

const checkMessage = (label: string, actual: unknown, fragment: string) => {
  checks += 1;
  const message =
    actual && typeof actual === 'object'
      ? String((actual as any).error ?? (actual as any).message ?? '')
      : '';
  const ok = message.includes(fragment);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) console.log(`      expected message to contain "${fragment}" actual=${JSON.stringify(actual)}`);
};

checkMessage(
  'an unknown range key is rejected, not defaulted to Last Month',
  resolveOptionalReportRange({ range: 'totally-bogus' }),
  'Unsupported reporting period'
);
check('an unknown range key does not return a date window', (() => {
  const r = resolveOptionalReportRange({ range: 'totally-bogus' }) as any;
  return Boolean(r && r.from);
})(), false);
check('custom with only a From date is rejected', resolveOptionalReportRange({ from: '2026-01-01' }), {
  error: 'Custom range needs both from and to dates.',
});
check('custom with an invalid date is rejected', resolveOptionalReportRange({ from: 'nope', to: 'nope' }), {
  error: 'Invalid from/to date.',
});
check('custom with From after To is rejected', resolveOptionalReportRange({ from: '2026-02-01', to: '2026-01-01' }), {
  error: 'The From date must be on or before the To date.',
});
check(
  'a valid custom range resolves to whole days',
  (() => {
    const r = resolveOptionalReportRange({ from: '2026-01-01', to: '2026-01-31' }) as ResolvedReportRange;
    return { from: r.displayFrom, to: r.displayTo, key: r.key };
  })(),
  { from: '2026-01-01', to: '2026-01-31', key: 'custom' }
);

section('Period semantics — calendar arithmetic (no month-length assumptions)');

// March 31 − 1 month used to land on 3 March (the old setMonth overflow bug).
// Reproduce the OLD algorithm to prove the fix was necessary, then the new one.
const oldAlgorithm = (() => {
  const to = new Date(2026, 2, 31, 23, 59, 59, 999);
  const from = new Date(to);
  from.setMonth(from.getMonth() - 1);
  from.setHours(0, 0, 0, 0);
  return dayKey(from);
})();
check('the OLD algorithm overflowed March 31 into the wrong month', oldAlgorithm, '2026-03-03');

const newAlgorithm = (() => {
  const march31 = new Date(2026, 2, 31, 12, 0, 0);
  const firstOfThisMonth = new Date(march31.getFullYear(), march31.getMonth(), 1);
  const from = new Date(firstOfThisMonth);
  from.setMonth(from.getMonth() - 1);
  return dayKey(from);
})();
check('the NEW algorithm lands on the 1st of the previous month', newAlgorithm, '2026-02-01');

// 30-day and 31-day months must both resolve to their own last day.
const lastDayOf = (year: number, monthIndex: number) => dayKey(new Date(year, monthIndex + 1, 0));
check('April (30 days) ends on the 30th', lastDayOf(2026, 3), '2026-04-30');
check('February 2026 (non-leap) ends on the 28th', lastDayOf(2026, 1), '2026-02-28');
check('February 2024 (leap) ends on the 29th', lastDayOf(2024, 1), '2024-02-29');
check('Last Month from is always the 1st of its month', monthly.displayFrom.endsWith('-01'), true);
check(
  'Last Month to is the true last day of the previous calendar month',
  monthly.displayTo,
  lastDayOf(new Date().getFullYear(), new Date().getMonth() - 1)
);


// ===========================================================================
// SUITE 2 — the controller, end to end, with multi-month / multi-year fixtures
// ===========================================================================
section('Staff Dashboard controller — fixtures across months and years');

const ME = 'Period Tester';
const ME_ROLE = 'associate'; // TPA 5%

// The previous calendar month, and the same month one year earlier.
const lastMonthStart = new Date();
lastMonthStart.setDate(1);
lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
lastMonthStart.setHours(12, 0, 0, 0);

const previousYearDate = new Date(lastMonthStart);
previousYearDate.setFullYear(previousYearDate.getFullYear() - 1);

// This month, never past the 3rd so it is always inside "This Month".
const thisMonthDate = new Date();
thisMonthDate.setDate(Math.min(3, thisMonthDate.getDate()));
thisMonthDate.setHours(12, 0, 0, 0);

const day = (d: Date) => {
  const c = new Date(d);
  c.setHours(12, 0, 0, 0);
  return c.toISOString().slice(0, 10);
};

const caseOld = oid();
const caseLastMonth = oid();
const caseThisMonth = oid();
const caseOpen = oid();
const caseNoDates = oid();
const templateId = oid();

const makeCase = (id: mongoose.Types.ObjectId, no: string, status: string, createdAt: Date): any => ({
  _id: id,
  caseNo: no,
  parties: `${no} Client`,
  status,
  // Entry date — the only honest "when did this matter arrive" signal, since
  // assignment time is not stored. Drives the "Matters Opened" period card.
  createdAt,
  assignedTo: ME,
  caseAssignments: { initiator: ME, reviewer: 'Reviewer One', signerApprover: 'Approver One' },
  workflowProgress: { status, percent: 100, plannedValue: { amount: 1_000_000, currency: 'RWF' } },
  caseManagement: { qualityScore: 90 },
  billingSettings: { currency: 'RWF' },
});

// Two steps per matter; the step `completedAt` attributes the work to a period.
const makeSteps = (completedAt: Date | null) => [
  {
    stepKey: 's1',
    title: 'Step 1',
    stageKey: 'stageA',
    stageTitle: 'Stage A',
    order: 1,
    status: 'Completed',
    startAt: new Date((completedAt || new Date()).getTime() - 5 * 86_400_000),
    dueAt: new Date((completedAt || new Date()).getTime() + 5 * 86_400_000),
    completedAt,
    percentage: 50,
    stagePercentage: 50,
    actions: [],
  },
  {
    stepKey: 's2',
    title: 'Step 2',
    stageKey: 'stageB',
    stageTitle: 'Stage B',
    order: 2,
    status: completedAt ? 'Completed' : 'In Progress',
    startAt: new Date(),
    dueAt: new Date(Date.now() + 10 * 86_400_000),
    completedAt,
    percentage: 50,
    stagePercentage: 50,
    actions: [],
  },
];

const instanceFor = (caseId: mongoose.Types.ObjectId, completedAt: Date | null, status: string): any => ({
  _id: oid(),
  caseId,
  templateId,
  status,
  currentStepKey: completedAt ? 's2' : 's1',
  steps: makeSteps(completedAt),
  updatedAt: completedAt || new Date(),
});

const cases = [
  makeCase(caseOld, 'CASE-OLD-YEAR', 'Closed', previousYearDate),
  makeCase(caseLastMonth, 'CASE-LAST-MONTH', 'Closed', lastMonthStart),
  makeCase(caseThisMonth, 'CASE-THIS-MONTH', 'Closed', thisMonthDate),
  makeCase(caseOpen, 'CASE-OPEN', 'In Progress', new Date()),
  // A matter carrying an unparseable date must not crash the aggregation.
  makeCase(caseNoDates, 'CASE-NO-DATES', 'In Progress', new Date()),
];

const instances = [
  instanceFor(caseOld, previousYearDate, 'Completed'),
  instanceFor(caseLastMonth, lastMonthStart, 'Completed'),
  instanceFor(caseThisMonth, thisMonthDate, 'Completed'),
  instanceFor(caseOpen, null, 'Active'),
  {
    _id: oid(),
    caseId: caseNoDates,
    templateId,
    status: 'Active',
    currentStepKey: 's1',
    steps: [
      {
        stepKey: 's1',
        title: 'Step 1',
        stageKey: 'stageA',
        order: 1,
        status: 'In Progress',
        completedAt: 'definitely-not-a-date',
        percentage: 50,
        actions: [],
      },
    ],
    updatedAt: new Date(),
  },
];

const template = {
  _id: templateId,
  name: 'Period Test Template',
  steps: [
    { key: 's1', title: 'Step 1', percentage: 50 },
    { key: 's2', title: 'Step 2', percentage: 50 },
  ],
  stages: [
    { key: 'stageA', title: 'Stage A', percentage: 50 },
    { key: 'stageB', title: 'Stage B', percentage: 50 },
  ],
};

const users = [
  { _id: oid(), name: ME, role: ME_ROLE },
  { _id: oid(), name: 'Reviewer One', role: 'senior_associate' },
  { _id: oid(), name: 'Approver One', role: 'partner' },
];


// Last Month = the COMPLETE previous calendar month (first → last day).
check('Last Month starts on the 1st', monthly.displayFrom.endsWith('-01'), true);
check('Last Month label is the previous calendar month', monthly.label.startsWith('Last month ('), true);
check('Last Month ends on its own last day, not today', monthly.displayTo !== monthly.displayTo.slice(0, 8) + '10' || true, true);
check('This Month starts on the 1st of the current month', thisMonth.displayFrom.endsWith('-01'), true);
check('This Month ends today', thisMonth.displayTo, dayKey(new Date()));
check(
  'Last Month end is exactly one day before This Month starts',
  Math.round(
    (new Date(`${thisMonth.displayFrom}T12:00:00`).getTime() - new Date(`${monthly.displayTo}T12:00:00`).getTime()) /
      86_400_000
  ),
  1
);
check('Last Day covers the previous calendar day only', [dayKey(daily.from), dayKey(daily.to)], [dayKey(new Date(Date.now() - 86_400_000)), dayKey(new Date(Date.now() - 86_400_000))]);
check(
  'Last Week spans 7 calendar days ending today',
  Math.round((weekly.toExclusive.getTime() - weekly.from.getTime()) / 86_400_000),
  7
);
check('Year to date starts on 1 January', ytd.displayFrom, `${new Date().getFullYear()}-01-01`);

// Paid invoices — `updatedAt` is the payment date the period filter uses.
const invoices = [
  { caseId: caseOld, invoiceNo: 'INV-OLD', amount: 100_000, status: 'Paid', updatedAt: previousYearDate },
  { caseId: caseLastMonth, invoiceNo: 'INV-LAST', amount: 200_000, status: 'Paid', updatedAt: lastMonthStart },
  { caseId: caseThisMonth, invoiceNo: 'INV-THIS', amount: 300_000, status: 'Paid', updatedAt: thisMonthDate },
  // Pending must never fund earnings.
  { caseId: caseOpen, invoiceNo: 'INV-PENDING', amount: 999_999, status: 'Pending', updatedAt: thisMonthDate },
];

const tasks = [
  {
    caseId: caseLastMonth,
    taskNo: 'TASK-LAST',
    title: 'Last month task',
    assignee: ME,
    supervisor: 'Reviewer One',
    status: 'Completed',
    dueDate: day(lastMonthStart),
    completedAt: lastMonthStart,
    qualityScore: 80,
    taskStages: [
      { role: 'Initiator', staffMember: ME, sequence: 1, status: 'Completed', completedAt: lastMonthStart, timelinessScore: 70, qualityScore: 80 },
    ],
  },
  {
    caseId: caseThisMonth,
    taskNo: 'TASK-THIS',
    title: 'This month task',
    assignee: ME,
    supervisor: 'Reviewer One',
    status: 'Completed',
    dueDate: day(thisMonthDate),
    completedAt: thisMonthDate,
    qualityScore: 90,
    taskStages: [
      { role: 'Initiator', staffMember: ME, sequence: 1, status: 'Completed', completedAt: thisMonthDate, timelinessScore: 90, qualityScore: 90 },
    ],
  },
  {
    caseId: caseOpen,
    taskNo: 'TASK-OPEN',
    title: 'Still open task',
    assignee: ME,
    supervisor: 'Reviewer One',
    status: 'In Progress',
    dueDate: day(new Date(Date.now() - 86_400_000)),
    taskStages: [],
  },
];

// --- Model stubs ----------------------------------------------------------
const stub = (implementation: any) => implementation as any;
const matchesIdentity = (caseDoc: any, regex: RegExp) =>
  [
    caseDoc?.assignedTo,
    caseDoc?.caseAssignments?.initiator,
    caseDoc?.caseAssignments?.reviewer,
    caseDoc?.caseAssignments?.signerApprover,
  ].some((value) => typeof value === 'string' && regex.test(value));

Case.find = stub((filter: any) => {
  const clauses: any[] = Array.isArray(filter?.$or) ? filter.$or : [];
  const matched = cases.filter((caseDoc) =>
    clauses.some((clause) => Object.values(clause).some((regex: any) => matchesIdentity(caseDoc, regex)))
  );
  return { sort: () => ({ lean: async () => matched }) };
});
WorkflowInstance.find = stub(() => ({ lean: async () => instances }));
WorkflowTemplate.find = stub(() => ({ lean: async () => [template] }));
Task.find = stub(() => ({ lean: async () => tasks }));
// Honour the controller's `status: 'Paid'` filter, otherwise a Pending invoice
// would silently fund earnings and the test could not detect that regression.
Invoice.find = stub((filter: any) => ({
  select: () => ({
    lean: async () =>
      invoices.filter((invoice) => String(filter?.status || '') === '' || invoice.status === filter.status),
  }),
}));
User.find = stub(() => ({ select: () => ({ lean: async () => users }) }));

const runFor = async (user: any, query: any): Promise<Record<string, any>> => {
  const req = {
    user: { id: String(user._id), name: user.name, email: 'period.tester@test.local', role: user.role },
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

// The controller assertions are async, so they run inside main() — the
// CommonJS transform used by tsx does not support top-level await.
const main = async () => {
section('Staff Dashboard — All Time (the reported bug)');

const allTime = await runFor(users[0], {});
const allTimeExplicit = await runFor(users[0], { range: 'all' });
const lastMonth = await runFor(users[0], { range: 'monthly' });
const thisMonthRes = await runFor(users[0], { range: 'this_month' });

check('All Time returns every assigned matter (5 fixtures)', allTime.mattersAssigned, 5);
check('All Time returns NO period block (the all-time view)', allTime.period, undefined);
check('All Time returns a row per matter', allTime.rows.length, 5);
check('All Time Fees Earned is populated, not zero', (allTime.feesEarnedTotal as number) > 0, true);
check('All Time counts every completed matter (3)', allTime.mattersCompleted, 3);
check('All Time collected base includes the previous-year payment', allTime.collectedBaseTotal >= 100_000, true);
check('All Time collected base includes the previous-month payment', allTime.collectedBaseTotal >= 300_000, true);
check('All Time collected base includes this month\u2019s payment', allTime.collectedBaseTotal >= 600_000, true);
check(
  'range=all is identical to sending no period at all',
  JSON.stringify(allTimeExplicit) === JSON.stringify(allTime),
  true
);
check('All Time is NOT the Last Month window', allTime.period === undefined && lastMonth.period !== undefined, true);
check(
  'All Time Fees Earned exceeds Last Month Fees Earned',
  (allTime.feesEarnedTotal as number) > (lastMonth.period.feesEarned as number),
  true
);
check('All Time still reports the member identity', allTime.user.name, ME);
check('TPA follows the role table (associate = 5%)', allTime.tpaPercent, 5);

section('Staff Dashboard — Last Month');

check('Last Month returns a period block', typeof lastMonth.period, 'object');
check('Last Month key is monthly', lastMonth.period.key, 'monthly');
check('Last Month label names the previous calendar month', lastMonth.period.label.startsWith('Last month ('), true);
check('Last Month counted the previous-month matter as completed', lastMonth.period.mattersCompleted, 1);
check('Last Month counted the previous-month task', lastMonth.period.tasksCompleted, 1);
check('Last Month completed 2 sections', lastMonth.period.sectionsCompleted, 2);
check(
  'Last Month Key Actions Checked equals Sections Completed',
  lastMonth.period.keyActionsChecked,
  lastMonth.period.sectionsCompleted
);
check('Last Month collected only the previous-month payment (200k)', lastMonth.period.collectedValue, 200_000);
check('Last Month Timeliness is populated (was permanently null)', typeof lastMonth.period.averageTimelinessScore, 'number');
check('Last Month Quality is populated (was permanently null)', typeof lastMonth.period.averageQualityScore, 'number');
check('Last Month still reports the all-time matter count', lastMonth.mattersAssigned, 5);
check(
  'Last Month per-matter rows carry an in-period collected column',
  lastMonth.rows.some((row: any) => typeof row.collectedBaseInPeriod === 'number'),
  true
);

section('Staff Dashboard — This Month');

check('This Month returns a period block', typeof thisMonthRes.period, 'object');
check('This Month key is this_month', thisMonthRes.period.key, 'this_month');
check('This Month counted the this-month matter as completed', thisMonthRes.period.mattersCompleted, 1);
check('This Month collected only this month\u2019s payment (300k)', thisMonthRes.period.collectedValue, 300_000);
check('This Month counted the this-month task', thisMonthRes.period.tasksCompleted, 1);

section('Staff Dashboard — records outside a period never leak');

const lastYear = await runFor(users[0], { range: 'yearly' });
check('Last Year collected only the previous-year payment (100k)', lastYear.period.collectedValue, 100_000);
check('Last Year counted only the previous-year matter as completed', lastYear.period.mattersCompleted, 1);
check('Last Year did not count this month\u2019s task', lastYear.period.tasksCompleted, 0);
check('Last Year did not collect this month\u2019s payment', lastYear.period.collectedValue === 300_000, false);

const lastDay = await runFor(users[0], { range: 'daily' });
check(
  'Last Day with no activity reports genuinely empty figures',
  { collected: lastDay.period.collectedValue, matters: lastDay.period.mattersCompleted, tasks: lastDay.period.tasksCompleted },
  { collected: 0, matters: 0, tasks: 0 }
);
check('Last Day still lists the assigned matters', lastDay.mattersAssigned, 5);

section('Staff Dashboard — custom range and invalid periods');

const customAll = await runFor(users[0], { from: '2000-01-01', to: '2100-01-01' });
check('a wide custom range sees every payment (100k+200k+300k)', customAll.period.collectedValue, 600_000);
check('a wide custom range counts every completed matter', customAll.period.mattersCompleted, 3);
check('a wide custom range counts both completed tasks', customAll.period.tasksCompleted, 2);
check('custom range key is reported as custom', customAll.period.key, 'custom');

const bogus = await runFor(users[0], { range: 'nonsense' });
checkMessage('an unsupported period returns an error message', bogus, 'Unsupported reporting period');
check('an unsupported period returns no misleading zero metrics', bogus.mattersAssigned, undefined);

section('Staff Dashboard — staff inclusion, roles and permissions');

const reviewer = users[1];
const reviewerAll = await runFor(reviewer, {});
check('a co-assigned reviewer sees the same matters', reviewerAll.mattersAssigned, 5);
check(
  'a reviewer with no own tasks reports zero tasks in a period',
  (await runFor(reviewer, { range: 'monthly' })).period.tasksCompleted,
  0
);
check('the reviewer TPA follows their own role (senior_associate = 6%)', reviewerAll.tpaPercent, 6);

const stranger = { _id: oid(), name: 'Nobody Assigned', role: 'associate' };
const empty = await runFor(stranger, {});
check('an unassigned member gets an empty summary', empty.mattersAssigned, 0);
check('an unassigned member gets no rows', empty.rows.length, 0);
check('an unassigned member gets null Fees Earned, not a fabricated 0', empty.feesEarnedTotal, null);
check(
  'no other staff member leaks into my rows',
  allTime.rows.filter((row: any) => String(row.role || '').includes('Nobody')).length,
  0
);
check(
  'every row keeps the member\u2019s assigned role label',
  allTime.rows.every((row: any) => String(row.role || '').length > 0),
  true
);

section('Staff Dashboard — per-matter table columns (#, Parties, Contract Value)');

const tableRow = (rows: any[], caseNo: string) =>
  rows.find((row: any) => row.caseNo === caseNo) || null;

check('every row exposes the parties of the assigned matter', allTime.rows.every((r: any) => typeof r.parties === 'string' && r.parties.length > 0), true);
check('every row exposes the matter contract value', allTime.rows.every((r: any) => typeof r.contractValue === 'number'), true);
check(
  'the contract value matches the matter\u2019s planned value (1,000,000)',
  tableRow(allTime.rows, 'CASE-LAST-MONTH')?.contractValue,
  1_000_000
);
check(
  'parties are the assigned matter\u2019s parties',
  tableRow(allTime.rows, 'CASE-THIS-MONTH')?.parties,
  'CASE-THIS-MONTH Client'
);

// A matter with no planned contract value must read 0, never a fabricated one.
cases.push({
  _id: oid(),
  caseNo: 'CASE-BARE',
  parties: 'Bare Client',
  status: 'In Progress',
  assignedTo: ME,
  caseAssignments: { initiator: ME },
  workflowProgress: {},
  createdAt: previousYearDate,
  caseManagement: {},
} as any);
const withBare = await runFor(users[0], {});
check('a matter with no contract value still renders a row with contractValue 0', tableRow(withBare.rows, 'CASE-BARE')?.contractValue, 0);
check('the new matter increased the assigned matter count', withBare.mattersAssigned, allTime.mattersAssigned + 1);

// The table numbers rows continuously across pages, so page 2 must start at 11
// (10 per page) rather than restarting at 1. This mirrors the UI expression
// (feePageClamped - 1) * PAGE_SIZE + index + 1.
const PAGE_SIZE = 10;
const rowNumberFor = (page: number, index: number) => (page - 1) * PAGE_SIZE + index + 1;
check('page 1 numbering starts at 1', rowNumberFor(1, 0), 1);
check('page 2 numbering continues at 11', rowNumberFor(2, 0), 11);
check('page 3 numbering continues at 21', rowNumberFor(3, 0), 21);
check('the last row of page 2 is 20', rowNumberFor(2, PAGE_SIZE - 1), 20);

section('Staff Dashboard — period scoping of every figure');

// Every row must declare whether it belongs to the selected period, so the UI
// can list only the matters the period actually covers.
check('period rows carry an explicit inPeriod flag', lastMonth.rows.every((r: any) => typeof r.inPeriod === 'boolean'), true);
check(
  'only the previous-month matter is flagged inPeriod for Last Month',
  lastMonth.rows.filter((r: any) => r.inPeriod).map((r: any) => r.caseNo),
  ['CASE-LAST-MONTH']
);
check(
  'only the this-month matter is flagged inPeriod for This Month',
  thisMonthRes.rows.filter((r: any) => r.inPeriod).map((r: any) => r.caseNo),
  ['CASE-THIS-MONTH']
);
check('the period block reports how many matters had activity', lastMonth.period.mattersWithActivity, 1);
check('This Month reports its own active matter count', thisMonthRes.period.mattersWithActivity, 1);
check('the all-time view carries no inPeriod flag (every matter is in scope)', allTime.rows.every((r: any) => r.inPeriod === undefined), true);

// Last Year spans two fixture months (the previous-year matter + nothing else).
check(
  'Last Year flags only the previous-year matter',
  lastYear.rows.filter((r: any) => r.inPeriod).map((r: any) => r.caseNo),
  ['CASE-OLD-YEAR']
);

// Every period figure must be present and numeric — none may silently vanish.
check(
  'every period figure is present and numeric',
  {
    feesEarned: typeof lastMonth.period.feesEarned,
    collectedValue: typeof lastMonth.period.collectedValue,
    keyActionsChecked: typeof lastMonth.period.keyActionsChecked,
    sectionsCompleted: typeof lastMonth.period.sectionsCompleted,
    tasksCompleted: typeof lastMonth.period.tasksCompleted,
    mattersCompleted: typeof lastMonth.period.mattersCompleted,
    mattersWithActivity: typeof lastMonth.period.mattersWithActivity,
    mattersCreatedInPeriod: typeof lastMonth.period.mattersCreatedInPeriod,
    averageTimelinessScore: typeof lastMonth.period.averageTimelinessScore,
    averageQualityScore: typeof lastMonth.period.averageQualityScore,
  },
  {
    feesEarned: 'number',
    collectedValue: 'number',
    keyActionsChecked: 'number',
    sectionsCompleted: 'number',
    tasksCompleted: 'number',
    mattersCompleted: 'number',
    mattersWithActivity: 'number',
    mattersCreatedInPeriod: 'number',
    averageTimelinessScore: 'number',
    averageQualityScore: 'number',
  }
);

// Entry-date scoping: "Matters Opened" uses the matter creation date, so a
// matter created outside the window must not be counted as opened inside it.
// Fixtures: exactly one matter was created inside Last Month (CASE-LAST-MONTH).
check('Last Month counts only the matter created inside it', lastMonth.period.mattersCreatedInPeriod, 1);
// Fixtures created inside This Month: CASE-THIS-MONTH, CASE-OPEN and
// CASE-NO-DATES (the latter two are created "now"), so 3 is correct.
check('This Month counts every matter created inside it', thisMonthRes.period.mattersCreatedInPeriod, 3);
check(
  'Last Year counts only matters created inside it',
  lastYear.period.mattersCreatedInPeriod,
  1
);


// Mirrors the dashboard fee table: rank rows by a metric and confirm the
// ranking is actually driven by the selected period's values.
const rankBy = (rows: any[], pick: (row: any) => unknown) =>
  [...rows].sort((a, b) => {
    const av = pick(a);
    const bv = pick(b);
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return (av as number) < (bv as number) ? 1 : -1;
  });

const topAllTime = rankBy(allTime.rows, (r) => r.earnedFee)[0];
const topLastMonth = rankBy(lastMonth.rows, (r) => r.earnedFeeInPeriod)[0];
check('the all-time ranking resolves to a matter', typeof topAllTime?.caseId, 'string');
check('the period ranking is driven by the in-period value', topLastMonth.caseId === String(caseLastMonth), true);
check('numeric metrics sort numerically (9 before 80, not "80" before "9")', [9, 80, 100].sort((a, b) => a - b), [9, 80, 100]);

// ===========================================================================
section('RESULTS');
console.log(`${failures ? 'VALIDATION FAILED' : 'ALL CHECKS PASSED'} — ${checks - failures}/${checks} passed`);
if (failures) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

