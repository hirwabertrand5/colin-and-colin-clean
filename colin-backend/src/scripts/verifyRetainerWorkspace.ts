/** Real handlers and synthetic records in a disposable local database only. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../models/userModel';
import Case from '../models/caseModel';
import Template from '../models/workflowTemplateModel';
import Workflow from '../models/workflowInstanceModel';
import Invoice from '../models/invoiceModel';
import Expense from '../models/pettyCashExpenseModel';
import retainerRoutes from '../routes/retainer';
import { authenticate } from '../middleware/authMiddleware';
import { getCaseEarnedFees } from '../controllers/workflowController';

async function main() {
  process.env.JWT_SECRET = 'retainer-workspace-local-verification'; delete process.env.RESEND_API_KEY;
  const binary = path.resolve(__dirname, '../../node_modules/.cache/mongodb-memory-server/test-mongod.exe');
  assert(existsSync(binary), 'Requires the existing local test database binary. Never connects to production.');
  const database = await MongoMemoryReplSet.create({ binary: { systemBinary: binary, version: '7.0.14' }, replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 120000 }] });
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await mongoose.connect(database.getUri(), { dbName: 'retainer_workspace_verification' });
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    const partner = await User.create({ name: 'Partner', email: 'partner@retainer.invalid', role: 'managing_partner', passwordHash: 'test' });
    const alice = await User.create({ name: 'Alice', email: 'alice@retainer.invalid', role: 'associate', passwordHash: 'test' });
    const bob = await User.create({ name: 'Bob', email: 'bob@retainer.invalid', role: 'senior_associate', passwordHash: 'test' });
    const app = express(); app.use(express.json()); app.use('/retainers', retainerRoutes);
    app.get('/cases/:caseId/earned-fees', authenticate, getCaseEarnedFees);
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const request = async (url: string, body?: object, method?: string, actor = partner) => {
      const response = await fetch(origin + url, { method: method || (body ? 'POST' : 'GET'), headers: { Authorization: 'Bearer ' + jwt.sign({ id: String(actor._id) }, process.env.JWT_SECRET!), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() as any };
    };
    const get = async (url: string) => { const result = await request(url); assert.equal(result.status, 200, result.data.message); return result.data; };
    const payload = { name: 'Annual legal services', clientName: 'Client Ltd', billingModel: 'monthly', status: 'Active', startDate: '2020-01-01', endDate: '2030-12-31', renewalDate: '2027-12-01', monthlyFee: 1000000, billingDay: 14, scope: 'Advice and disputes', notes: 'Quarterly review' };
    const created = await request('/retainers', payload); assert.equal(created.status, 201, created.data.message);
    for (const key of Object.keys(payload) as (keyof typeof payload)[]) assert.equal(created.data[key], payload[key]);
    const id = created.data._id;
    const template = await Template.create({ name: 'Workspace test', matterType: 'Workspace test', caseType: 'Transactional Cases', stages: [{ key: 'work', title: 'Work', order: 1, percentage: 100 }], steps: [{ key: 'action', title: 'Action', stageKey: 'work', order: 1, percentage: 100, actions: [], outputs: [], legalBasis: [], responsibleRole: 'Initiator' }] });
    let sequence = 0;
    const fixture = async (department: string | null, quality: number | null, collected: number, pending = 0, link = id) => {
      const number = ++sequence;
      const matter = await Case.create({ caseNo: 'RET-' + number, parties: 'Client case ' + number, status: 'In Progress', caseType: 'Transactional Cases', budget: '2000000',
        legalServicePath: [{ id: department || 'unknown_department', label: department === 'dispute_resolution' ? 'A. Dispute Resolution' : department ? 'B. Transaction & Advisory' : 'Unknown' }],
        ...(link ? { retainerId: link, billingArrangement: 'retainer' } : {}), assignedTo: alice.name,
        caseAssignments: { initiator: alice.name, reviewer: bob.name, signerApprover: partner.name }, workflowTemplateId: template._id,
        ...(quality == null ? {} : { caseManagement: { qualityScore: quality } }) });
      await Workflow.collection.insertOne({ caseId: matter._id, templateId: template._id, steps: [{ stepKey: 'action', title: 'Action', stageKey: 'work', order: 1, percentage: 100, status: quality == null ? 'Not Started' : 'Completed', actions: [], outputs: [],
        startAt: new Date('2026-01-01T10:00:00Z'), dueAt: new Date('2026-01-11T10:00:00Z'), ...(quality == null ? {} : { submittedAt: new Date('2026-01-02T10:00:00Z'), submittedBy: alice.name, reviewedAt: new Date('2026-01-02T10:00:00Z'), reviewedBy: bob.name, completedAt: new Date('2026-01-02T10:00:00Z'), completedBy: partner.name }) }] });
      if (collected) await Invoice.collection.insertOne({ caseId: matter._id, invoiceNo: 'RET-INV-' + number, year: 2026, seqYear: number, seqCase: 1, date: '2026-01-05', amount: collected, status: 'Paid' });
      if (pending) await Invoice.collection.insertOne({ caseId: matter._id, invoiceNo: 'RET-PENDING-' + number, year: 2025, seqYear: number, seqCase: 2, date: '2026-01-05', amount: pending, status: 'Pending' });
      return matter;
    };
    const dispute = await fixture('dispute_resolution', 80, 500000, 200000);
    const advisory = await fixture('transactions_advisory', 100, 1000000);
    const pending = await fixture('dispute_resolution', null, 0);
    const unknown = await fixture(null, null, 0);
    const other = await fixture('transactions_advisory', 100, 999999, 0, '');
    await Expense.collection.insertMany([{ caseId: dispute._id, chargeType: 'client', amount: 30000, refundAmount: 5000 }, { caseId: advisory._id, chargeType: 'client', amount: 5000 }, { caseId: dispute._id, chargeType: 'internal', amount: 90000 }]);
    const workspace = await get('/retainers/' + id + '/cases');
    assert.equal(workspace.cases.length, 4);
    assert.equal(workspace.summary.totalBilled, 1700000); assert.equal(workspace.summary.totalCollected, 1500000); assert.equal(workspace.summary.outstanding, 200000);
    assert.equal(workspace.summary.directMatterCosts, 30000); assert.equal(workspace.summary.staffCount, 3);
    assert.equal(workspace.cases.find((matter: any) => matter._id === String(dispute._id)).department, 'Dispute Resolution');
    assert.equal(workspace.cases.find((matter: any) => matter._id === String(advisory._id)).department, 'Transaction & Advisory');
    assert.equal(workspace.cases.find((matter: any) => matter._id === String(unknown._id)).department, null);
    assert(!workspace.cases.some((matter: any) => matter._id === String(other._id)));
    for (const matter of workspace.cases) {
      const original = await get('/cases/' + matter._id + '/earned-fees');
      assert.deepEqual(matter.team, original.team);
      assert.equal(matter.staffEarnedFees, original.staffEarnedTotal);
      assert.equal(matter.netAfterStaff, Math.round((matter.totalCollected - matter.directMatterCosts - (original.staffEarnedTotal || 0)) * 100) / 100);
    }
    const waiting = workspace.cases.find((matter: any) => matter._id === String(pending._id));
    assert.deepEqual(waiting.team.map((member: any) => member.name), ['Alice', 'Bob', 'Partner']);
    assert.equal(waiting.staffEarnedFees, null); assert.equal(waiting.pendingStaffCount, 3);
    assert.equal(workspace.summary.staffEarnedFees, 264600); assert.equal(workspace.summary.netAfterStaff, 1205400);
    assert.equal(workspace.summary.pendingStaffCount, 6);
    assert.equal((await request('/retainers/' + id + '/cases', undefined, 'GET', alice)).status, 403);
    const updated = await request('/retainers/' + id, { ...payload, monthlyFee: 2000000 }, 'PUT');
    assert.equal(updated.status, 200); assert.equal((await get('/retainers/' + id)).monthlyFee, 2000000);
    const linked = await request('/retainers/cases/' + other._id + '/link', { retainerId: id }); assert.equal(linked.status, 200, linked.data.message);
    assert.equal((await get('/retainers/' + id + '/cases')).summary.caseCount, 5);
    const unlinked = await request('/retainers/cases/' + other._id + '/link', {}); assert.equal(unlinked.status, 200);
    assert.equal((await get('/retainers/' + id + '/cases')).summary.caseCount, 4);
    console.log('PASS: form fields persist, fee edits refresh, case/department totals reconcile, staff roles and scores match case workspaces, pending fees remain pending, refunded costs, permissions, and linking/unlinking.');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
    await mongoose.disconnect(); await database.stop();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
