/**
 * Focused validation for the period-based Staff Earnings attribution.
 *
 * Run with:  npx tsx scripts/verifyStaffEarningsPeriod.ts
 *
 * Covers, without a database:
 *   - date boundaries / timezone behaviour of the period filter
 *   - action-level attribution to the completion period (the worked example:
 *     1,000 of work in one month and 200 in the next land in two periods)
 *   - the paid-collection cap and the "never counted twice" allocation rule
 *   - the TPA x timeliness x quality calculation
 *   - staff and role filtering
 *   - missing inputs (no invented scores, percentages or staff mappings)
 *   - duplicate prevention / reopen behaviour via the deterministic entry key
 */
import {
  buildStaffEarningsRows,
  buildLedgerEntryKey,
  filterRowsToPeriod,
  round2,
  summarizeStaffEarnings,
} from '../src/utils/staffEarningsLedger';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
};

// --- Fixtures -------------------------------------------------------------

const templateId = 'TPL-1';
const caseId = 'CASE-1';

// Contract value 10,000 with two Key Actions at 10% (1,000) and 2% (200).
// A1 completes in March and A2 in April, so they must land in two periods.
const template = {
  _id: templateId,
  stages: [
    { key: 's1', title: 'Stage One', percentage: 60 },
    { key: 's2', title: 'Stage Two', percentage: 40 },
  ],
  steps: [
    { key: 'a1', title: 'Key Action A', stageKey: 's1', stageTitle: 'Stage One', percentage: 10 },
    { key: 'a2', title: 'Key Action B', stageKey: 's2', stageTitle: 'Stage Two', percentage: 2 },
  ],
};

const matter = {
  _id: caseId,
  caseNo: 'CASE-TEST-001',
  parties: 'Test Client',
  matterType: 'Commercial',
  workflowTemplateId: templateId,
  assignedTo: 'Alice',
  caseAssignments: { initiator: 'Alice', reviewer: 'Bob' },
  workflowProgress: { plannedValue: { amount: 10000, currency: 'RWF' } },
  caseManagement: { qualityScore: 100, qualityScoredBy: 'Bob', qualityScoredAt: new Date('2026-03-01T00:00:00Z') },
};

const instance = {
  caseId,
  templateId,
  status: 'Active',
  steps: [
    {
      stepKey: 'a1',
      title: 'Key Action A',
      stageKey: 's1',
      stageTitle: 'Stage One',
      percentage: 10,
      status: 'Completed',
      startAt: new Date('2026-03-01T08:00:00Z'),
      dueAt: new Date('2026-03-11T08:00:00Z'),
      submittedAt: new Date('2026-03-05T09:30:00Z'),
      completedAt: new Date('2026-03-11T08:00:00Z'),
      actions: [{ text: 'Draft', done: true, doneAt: new Date('2026-03-05T09:00:00Z') }],
    },
    {
      stepKey: 'a2',
      title: 'Key Action B',
      stageKey: 's2',
      stageTitle: 'Stage Two',
      percentage: 2,
      status: 'Completed',
      startAt: new Date('2026-04-01T08:00:00Z'),
      dueAt: new Date('2026-04-11T08:00:00Z'),
      // No submittedAt, so the last ticked action decides â€” the existing rule.
      completedAt: new Date('2026-04-11T08:00:00Z'),
      actions: [{ text: 'File', done: true, doneAt: new Date('2026-04-07T14:15:00Z') }],
    },
  ],
};

const users = [
  { name: 'Alice', role: 'associate' },
  { name: 'Bob', role: 'senior_associate' },
];

const build = (overrides: any = {}) =>
  buildStaffEarningsRows({
    matters: [matter],
    templatesById: new Map([[templateId, template]]),
    instancesByCaseId: new Map([[caseId, instance]]),
    tasksByCaseId: new Map(),
    paidInvoicesByCaseId: new Map(),
    users,
    from: new Date('2026-01-01T00:00:00Z'),
    to: new Date('2026-12-31T23:59:59Z'),
    ...overrides,
  });

const marchRange = { from: new Date('2026-03-01T00:00:00Z'), to: new Date('2026-03-31T23:59:59Z') };
const aprilRange = { from: new Date('2026-04-01T00:00:00Z'), to: new Date('2026-04-30T23:59:59Z') };

