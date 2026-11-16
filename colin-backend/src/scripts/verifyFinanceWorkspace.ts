/** Real HTTP + isolated MongoDB. Does not load .env or production records. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../app';
import User from '../models/userModel';
import Case from '../models/caseModel';
import Invoice from '../models/invoiceModel';
import Expense from '../models/pettyCashExpenseModel';
import Fund from '../models/pettyCashFundModel';
import Template from '../models/workflowTemplateModel';
import Workflow from '../models/workflowInstanceModel';
import Task from '../models/taskModel';
import { invalidateFinanceReads } from '../services/financeReadCache';

const stamp = (day: string) => new Date(`${day}T10:00:00+02:00`);
const oid = () => new mongoose.Types.ObjectId();
async function main() {
  delete process.env.MONGO_URI; delete process.env.RESEND_API_KEY;
  process.env.JWT_SECRET = 'isolated-finance-workspace'; process.env.APP_TIMEZONE = 'Africa/Kigali';
  process.env.NOTIFICATION_EMAIL_ENABLED = 'false';
  const binary = path.resolve(__dirname, '../../node_modules/.cache/mongodb-memory-server/test-mongod.exe');
  assert(existsSync(binary), 'An existing isolated MongoDB binary is required.');
  const db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: binary }, replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 120000 }] });
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    await mongoose.connect(db.getUri(), { dbName: 'finance_workspace_verification', monitorCommands: true });
    let financeReads = 0;
    mongoose.connection.getClient().on('commandStarted', event => {
      if (['find', 'aggregate', 'distinct'].includes(event.commandName) && !['users', 'auditlogs'].includes(String(event.command[event.commandName]))) financeReads++;
    });
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    const director = await User.create({ name: 'Finance Director', email: 'director@finance.invalid', role: 'managing_director', passwordHash: 'isolated' });
    const partner = await User.create({ name: 'Finance Partner', email: 'partner@finance.invalid', role: 'managing_partner', passwordHash: 'isolated' });
    const staff = await User.create({ name: 'Finance Associate', email: 'staff@finance.invalid', role: 'associate', passwordHash: 'isolated' });
    const a = oid(), b = oid(), fund = oid(), template = oid();
    await Template.collection.insertOne({ _id: template, name: 'Finance fixture', matterType: 'Finance fixture', stages: [{ key: 'work', title: 'Work', order: 1, percentage: 100 }], steps: [{ key: 'action', title: 'Action', stageKey: 'work', order: 1, percentage: 100 }] });
    await Case.collection.insertMany([
      { _id: a, caseNo: 'FIN-A', parties: 'Alpha client', status: 'In Progress', budget: '1000', assignedTo: staff.name, caseAssignments: { initiator: staff.name, reviewer: partner.name }, caseManagement: { qualityScore: 90 }, workflowTemplateId: template, matterType: 'Finance fixture', legalServicePath: [{ id: 'advisory', label: 'Advisory' }], createdAt: stamp('2026-10-01'), workflowProgress: { percent: 100, completedValue: { amount: 1000 } } },
      { _id: b, caseNo: 'FIN-B', parties: 'Beta client', status: 'Closed', budget: '2000', legalServicePath: [{ id: 'litigation', label: 'Litigation' }], createdAt: stamp('2026-11-01') },
    ] as any);
    await Workflow.collection.insertOne({ caseId: a, templateId: template, status: 'Completed', steps: [{ stepKey: 'action', title: 'Action', stageKey: 'work', order: 1, percentage: 100, status: 'Completed', startAt: stamp('2026-11-01'), dueAt: stamp('2026-11-08'), doneAt: stamp('2026-11-04'), completedAt: stamp('2026-11-04'), submittedAt: stamp('2026-11-04'), actions: [], outputs: [] }] } as any);
    const invoice = (i: number, caseId: any, amount: number, entered: string, extra = {}) => ({ _id: oid(), caseId, invoiceNo: `FIN-INV-${i}`, amount, year: 2026, seqYear: i, seqCase: i, date: entered, status: 'Pending', createdAt: stamp(entered), updatedAt: stamp(entered), ...extra });
    const legacyPaid = invoice(1, a, 100, '2026-10-01', { status: 'Paid', paidAt: stamp('2026-11-02'), updatedAt: stamp('2026-12-01') });
    const invoices = [legacyPaid,
      invoice(2, a, 200, '2026-11-01', { dueDate: '2026-11-05' }),
      invoice(3, b, 300, '2026-11-01'),
      invoice(4, b, 400, '2026-11-02', { status: 'Paid', paidAt: stamp('2026-12-01'), updatedAt: stamp('2026-12-05'), dueDate: '2026-12-01' }),
      invoice(5, a, 500, '2026-11-03', { status: 'Paid', paidAt: stamp('2026-11-04'), updatedAt: stamp('2026-12-05') }),
      invoice(6, b, 9999, '2026-12-01'),
    ];
    await Invoice.collection.insertMany(invoices as any);
    await Fund.collection.insertOne({ _id: fund, name: 'Office fund', status: 'active', remainingAmount: 700, initialAmount: 1000, spentAmount: 300, currency: 'RWF', createdByName: director.name });
    await Expense.collection.insertMany([
      { fundId: fund, caseId: a, title: 'Prior matter expense', amount: 100, refundAmount: 20, refundDate: '2026-11-04', chargeType: 'client', date: '2026-10-05', createdAt: stamp('2026-10-05'), vendor: 'Vendor A' },
      { fundId: fund, caseId: a, title: 'Matter filing', amount: 50, refundAmount: 10, refundDate: '2026-12-02', chargeType: 'client', date: '2026-11-05', createdAt: stamp('2026-11-05'), vendor: 'Vendor A' },
      { fundId: fund, title: 'Office expense', amount: 30, chargeType: 'internal', date: '2026-11-05', createdAt: stamp('2026-11-05'), vendor: 'Vendor B' },
    ] as any);
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const api = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
    const headers = (user = director) => ({ Authorization: `Bearer ${jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET!)}` });
    const request = async (url: string, user = director, init: RequestInit = {}) => {
      const start = performance.now(); const response = await fetch(`${api}${url}`, { ...init, headers: { ...headers(user), ...(init.headers || {}) } });
      return { status: response.status, body: await response.json() as any, ms: Math.round(performance.now() - start) };
    };
    const base = '/billing/workspace/'; const window = '?range=custom&from=2026-11-01&to=2026-11-30';
    const read = async (section: string, extra = '') => { const result = await request(`${base}${section}${window}${extra}`); assert.equal(result.status, 200, JSON.stringify(result.body)); return result; };
    const dashboard = await read('financial-dashboard'); const m = dashboard.body.metrics;
    assert.equal(m.contractValue, 2000); assert.equal(m.billed, 1400); assert.equal(m.collected, 600);
    assert.equal(m.outstanding, 900); assert.equal(m.overdue, 200); assert.equal(m.directCosts, 30); assert.equal(m.operatingExpenses, 30);
    assert.equal(m.grossProfit, 570); assert.equal(m.netProfit, 540); assert.equal(m.paidCount, 1); assert.equal(m.pendingCount, 3);
    assert.equal(m.invoiceSettlementRate, 35.71); assert.equal(m.collectionRate, 42.86);
    const profit = await request(`/reports/profitability${window}`); assert.equal(profit.status, 200);
    assert.equal(m.collected, profit.body.firm.recognisedCollectedRevenue); assert.equal(m.outstanding, profit.body.firm.totalReceivables);
    assert.equal(m.directCosts, profit.body.firm.directMatterCosts); assert.equal(m.operatingExpenses, profit.body.firm.generalOverheads);
    console.log('PASS: dashboard reconciles with Profitability, payment dates and period refunds.');
    const warmReads = financeReads;
    await read('financial-dashboard', '&q=alpha&sort=collected&dir=asc');
    await read('financial-dashboard', '&sort=amount&dir=desc&pageSize=25');
    assert.equal(financeReads, warmReads, 'Search, sort and pagination reuse the same period snapshot without another finance query.');
    invalidateFinanceReads();
    const concurrentStart = financeReads;
    await Promise.all([read('financial-dashboard', '&q=alpha'), read('financial-dashboard', '&sort=client&dir=asc'), read('financial-dashboard', '&pageSize=25')]);
    assert.equal(financeReads - concurrentStart, 3, 'Concurrent table requests share one Case, Invoice and Expense read.');
    const receivables = (await read('collections')).body;
    assert.equal(receivables.pagination.total, 3); assert.equal(receivables.ageing.reduce((n: number, r: any) => n + r.value, 0), 900);
    assert.equal(receivables.ageing.find((r: any) => r.key === 'unknown').value, 300);
    assert.equal((await read('collections', '&status=Overdue')).body.pagination.total, 1);
    assert.equal((await read('collections', '&status=unknown')).body.rows[0].age, null);
    const filtered = (await read('financial-dashboard', '&servicePath=advisory')).body;
    assert.equal(filtered.metrics.collected, 600); assert.equal(filtered.metrics.outstanding, 200); assert.equal(filtered.metrics.operatingExpenses, 0);
    assert.equal((await read('invoicing', '&q=beta')).body.pagination.total, 2);
    const paged = (await read('invoicing', '&sort=amount&dir=asc&pageSize=2&page=2')).body;
    assert.deepEqual(paged.rows.map((r: any) => r.amount), [400, 500]);
    assert.equal((await read('invoicing', '&sort=dueDate&dir=desc')).body.rows.at(-1).dueDate, null);
    assert.equal((await read('invoicing', '&page=99')).body.pagination.page, 1);
    console.log('PASS: ageing bands, unknown terms, classification, search, stable numeric sorting and pagination.');
    const cash = (await read('cash-flow')).body.metrics;
    assert.equal(cash.periodInflow, 620); assert.equal(cash.periodOutflow, 80); assert.equal(cash.netCashFlow, 540);
    assert.equal(cash.openingMovement, -100); assert.equal(cash.closingMovement, 440); assert.equal(cash.pettyCash, 700); assert.equal(cash.bankBalance, null);
    assert((await read('cash-flow', '&tab=inflows')).body.rows.every((r: any) => r.inflow > 0));
    assert((await read('cash-flow', '&tab=outflows')).body.rows.every((r: any) => r.outflow > 0));
    const vendors = (await read('expenses', '&tab=vendors')).body;
    assert.equal(vendors.rows.reduce((n: number, r: any) => n + r.netCost, 0), 60);
    const remuneration = await read('remuneration');
    assert(remuneration.body.rows.length > 0); assert.equal(remuneration.body.metrics.paid, null);
    const earningsReads = financeReads;
    for (const tab of ['by-staff', 'by-role', 'by-matter']) {
      const grouped = (await read('remuneration', `&tab=${tab}`)).body;
      assert.equal(grouped.rows.reduce((n: number, r: any) => n + (r.earnedFee || 0), 0), remuneration.body.metrics.earnedFee);
    }
    assert.equal(financeReads, earningsReads, 'Remuneration groupings reuse the earnings engine result.');
    console.log('PASS: cash events, vendor reconciliation and all remuneration groupings without inferred payroll balances.');
    const patch = (data: any) => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal((await request(`/invoices/${invoices[2]!._id}/terms`, director, patch({ dueDate: '2026-02-30' }))).status, 400);
    assert.equal((await request(`/invoices/${invoices[2]!._id}/terms`, partner, patch({ dueDate: '2026-11-12' }))).status, 403);
    assert.equal((await request(`/invoices/${invoices[2]!._id}/terms`, director, patch({ dueDate: '2026-11-12' }))).status, 200);
    assert.equal((await read('collections', '&status=Overdue')).body.pagination.total, 2);
    assert.equal((await request(`/invoices/${invoices[2]!._id}/terms`, director, patch({ dueDate: null }))).status, 200);
    const old = await Invoice.findById(legacyPaid._id).lean();
    await Invoice.collection.updateOne({ _id: legacyPaid._id }, { $unset: { paidAt: 1 }, $set: { updatedAt: stamp('2026-11-02') } });
    assert.equal((await request(`/invoices/${legacyPaid._id}/terms`, director, patch({ dueDate: '2026-10-30' }))).status, 200);
    assert.equal((await Invoice.findById(legacyPaid._id).lean())!.paidAt!.toISOString(), stamp('2026-11-02').toISOString());
    await Invoice.collection.updateOne({ _id: legacyPaid._id }, { $set: { paidAt: old!.paidAt } });
    for (const extra of ['&page=-1', '&pageSize=101', '&sort=unexpected', '&dir=invalid']) assert.equal((await request(`${base}invoicing${window}${extra}`)).status, 400);
    assert.equal((await request(`${base}invoicing?range=custom&from=2026-02-30&to=2026-03-01`)).status, 400);
    assert.equal((await request(`${base}invoicing${window}`, staff)).status, 403);
    assert.equal((await request(`${base}invoicing${window}`, partner)).status, 200);
    assert.equal((await fetch(`${api}${base}invoicing${window}`)).status, 401);
    console.log('PASS: explicit due date writes, audit path, preserved payment timestamps, date/query validation and role permissions.');
    const historyIds = [oid(), oid(), oid(), oid()];
    const historyMatter = (id: mongoose.Types.ObjectId, index: number) => ({ _id: id, caseNo: `HISTORY-${index}`, parties: `History client ${index}`,
      status: 'Closed', budget: '1000', assignedTo: staff.name, caseAssignments: { initiator: staff.name, reviewer: partner.name },
      caseManagement: { qualityScore: 90 }, workflowTemplateId: template, createdAt: stamp('2025-01-01') });
    await Case.collection.insertMany(historyIds.map(historyMatter) as any);
    const historyStep = { stepKey: 'action', title: 'Action', stageKey: 'work', order: 1, percentage: 100, status: 'Completed',
      startAt: stamp('2026-11-01'), dueAt: stamp('2026-11-08'), actions: [], outputs: [{ note: 'Unused output payload '.repeat(5000) }] };
    await Workflow.collection.insertMany([
      { caseId: historyIds[0], templateId: template, steps: [{ ...historyStep, completedAt: stamp('2025-01-05'), submittedAt: stamp('2025-01-05') }] },
      { caseId: historyIds[1], templateId: template, steps: [{ ...historyStep, submittedAt: stamp('2026-12-04'), carriedWork: { submittedAt: stamp('2026-11-04') } }] },
      { caseId: historyIds[2], templateId: template, steps: [historyStep] },
      { caseId: historyIds[3], templateId: template, steps: [{ ...historyStep, submittedAt: '2026-11-04' }] },
    ] as any);
    await Task.collection.insertOne({ caseId: historyIds[2], workflowStepKey: 'action', title: 'Action', assignee: staff.name,
      status: 'Completed', completedAt: stamp('2026-11-04'), updatedAt: stamp('2026-12-01') } as any);
    invalidateFinanceReads();
    const baseline = await request(`/reports/staff-earnings${window}&collectionScope=all`);
    const focused = await request(`/reports/staff-earnings${window}&collectionScope=all&scope=finance-workspace`);
    assert.equal(baseline.status, 200); assert.equal(focused.status, 200);
    const ordered = (rows: any[]) => [...rows].sort((a, b) => a.key.localeCompare(b.key));
    assert.deepEqual(ordered(focused.body.rows), ordered(baseline.body.rows), 'Focused earnings preserve every input, timestamp, fee and ledger identity.');
    for (const id of historyIds.slice(1)) assert(focused.body.rows.some((row: any) => row.caseId === String(id)), 'Carried, task-fallback and legacy string work dates remain included.');
    assert(focused.body.counts.mattersEvaluated < baseline.body.counts.mattersEvaluated, 'Old unrelated matters are excluded before calculation.');
    console.log('PASS: focused remuneration matches the original engine exactly, including carried work, task fallbacks and legacy string dates.');
    await Expense.collection.insertMany(Array.from({ length: 507 }, (_, i) => ({ fundId: fund, title: `Bulk spend ${i}`, date: '2026-11-05', createdAt: stamp('2026-11-05'), amount: 1, chargeType: 'internal' })) as any);
    invalidateFinanceReads(); // Fixture writes bypass HTTP mutation invalidation.
    const bulk = (await read('expenses', '&pageSize=100')).body;
    assert.equal(bulk.pagination.total, 510); assert.equal(bulk.metrics.operatingExpenses, 537); assert.equal(bulk.rows.length, 100);
    const refreshed = await request(`${base}expenses${window}`, director, { headers: { 'X-Finance-Refresh': '1' } });
    assert.equal(refreshed.status, 200); assert.equal(refreshed.body.pagination.total, 510);
    const times = [];
    for (const section of ['financial-dashboard', 'invoicing', 'collections', 'cash-flow', 'expenses', 'remuneration']) {
      const result = await read(section); times.push({ section, milliseconds: result.ms, bytes: JSON.stringify(result.body).length });
    }
    console.table(times); assert(times.every(result => result.milliseconds < 1000), 'Local finance reads should complete below one second.');
    console.log('PASS: no 500-expense truncation; all six real local HTTP reads below one second.');
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await mongoose.disconnect(); await db.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
