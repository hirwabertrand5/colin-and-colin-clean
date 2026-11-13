/** Read-model regression using disposable MongoDB. Never loads production .env. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { existsSync } from 'node:fs';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { performance } from 'node:perf_hooks';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../app';
import Case from '../models/caseModel';
import User from '../models/userModel';
import Prospect from '../models/prospectModel';
import { isActiveMatter, countActiveMatters, isCompletedMatter, isTemporarilyClosedMatter } from '../utils/matterLifecycle';

async function main() {
  delete process.env.MONGO_URI; delete process.env.RESEND_API_KEY;
  process.env.JWT_SECRET = 'isolated-active-matter-regression';
  process.env.NOTIFICATION_EMAIL_ENABLED = 'false';
  for (const status of ['Temporarily Closed', 'temporarily_closed', ' Returned-To-Intake ', 'Closed', 'COMPLETED', 'Cancelled', 'canceled']) {
    assert(!isActiveMatter({ status }), `${status} must never count as active`);
  }
  assert(!isActiveMatter({ status: 'In Progress', workflowProgress: { status: ' COMPLETED ' } }));
  assert(isActiveMatter({ status: 'In Progress', workflowProgress: { status: 'In Progress' } }));
  assert(!isCompletedMatter({ status: 'Temporarily Closed', workflowProgress: { status: 'Completed' } }));
  assert(isTemporarilyClosedMatter({ status: 'temporarily-closed' }));
  assert.equal(countActiveMatters([{ id: 'same', status: 'Open' }, { id: 'same', status: 'Open' }]), 1);
  const binary = path.resolve(__dirname, '../../node_modules/.cache/mongodb-memory-server/test-mongod.exe');
  assert(existsSync(binary));
  const replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: binary },
    replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 120000 }] });
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'active_matter_consistency' });
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    const actor = await User.create({ name: 'Fixture Manager', email: 'manager@active.invalid', role: 'managing_director', passwordHash: 'test-only' });
    const entered = new Date(); entered.setDate(entered.getDate() - 2);
    const make = (index: number, extra: any = {}) => ({ _id: new mongoose.Types.ObjectId(), caseNo: `ACTIVE-${index}`, parties: 'Shared Client',
      assignedTo: actor.name, caseAssignments: { initiator: actor.name, reviewer: actor.name }, status: 'In Progress',
      budget: '1000', createdAt: entered, updatedAt: entered, workflowProgress: { status: 'In Progress' }, legalServicePath: [{ label: 'Advisory' }], ...extra });
    const active = Array.from({ length: 105 }, (_, i) => make(i));
    const workflowCompleted = make(105, { workflowProgress: { status: 'Completed' } });
    const returned = make(106, { status: 'Returned to Intake' });
    const fixtures = [...active, workflowCompleted, returned,
      make(107, { status: 'Temporarily Closed' }), make(108, { status: 'Closed' }), make(109, { status: 'Cancelled' }),
      make(110, { status: 'temporarily_closed' }), make(111, { status: ' Returned-To-Intake ' }),
      make(112, { workflowProgress: { status: 'completed' } })];
    await Case.collection.insertMany(fixtures);
    // A prospect contributes to the pipeline, never the active-matter total.
    await Prospect.collection.insertOne({ clientName: 'Pipeline Client', isActive: true, stage: 'Engagement', createdAt: entered, updatedAt: entered });
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
    const token = jwt.sign({ id: String(actor._id) }, process.env.JWT_SECRET!);
    const get = async (url: string) => {
      const start = performance.now();
      const response = await fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json() as any;
      assert.equal(response.status, 200, body.message);
      console.log(`${url.split('?')[0]}: ${Math.round(performance.now() - start)} ms`);
      return body;
    };
    const list = await get('/cases');
    assert.equal(countActiveMatters(list), 105);
    const firm = await get('/reports/firm?range=ytd');
    assert.equal(firm.kpis.activeCases, 105);
    assert.equal(firm.caseTypes.reduce((n: number, row: any) => n + row.active, 0), 105);
    assert.equal(firm.clientProfitability.reduce((n: number, row: any) => n + row.activeMatters, 0), 105);
    assert.equal(firm.team.find((member: any) => member.name === actor.name).activeCases, 105, 'Multiple assignment roles must not count a case twice');
    const profit = await get('/reports/profitability?range=ytd');
    assert.equal(profit.firm.activeMatters, 105);
    assert.equal(profit.clientRows.reduce((n: number, row: any) => n + row.activeMatters, 0), 105);
    assert.equal(profit.practiceAreaRows.reduce((n: number, row: any) => n + row.activeMatters, 0), 105);
    const staff = await get('/reports/firm?range=ytd&scope=profitability');
    assert.equal(staff.team.find((member: any) => member.name === actor.name).activeCases, 105);
    const personal = await get('/reports/my-productivity?range=ytd');
    assert.equal(personal.team[0].activeCases, 105, 'Personal reports must select operational status');
    const summary = await get('/dashboard/staff-summary');
    assert.equal(summary.mattersOutstanding, 105);
    // Both status changes must affect the very next read, without stale totals.
    await Case.collection.updateOne({ _id: active[0]!._id }, { $set: { status: 'Temporarily Closed' } });
    assert.equal((await get('/reports/firm?range=ytd&scope=profitability')).team.find((member: any) => member.name === actor.name).activeCases, 104);
    await Case.collection.updateOne({ _id: active[0]!._id }, { $set: { status: 'In Progress' } });
    assert.equal((await get('/reports/profitability?range=ytd')).firm.activeMatters, 105);
    console.log('PASS: 105 active matters agree across list/dashboard rules, firm/personal/staff reports, client/practice rollups and immediate lifecycle changes; pipeline prospects excluded');
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await mongoose.disconnect(); await replica.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
