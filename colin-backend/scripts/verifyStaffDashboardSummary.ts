/**
 * Fixture validation for GET /api/dashboard/staff-summary (no DB required).
 *
 * The controller is exercised end-to-end with in-memory fixtures so the values
 * can be checked against the Case Workspace Earned Fees formula:
 *   earnedFee = eligibleCollectedValue x TPA% x Timeliness% x Quality%
 *
 * Run with:  npx tsx scripts/verifyStaffDashboardSummary.ts
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
const at = (iso: string) => new Date(iso);

// --- Fixtures -------------------------------------------------------------

const caseActiveId = oid();
const caseDoneId = oid();
const templateId = oid();

const caseActive = {
  _id: caseActiveId,
  caseNo: 'CASE-TEST-001',
  parties: 'Active Client',
  status: 'In Progress',
  assignedTo: 'Test Initiator',
  caseAssignments: { initiator: 'Test Initiator', reviewer: 'Test Reviewer', signerApprover: 'Test Approver' },
  workflowProgress: {
    status: 'In Progress',
    percent: 50,
    plannedValue: { amount: 1000000, currency: 'RWF' },
  },
  caseManagement: { qualityScore: 90 },
  billingSettings: { currency: 'RWF' },
};

const caseDone = {
  _id: caseDoneId,
  caseNo: 'CASE-TEST-002',
  parties: 'Completed Client',
  status: 'Closed',
  assignedTo: 'Test Initiator',
  caseAssignments: { initiator: 'Test Initiator' },
  workflowProgress: {
    status: 'Completed',
    percent: 100,
    plannedValue: { amount: 0, currency: 'RWF' },
  },
  caseManagement: { qualityScore: 80 },
  billingSettings: { currency: 'RWF' },
};

const template = {
  _id: templateId,
  name: 'Test Template',
  steps: [
    { key: 's1', title: 'Step 1', percentage: 50 },
    { key: 's2', title: 'Step 2', percentage: 50 },
  ],
  stages: [
    { key: 'stageA', title: 'Stage A', percentage: 50 },
    { key: 'stageB', title: 'Stage B', percentage: 50 },
  ],
};


const activeInstance = {
  _id: oid(),
  caseId: caseActiveId,
  templateId,
  status: 'Active',
  currentStepKey: 's2',
  steps: [
    {
      stepKey: 's1',
      title: 'Step 1',
      stageKey: 'stageA',
      stageTitle: 'Stage A',
      order: 1,
      status: 'Completed',
      startAt: at('2026-01-01T00:00:00.000Z'),
      dueAt: at('2026-01-11T12:00:00.000Z'),
      completedAt: at('2026-01-02T12:00:00.000Z'),
      percentage: 50,
      stagePercentage: 50,
      actions: [
        { text: 'Action 1', done: true },
        { text: 'Action 2', done: true },
      ],
    },
    {
      stepKey: 's2',
      title: 'Step 2',
      stageKey: 'stageB',
      stageTitle: 'Stage B',
      order: 2,
      status: 'In Progress',
      startAt: at('2026-01-02T12:00:00.000Z'),
      dueAt: at('2026-01-20T12:00:00.000Z'), // in the past - overdue section
      percentage: 50,
      stagePercentage: 50,
      actions: [
        { text: 'Action 1', done: true },
        { text: 'Action 2', done: false },
      ],
    },
  ],
};

const doneInstance = {
  _id: oid(),
  caseId: caseDoneId,
  templateId,
  status: 'Completed',
  steps: [
    {
      stepKey: 's1',
      title: 'Step 1',
      stageKey: 'stageA',
      order: 1,
      status: 'Completed',
      percentage: 50,
      actions: [{ text: 'Action 1', done: true }],
    },
    {
      stepKey: 's2',
      title: 'Step 2',
      stageKey: 'stageB',
      order: 2,
      status: 'Completed',
      percentage: 50,
      actions: [{ text: 'Action 1', done: true }],
    },
  ],
};

const users = [
  { _id: oid(), name: 'Test Initiator', role: 'associate' }, // TPA 5%
  { _id: oid(), name: 'Test Reviewer', role: 'senior_associate' }, // TPA 6%
  { _id: oid(), name: 'Test Approver', role: 'partner' }, // TPA 8%
];

const invoices = [{ caseId: caseActiveId, amount: 500000, status: 'Paid' }];

// --- Model stubs ----------------------------------------------------------

const stub = (implementation: any) => implementation as any;

const matchesIdentity = (caseDoc: any, regex: RegExp) =>
  [
    caseDoc?.assignedTo,
    caseDoc?.caseAssignments?.initiator,
    caseDoc?.caseAssignments?.reviewer,
    caseDoc?.caseAssignments?.signerApprover,
  ].some((value) => typeof value === 'string' && regex.test(value));

// Mirrors the real query: only matters where the user is an assignee.
Case.find = stub((filter: any) => {
  const clauses: any[] = Array.isArray(filter?.$or) ? filter.$or : [];
  const matched = [caseActive, caseDone].filter((caseDoc) =>
    clauses.some((clause) => Object.values(clause).some((regex: any) => matchesIdentity(caseDoc, regex)))
  );
  return { sort: () => ({ lean: async () => matched }) };
});

// --- Runner ---------------------------------------------------------------

type Summary = Record<string, any>;

const runFor = async (user: any): Promise<Summary> => {
  const req = {
    user: {
      id: String(user._id),
      name: user.name,
      email: `${user.name.toLowerCase().replace(/\s+/g, '.')}@test.local`,
      role: user.role,
    },
  } as unknown as AuthRequest;
  let payload: Summary = {};
  const res: any = {
    status() {
      return this;
    },
    json(value: any) {
      payload = value;
      return value;
    },
  };
  await getStaffDashboardSummary(req, res);
  return payload;
};

let failures = 0;
const expectValue = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
};

const main = async () => {
  const initiator = await runFor(users[0]);
  console.log('Initiator summary:', JSON.stringify({ ...initiator, rows: `${initiator.rows?.length || 0} row(s)` }, null, 2));
  expectValue('initiator.mattersAssigned', initiator.mattersAssigned, 2);
  expectValue('initiator.mattersOutstanding', initiator.mattersOutstanding, 1);
  expectValue('initiator.mattersCompleted', initiator.mattersCompleted, 1);
  expectValue('initiator.overdueSections', initiator.overdueSections, 1);
  expectValue('initiator.averageTimelinessScore', initiator.averageTimelinessScore, 90);
  expectValue('initiator.averageQualityScore', initiator.averageQualityScore, 85);
  expectValue('initiator.feesEarnedTotal', initiator.feesEarnedTotal, 20250);
  expectValue('initiator.collectedBaseTotal', initiator.collectedBaseTotal, 500000);
  expectValue('initiator.tpaPercent', initiator.tpaPercent, 5);
  expectValue('initiator.rows[0].role', initiator.rows?.[0]?.role, 'Initiator');

  const reviewer = await runFor(users[1]);
  expectValue('reviewer.mattersAssigned', reviewer.mattersAssigned, 1);
  expectValue('reviewer.feesEarnedTotal', reviewer.feesEarnedTotal, 24300);
  expectValue('reviewer.averageTimelinessScore', reviewer.averageTimelinessScore, 90);
  expectValue('reviewer.averageQualityScore', reviewer.averageQualityScore, 90);
  expectValue('reviewer.tpaPercent', reviewer.tpaPercent, 6);

  const approver = await runFor(users[2]);
  expectValue('approver.mattersAssigned', approver.mattersAssigned, 1);
  expectValue('approver.feesEarnedTotal', approver.feesEarnedTotal, 32400);
  expectValue('approver.tpaPercent', approver.tpaPercent, 8);

  console.log(failures ? `VALIDATION FAILED (${failures} check(s))` : 'ALL CHECKS PASSED');
  if (failures) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

WorkflowInstance.find = stub(() => ({ lean: async () => [activeInstance, doneInstance] }));
WorkflowTemplate.find = stub(() => ({ lean: async () => [template] }));
Task.find = stub(() => ({ lean: async () => [] }));
Invoice.find = stub(() => ({ select: () => ({ lean: async () => invoices }) }));
User.find = stub(() => ({ select: () => ({ lean: async () => users }) }));