const rowFor = (rows: any[], keyActionKey: string, staffName: string) =>
  rows.find((row) => row.keyActionKey === keyActionKey && row.staffName === staffName);

const paid = (amount: number, day = 20) => ({
  paidInvoicesByCaseId: new Map([
    [caseId, [{ invoiceNo: `INV-${amount}`, amount, paidAt: new Date(`2026-03-${day}T00:00:00Z`) }]],
  ]),
});

// --- 1. Action-level attribution to the completion period ----------------
// The worked example: 1,000 of work in one month, 200 in the next.

const marchKeys = Array.from(new Set(filterRowsToPeriod(build({ ...marchRange })).map((row) => row.keyActionKey)));
check('March period contains only the March Key Action', marchKeys, ['a1']);

const aprilKeys = Array.from(new Set(filterRowsToPeriod(build({ ...aprilRange })).map((row) => row.keyActionKey)));
check('April period contains only the April Key Action', aprilKeys, ['a2']);

const a1Row = rowFor(filterRowsToPeriod(build({ ...marchRange })), 'a1', 'Alice');
const a2Row = rowFor(filterRowsToPeriod(build({ ...aprilRange })), 'a2', 'Alice');
check('a1 work value = 10,000 x 10%', a1Row?.grossActionValue, 1000);
check('a2 work value = 10,000 x 2%', a2Row?.grossActionValue, 200);

// --- 2. Date boundaries and timezone -------------------------------------

const boundary = filterRowsToPeriod(build({ from: new Date('2026-03-05T09:30:00Z'), to: new Date('2026-03-05T09:30:00Z') }));
check('the exact completion instant is inside the window (inclusive)', boundary.length > 0, true);

const justBefore = filterRowsToPeriod(build({ from: new Date('2026-03-05T09:29:59Z'), to: new Date('2026-03-05T09:29:59Z') }));
check('one second earlier is excluded', justBefore.length, 0);

// A completion at midnight still belongs to that day.
const midnightStep = { ...instance, steps: [{ ...instance.steps[0], submittedAt: new Date('2026-03-15T00:00:00Z'), actions: [] }] };
const midnight = filterRowsToPeriod(
  build({
    from: new Date('2026-03-15T00:00:00Z'),
    to: new Date('2026-03-15T23:59:59Z'),
    instancesByCaseId: new Map([[caseId, midnightStep]]),
  })
);
check('a midnight completion is inside the day window', midnight.length > 0, true);

// A +02:00 local day must still capture the 09:30Z completion of that local day.
const tzRows = filterRowsToPeriod(
  build({ from: new Date('2026-03-05T00:00:00+02:00'), to: new Date('2026-03-05T23:59:59+02:00') })
);
check('a +02:00 local day captures the matching completion', tzRows.length > 0, true);

// The winning timestamp is reported, so the attribution is auditable.
check('submittedAt wins over the later completedAt', a1Row?.completionSource, 'submitted');
check('without submittedAt the last ticked action wins', a2Row?.completionSource, 'lastActionTicked');
check('the completion instant is exposed in UTC', a1Row?.completionAt, '2026-03-05T09:30:00.000Z');

// --- 3. Work value vs the paid-collection cap -----------------------------
// Work value, eligible collected base and earned fee stay three separate
// numbers, and unpaid work never reads as payable earnings.

const unpaidRow = rowFor(filterRowsToPeriod(build({ ...marchRange })), 'a1', 'Alice');
check('unpaid work has no eligible base', unpaidRow?.eligibleCollectedBase, 0);
check('unpaid work is flagged awaiting collection', unpaidRow?.status, 'awaiting-collection');
check('unpaid work value is reported separately', unpaidRow?.uncollectedActionValue, 1000);

// Paying 600 against 1,200 of completed work: the existing allocation spreads the
// 600 pro-rata over BOTH completed actions (1,000 and 200) at a 50% ratio, so
// a1's share is 500 and a2's is 100 â€” the total can never exceed the 600 collected.
const partial = build({ ...paid(600) }).filter((row) => row.staffName === 'Alice');
check(
  'a partial payment is shared pro-rata, never exceeding the cash',
  round2(partial.reduce((sum, row) => sum + row.eligibleCollectedBase, 0)),
  600
);
check(
  "a1's share of a partial payment is proportional to its value",
  rowFor(partial, 'a1', 'Alice')?.eligibleCollectedBase,
  500
);
check(
  "a2's share of a partial payment is proportional to its value",
  rowFor(partial, 'a2', 'Alice')?.eligibleCollectedBase,
  100
);

