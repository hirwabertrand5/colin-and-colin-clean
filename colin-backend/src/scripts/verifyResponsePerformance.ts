/** Real HTTP and accounting hooks against disposable MongoDB. Never reads .env. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../app';
import User from '../models/userModel';
import Case from '../models/caseModel';
import Template from '../models/workflowTemplateModel';
import Workflow from '../models/workflowInstanceModel';
import Ledger from '../models/staffEarningsLedgerModel';
import Notification from '../models/notificationModel';
import Audit from '../models/auditLogModel';
import { processEmailDeliveries } from '../services/emailDeliveryService';
import { snapshotCaseEarnings } from '../services/earningSnapshotService';

async function main() {
  delete process.env.MONGO_URI;
  delete process.env.RESEND_API_KEY;
  process.env.NOTIFICATION_EMAIL_ENABLED = 'false';
  process.env.JWT_SECRET = 'isolated-response-performance-only';
  console.log('Starting disposable performance database...');
  const binary = path.resolve(__dirname, '../../node_modules/.cache/mongodb-memory-server/test-mongod.exe');
  assert(existsSync(binary), 'Requires the existing local MongoDB test binary; never downloads one.');
  const replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: binary },
    replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 120000 }] });
  let server: ReturnType<typeof app.listen> | undefined;
  let queryCount = 0;
  const results: Array<{ action: string; ms: number; databaseOperations: number }> = [];
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'response_performance', monitorCommands: true });
    mongoose.connection.getClient().on('commandStarted', (event) => {
      if (!['hello', 'ismaster', 'endSessions'].includes(event.commandName)) queryCount++;
    });
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    const users = await Promise.all(['Initiator', 'Reviewer', 'Approver', 'Outsider'].map(name =>
      User.create({ name, email: `${name.toLowerCase()}@performance.invalid`, role: 'associate', passwordHash: 'test-only' })));
    const [initiator, reviewer, approver, outsider] = users;
    assert(initiator && reviewer && approver && outsider);
    const steps = Array.from({ length: 10 }, (_, i) => ({ key: `action_${i}`, title: `Action ${i + 1}`, stageKey: 'work', order: i + 1, percentage: 10, actions: [], outputs: [], legalBasis: [] }));
    const template = await Template.create({ name: 'Performance fixture', matterType: 'Performance fixture', caseType: 'Transactional Cases',
      stages: [{ key: 'work', title: 'Work', order: 1, percentage: 100 }], steps });
    const matter = await Case.create({ caseNo: 'PERF-1', parties: 'Disposable performance fixture', caseType: 'Transactional Cases', status: 'In Progress',
      assignedTo: initiator.name, caseAssignments: { initiator: initiator.name, reviewer: reviewer.name, signerApprover: approver.name },
      workflowTemplateId: template._id, matterType: template.matterType, workflow: template.matterType, budget: '1000000',
      caseManagement: { qualityScore: 90, qualityScoredBy: reviewer.name, qualityScoredAt: new Date() } });
    const stamp = new Date();
    await Workflow.create({ caseId: matter._id, templateId: template._id, currentStepKey: 'action_8', steps: steps.map((step, i) => ({
      stepKey: step.key, title: step.title, stageKey: step.stageKey, order: step.order, percentage: step.percentage,
      status: i < 8 ? 'Completed' : 'Not Started', startAt: new Date(+stamp - 3600000), dueAt: new Date(+stamp + 3600000),
      ...(i < 8 ? { doneAt: stamp, submittedAt: stamp, reviewedAt: stamp, completedAt: stamp } : {}), actions: [], outputs: [],
    })) });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
    const request = async (url: string, body?: unknown, actor = initiator, method?: string) => {
      const response = await fetch(`${base}${url}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: {
        Authorization: `Bearer ${jwt.sign({ id: String(actor._id) }, process.env.JWT_SECRET!)}`, 'Content-Type': 'application/json',
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() as any };
    };
    const timed = async (action: string, run: () => ReturnType<typeof request>) => {
      queryCount = 0;
      const start = performance.now();
      const result = await run();
      results.push({ action, ms: Math.round(performance.now() - start), databaseOperations: queryCount });
      assert.equal(result.status, 200, result.body.message);
      console.log(`PASS: ${action}`);
      return result.body;
    };
    const management = `/case-management/cases/${matter._id}`;
    const workflow = `/workflows/cases/${matter._id}`;
    const login = await timed('login', () => request('/auth/login', { email: initiator.email, password: 'test-only' }));
    assert(login.token);
    await timed('case-management load', () => request(management));
    const originalTemplate = await Template.findById(template._id).lean();
    const added = await timed('add key action', () => request(`${workflow}/steps`, { title: 'Performance custom action', stageKey: 'work', percentage: 1, position: 10 }));
    const custom = added.steps.find((step: any) => step.title === 'Performance custom action');
    assert(custom?.custom);
    assert.deepEqual(await Template.findById(template._id).lean(), originalTemplate, 'Adding a case action must preserve its template');
    const originalDue = new Date(added.steps.find((step: any) => step.stepKey === 'action_8').dueAt);
    const newDueAt = new Date(+originalDue + 86400000).toISOString();
    const amended = await timed('amend deadline', () => request(`${workflow}/steps/action_8/extend-deadline`, { newDueAt, mode: 'standard', reason: 'Performance check' }));
    assert.equal(new Date(amended.steps.find((step: any) => step.stepKey === 'action_8').dueAt).toISOString(), newDueAt);
    assert.equal(new Date(amended.steps.find((step: any) => step.stepKey === 'action_9').dueAt).getTime(), +originalDue + 86400000);
    const deleted = await timed('delete key action', () => request(`${workflow}/steps/${custom.stepKey}`, undefined, initiator, 'DELETE'));
    assert(!deleted.steps.some((step: any) => step.stepKey === custom.stepKey));
    const denied = await request(`${workflow}/steps/action_9/complete`, {});
    assert.equal(denied.status, 409, 'Later actions must still wait for earlier work');
    const ticked = await timed('tick key action', () => request(`${workflow}/steps/action_8/complete`, {}));
    assert.equal(ticked.steps.find((step: any) => step.stepKey === 'action_8').status, 'Done');
    assert.equal((await request(`${management}/request-review`, { stepKey: 'action_8' }, outsider)).status, 403);
    const reviewed = await timed('submit to reviewer', () => request(`${management}/request-review`, { stepKey: 'action_8' }));
    assert.equal(reviewed.steps.find((step: any) => step.stepKey === 'action_8').status, 'Awaiting Review');
    const approval = await timed('submit to approver', () => request(`${management}/request-approval`, { stepKey: 'action_8' }, reviewer));
    assert.equal(approval.steps.find((step: any) => step.stepKey === 'action_8').status, 'Awaiting Approval');
    const approved = await timed('approve key action', () => request(`${management}/approve`, { stepKey: 'action_8' }, approver));
    assert.equal(approved.steps.find((step: any) => step.stepKey === 'action_8').status, 'Completed');
    assert(await Ledger.countDocuments({ caseId: matter._id, keyActionKey: 'action_8' }), 'Earnings snapshots must exist before the response');
    const ledgerBefore = await Ledger.find({ caseId: matter._id }).sort({ entryKey: 1 }).lean();
    await snapshotCaseEarnings(matter._id);
    assert.deepEqual(await Ledger.find({ caseId: matter._id }).sort({ entryKey: 1 }).lean(), ledgerBefore,
      'Recomputing earnings after approval must be idempotent: the final snapshot was already saved');
    assert(await Audit.exists({ caseId: matter._id, action: 'CASE_MANAGEMENT_REQUESTED_REVIEW' }));
    assert(await Audit.exists({ caseId: matter._id, action: 'CASE_MANAGEMENT_REQUESTED_APPROVAL' }));
    const notifications = await Notification.find({ caseId: matter._id });
    assert(notifications.some(n => String(n.type) === 'CASE_MANAGEMENT_REVIEW_REQUESTED'));
    assert(notifications.some(n => String(n.type) === 'CASE_MANAGEMENT_APPROVAL_REQUESTED'));
    assert(notifications.some(n => String(n.type) === 'APPROVAL_COMPLETED'));
    // Later actions must also persist earnings and close/reopen correctly.
    assert.equal((await request(`${workflow}/steps/action_9/complete`, {})).status, 200);
    const nextWork = (await Workflow.findOne({ caseId: matter._id }))?.steps.find(step => step.stepKey === 'action_9');
    assert(nextWork?.tpaSnapshots?.some(snapshot => snapshot.assignmentRole === 'Initiator'), 'Ticking must freeze the activity-time rate before returning');
    assert.equal((await request(`${management}/request-review`, { stepKey: 'action_9' })).status, 200);
    assert.equal((await request(`${management}/request-approval`, { stepKey: 'action_9' }, reviewer)).status, 200);
    const closed = await request(`${management}/approve`, { stepKey: 'action_9' }, approver);
    assert.equal(closed.status, 200, closed.body.message);
    assert.equal(closed.body.workflowStatus, 'Completed');
    assert(await Ledger.exists({ caseId: matter._id, keyActionKey: 'action_9' }), 'Approval must persist earned-fee entries before returning');
    assert.equal((await Case.findById(matter._id))?.status, 'Closed');
    const manager = await User.create({ name: 'Performance Manager', email: 'manager@performance.invalid', role: 'managing_director', passwordHash: initiator.passwordHash });
    const profitability = await timed('staff profitability', () => request('/reports/firm?range=ytd&scope=profitability', undefined, manager));
    assert(Array.isArray(profitability.team));
    const summary = await timed('staff dashboard data', () => request('/dashboard/staff-summary'));
    assert(summary.workByMatter?.[String(matter._id)], 'Dashboard summary must include work items without per-matter HTTP requests');
    await Workflow.collection.updateOne({ caseId: matter._id }, { $set: { 'steps.9.independentContributors': [{
      name: outsider.name, userId: outsider._id, role: 'Initiator', taskId: new mongoose.Types.ObjectId(), actedAt: new Date(),
    }] } });
    const delegatedSummary = await request('/dashboard/staff-summary', undefined, outsider);
    assert.equal(delegatedSummary.status, 200);
    assert(!delegatedSummary.body.workByMatter?.[String(matter._id)], 'A narrow independent contribution must not expose the full matter work queue');
    const roles = (User.schema.path('role') as any).enumValues as string[];
    for (const role of roles) {
      const actor: any = await User.create({ name: `Dashboard ${role}`, email: `${role}@dashboards.invalid`, role, passwordHash: initiator.passwordHash });
      queryCount = 0;
      const started = performance.now();
      const response: globalThis.Response = await fetch(`${base}/dashboard/bootstrap`, { headers: { Authorization: `Bearer ${jwt.sign({ id: String(actor._id) }, process.env.JWT_SECRET!)}` } });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') || '', /application\/x-ndjson/);
      const sections: any[] = (await response.text()).trim().split('\n').map((line: string) => JSON.parse(line));
      const ms = Math.round(performance.now() - started);
      results.push({ action: `dashboard ${role}`, ms, databaseOperations: queryCount });
      const primary = role === 'executive_assistant' ? 'executive' : ['managing_director', 'managing_partner', 'executive_managing_partner'].includes(role) ? 'cases' : 'summary';
      assert.equal(sections.find(section => section.section === primary)?.status, 'fulfilled', `${role}: primary dashboard data must load`);
      if (role === 'managing_partner' || role === 'executive_managing_partner') {
        for (const key of ['billing', 'invoices', 'fund', 'audit']) assert.equal(sections.find(section => section.section === key)?.status, 'rejected', 'Streaming must retain source-route finance/audit permissions');
      }
      assert(!JSON.stringify(sections).includes('passwordHash'));
    }
    console.log('PASS: dashboard stream for every user role, primary data, work items, and unchanged finance/audit restrictions');
    const reopened = await request(`${workflow}/steps/action_9/reopen`, {});
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.status, 'Active');
    assert.equal(reopened.body.steps.find((step: any) => step.stepKey === 'action_9').status, 'In Progress');
    // Preserve the existing terminal-case rule in this performance change.
    // updateCaseWorkflowProgress retains a prior Completed case progress state.
    assert.equal((await Case.findById(matter._id))?.status, 'Closed');
    await processEmailDeliveries();
    assert.equal(await Notification.countDocuments({ caseId: matter._id, emailQueueState: 'pending' }), 0, 'The durable email worker drains queued notifications');
    const history = [{ kind: 'normal', rate: 2.5, from: new Date('2026-01-01'), until: null, recordedAt: new Date(), actor: 'Test', reason: 'Preservation check' }];
    await User.updateOne({ _id: initiator._id }, { $set: { loginAttempts: 2, lockUntil: new Date(), tpaHistory: history } });
    assert.equal((await request('/auth/login', { email: initiator.email, password: 'test-only' })).status, 200);
    const resetUser = await User.findById(initiator._id).lean();
    assert.equal(resetUser?.loginAttempts, 0);
    assert.equal(resetUser?.tpaHistory.length, 1, 'The smaller login projection must preserve financial history when clearing stale lock data');
    assert.equal(resetUser?.tpaHistory[0].rate, 2.5);
    await User.updateOne({ _id: initiator._id }, { $set: { isActive: false } });
    assert.equal((await request(management)).status, 403, 'Deactivation must apply on the very next request');
    assert.equal((await request('/auth/login', { email: initiator.email, password: 'test-only' })).status, 401);
    console.table(results);
    console.log('PASS: sequence, role permissions, review/approval lifecycle, closing/reopening, immediate and idempotent earnings/audit persistence, durable email processing, and immediate account deactivation.');
    console.log(JSON.stringify(results));
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await mongoose.disconnect();
    await replica.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
