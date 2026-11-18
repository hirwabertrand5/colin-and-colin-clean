/** Isolated fixtures: no database connection or application credentials. */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Case from '../src/models/caseModel';
import Task from '../src/models/taskModel';
import Invoice from '../src/models/invoiceModel';
import User from '../src/models/userModel';
import WorkflowInstance from '../src/models/workflowInstanceModel';
import { getStaffDashboardSummary } from '../src/controllers/dashboardController';
import { buildCollectedKeyActionRows, getFirmReports, getMyProductivityEarningsReport } from '../src/controllers/firmReportsController';
import { buildProductivityReconciliation, summarizeProductivity } from '../src/utils/productivityReport';
import { buildRoleByName, computeEarnedFee } from '../src/utils/workflowPercentages';
import { getMatterQualityScore } from '../src/utils/caseEarnedFees';
import { invoicePaymentDate } from '../src/utils/invoicePaymentDate';
import { isWithinReportRange, resolveOptionalReportRange } from '../src/utils/reportRange';

async function main() {
  const oid = () => new mongoose.Types.ObjectId();
  const user = { _id: oid(), name: 'Ada', email: 'ada@test.invalid', role: 'associate' };
  const template: any = { _id: oid(), stages: [{ key: 'delivery', title: 'Delivery', percentage: 100 }], steps: [
    { key: 'a', title: 'Prepare', stageKey: 'delivery', percentage: 40 },
    { key: 'b', title: 'Deliver', stageKey: 'delivery', percentage: 60 },
  ] };
  const cases: any[] = [], instances: any[] = [], invoices: any[] = [];
  const fixture = (name: string, dates: Array<string | null>, quality: any = 80, paidAt = '2026-09-01T08:00:00Z', weight: any = undefined) => {
    const matter: any = { _id: oid(), caseNo: name, assignedTo: 'Ada', parties: 'Fixture Client', status: 'In Progress',
      caseAssignments: { initiator: 'Ada' }, workflowTemplateId: template._id, budget: '100000', caseManagement: { qualityScore: quality } };
    const steps = dates.map((date, index) => ({ stepKey: index ? 'b' : 'a', title: index ? 'Deliver' : 'Prepare', stageKey: 'delivery',
      percentage: weight === undefined ? (index ? 60 : 40) : weight, status: date ? 'Completed' : 'In Progress',
      completedAt: date, submittedAt: date, startAt: '2026-09-01T00:00:00Z', dueAt: '2026-12-01T00:00:00Z',
    }));
    cases.push(matter);
    instances.push({ _id: oid(), caseId: matter._id, templateId: template._id, status: dates.every(Boolean) ? 'Completed' : 'Active', steps });
    invoices.push({ caseId: matter._id, amount: 100000, status: 'Paid', paidAt, updatedAt: '2026-12-15T00:00:00Z' });
    return matter;
  };
  fixture('EARLIER-WORK', ['2026-10-10T08:00:00Z', null], 80, '2026-11-01T08:00:00Z');
  fixture('IN-WINDOW', ['2026-10-16T22:00:00Z', '2026-11-17T21:59:59.999Z']);
  fixture('NEXT-DAY', ['2026-11-17T22:00:00Z', null]);
  fixture('QUALITY-PENDING', ['2026-10-20T08:00:00Z', null], null);
  fixture('QUALITY-ZERO', ['2026-10-21T08:00:00Z', null], 0);
  const missingReference = fixture(' ', ['2026-10-22T08:00:00Z', null]);
  missingReference.caseNo = 'N/A';
  const unpaid = fixture('UNPAID', ['2026-10-23T08:00:00Z', null]);
  invoices.find(invoice => String(invoice.caseId) === String(unpaid._id)).status = 'Pending';
  const missingWeight = fixture('MISSING-WEIGHT', ['2026-10-24T08:00:00Z', null], 80, '2026-09-01T08:00:00Z', null);
  instances.find(instance => String(instance.caseId) === String(missingWeight._id)).steps[0].stepKey = 'custom-unallocated';
  const undated = fixture('UNDATED', ['2026-10-24T08:00:00Z', null]);
  instances.find(instance => String(instance.caseId) === String(undated._id)).steps[0].completedAt = null;
  const deleted = fixture('DELETED', ['2026-10-25T08:00:00Z', null]);
  instances.find(instance => String(instance.caseId) === String(deleted._id)).deletedStepKeys = ['a'];

  const period = resolveOptionalReportRange({ range: 'custom', from: '2026-10-17', to: '2026-11-17' });
  assert(period && !('error' in period));
  const paid = invoices.filter(invoice => invoice.status === 'Paid');
  const collected = (items: any[]) => new Map(items.map(invoice => [String(invoice.caseId), invoice.amount]));
  const inputs = {
    matters: cases, templatesById: new Map([[String(template._id), template]]),
    instancesByCaseId: new Map(instances.map(instance => [String(instance.caseId), instance])),
    tasksByCaseId: new Map<string, any[]>(), historicalCollectedByCaseId: collected(paid),
    paidInvoicesByCaseId: collected(paid.filter(invoice => isWithinReportRange(invoicePaymentDate(invoice), period))),
    roleByName: buildRoleByName([user]), selectedMemberName: 'Ada',
  };
  const allRows = buildCollectedKeyActionRows(inputs);
  const report = buildProductivityReconciliation({ ...inputs, period, allRows });
  assert.equal(report.summary.completedTasks, 1, 'One whole matter; multiple completed Key Actions');
  assert(report.summary.keyActionsCompleted > report.summary.completedTasks);
  assert.equal(report.rows.filter(row => row.matter === 'IN-WINDOW').length, 2, 'Both inclusive Kigali boundaries retained');
  assert(!report.rows.some(row => row.matter === 'NEXT-DAY'), 'Next local day excluded');
  assert(!report.rows.some(row => row.matter === 'EARLIER-WORK'), 'Earlier work excluded despite current payment');
  assert(!report.rows.some(row => row.matter === 'DELETED'), 'Deleted actions cannot reappear through template');
  assert.equal(report.rows.find(row => row.matter === 'QUALITY-PENDING').feeEarned, null);
  assert.equal(report.rows.find(row => row.matter === 'QUALITY-ZERO').feeEarned, 0);
  assert.equal(report.rows.find(row => row.matter === 'UNPAID').allocationStatus, 'No Paid invoices linked to matter');
  assert.equal(report.rows.find(row => row.matter === 'MISSING-WEIGHT').allocationStatus, 'Missing Key Action percentage');
  const referenceRow = report.rows.find(row => row.caseId === String(missingReference._id));
  assert.equal(referenceRow.matterReference, null);
  assert(referenceRow.matter.includes(String(missingReference._id)), 'Missing reference remains traceable by matter ID');
  assert.equal(report.reconciliation.undatedContributionRecords, 1);
  assert.equal(report.reconciliation.allTimeContributionRecords,
    report.rows.length + report.reconciliation.outsidePeriodContributionRecords + report.reconciliation.undatedContributionRecords);
  const duplicated = summarizeProductivity([report.rows[0], { ...report.rows[0], id: 'second-role', assignmentRole: 'Reviewer' }]);
  assert.equal(duplicated.keyActionsCompleted, 1);
  assert.equal(duplicated.totalTaskFeeCollected, report.rows[0].taskFeeCollected, 'No double-counting collected bases across roles');
  assert.equal(duplicated.totalFeeEarned, Math.round(report.rows[0].feeEarned * 200) / 100, 'Contributor fees remain additive');
  for (const value of [null, undefined, '']) assert.equal(getMatterQualityScore({ caseManagement: { qualityScore: value } }).qualityScore, null);
  assert.equal(computeEarnedFee(1000, 5, 80, 0), 0);
  assert.equal(computeEarnedFee(1000, 5, 0, 80), 0);
  assert.equal(computeEarnedFee(1000, 5, 80, null), null);
  assert.equal(summarizeProductivity(report.rows.filter(row => row.matter === 'QUALITY-PENDING')).totalFeeEarned, null);
  const roundingCase = { _id: oid(), assignedTo: 'Ada', budget: '1', caseManagement: { qualityScore: 100 } };
  const roundingSteps = [12, 12, 0.01].map((percentage, index) => ({ stepKey: `round-${index}`, percentage,
    status: 'Completed', completedAt: '2026-10-20T00:00:00Z', submittedAt: '2026-10-20T00:00:00Z',
    startAt: '2026-10-20T00:00:00Z', dueAt: '2026-10-21T00:00:00Z' }));
  const roundingRows = buildCollectedKeyActionRows({ ...inputs, matters: [roundingCase],
    instancesByCaseId: new Map([[String(roundingCase._id), { steps: roundingSteps }]]),
    historicalCollectedByCaseId: new Map([[String(roundingCase._id), 1]]),
  });
  assert(roundingRows.every(row => row.feeEarned >= 0), 'Rounding never creates negative earned fees');
  assert.equal(summarizeProductivity(roundingRows).totalFeeEarned, 0.01, 'Row cents reconcile to the shared engine');

  // Run the real dashboard handler against the same fixtures. Any divergence
  // in its date rules or its shared earnings calculation fails these checks.
  const chain = (value: any) => ({ select() { return this; }, sort() { return this; }, lean: async () => value });
  (User as any).find = () => chain([user]);
  (WorkflowInstance as any).distinct = async () => [];
  (Case as any).aggregate = async () => cases.map(matter => ({ ...matter,
    _dashboardInstances: instances.filter(instance => String(instance.caseId) === String(matter._id)),
    _dashboardTasks: [], _dashboardInvoices: paid.filter(invoice => String(invoice.caseId) === String(matter._id)),
    _dashboardTemplates: [template],
  }));
  const invoke = async (handler: any, query: any) => {
    let status = 200, data: any;
    await handler({ user: { id: String(user._id), ...user }, query }, {
      status(code: number) { status = code; return this; }, json(body: any) { data = body; return body; },
    });
    assert.equal(status, 200, JSON.stringify(data));
    return data;
  };
  const dashboard = await invoke(getStaffDashboardSummary, { range: 'custom', from: '2026-10-17', to: '2026-11-17' });
  assert.equal(report.reconciliation.selectedPeriod.feesEarned, dashboard.period.feesEarned);
  assert.equal(report.reconciliation.selectedPeriod.keyActionsChecked, dashboard.period.keyActionsChecked);
  assert.equal(report.reconciliation.selectedPeriod.sectionsCompleted, dashboard.period.sectionsCompleted);
  assert.equal(report.reconciliation.allTime.feesEarned, dashboard.feesEarnedTotal);
  assert.notEqual(report.summary.totalFeeEarned, dashboard.period.feesEarned, 'Completion and payment bases intentionally differ');
  (User as any).findById = () => chain(user);
  (Case as any).find = (filter: any) => {
    if (filter?.$or) {
      const identity = filter.$or.find((clause: any) => clause.assignedTo)?.assignedTo;
      assert(identity instanceof RegExp && identity.test('Ada Member'), 'Personal visibility matches canonical full-name assignments');
      assert(!identity.test('Adaline'), 'Personal visibility must not use substring matches');
    }
    return chain(cases);
  };
  (WorkflowInstance as any).find = () => chain(instances);
  const Template = (await import('../src/models/workflowTemplateModel')).default;
  (Template as any).find = () => chain([template]);
  (Task as any).find = () => chain([]);
  (Task as any).countDocuments = async () => 0;
  (Invoice as any).find = (filter: any) => { assert.equal(filter.status, 'Paid'); assert(filter.caseId, 'Invoices scoped to visible matters'); return chain(paid); };
  const personal = await invoke(getMyProductivityEarningsReport, { range: 'custom', from: '2026-10-17', to: '2026-11-17' });
  assert.deepEqual(personal.productivitySummary, report.summary);
  assert.deepEqual(personal.productivityReconciliation, report.reconciliation);
  const Expense = (await import('../src/models/pettyCashExpenseModel')).default;
  const Prospect = (await import('../src/models/prospectModel')).default;
  const ClientReport = (await import('../src/models/clientReportModel')).default;
  (Expense as any).find = () => chain([]);
  (Prospect as any).find = () => chain([]);
  (Prospect as any).aggregate = async () => [];
  (ClientReport as any).aggregate = async () => [];
  (Invoice as any).aggregate = async () => [...inputs.historicalCollectedByCaseId].map(([id, total]) => ({ _id: id, total }));
  (Invoice as any).find = (filter: any) => chain(filter?.status === 'Paid'
    ? paid.filter(invoice => isWithinReportRange(invoicePaymentDate(invoice), period)) : []);
  let managementStatus = 200, management: any;
  await getFirmReports({ user: { id: String(user._id), name: user.name, role: 'managing_director' },
    query: { teamMemberId: String(user._id), range: 'custom', from: '2026-10-17', to: '2026-11-17' } } as any, {
    status(code: number) { managementStatus = code; return this; }, json(body: any) { management = body; return body; },
  } as any);
  assert.equal(managementStatus, 200, JSON.stringify(management));
  assert.deepEqual(management.productivitySummary, personal.productivitySummary, 'Management and personal summaries reconcile');
  assert.deepEqual(management.productivityReconciliation, personal.productivityReconciliation, 'Management and personal dashboard comparisons reconcile');
  console.log('PASS: completed-work counts, allocation reasons, missing references/scores, zero scores, Kigali boundaries, deleted/undated actions, role deduplication, real dashboard reconciliation and personal API.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
