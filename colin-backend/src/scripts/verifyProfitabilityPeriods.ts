/** Real report/login HTTP checks on disposable MongoDB; never reads .env. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../app';
import User from '../models/userModel';
import Case from '../models/caseModel';
import Invoice from '../models/invoiceModel';
import Expense from '../models/pettyCashExpenseModel';
import Template from '../models/workflowTemplateModel';
import Workflow from '../models/workflowInstanceModel';
import Task from '../models/taskModel';
import Period from '../models/retainerPeriodModel';
import Receipt from '../models/retainerReceiptModel';
import { resolveOptionalReportRange, isWithinReportRange, type ResolvedReportRange } from '../utils/reportRange';

const stamp = (day: string) => new Date(`${day}T10:00:00+02:00`);
const oid = () => new mongoose.Types.ObjectId();
const resolve = (range: string, now = new Date('2026-11-13T23:30:00Z')) => {
  const result = resolveOptionalReportRange({ range }, now);
  assert(result && !('error' in result)); return result;
};

async function main() {
  delete process.env.MONGO_URI;
  delete process.env.RESEND_API_KEY;
  process.env.JWT_SECRET = 'profitability-isolated-verification';
  process.env.APP_TIMEZONE = 'Africa/Kigali';
  process.env.NOTIFICATION_EMAIL_ENABLED = 'false';
  const today = resolve('daily');
  assert.equal(today.fromISO, '2026-11-14', 'Kigali calendar must win over UTC/server date');
  assert.equal(today.from.toISOString(), '2026-11-13T22:00:00.000Z');
  assert(isWithinReportRange(today.from, today));
  assert(!isWithinReportRange(today.toExclusive, today));
  assert.equal(resolve('weekly').fromISO, '2026-11-08');
  assert.equal(resolve('monthly').fromISO, '2026-11-01');
  assert.equal(resolve('quarterly', new Date('2026-01-15')).fromISO, '2025-10-01');
  assert.equal(resolve('quarterly', new Date('2026-01-15')).toISO, '2025-12-31');
  assert.equal(resolve('yearly').fromISO, '2025-01-01');
  assert.equal(resolve('yearly').toISO, '2025-12-31');
  assert.equal(resolve('ytd').fromISO, '2026-01-01');
  assert.equal(resolveOptionalReportRange({ range: 'all' }), null);
  assert(isWithinReportRange(undefined, null));
  for (const query of [{ range: 'nonsense' }, { range: 'custom', from: '2026-02-30', to: '2026-03-01' },
    { range: 'custom', from: '2026-11-14', to: '2026-11-13' }, { from: '2026-11-13' }]) {
    assert('error' in resolveOptionalReportRange(query)!);
  }
  const leap = resolveOptionalReportRange({ range: 'custom', from: '2024-02-29', to: '2024-02-29' }) as ResolvedReportRange;
  assert.equal(leap.toExclusive.toISOString(), '2024-02-29T22:00:00.000Z');
  const dst = resolveOptionalReportRange({ range: 'custom', from: '2026-03-08', to: '2026-03-08' }, new Date(), 'America/New_York') as ResolvedReportRange;
  assert.equal(dst.toExclusive.getTime() - dst.from.getTime(), 23 * 3600000);
  console.log('PASS: named periods, Kigali midnight, exclusive boundaries, leap day, DST and invalid/custom ranges');

  const binary = path.resolve(__dirname, '../../node_modules/.cache/mongodb-memory-server/test-mongod.exe');
  assert(existsSync(binary), 'Uses only the existing local MongoDB test binary');
  const db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: binary },
    replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 120000 }] });
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    await mongoose.connect(db.getUri(), { dbName: 'profitability_periods', monitorCommands: true });
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    const admin = await User.create({ name: 'Manager', email: 'manager@periods.invalid', role: 'managing_partner', passwordHash: 'test-only' });
    const alice = await User.create({ name: 'Alice', email: 'alice@periods.invalid', role: 'associate', passwordHash: 'test-only' });
    await User.collection.updateMany({}, { $set: { createdAt: stamp('2026-01-01') } });
    const lateUser = await User.create({ name: 'Future', email: 'future@periods.invalid', role: 'associate', passwordHash: 'test-only' });
    await User.collection.updateOne({ _id: lateUser._id }, { $set: { createdAt: stamp('2026-11-14') } });
    const [a, b, c, d, completed] = [oid(), oid(), oid(), oid(), oid()];
    await Case.collection.insertMany([
      { _id: a!, caseNo: 'PERIOD-A', parties: 'Client A', budget: '1000', createdAt: stamp('2026-11-01') },
      { _id: b!, caseNo: 'PERIOD-B', parties: 'Client B', budget: '2000', createdAt: new Date('2026-11-12T22:00:00Z') },
      { _id: c!, caseNo: 'PERIOD-C', parties: 'Client C', budget: '4000', createdAt: new Date('2026-11-13T22:00:00Z') },
      { _id: d!, caseNo: 'PERIOD-D', parties: 'Client D', budget: '8000', createdAt: stamp('2026-10-15') },
    ].map(m => ({ ...m, status: 'Open', assignedTo: 'Alice', caseAssignments: { initiator: 'Alice' },
      legalServicePath: [{ label: 'Advisory' }], workflowProgress: { nextDueAt: '2026-11-12T09:00:00+02:00' } })));
    const invoice = (caseId: any, seq: number, amount: number, entered: string, extra: any = {}) => ({
      _id: oid(), caseId, invoiceNo: `PERIOD-${seq}`, year: 2026, seqYear: seq, seqCase: seq,
      date: '2020-01-01', amount, status: 'Pending', createdAt: stamp(entered), updatedAt: stamp(entered), ...extra,
    });
    await Invoice.collection.insertMany([
      invoice(a, 1, 100, '2026-11-01'), invoice(b, 2, 200, '2026-11-13'),
      invoice(a, 3, 300, '2026-10-31', { status: 'Paid', paidAt: stamp('2026-11-13'), updatedAt: stamp('2026-11-20') }),
      invoice(a, 4, 400, '2026-10-31', { status: 'Paid', paidAt: stamp('2026-11-14'), updatedAt: stamp('2026-11-20') }),
      invoice(c, 5, 800, '2026-11-14', { status: 'Paid', paidAt: stamp('2026-11-14') }),
      invoice(d, 6, 50, '2026-10-31', { status: 'Paid', updatedAt: stamp('2026-11-13') }),
      invoice(a, 7, 7, '2026-11-13', { createdAt: new Date('2026-11-13T21:59:59.999Z') }),
      invoice(c, 8, 9, '2026-11-14', { createdAt: new Date('2026-11-13T22:00:00Z') }),
    ]);
    await Expense.collection.insertMany([
      { fundId: oid(), caseId: b, chargeType: 'client', amount: 200, date: '2020-01-01', createdAt: stamp('2026-11-13'), refundAmount: 100, refundDate: '2026-11-14' },
      { fundId: oid(), chargeType: 'internal', amount: 50, date: '2020-01-01', createdAt: stamp('2026-10-01'), refundAmount: 25, refundDate: '2026-11-13' },
    ]);
    // A whole matter finishes on the LAST action date, rather than on every
    // earlier action's date just because it is completed now.
    const templateId = oid();
    await Template.collection.insertOne({ _id: templateId, name: 'Period fixture', matterType: 'Period fixture',
      stages: [{ key: 'work', title: 'Work', percentage: 100, order: 1 }],
      steps: ['first', 'last'].map((key, i) => ({ key, title: key, stageKey: 'work', percentage: 50, order: i + 1, actions: [] })) });
    await Case.collection.insertOne({ _id: completed!, caseNo: 'PERIOD-COMPLETED', parties: 'Completed client', status: 'Closed',
      assignedTo: 'Alice', caseAssignments: { initiator: 'Alice' }, budget: '1000', createdAt: stamp('2026-10-01'), workflowTemplateId: templateId,
      caseManagement: { qualityScore: 100 }, billingSettings: { currency: 'RWF' } });
    await Workflow.collection.insertOne({ caseId: completed, templateId, status: 'Completed', steps: ['2026-11-01', '2026-11-13'].map((day, i) => ({
      stepKey: i ? 'last' : 'first', title: i ? 'last' : 'first', stageKey: 'work', percentage: 50, order: i + 1, status: 'Completed',
      startAt: new Date(stamp(day).getTime() - 3600000), dueAt: new Date(stamp(day).getTime() + 3600000),
      doneAt: stamp(day), submittedAt: stamp(day), completedAt: stamp(day), actions: [],
    })) });
    await Invoice.collection.insertOne(invoice(completed, 9, 1000, '2026-10-01', { status: 'Paid', paidAt: stamp('2026-10-01') }));
    // Task links must not pull old matter counts back into the entry window.
    await Task.collection.insertOne({ caseId: a, assignee: 'Alice', status: 'Not Started' });

    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
    const token = jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET!);
    const request = async (url: string, body?: any) => {
      const response = await fetch(`${base}${url}`, { method: body ? 'POST' : 'GET', headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() as any };
    };
    const report = async (from: string, to = from, staff = false) => {
      const r = await request(`/reports/${staff ? 'firm' : 'profitability'}?range=custom&from=${from}&to=${to}${staff ? '&scope=profitability&basis=paymentDate' : ''}`);
      assert.equal(r.status, 200, r.body.message); return r.body;
    };
    const first = await report('2026-11-13');
    assert.equal(first.firm.contractValue, 2000);
    assert.equal(first.firm.billed, 207);
    assert.equal(first.firm.recognisedCollectedRevenue, 350);
    assert.equal(first.firm.directMatterCosts, 200);
    assert.equal(first.firm.generalOverheads, -25);
    assert.equal(first.firm.netProfit, 175);
    assert.equal(first.firm.totalReceivables, 707);
    assert.equal(first.firm.activeMatters, 1);
    assert(!first.matterRows.some((row: any) => row.matterNo === 'PERIOD-C'));
    assert.equal(Object.values(first.ageing).reduce((sum: number, value: any) => sum + value, 0), 707);
    for (const rows of [first.matterRows, first.clientRows, first.practiceAreaRows]) {
      assert.equal(rows.reduce((sum: number, row: any) => sum + row.collected, 0), 350);
      assert.equal(rows.reduce((sum: number, row: any) => sum + row.billed, 0), 207);
    }
    const second = await report('2026-11-14');
    assert.equal(second.firm.directMatterCosts, -100);
    assert.equal(second.firm.recognisedCollectedRevenue, 1200);
    assert.equal(second.firm.contractValue, 4000);
    const combined = await report('2026-11-13', '2026-11-14');
    for (const key of ['contractValue', 'billed', 'recognisedCollectedRevenue', 'directMatterCosts', 'generalOverheads', 'netProfit']) {
      assert.equal(combined.firm[key], first.firm[key] + second.firm[key], `${key}: adjacent periods reconcile`);
    }
    console.log('PASS: entry timestamps, later payments/refunds, historical receivables, rollups, next-day exclusion and adjacent-period reconciliation');

    const teamEarly = await report('2026-11-01', '2026-11-01', true);
    const teamLate = await report('2026-11-13', '2026-11-13', true);
    const aliceEarly = teamEarly.team.find((m: any) => m.name === 'Alice');
    const aliceLate = teamLate.team.find((m: any) => m.name === 'Alice');
    assert.equal(aliceEarly.tasksCompleted, 0);
    assert.equal(aliceLate.tasksCompleted, 1);
    assert.equal(aliceLate.activeCases, 1);
    assert.equal(aliceLate.overdueTasks, 1);
    assert(!teamLate.team.some((m: any) => m.name === 'Future'));
    assert(aliceLate.earnedFees > 0);
    assert.equal((await report('2026-11-12', '2026-11-12', true)).team.find((m: any) => m.name === 'Alice').earnedFees, 0);
    console.log('PASS: staff earned fees, completed/active/overdue counts, future staff exclusion and old task links');

    await Period.collection.insertOne({ retainerId: oid(), month: '2026-11', clientName: 'Retainer client', retainerNo: 'RET-PERIOD', fixedFee: 500,
      dueDate: '2026-11-13', status: 'Open', services: [], createdAt: stamp('2026-11-01') });
    const period = await Period.findOne({ retainerNo: 'RET-PERIOD' }).lean();
    await Receipt.collection.insertOne({ periodId: period!._id, retainerId: period!.retainerId, amount: 500, receivedOn: '2026-11-14' });
    const retainerFirst = await report('2026-11-13');
    assert.equal(retainerFirst.retainer.billed, 500);
    assert.equal(retainerFirst.retainer.collected, 0);
    assert.equal(retainerFirst.retainer.outstanding, 500);
    assert.equal((await report('2026-11-14')).retainer.collected, 500);
    console.log('PASS: retainer statement/receipt dates and historical outstanding balances');

    for (const range of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'ytd', 'all']) {
      assert.equal((await request(`/reports/profitability?range=${range}`)).status, 200);
      assert.equal((await request(`/reports/firm?range=${range}&scope=profitability`)).status, 200);
    }
    assert.equal((await request('/reports/firm?range=custom&from=2026-11-14&to=2026-11-13')).status, 400);
    assert.equal((await request('/reports/profitability?range=custom&from=2026-02-30&to=2026-03-01')).status, 400);
    console.log('PASS: every UI period loads through both real report endpoints; invalid dates rejected');

    const timings: number[] = [];
    const client = mongoose.connection.getClient();
    let finds = 0, writes = 0;
    client.on('commandStarted', e => { if (e.commandName === 'find') finds++; if (['update', 'insert', 'findAndModify'].includes(e.commandName)) writes++; });
    const originalHash = (await User.findById(alice._id).lean())!.passwordHash;
    for (let i = 0; i < 5; i++) {
      finds = 0; writes = 0;
      const started = performance.now();
      const login = await request('/auth/login', { email: '  ALICE@PERIODS.INVALID  ', password: 'test-only' });
      timings.push(Math.round(performance.now() - started));
      assert.equal(login.status, 200); assert(login.body.token);
      assert.equal(finds, 1); assert.equal(writes, 0);
    }
    assert.equal((await User.findById(alice._id).lean())!.passwordHash, originalHash);
    const stronger = await bcrypt.hash('test-only', 12);
    await User.collection.updateOne({ _id: alice._id }, { $set: { passwordHash: stronger } });
    finds = 0; writes = 0;
    const started = performance.now();
    assert.equal((await request('/auth/login', { email: alice.email, password: 'test-only' })).status, 200);
    const strongerMs = Math.round(performance.now() - started);
    assert.equal(writes, 0);
    assert.equal((await User.findById(alice._id).lean())!.passwordHash, stronger, 'Stronger password hashes remain intact');
    assert.equal((await request('/auth/login', { email: alice.email, password: 'wrong' })).status, 401);
    assert.equal((await request('/auth/login', { email: {}, password: 'test-only' })).status, 400);
    await User.updateOne({ _id: alice._id }, { $set: { isActive: false } });
    assert.equal((await request('/auth/login', { email: alice.email, password: 'test-only' })).status, 401);
    console.log(`PASS: login one indexed read / zero writes; cost-10 timings ${timings.join(', ')} ms; cost-12 ${strongerMs} ms; wrong/inactive accounts rejected`);
  } finally {
    if (server) await new Promise<void>(done => server!.close(() => done()));
    await mongoose.disconnect(); await db.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