// Over-collection is capped at the completed work value (1,000 + 200 = 1,200),
// so no action is ever credited with more than its own work value.
const overAlice = build({ ...paid(99999) }).filter((row) => row.staffName === 'Alice');
check(
  'an over-payment is capped at the completed work value',
  round2(overAlice.reduce((sum, row) => sum + row.eligibleCollectedBase, 0)),
  1200
);
check(
  'no action is credited beyond its own work value',
  rowFor(overAlice, 'a1', 'Alice')?.eligibleCollectedBase,
  1000
);
check(
  'the capped base never exceeds the gross work value',
  overAlice.every((row) => row.eligibleCollectedBase <= row.grossActionValue),
  true
);

// --- 4. No collected amount counted twice ---------------------------------
// 1,200 collected across completed actions of 1,000 and 200 must be spread
// exactly once across them.

const allocated = filterRowsToPeriod(build({ ...paid(1200, 31) }));
const aliceRows = allocated.filter((row) => row.staffName === 'Alice');
check(
  'collections are distributed once, never double counted',
  round2(aliceRows.reduce((sum, row) => sum + row.eligibleCollectedBase, 0)),
  1200
);
check(
  'the allocation is proportional to action value',
  rowFor(aliceRows, 'a1', 'Alice')?.eligibleCollectedBase,
  1000
);

// --- 5. TPA x timeliness x quality ----------------------------------------

const aliceFunded = rowFor(allocated, 'a1', 'Alice');
const bobFunded = rowFor(allocated, 'a1', 'Bob');

// TPA comes from the staff system role.
check('associate TPA is 5%', aliceFunded?.tpaPercent, 5);
check('senior associate TPA is 6%', bobFunded?.tpaPercent, 6);

// The shared engine averages timeliness over the matter's checked Key Actions.
// a1 ran Mar 1 08:00 -> due Mar 11 08:00 and finished Mar 5 09:30 (~40.6%
// consumed -> 59). a2 ran Apr 1 -> due Apr 11 and was ticked Apr 7 14:15
// (~62.6% consumed -> 37). The matter score is the average: 48.
check('timeliness is the average across completed Key Actions', aliceFunded?.timelinessScore, 48);
check('quality comes from the Case Management score', aliceFunded?.qualityScore, 100);

// earnedFee = base x TPA x timeliness x quality (the shared engine's formula).
check(
  'earned fee = base x TPA x timeliness x quality',
  aliceFunded?.earnedFee,
  round2(1000 * 0.05 * 0.48)
);
check('the formula is exposed for audit', aliceFunded?.formula, '1000 x 5% x 48% x 100% = 24');

// --- 6. Staff and role filtering -----------------------------------------

const staffNames = filterRowsToPeriod(build({ ...marchRange, staffKeyFilter: 'alice' })).map((row) => row.staffName);
check('the staff filter returns only that person', Array.from(new Set(staffNames)), ['Alice']);

const roleNames = filterRowsToPeriod(build({ ...marchRange, roleFilter: 'senior_associate' })).map(
  (row) => row.systemRole
);
check('the role filter returns only that role', Array.from(new Set(roleNames)), ['senior_associate']);

const allNames = filterRowsToPeriod(build({ ...marchRange })).map((row) => row.staffName);
check('no filter returns both team members', Array.from(new Set(allNames)).sort(), ['Alice', 'Bob']);

// --- 7. Missing inputs are shown, never invented -------------------------

const unscored = rowFor(
  filterRowsToPeriod(build({ ...paid(1200, 31), matters: [{ ...matter, caseManagement: {} }] })),
  'a1',
  'Alice'
);
check('a missing quality score stays null', unscored?.qualityScore, null);
check('a missing quality score yields no invented fee', unscored?.earnedFee, null);
check('a missing quality score is flagged', unscored?.status, 'awaiting-input');
check(
  'a missing quality score is named in the explanation',
  (unscored?.missingInputs || []).some((input: string) => input.includes('Quality')),
  true
);

