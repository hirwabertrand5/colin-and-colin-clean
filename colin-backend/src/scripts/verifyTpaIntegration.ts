/** Real HTTP handlers and transactions against a disposable local replica set. Never uses MONGO_URI. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import userRoutes from '../routes/user';
import User from '../models/userModel';
import Case from '../models/caseModel';
import Template from '../models/workflowTemplateModel';
import Workflow from '../models/workflowInstanceModel';
import Task from '../models/taskModel';
import Invoice from '../models/invoiceModel';
import Ledger from '../models/staffEarningsLedgerModel';
import AuditLog from '../models/auditLogModel';
import { computeCaseEarnedFees } from '../utils/caseEarnedFees';
import { buildRoleByName } from '../utils/workflowPercentages';
import { resolveTpaRate } from '../utils/tpaRates';
import { loadEarningRows, snapshotCaseEarnings } from '../services/earningSnapshotService';

async function main() {
  process.env.JWT_SECRET = 'isolated-tpa-verification-only';
  delete process.env.RESEND_API_KEY;
  const binary = path.resolve(__dirname, '../../node_modules/.cache/mongodb-memory-server/test-mongod.exe');
  assert(existsSync(binary), 'Local test MongoDB binary must exist; this check never downloads or uses production MongoDB.');
  const replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: binary }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 120000 }] });
  let server: ReturnType<express.Express['listen']> | undefined;
  let passed = 0;
  const pass = (message: string) => console.log(`PASS ${++passed}: ${message}`);
  const now = Date.now();
  const at = (hours: number) => new Date(now + hours * 3600000).toISOString();
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'tpa_isolated_verification' });
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    const admin = await User.create({ name: 'Managing Partner', email: 'partner@tpa.invalid', role: 'managing_partner', passwordHash: 'test-only' });
    const staff = await User.create({ name: 'TPA Staff', email: 'staff@tpa.invalid', role: 'intern', passwordHash: 'test-only' });
    const app = express(); app.use(express.json()); app.use('/users', userRoutes);
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const request = async (url: string, body?: any, actor = admin, method?: string) => {
      const response = await fetch(`${base}${url}`, { method: method || (body ? 'POST' : 'GET'),
        headers: { Authorization: `Bearer ${jwt.sign({ id: String(actor._id) }, process.env.JWT_SECRET!)}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() as any };
    };
    const url = `/users/${staff._id}/tpa`;
    const configuration = async () => { const r = await request(url); assert.equal(r.status, 200); return r.body; };
    const change = async (body: any) => {
      const result = await request(url, { reason: 'Integration verification', confirmBackdated: true, revision: (await configuration()).revision, ...body });
      assert.equal(result.status, 200, result.body.message); return result.body;
    };
    const template = await Template.create({ name: 'Dynamic TPA', matterType: 'Dynamic TPA', caseType: 'Transactional Cases',
      stages: [{ key: 'work', title: 'Work', order: 1, percentage: 100 }],
      steps: [{ key: 'action', title: 'Action', stageKey: 'work', order: 1, percentage: 100, actions: [], outputs: [], legalBasis: [], responsibleRole: 'Initiator' }] });
    let fixtureNumber = 0;
    const fixture = async (activityAt: string, options: { legacy?: boolean; delegated?: boolean; unpaid?: boolean; forged?: boolean } = {}) => {
      const number = ++fixtureNumber;
      const matter = await Case.create({ caseNo: `TPA-${number}`, parties: 'Isolated rate verification', caseType: 'Transactional Cases',
        status: 'In Progress', assignedTo: options.delegated ? 'Unassigned owner' : staff.name,
        caseAssignments: { initiator: options.delegated ? 'Unassigned owner' : staff.name },
        budget: '1000000', billingSettings: { currency: 'RWF' }, matterType: template.matterType, workflowTemplateId: template._id,
        caseManagement: { qualityScore: 90, qualityScoredBy: admin.name, qualityScoredAt: new Date() } });
      const instance = await Workflow.create({ caseId: matter._id, templateId: template._id, steps: [{ stepKey: 'action', title: 'Action', stageKey: 'work', order: 1, status: 'Not Started',
        startAt: new Date(+new Date(activityAt) - 3600000), dueAt: new Date(+new Date(activityAt) + 9 * 3600000), actions: [], outputs: [] }] });
      const step: any = instance.steps[0]!;
      const completed = { status: 'Completed', doneAt: new Date(activityAt), submittedAt: new Date(activityAt), completedAt: new Date(activityAt),
        ...(options.delegated ? { independentContributors: [{ taskId: new mongoose.Types.ObjectId(), name: staff.name, role: 'Initiator', actedAt: new Date(activityAt), userId: staff._id }] } : {}) };
      if (options.legacy) await Workflow.collection.updateOne({ _id: instance._id }, { $set: Object.fromEntries(Object.entries(completed).map(([key, value]) => [`steps.0.${key}`, value])) });
      else {
        Object.assign(step, completed);
        if (options.forged) step.tpaSnapshots = [{ staffKey: 'tpa staff', staffName: staff.name, assignmentRole: 'Initiator', activityAt: new Date(activityAt), rate: 99, recordedAt: new Date() }];
        await instance.save();
      }
      if (!options.unpaid) {
        if (options.legacy) await Invoice.collection.insertOne({ caseId: matter._id, invoiceNo: `TPA-INV-${number}`, year: 2026, seqYear: number, seqCase: 1, date: new Date().toISOString().slice(0,10), amount: 1000000, status: 'Paid', createdAt: new Date(), updatedAt: new Date() });
        else await Invoice.create({ caseId: matter._id, invoiceNo: `TPA-INV-${number}`, year: 2026, seqYear: number, seqCase: 1, date: new Date().toISOString().slice(0,10), amount: 1000000, status: 'Paid' });
      }
      return { matter, instance };
    };

    assert.equal((await request(url, { kind: 'normal', rate: 99, from: at(1), reason: 'Self change' }, staff)).status, 403);
    assert.equal((await request(url, undefined, staff)).status, 403);
    assert.equal((await request('/users')).status, 200);
    assert.equal((await request(`/users/${staff._id}`, { role: 'partner' }, admin, 'PUT')).status, 403);
    pass('HTTP authorization rejects staff self-management; Managing Partner can manage TPA without account-edit authority');

    const historical = await fixture(at(-10));
    let saved: any = await Ledger.findOne({ caseId: historical.matter._id }).lean();
    assert(saved); assert.equal(saved.tpaPercent, 1);
    const originalAmount = saved.earnedFee;
    const originalSnapshots: any = (await Workflow.findById(historical.instance._id).lean())!.steps[0]!.tpaSnapshots;
    assert.equal(originalSnapshots[0].rate, 1);
    pass('Activity-time rates and financial ledger inputs are captured automatically, without opening a report');

    await change({ kind: 'normal', rate: 5, from: at(-8) });
    const future = await fixture(at(-7));
    assert.equal((await Ledger.findOne({ caseId: future.matter._id }).lean())!.tpaPercent, 5);
    await snapshotCaseEarnings(historical.matter._id);
    saved = await Ledger.findOne({ caseId: historical.matter._id }).lean();
    assert.equal(saved.tpaPercent, 1); assert.equal(saved.earnedFee, originalAmount);
    pass('Normal 1% → 5% uses the configured start date and preserves earlier rates and amounts');

    await change({ kind: 'special', rate: 10, from: at(-6) });
    const specialWork = await fixture(at(-5));
    assert.equal((await Ledger.findOne({ caseId: specialWork.matter._id }).lean())!.tpaPercent, 10);
    await change({ kind: 'normal', rate: 3, from: at(-4) });
    let config = await configuration();
    assert.equal(config.currentRate, 10);
    const special = config.history.find((r: any) => r.kind === 'special');
    await change({ kind: 'stop', specialId: special._id, from: at(-2) });
    config = await configuration();
    assert.equal(config.currentRate, 3);
    assert(config.history.find((r: any) => r._id === special._id).until);
    assert.equal(resolveTpaRate(config.history, at(-2), 1), 3);
    assert.equal(resolveTpaRate(config.history, new Date(+new Date(at(-2)) - 1), 1), 10);
    pass('Special precedence, normal changes during a special, and exclusive stop boundaries share one dynamic history');

    const revision = config.revision;
    const overlap = await request(url, { kind: 'special', rate: 20, from: at(-5), until: at(-3), reason: 'Conflict', confirmBackdated: true, revision });
    assert.equal(overlap.status, 400); assert.match(overlap.body.message, /overlap/);
    assert.equal((await configuration()).revision, revision);
    pass('Overlapping special periods are rejected without modifying history');

    const body = { kind: 'normal', rate: 8, from: at(-11), reason: 'Backdated', confirmBackdated: true, revision };
    const preview = await request(url, { ...body, preview: true });
    assert.equal(preview.status, 200); assert(preview.body.savedEarningsAffected > 0);
    assert(preview.body.affectedActivities > 0);
    assert(preview.body.financialImpact.RWF.proposedDelta > 0);
    assert.equal(preview.body.financialImpact.RWF.appliedDelta, 0);
    assert.equal((await request(url, body)).status, 400);
    assert.equal((await Ledger.findOne({ caseId: historical.matter._id }).lean())!.earnedFee, originalAmount);
    pass('Backdated impact includes priced activities; finalized snapshots block silent corrections');

    const legacy = await fixture(at(-1), { legacy: true });
    const legacyPreview = await request(url, { kind: 'special', rate: 7, from: at(-1.5), until: at(-0.5), reason: 'Legacy correction preview', confirmBackdated: true, revision: config.revision, preview: true });
    assert.equal(legacyPreview.status, 200);
    assert(legacyPreview.body.unsnapshottedActivities > 0);
    assert(legacyPreview.body.financialImpact.RWF.appliedDelta > 0);
    await change({ kind: 'special', rate: 7, from: at(-1.5), until: at(-0.5) });
    const legacyRows = await loadEarningRows([String(legacy.matter._id)]);
    assert.equal(legacyRows.find(r => r.staffKey === 'tpa staff')!.tpaPercent, 7);
    pass('Legacy unsnapshotted activities are counted, priced and changed only after explicit backdating confirmation');

    const delegated = await fixture(at(1), { delegated: true, unpaid: true });
    const frozen: any = await Workflow.findById(delegated.instance._id).lean();
    const users = await User.find({}).lean();
    const shared = computeCaseEarnedFees({ caseDoc: delegated.matter.toObject(), template: template.toObject(), workflowInstance: frozen,
      tasks: [], collectedAmount: 1000000, roleByName: buildRoleByName(users) });
    assert.equal(shared.team.find(m => m.name === staff.name)!.actionTpaRates.action, 3);
    await change({ kind: 'normal', rate: 6, from: at(2) });
    await Invoice.create({ caseId: delegated.matter._id, invoiceNo: 'TPA-LATE-COLLECTION', year: 2026, seqYear: 1000, seqCase: 1,
      date: new Date().toISOString().slice(0,10), amount: 1000000, status: 'Paid' });
    const paid: any = await Ledger.findOne({ caseId: delegated.matter._id, staffKey: 'tpa staff' }).lean();
    assert.equal(paid.tpaPercent, 3); assert(paid.earnedFee > 0); assert(paid.inputHistory.length > 0);
    assert.equal(await Ledger.countDocuments({ caseId: delegated.matter._id, staffKey: 'tpa staff' }), 1);
    assert(await AuditLog.countDocuments({ caseId: delegated.matter._id, action: 'EARNING_SNAPSHOT_REFRESHED' }) > 0);
    pass('Delegated work retains its activity-time rate across later collection; prior inputs remain auditable and earnings are not duplicated');

    const before = await configuration();
    const auditBefore = await AuditLog.countDocuments({ action: 'USER_TPA_CHANGED' });
    const concurrentBody = { kind: 'normal', from: at(4), reason: 'Concurrent verification', revision: before.revision };
    const concurrent = await Promise.all([request(url, { ...concurrentBody, rate: 8 }), request(url, { ...concurrentBody, rate: 9 })]);
    assert.equal(concurrent.filter(r => r.status === 200).length, 1);
    assert.equal(concurrent.filter(r => r.status === 400).length, 1);
    assert.equal(await AuditLog.countDocuments({ action: 'USER_TPA_CHANGED' }), auditBefore + 1);
    pass('Concurrent administrative writes commit exactly one change and one audit event');

    const rollbackBefore = await configuration();
    const createAudit = AuditLog.create;
    (AuditLog as any).create = async (...args: any[]) => {
      if (args[0]?.[0]?.action === 'USER_TPA_CHANGED') throw new Error('Injected audit failure');
      return (createAudit as any).apply(AuditLog, args);
    };
    try {
      const failed = await request(url, { kind: 'normal', rate: 12, from: at(6), reason: 'Rollback verification', revision: rollbackBefore.revision });
      assert.equal(failed.status, 400);
    } finally { AuditLog.create = createAudit; }
    assert.equal((await configuration()).revision, rollbackBefore.revision);
    assert.deepEqual((await configuration()).history, rollbackBefore.history);
    pass('Audit failure rolls back the entire rate change transaction');

    const tampered: any = await Workflow.findById(historical.instance._id);
    tampered.steps[0].tpaSnapshots = [{ ...originalSnapshots[0], rate: 99 }];
    await tampered.save();
    assert.equal((await Workflow.findById(tampered._id).lean())!.steps[0]!.tpaSnapshots![0]!.rate, 1);
    const report = await loadEarningRows([String(historical.matter._id)]);
    assert.equal(report[0]!.tpaPercent, 1); assert.equal(report[0]!.earnedFee, originalAmount);
    pass('Applied snapshots cannot be overwritten by source-document edits; historical reports retain the original rate');

    const legacyTaskMatter = await fixture(at(8), { legacy: true });
    await Workflow.deleteOne({ _id: legacyTaskMatter.instance._id });
    const task = await Task.create({ caseId: legacyTaskMatter.matter._id, taskNo: 'TPA-LEGACY-TASK', title: 'Action',
      workflowStepKey: 'action', assignee: staff.name, supervisor: admin.name, dueDate: at(9).slice(0,10), startDate: at(7).slice(0,10), status: 'Not Started' });
    const completedTask = await Task.findByIdAndUpdate(task._id, { status: 'Completed', completedAt: new Date(at(8)) }, { returnDocument: 'after' });
    const taskRate = resolveTpaRate((await configuration()).history, at(8), 1);
    assert.equal(completedTask!.tpaSnapshots![0]!.rate, taskRate);
    assert.equal((await Ledger.findOne({ caseId: legacyTaskMatter.matter._id, staffKey: 'tpa staff' }).lean())!.tpaPercent, taskRate);
    pass('Legacy task query-based completion captures the same effective rate and creates the earning automatically');

    const invoiceFixture = await fixture(at(9), { unpaid: true });
    const pendingInvoice = await Invoice.create({ caseId: invoiceFixture.matter._id, invoiceNo: 'TPA-QUERY-PAYMENT', year: 2026, seqYear: 2000, seqCase: 1,
      date: new Date().toISOString().slice(0,10), amount: 500000, status: 'Pending' });
    const unpaidSnapshot = await Ledger.findOne({ caseId: invoiceFixture.matter._id, staffKey: 'tpa staff' }).lean();
    assert.equal(unpaidSnapshot!.eligibleCollectedBase, 0);
    await Invoice.findByIdAndUpdate(pendingInvoice._id, { status: 'Paid' }, { returnDocument: 'after' });
    const paidSnapshot = await Ledger.findOne({ caseId: invoiceFixture.matter._id, staffKey: 'tpa staff' }).lean();
    assert.equal(paidSnapshot!.eligibleCollectedBase, 500000);
    assert.equal(paidSnapshot!.tpaPercent, unpaidSnapshot!.tpaPercent);
    assert.equal(paidSnapshot!.inputHistory[0].eligibleCollectedBase, 0);
    pass('Query-based payment confirmation applies the existing collection cap and preserves the original unpaid snapshot');

    const currentConfig = await configuration();
    const forged = await fixture(at(10), { forged: true });
    assert.equal((await Workflow.findById(forged.instance._id).lean())!.steps[0]!.tpaSnapshots![0]!.rate, resolveTpaRate(currentConfig.history, at(10), 1));
    assert.equal((await request(url, { kind: 'normal', rate: 8, reason: 'Missing start', revision: currentConfig.revision })).status, 400);
    assert.equal((await request(url, { kind: 'normal', rate: 8, from: at(12).slice(0,19), reason: 'Missing timezone', revision: currentConfig.revision })).status, 400);
    assert.equal(await AuditLog.countDocuments({ action: 'USER_TPA_CHANGED' }), currentConfig.revision);
    pass('Backend requires start dates/timezones, rejects forged applied rates, and audits every committed administrative change');
    console.log(`All ${passed} TPA integration scenarios passed.`);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await mongoose.disconnect(); await replica.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
