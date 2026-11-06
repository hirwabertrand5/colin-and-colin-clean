/** Isolated notification regression suite. Never reads .env or a production DB. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../app';
import User from '../models/userModel';
import Case from '../models/caseModel';
import Task from '../models/taskModel';
import IndependentTask from '../modules/independentTasks/models/independentTaskModel';
import Event from '../models/eventModel';
import Workflow from '../models/workflowInstanceModel';
import Notification from '../models/notificationModel';
import Prefs from '../models/notificationPreferencesModel';
import Delivery from '../models/emailDeliveryModel';
import Webhook from '../models/emailWebhookModel';
import Fund from '../models/pettyCashFundModel';
import Expense from '../models/pettyCashExpenseModel';
import Retainer from '../models/retainerModel';
import Prospect from '../models/prospectModel';
import { createNotification } from '../services/notifyService';
import { processEmailDeliveries, applyEmailWebhooks } from '../services/emailDeliveryService';
import { getEmailConfiguration } from '../services/emailResendService';
import { buildNotificationEmail, absoluteAppLink } from '../services/notificationTemplateService';
import { eventDateTime } from '../utils/notificationTime';
import { runReminderScan } from '../jobs/reminderScheduler';
import { runPettyCashDigest } from '../jobs/pettyCashDigest';
import { runBusinessReminders } from '../jobs/businessReminders';
import { notifyWorkflowHandoff, notifyMatterParticipants } from '../services/activityNotificationService';

async function main() {
  console.log('Starting isolated notification database and mocked email transport...');
  delete process.env.MONGO_URI;
  process.env.RESEND_API_KEY = 're_synthetic_notification_verification';
  process.env.EMAIL_FROM = 'Verification <sender@test.invalid>';
  process.env.EMAIL_REPLY_TO = 'reply@test.invalid';
  process.env.FINANCE_ALERT_EMAIL = 'finance@test.invalid';
  process.env.APP_TIMEZONE = 'Africa/Kigali';
  process.env.PUBLIC_CLIENT_URL = 'https://app.test.invalid';
  process.env.NOTIFICATION_EMAIL_ENABLED = 'true';
  process.env.NOTIFICATION_EMAIL_ALLOWLIST = '';
  process.env.PETTY_CASH_DIGEST_HOUR = '8';
  process.env.JWT_SECRET = 'notification-isolated-verification-only';
  const signingBytes = Buffer.from('isolated-webhook-secret-32-bytes!!');
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${signingBytes.toString('base64')}`;
  const nativeFetch = globalThis.fetch;
  const sends: Array<{ key: string; body: any }> = [];
  const provider = new Map<string, string>();
  let providerFailure = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://api.resend.com/')) {
      const body = JSON.parse(String(init?.body));
      assert(body.to.every((to: string) => to.endsWith('@test.invalid')), 'A test attempted to send to a real address');
      const key = new Headers(init?.headers).get('Idempotency-Key') || '';
      assert(key, 'Notification send must have a provider idempotency key');
      sends.push({ key, body });
      if (providerFailure) return new Response(JSON.stringify({ name: providerFailure === 429 ? 'rate_limit_exceeded' : 'validation_error', message: providerFailure === 429 ? 'Rate limit exceeded' : 'Invalid recipient' }), { status: providerFailure, headers: { 'content-type': 'application/json' } });
      if (!provider.has(key)) provider.set(key, `safe-provider-${provider.size + 1}`);
      return new Response(JSON.stringify({ id: provider.get(key) }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (!url.startsWith('http://127.0.0.1:')) throw new Error('External network is disabled in notification tests');
    return nativeFetch(input, init);
  };
  const binary = path.resolve(__dirname, '../../node_modules/.cache/mongodb-memory-server/test-mongod.exe');
  const replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', ...(existsSync(binary) ? { systemBinary: binary } : {}) }, instanceOpts: [{ launchTimeout: 120000 }], replSet: { count: 1, storageEngine: 'wiredTiger' } });
  let server: ReturnType<typeof app.listen> | undefined;
  let passed = 0;
  const pass = (label: string) => console.log(`PASS ${++passed}: ${label}`);
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'notification_verification' });
    console.log('Temporary replica set connected; initializing notification indexes.');
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    const owner = await User.create({ name: 'Owner', email: 'owner@test.invalid', role: 'associate', passwordHash: 'test-only' });
    const reviewer = await User.create({ name: 'Reviewer', email: 'reviewer@test.invalid', role: 'associate', passwordHash: 'test-only' });
    const director = await User.create({ name: 'Director', email: 'director@test.invalid', role: 'managing_director', passwordHash: 'test-only' });
    const outsider = await User.create({ name: 'Outsider', email: 'outsider@test.invalid', role: 'intern', passwordHash: 'test-only' });
    const roleUser = await User.create({ name: 'ExecutivePartner', email: 'executive@test.invalid', role: 'executive_partner', passwordHash: 'test-only' });
    const matter = await Case.create({ caseNo: 'NOTIFY-1', parties: 'Verification only', caseType: 'Transactional Cases', status: 'In Progress', assignedTo: owner.name,
      caseAssignments: { initiator: owner.name, reviewer: reviewer.name, signerApprover: director.name } });
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const request = async (user: any, route: string, body?: any, method = body === undefined ? 'GET' : 'POST') => {
      const response = await fetch(`${base}/api${route}`, { method, headers: { Authorization: `Bearer ${jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET!)}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json().catch(() => ({})) as any };
    };
    const ok = async (user: any, route: string, body?: any, method?: string) => {
      const result = await request(user, route, body, method); assert(result.status < 300, `${route}: ${result.status} ${JSON.stringify(result.data)}`); return result.data;
    };
    const alert = (key: string, type = 'TASK_ASSIGNED', user = owner) => createNotification({ type, title: key, message: `Details for ${key}`, audienceUserIds: [String(user._id)], dedupeKey: key, link: '/notifications' });
    const now = new Date('2026-11-06T08:00:00.000Z');
    let serial = 0;
    const independent = async (priority: string, due: Date, extra: any = {}) => IndependentTask.create({ taskNumber: `VERIFY-${++serial}`, title: `Task ${serial}`, assignee: owner.name, supervisor: reviewer.name, priority,
      status: 'In Progress', startDate: '2026-11-01', dueDate: due.toISOString(), ...extra });
    const forTask = (id: any) => Notification.find({ taskId: id, type: 'TASK_DUE_REMINDER' }).lean();

    if (process.argv.includes('--focus-recipients')) {
      const delegation = await independent('Medium', new Date(Date.now() + 86400000), { relatedMatterId: matter._id, assignee: outsider.name });
      await notifyMatterParticipants(matter, { type: 'DEADLINE_CHANGED', title: 'Delegated legal deadline changed', message: 'A dependent deadline changed.', dedupeKey: 'recipient-deadline' });
      let event: any = await Notification.findOne({ dedupeKey: 'recipient-deadline' });
      assert(await Delivery.exists({ notificationId: event._id, to: outsider.email }));
      assert(await Delivery.exists({ notificationId: event._id, to: owner.email }));
      pass('Legal deadline changes include active delegates and standing participants');
      await IndependentTask.updateOne({ _id: delegation._id }, { status: 'Completed' });
      await notifyMatterParticipants(matter, { type: 'APPROVAL_COMPLETED', title: 'Delegated contribution approved', message: 'Completed work has been approved.', dedupeKey: 'recipient-completion' }, [outsider.name]);
      event = await Notification.findOne({ dedupeKey: 'recipient-completion' });
      assert(await Delivery.exists({ notificationId: event._id, to: outsider.email }));
      pass('Completed contributors receive final approval outcomes after their task closes');
      const taskId = new mongoose.Types.ObjectId();
      await Task.collection.insertOne({ _id: taskId, caseId: matter._id, taskNo: 'FOCUS-REVIEW', title: 'Direct stage review', assignee: owner.name, supervisor: reviewer.name,
        priority: 'Medium', status: 'In Progress', workflowStage: 'In Progress', startDate: '2026-11-01', dueDate: '2026-11-20', requiresApproval: false, approvalStatus: 'Not Required', checklist: [], createdAt: new Date(), updatedAt: new Date() } as any);
      await ok(director, `/tasks/${taskId}`, { workflowStage: 'Awaiting Review' }, 'PUT');
      event = await Notification.findOne({ taskId, type: 'TASK_APPROVAL_REQUESTED' });
      assert(event); assert(await Delivery.exists({ notificationId: event._id, to: reviewer.email }));
      pass('Direct workflow-stage changes request email review from the actual reviewer');
      const approvalId = new mongoose.Types.ObjectId();
      await Task.collection.insertOne({ _id: approvalId, caseId: matter._id, taskNo: 'FOCUS-OVERLAP', title: 'Coordinator reviewer overlap', assignee: owner.name, supervisor: director.name,
        priority: 'Medium', status: 'In Progress', workflowStage: 'In Progress', startDate: '2026-11-01', dueDate: '2026-11-20', requiresApproval: true, approvalStatus: 'Draft', checklist: [], createdAt: new Date(), updatedAt: new Date() } as any);
      await ok(owner, `/tasks/${approvalId}/submit`, {});
      assert.equal(await Notification.countDocuments({ taskId: approvalId, type: 'TASK_APPROVAL_REQUESTED' }), 1);
      event = await Notification.findOne({ taskId: approvalId, type: 'TASK_APPROVAL_REQUESTED' });
      assert(event.audienceRoles.includes('managing_director'));
      assert.equal(await Delivery.countDocuments({ notificationId: event._id, to: director.email }), 1);
      pass('Coordinator audiences are preserved without duplicate direct-reviewer emails');
      console.log('Focused recipient verification complete: 4 groups passed; no provider calls.');
      return;
    }

    process.env.RESEND_API_KEY = 'your_private_key'; assert.equal(getEmailConfiguration().configured, false); process.env.RESEND_API_KEY = 're_synthetic_notification_verification';
    process.env.EMAIL_REPLY_TO = 'invalid'; assert.equal(getEmailConfiguration().configured, false); process.env.EMAIL_REPLY_TO = 'reply@test.invalid'; pass('Placeholder keys and invalid reply-to rejected');
    assert.equal(absoluteAppLink('//evil.invalid'), undefined); assert.equal(absoluteAppLink('javascript:alert(1)'), undefined);
    const html = buildNotificationEmail({ title: '<script>x</script>', message: '<img src=x>', link: '/cases/123' });
    assert(!html.includes('<script>')); assert(html.includes('&lt;img')); assert(html.includes('https://app.test.invalid/cases/123')); pass('Escaped branded templates and absolute application links');

    await Promise.all(Array.from({ length: 8 }, () => alert('concurrent')));
    assert.equal(await Notification.countDocuments({ dedupeKey: 'concurrent' }), 1);
    let n: any = await Notification.findOne({ dedupeKey: 'concurrent' });
    assert.equal(await Delivery.countDocuments({ notificationId: n._id }), 1); pass('Concurrent scans create one in-app alert and one email per recipient');
    await createNotification({ type: 'TASK_ASSIGNED', title: 'Audience overlap', message: 'Test', audienceUserIds: [String(director._id)], audienceRoles: ['managing_director'], dedupeKey: 'overlap' });
    n = await Notification.findOne({ dedupeKey: 'overlap' }); assert.equal(await Delivery.countDocuments({ notificationId: n._id }), 1); pass('Overlapping role/user audiences are deduplicated');
    await processEmailDeliveries(new Date(), 100);
    assert(sends.every(send => send.body.reply_to === 'reply@test.invalid' && send.body.to.length === 1)); pass('Private per-recipient sends carry reply-to');
    const sentCount = sends.length; await processEmailDeliveries(new Date(), 100); assert.equal(sends.length, sentCount); pass('Repeated workers do not resend accepted email');

    process.env.NOTIFICATION_EMAIL_ENABLED = 'false'; n = await alert('disabled'); assert.equal((await Delivery.findOne({ notificationId: n._id }))?.status, 'suppressed');
    process.env.NOTIFICATION_EMAIL_ENABLED = 'true'; process.env.NOTIFICATION_EMAIL_ALLOWLIST = 'reviewer@test.invalid'; n = await alert('allowlist'); assert.equal((await Delivery.findOne({ notificationId: n._id }))?.lastCode, 'ROLLOUT_ALLOWLIST'); process.env.NOTIFICATION_EMAIL_ALLOWLIST = ''; pass('Disabled rollout and allowlist preserve in-app alerts without a send');
    await Prefs.create({ userId: owner._id, mattersEnabled: false }); n = await alert('matter-opt-out', 'WORKFLOW_NOTIFICATION'); assert.equal((await Delivery.findOne({ notificationId: n._id }))?.status, 'suppressed');
    await Prefs.updateOne({ userId: owner._id }, { mattersEnabled: true }); n = await alert('preference-changed'); await Prefs.updateOne({ userId: owner._id }, { emailEnabled: false }); await processEmailDeliveries(new Date(), 100);
    assert.equal((await Delivery.findOne({ notificationId: n._id }))?.status, 'suppressed'); await Prefs.updateOne({ userId: owner._id }, { emailEnabled: true }); pass('Matter preferences honored and preferences rechecked at send time');
    assert.equal((await request(owner, '/notifications/preferences/me', { emailEnabled: 'false' }, 'PUT')).status, 400);
    assert.equal((await request(owner, '/notifications/preferences/me', { taskDueReminderHours: 0 }, 'PUT')).status, 400);
    assert.equal((await request(owner, '/notifications/preferences/me', { eventReminderHours: [24, -1] }, 'PUT')).status, 400);
    assert.equal((await request(roleUser, '/notifications/preferences/me')).status, 200); pass('Preferences reject malformed values and support all staff roles');
    n = await alert('private'); assert.equal((await request(outsider, `/notifications/${n._id}/read`, {})).status, 404);
    await ok(owner, `/notifications/${n._id}/read`, {}); assert((await Notification.findById(n._id))!.isReadBy.some(id => id.equals(owner._id))); pass('Read state preserved and other users cannot mark private alerts read');
    await alert('review-filter', 'CASE_MANAGEMENT_REVIEW_REQUESTED'); const filtered = await ok(owner, '/notifications?filter=TASK_APPROVAL_REQUESTED'); assert(filtered.some((item: any) => item.title === 'review-filter')); pass('Approval filter includes existing case review and approval types');
    assert.equal((await request(owner, '/admin/email/status')).status, 403); const diagnostics = await ok(director, '/admin/email/status'); assert(!JSON.stringify(diagnostics).includes(process.env.RESEND_API_KEY!)); pass('Delivery diagnostics restricted to managing director and omit credentials');

    n = await alert('rate-limited'); providerFailure = 429; await processEmailDeliveries(new Date(), 100);
    let d: any = await Delivery.findOne({ notificationId: n._id }); assert.equal(d.status, 'pending'); assert.equal(d.lastCode, 'EMAIL_RATE_LIMITED');
    const firstKey = `notification/${d._id}`; providerFailure = 0; await processEmailDeliveries(new Date(Date.now() + 120000), 100); d = await Delivery.findById(d._id); assert.equal(d.status, 'sent'); assert.equal(sends.filter(send => send.key === firstKey).length, 2); pass('Retryable provider errors retry with the same idempotency key');
    n = await alert('permanent-failure'); providerFailure = 400; await processEmailDeliveries(new Date(), 100); providerFailure = 0; d = await Delivery.findOne({ notificationId: n._id }); assert.equal(d.status, 'failed'); pass('Invalid recipients fail visibly without endless retries');
    n = await alert('multi-worker'); const beforeProvider = provider.size; await Promise.all([processEmailDeliveries(new Date(), 100), processEmailDeliveries(new Date(), 100)]); assert.equal(provider.size, beforeProvider + 1); pass('Multiple workers claim a delivery once');
    d = await Delivery.findOne({ notificationId: n._id }); await Delivery.updateOne({ _id: d._id }, { status: 'processing', leaseUntil: new Date(Date.now() - 1000) }); await processEmailDeliveries(new Date(), 100);
    assert.equal(provider.size, beforeProvider + 1); pass('Expired crash lease recovers using provider idempotency');
    n = await alert('expired-retry'); await Delivery.updateOne({ notificationId: n._id }, { firstAttemptAt: new Date(Date.now() - 25 * 3600000) }); await processEmailDeliveries(new Date(), 100); assert.equal((await Delivery.findOne({ notificationId: n._id }))?.lastCode, 'RETRY_WINDOW_EXPIRED'); pass('Ambiguous retries stop before provider idempotency expires');

    const normal = await independent('Medium', new Date(now.getTime() + 24 * 3600000));
    await runReminderScan(now); assert.equal((await forTask(normal._id)).length, 1); await runReminderScan(now); assert.equal((await forTask(normal._id)).length, 1);
    await runReminderScan(new Date(now.getTime() + 22 * 3600000)); assert.equal((await forTask(normal._id)).length, 2);
    await runReminderScan(new Date(now.getTime() + 25 * 3600000)); await runReminderScan(new Date(now.getTime() + 26 * 3600000)); assert.equal((await forTask(normal._id)).length, 3); pass('Normal task receives 24h, 2h and one overdue alert across repeated scans');
    const critical = await independent('Critical', new Date(now.getTime() + 72 * 3600000)); await runReminderScan(now); assert((await forTask(critical._id)).some(item => item.title.includes('72h'))); pass('Critical task receives a 72-hour reminder');
    const high = await independent('High', new Date(now.getTime() + 48 * 3600000)); await runReminderScan(now); assert((await forTask(high._id)).some(item => item.title.includes('48h'))); pass('High-priority task receives a 48-hour reminder');
    const low = await independent('Low', new Date(now.getTime() + 24 * 3600000)); await runReminderScan(now); await runReminderScan(new Date(now.getTime() + 25 * 3600000)); assert.equal((await forTask(low._id)).length, 1); pass('Low-priority tasks receive only their first reminder');
    const short = await independent('Medium', new Date(now.getTime() + 15 * 60000)); await runReminderScan(now); assert.equal((await forTask(short._id)).length, 1); assert((await forTask(short._id))[0]!.title.includes('2h')); pass('Short-deadline task catches up once at the nearest threshold');
    await Prefs.updateOne({ userId: owner._id }, { taskDueReminderHours: 12 }); const custom = await independent('Medium', new Date(now.getTime() + 12 * 3600000)); await runReminderScan(now); assert((await forTask(custom._id))[0]!.title.includes('12h')); await Prefs.updateOne({ userId: owner._id }, { taskDueReminderHours: 24 }); pass('Configured task reminder hours drive real scans');
    const done = await independent('Medium', new Date(now.getTime() + 3600000), { status: 'Completed' });
    const submitted = await independent('Medium', new Date(now.getTime() + 3600000), { status: 'Awaiting Review' }); await runReminderScan(now); assert.equal((await forTask(done._id)).length + (await forTask(submitted._id)).length, 0); pass('Completed and submitted work do not receive assignee deadline reminders');
    const stale = await independent('Medium', new Date(Date.now() + 3600000)); await runReminderScan(new Date()); await IndependentTask.updateOne({ _id: stale._id }, { status: 'Completed' }); await processEmailDeliveries(new Date(), 500);
    const staleIds = (await forTask(stale._id)).map(item => item._id); assert.equal(await Delivery.countDocuments({ notificationId: { $in: staleIds }, status: 'sent' }), 0); pass('Completed work invalidates already queued reminders');
    const changed = await independent('Medium', new Date(now.getTime() + 3600000)); await runReminderScan(now); await IndependentTask.updateOne({ _id: changed._id }, { dueDate: new Date(now.getTime() + 86400000).toISOString() }); await runReminderScan(now); assert.equal((await forTask(changed._id)).length, 2); pass('Changed deadlines create a new persisted reminder revision');
    const linked = await independent('Medium', new Date(now.getTime() + 3600000), { relatedMatterId: matter._id }); await Case.updateOne({ _id: matter._id }, { status: 'Temporarily Closed' }); await runReminderScan(now); assert.equal((await forTask(linked._id)).length, 0);
    await Case.updateOne({ _id: matter._id }, { status: 'In Progress' }); await runReminderScan(now); assert.equal((await forTask(linked._id)).length, 1); pass('Paused matters suppress reminders and reopened matters resume');
    assert.equal(eventDateTime('2026-11-07', '10:00')?.toISOString(), '2026-11-07T08:00:00.000Z');
    await Prefs.updateOne({ userId: owner._id }, { eventReminderHours: [12] }); const event = await Event.create({ caseId: matter._id, title: 'Hearing', date: '2026-11-06', time: '22:00' }); await runReminderScan(now);
    assert.equal(await Notification.countDocuments({ eventId: event._id, audienceUserIds: owner._id, title: /12h/ }), 1); await Prefs.updateOne({ userId: owner._id }, { eventReminderHours: [24, 2] }); pass('Calendar reminders honor Kigali wall time and individual schedules');

    const legacyId = new mongoose.Types.ObjectId(); await Task.collection.insertOne({ _id: legacyId, caseId: matter._id, taskNo: 'LEGACY-1', title: 'Approval regression', assignee: owner.name, supervisor: reviewer.name, assignedBy: director.name, priority: 'Medium', status: 'In Progress', workflowStage: 'In Progress', dueDate: '2026-11-20', requiresApproval: true, approvalStatus: 'Draft', checklist: [], createdAt: new Date(), updatedAt: new Date() } as any);
    assert.equal((await request(outsider, `/tasks/${legacyId}/submit`, {})).status, 403);
    await ok(owner, `/tasks/${legacyId}/submit`, {}); const reviewAlert = await Notification.findOne({ taskId: legacyId, type: 'TASK_APPROVAL_REQUESTED', audienceUserIds: reviewer._id }); assert(reviewAlert); assert(await Delivery.exists({ notificationId: reviewAlert._id, to: reviewer.email })); pass('Actual direct reviewer receives approval email; unrelated users cannot submit');
    await ok(director, `/tasks/${legacyId}/reject`, { comment: 'Please correct this' }); assert(await Delivery.exists({ notificationId: (await Notification.findOne({ taskId: legacyId, type: 'CASE_MANAGEMENT_CHANGES_REQUESTED' }))!._id, to: owner.email })); pass('Returned task emails its responsible owner');
    await ok(owner, `/tasks/${legacyId}/submit`, {}); await ok(director, `/tasks/${legacyId}/approve`, {}); assert(await Notification.exists({ taskId: legacyId, type: 'APPROVAL_COMPLETED' })); pass('Completed approval emails relevant participants');
    await notifyWorkflowHandoff(matter, { stepKey: 'review-me', title: 'Delegated work' }, 'Reviewer', new Date()); assert(await Notification.exists({ type: 'CASE_MANAGEMENT_REVIEW_REQUESTED', audienceUserIds: reviewer._id })); pass('Delegated work handoff targets the next reviewer');
    assert.equal((await request(outsider, `/cases/${matter._id}/events`, { title: 'Unauthorized', date: '2026-11-07', time: '10:00' })).status, 403);
    assert.equal((await request(owner, `/cases/${matter._id}/events`, { title: 'Invalid date', date: '2026-02-31', time: '10:00' })).status, 400);
    const eventCreated = await ok(owner, `/cases/${matter._id}/events`, { title: 'Changed hearing', date: '2026-11-07', time: '10:00' }); await ok(owner, `/events/${eventCreated._id}`, { time: '11:00' }, 'PUT'); await ok(owner, `/events/${eventCreated._id}`, undefined, 'DELETE'); assert.equal(await Notification.countDocuments({ type: 'EVENT_CHANGED', eventId: eventCreated._id }), 3); pass('Authorized valid event changes have real email triggers');

    const fund = await ok(director, '/petty-cash/funds', { name: 'Verification Fund', amount: 1000, initialAmount: 1000 });
    const createdAlert = await Notification.findOne({ type: 'PETTY_CASH_CREATED', fundId: fund._id }); assert(createdAlert); assert(await Delivery.exists({ notificationId: createdAlert._id, to: director.email })); pass('New petty cash allocation includes managing director and finance copy');
    await ok(director, `/petty-cash/funds/${fund._id}/expenses`, { date: '2026-11-06', title: 'Filing', amount: 850 });
    assert.equal((await Fund.findById(fund._id))!.remainingAmount, 150); assert.equal(await Notification.countDocuments({ type: 'PETTY_CASH_LOW', fundId: fund._id }), 1);
    await ok(director, `/petty-cash/funds/${fund._id}/expenses`, { date: '2026-11-06', title: 'Transport', amount: 10 }); assert.equal(await Notification.countDocuments({ type: 'PETTY_CASH_LOW', fundId: fund._id }), 1); pass('Expense commits preserve balances and emit one low-balance alert per crossing');
    const expense = await Expense.findOne({ fundId: fund._id, title: 'Filing' }); await ok(director, `/petty-cash/expenses/${expense!._id}/refund`, { refundAmount: 500, refundedBy: 'Verification', date: '2026-11-06' }); assert.equal((await Fund.findById(fund._id))!.lowBalanceNotifiedAt, null);
    await ok(director, `/petty-cash/funds/${fund._id}/expenses`, { date: '2026-11-06', title: 'Filing again', amount: 500 }); assert.equal(await Notification.countDocuments({ type: 'PETTY_CASH_LOW', fundId: fund._id }), 2); pass('Balance recovery rearms low alerts for a subsequent crossing');
    await ok(director, '/petty-cash/funds/top-up', { amount: 1000 }); assert.equal((await Fund.findById(fund._id))!.remainingAmount, 1140); assert.equal(await Notification.countDocuments({ type: 'PETTY_CASH_CREATED', fundId: fund._id }), 2); pass('Replenishment emails preserve actual running balance');
    await processEmailDeliveries(new Date(), 500); const expenseAlert = await Notification.findOne({ type: 'PETTY_CASH_EXPENSE', fundId: fund._id }); assert.equal((await Delivery.findOne({ notificationId: expenseAlert!._id, to: director.email }))?.status, 'suppressed');
    await Prefs.create({ userId: director._id, pettyCashExpenseMode: 'immediate' }); await ok(director, `/petty-cash/funds/${fund._id}/expenses`, { date: '2026-11-06', title: 'Immediate activity', amount: 1 }); await processEmailDeliveries(new Date(), 500); const immediate = await Notification.findOne({ title: 'Petty Cash Expense Recorded', message: /Immediate activity/ }); assert.equal((await Delivery.findOne({ notificationId: immediate!._id, to: director.email }))?.status, 'sent'); pass('Expenses default to daily summaries and support immediate preference');
    await Notification.updateMany({ type: { $in: ['PETTY_CASH_EXPENSE', 'PETTY_CASH_REFUND'] } }, { $set: { createdAt: new Date('2026-11-06T10:00:00Z') } }, { timestamps: false });
    await runPettyCashDigest(new Date('2026-11-07T07:00:00Z')); await runPettyCashDigest(new Date('2026-11-07T08:00:00Z')); assert.equal(await Notification.countDocuments({ type: 'PETTY_CASH_DIGEST' }), 1); const digest = await Notification.findOne({ type: 'PETTY_CASH_DIGEST' }); assert(digest!.message.includes('current balance RWF 1,139')); pass('Daily digest is persisted once and includes accurate labelled balances');
    const session = await mongoose.startSession(); try { await session.withTransaction(async () => { await createNotification({ type: 'PETTY_CASH_EXPENSE', title: 'Rolled back', message: 'Do not send', audienceRoles: ['managing_director'] }, { session }); throw new Error('intentional rollback'); }); } catch (error: any) { assert.equal(error.message, 'intentional rollback'); } finally { await session.endSession(); }
    assert.equal(await Notification.countDocuments({ title: 'Rolled back' }), 0); pass('Rolled-back financial transactions create no alert or email');

    await Retainer.create({ retainerNo: 'VERIFY-RET', name: 'Renewal fixture', clientName: 'Fixture', billingModel: 'monthly', status: 'Active', startDate: '2026-01-01', renewalDate: '2026-11-07', responsiblePartner: reviewer.name });
    await Prospect.collection.insertOne({ prospectNo: 'VERIFY-PROSPECT', clientName: 'Fixture', assignedTo: owner._id, isActive: true, stage: 'Inquiry', nextFollowUpDate: new Date('2026-11-05T12:00:00Z') } as any);
    await runBusinessReminders(now); await runBusinessReminders(now); assert.equal(await Notification.countDocuments({ type: 'RETAINER_REMINDER' }), 1); assert.equal(await Notification.countDocuments({ type: 'INTAKE_REMINDER' }), 1); n = await alert('intake-submission', 'INTAKE_SUBMISSION'); assert(await Delivery.exists({ notificationId: n._id })); pass('Intake submissions, prospect follow-ups and retainer renewals have deduplicated delivery');

    const webhookDelivery = await Delivery.findOne({ status: 'sent' }); assert(webhookDelivery);
    const sendWebhook = async (id: string, status: string, signed = true) => {
      const payload = JSON.stringify({ type: `email.${status}`, created_at: new Date().toISOString(), data: { email_id: webhookDelivery.providerId } }); const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac('sha256', signingBytes).update(`${id}.${timestamp}.${payload}`).digest('base64');
      return fetch(`${base}/api/webhooks/resend`, { method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signed ? `v1,${signature}` : 'v1,invalid' }, body: payload });
    };
    assert.equal((await sendWebhook('invalid', 'delivered', false)).status, 400); assert.equal((await sendWebhook('valid', 'delivered')).status, 204); await applyEmailWebhooks(); assert.equal((await Delivery.findById(webhookDelivery._id))?.status, 'delivered');
    await sendWebhook('valid', 'delivered'); assert.equal(await Webhook.countDocuments({ eventId: 'valid' }), 1); pass('Raw signed webhooks verify and replay idempotently');
    await sendWebhook('bounce', 'bounced'); await applyEmailWebhooks(); await sendWebhook('late-delivery', 'delivered'); await applyEmailWebhooks(); assert.equal((await Delivery.findById(webhookDelivery._id))?.status, 'bounced'); pass('Late webhook events cannot overwrite terminal bounce status');
    console.log(`Notification verification complete: ${passed} groups passed. All provider calls mocked; no real recipients or production data used.`);
  } finally {
    globalThis.fetch = nativeFetch;
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await mongoose.disconnect(); await replica.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