const noContract = rowFor(
  filterRowsToPeriod(build({ matters: [{ ...matter, workflowProgress: { plannedValue: { amount: 0, currency: 'RWF' } } }] })),
  'a1',
  'Alice'
);
check('a missing contract value yields no work value', noContract?.grossActionValue, 0);

// Work with no completion timestamp stays visible and is never attributed.
const undatedStep = { ...instance, steps: [{ ...instance.steps[0], submittedAt: undefined, completedAt: undefined, actions: [] }] };
const undated = rowFor(
  build({ instancesByCaseId: new Map([[caseId, undatedStep]]) }).filter((row) => row.keyActionKey === 'a1'),
  'a1',
  'Alice'
);
check('work without a timestamp is not silently dropped', undated?.completionAt, null);
check('work without a timestamp is not attributable', undated?.status, 'incomplete');
check('work without a timestamp never enters a period', undated?.inPeriod, false);

// An unmapped staff member has no TPA share rather than a fabricated one.
const unknown = rowFor(
  filterRowsToPeriod(
    build({
      matters: [{ ...matter, assignedTo: 'Zoe Unknown', caseAssignments: { initiator: 'Zoe Unknown' } }],
    })
  ),
  'a1',
  'Zoe Unknown'
);
check('an unmapped staff member has no TPA share', unknown?.tpaPercent, 0);
check('an unmapped staff member earns nothing', unknown?.earnedFee, null);

// --- 8. Summaries keep the amounts distinct -------------------------------

const summary = summarizeStaffEarnings(allocated);
const aliceSummary = summary.find((entry) => entry.staffKey === 'alice');
check('the summary counts both Key Actions for the person', aliceSummary?.keyActionsCount, 2);
check('the summary reports the work value', aliceSummary?.grossActionValue, 1200);
check('the summary reports the eligible collected base', aliceSummary?.eligibleCollectedBase, 1200);
check(
  'the summary earned fee equals the sum of that person rows',
  aliceSummary?.earnedFee,
  round2(aliceRows.reduce((sum, row) => sum + (row.earnedFee || 0), 0))
);

// --- 9. Duplicate prevention, corrections and reopens ---------------------

// The ledger identity ignores the money inputs, so a corrected recalculation or a
// re-tick resolves to the SAME key and can never become a second earning.
const correction = { ...aliceFunded, qualityScore: 80, earnedFee: 22, completionAt: '2026-04-02T10:00:00.000Z' };
check('a correction reuses the same ledger key', buildLedgerEntryKey(correction), buildLedgerEntryKey(aliceFunded));
check(
  'a different assignment role is a different earning event',
  buildLedgerEntryKey({ ...aliceFunded, assignmentRole: 'Reviewer' }) !== buildLedgerEntryKey(aliceFunded),
  true
);
check(
  'a different Key Action is a different earning event',
  buildLedgerEntryKey({ ...aliceFunded, keyActionKey: 'a2' }) !== buildLedgerEntryKey(aliceFunded),
  true
);

// Re-running the report must produce identical row identities (idempotent).
const runA = filterRowsToPeriod(build({ ...marchRange })).map((row) => row.key).sort();
const runB = filterRowsToPeriod(build({ ...marchRange })).map((row) => row.key).sort();
check('re-running the report produces identical row identities', runA, runB);

// Re-opening and re-ticking: the action is no longer completed, so it produces
// no row in the original period â€” the earnings drop out instead of doubling.
const reopenedStep = {
  ...instance,
  steps: [
    { ...instance.steps[0], status: 'In Progress', submittedAt: undefined, actions: [{ text: 'Draft', done: false }] },
    instance.steps[1],
  ],
};
const reopened = build({ instancesByCaseId: new Map([[caseId, reopenedStep]]) }).filter(
  (row) => row.keyActionKey === 'a1' && row.inPeriod
);
check('a re-opened action drops out of the period instead of duplicating', reopened.length, 0);
check(
  'the still-completed action keeps reporting',
  build({ instancesByCaseId: new Map([[caseId, reopenedStep]]) }).some((row) => row.keyActionKey === 'a2'),
  true
);

// --- Report ---------------------------------------------------------------

console.log(failures ? `VALIDATION FAILED (${failures} check(s))` : 'ALL CHECKS PASSED');
if (failures) process.exitCode = 1;
