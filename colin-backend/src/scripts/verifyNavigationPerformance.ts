/** Compare financial responses with the committed handler; use disposable MongoDB only. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../app';
import User from '../models/userModel';
import Case from '../models/caseModel';
import Template from '../models/workflowTemplateModel';
import Workflow from '../models/workflowInstanceModel';
import Invoice from '../models/invoiceModel';
import Expense from '../models/pettyCashExpenseModel';
import { getFirmReports } from '../controllers/firmReportsController';

async function main() {
  delete process.env.MONGO_URI;
  delete process.env.RESEND_API_KEY;
  process.env.JWT_SECRET = 'isolated-navigation-verification';
  const binary = path.resolve(__dirname, '../../node_modules/.cache/mongodb-memory-server/test-mongod.exe');
  assert(existsSync(binary), 'Use the existing test MongoDB binary, never production or a download.');
  console.log('Starting isolated navigation/financial verification...');
  const replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: binary }, replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 120000 }] });
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'navigation_verification' });
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    const admin = await User.create({ name: 'Navigation Director', email: 'director@navigation.invalid', role: 'managing_director', passwordHash: 'test-only' });
    const staff = await User.create({ name: 'Navigation Staff', email: 'staff@navigation.invalid', role: 'associate', passwordHash: 'test-only' });
    const template = await Template.create({ name: 'Navigation Fixture', matterType: 'Navigation Fixture', caseType: 'Transactional Cases',
      stages: [{ key: 'work', title: 'Work', order: 1, percentage: 100 }], steps: [{ key: 'a', title: 'Action', stageKey: 'work', order: 1, percentage: 100 }] });
    const matters = await Case.insertMany(['In Progress', 'Closed', 'Temporarily Closed'].map((status, i) => ({
      caseNo: `NAV-${i}`, parties: `Client ${i}`, clientName: `Recorded Client ${i}`, caseType: 'Transactional Cases', status, assignedTo: staff.name,
      caseAssignments: { initiator: staff.name, reviewer: admin.name, signerApprover: admin.name }, budget: '100000',
      workflowTemplateId: template._id, matterType: template.matterType, workflow: template.matterType,
      caseManagement: { qualityScore: 90 }, createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-11-05'),
    })));
    await Workflow.collection.insertMany(matters.map(matter => ({ caseId: matter._id, templateId: template._id, status: 'Completed', steps: [{
      stepKey: 'a', title: 'Action', stageKey: 'work', order: 1, percentage: 100, status: 'Completed', actions: [],
      startAt: new Date('2026-11-01'), dueAt: new Date('2026-11-08'), doneAt: new Date('2026-11-04'), submittedAt: new Date('2026-11-04'),
      reviewedAt: new Date('2026-11-05'), completedAt: new Date('2026-11-05'),
    }] })));
    await Invoice.collection.insertMany(matters.map((matter, i) => ({ caseId: matter._id, invoiceNo: `NAV-INV-${i}`, year: 2026, seqYear: i + 1, seqCase: 1, date: '2026-11-03', amount: 50000 + i,
      status: i === 1 ? 'Pending' : 'Paid', updatedAt: new Date('2026-11-05'), createdAt: new Date('2026-11-03') })));
    const fundA = new mongoose.Types.ObjectId(); const fundB = new mongoose.Types.ObjectId();
    await Expense.collection.insertMany(Array.from({ length: 507 }, (_, i) => ({ fundId: i < 503 ? fundA : fundB,
      caseId: matters[i < 503 ? 0 : 1]!._id, date: '2026-11-04', title: `Expense ${i}`, amount: i + 1, refundAmount: i % 3,
      chargeType: i % 2 ? 'client' : 'internal', createdByName: admin.name, createdAt: new Date(Date.UTC(2026, 10, 4, 0, i)) })));
    const baselineSource = execFileSync('git', ['show', 'HEAD:colin-backend/src/controllers/firmReportsController.ts'], { encoding: 'utf8' });
    const filename = path.resolve(__dirname, '../controllers/firmReportsController.ts');
    const baselineModule: any = new (Module as any)(filename, module);
    baselineModule.filename = filename;
    baselineModule.paths = (Module as any)._nodeModulePaths(path.dirname(filename));
    baselineModule._compile(ts.transpileModule(baselineSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
    const invoke = async (handler: any, query: any) => {
      let result: any; let status = 200;
      await handler({ query, user: { id: String(admin._id), role: admin.role, name: admin.name } }, {
        status(value: number) { status = value; return this; }, json(value: any) { result = JSON.parse(JSON.stringify(value)); return this; },
      });
      assert.equal(status, 200, result?.message);
      return result;
    };
    for (const basis of ['invoiceDate', 'paymentDate']) for (const teamMemberId of [undefined, String(staff._id)]) {
      const query = { from: '2026-11-01', to: '2026-11-30', basis, ...(teamMemberId ? { teamMemberId } : {}) };
      const before = await invoke(baselineModule.exports.getFirmReports, query);
      const after = await invoke(getFirmReports, query);
      assert.deepEqual(after, before, `Financial response changed for ${basis}, ${teamMemberId || 'all staff'}`);
    }
    console.log('PASS: optimized financial reporting exactly matches the committed handler for both date bases and staff scopes.');
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/petty-cash`;
    const read = async (url: string, actor = admin) => {
      const res = await fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${jwt.sign({ id: String(actor._id) }, process.env.JWT_SECRET!)}` } });
      return { status: res.status, data: await res.json() as any };
    };
    for (const [kind, ids, route] of [['caseIds', matters.map(matter => String(matter._id)), 'cases'], ['fundIds', [String(fundA), String(fundB)], 'funds']] as const) {
      const batch = await read(`/expenses/batch?${kind}=${ids.join(',')}`); assert.equal(batch.status, 200);
      for (const id of ids) { const individual = await read(`/${route}/${id}/expenses`); assert.equal(individual.status, 200); assert.deepEqual(batch.data[id], individual.data); }
    }
    assert.equal((await read(`/expenses/batch?caseIds=${matters[0]!._id}`, staff)).status, 403);
    assert.equal((await read('/expenses/batch?caseIds=invalid')).status, 400);
    assert.equal((await read(`/expenses/batch?caseIds=${matters[0]!._id}&fundIds=${fundA}`)).status, 400);
    console.log('PASS: batch reads preserve every expense, ordering, the 500-row per-group limit, empty groups, permissions, and validation.');
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await mongoose.disconnect(); await replica.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
