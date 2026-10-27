/** Runs real API handlers against a disposable replica set. Never reads MONGO_URI. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import independentRoutes from '../routes/independentTasks';
import managementRoutes from '../routes/caseManagement';
import Case from '../models/caseModel';
import User from '../models/userModel';
import Template from '../models/workflowTemplateModel';
import Workflow from '../models/workflowInstanceModel';
import Invoice from '../models/invoiceModel';
import Document from '../models/documentModel';
import AuditLog from '../models/auditLogModel';
import IndependentTask from '../modules/independentTasks/models/independentTaskModel';
import History from '../modules/independentTasks/models/independentTaskHistoryModel';
import TaskComment from '../modules/independentTasks/models/independentTaskCommentModel';
import Notification from '../models/notificationModel';
import { independentTaskService } from '../modules/independentTasks/services/independentTaskService';
import { computeCaseEarnedFees } from '../utils/caseEarnedFees';
import { buildRoleByName } from '../utils/workflowPercentages';
import { serveStoredUpload } from '../services/fileStorageService';

async function main() {
  console.log('Starting isolated MongoDB replica set...');
  // Explicitly suppress outbound mail. These users and notifications exist only here.
  delete process.env.RESEND_API_KEY;
  process.env.JWT_SECRET = 'independent-task-isolated-verification-secret';
  const localBinary = path.resolve(__dirname, '../../node_modules/.cache/mongodb-memory-server/test-mongod.exe');
  const replica = await MongoMemoryReplSet.create({
    binary: { version: '7.0.14', ...(existsSync(localBinary) ? { systemBinary: localBinary } : {}) },
    instanceOpts: [{ launchTimeout: 120000 }],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  console.log('Temporary replica set ready; connecting test database.');
  let server: ReturnType<express.Express['listen']> | undefined;
  let passed = 0;
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'independent_task_verification' });
    const users: Record<string, any> = {};
    for (const [name, role] of [
      ['Owner', 'associate'], ['Reviewer', 'senior_associate'], ['Approver', 'partner'],
      ['Winnie', 'associate'], ['Other', 'associate'], ['DelegateReviewer', 'senior_associate'],
      ['DelegateApprover', 'partner'], ['Intern', 'intern'], ['Trainee', 'trainee_associate'],
      ['ManagingPartner', 'managing_partner'], ['ExecutiveAssistant', 'executive_assistant'],
      ['SeniorExecutiveAssistant', 'senior_executive_assistant'],
    ] as const) {
      users[name!] = await User.create({ name, role, email: `${name!.toLowerCase()}@test.invalid`, passwordHash: 'verification-only' });
    }
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    const app = express();
    app.use(express.json());
    app.use(independentRoutes);
    app.use('/case-management', managementRoutes);
    app.get('/uploads/:fileKey', serveStoredUpload);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    const request = async (name: string, url: string, body?: any, method?: string) => {
      const token = jwt.sign({ id: String(users[name]._id) }, process.env.JWT_SECRET!);
      const response = await fetch(`${base}${url}`, {
        method: method || (body ? 'POST' : 'GET'),
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      return { status: response.status, data };
    };
    const ok = async (name: string, url: string, body?: any, method?: string) => {
      const result = await request(name, url, body, method);
      assert(result.status < 300, `${method || 'request'} ${url}: ${result.status} ${JSON.stringify(result.data)}`);
      return result.data;
    };
    const pass = (name: string) => { passed++; console.log(`PASS ${passed}: ${name}`); };
    let fixtureNumber = 0;
    const fixture = async (count = 1) => {
      fixtureNumber++;
      const steps = Array.from({ length: count }, (_, index) => ({
        key: `action-${index + 1}`, title: `Action ${index + 1}`, order: index + 1, stageKey: 'delivery',
        percentage: 100 / count, actions: [], outputs: [], legalBasis: [], responsibleRole: 'Initiator',
      }));
      const template = await Template.create({ name: `Verification ${fixtureNumber}`, matterType: `Verification ${fixtureNumber}`, caseType: 'Transactional Cases',
        stages: [{ key: 'delivery', title: 'Delivery', order: 1, percentage: 100 }], steps });
      const matter = await Case.create({ caseNo: `VERIFY-${fixtureNumber}`, parties: 'Isolated verification', caseType: 'Transactional Cases',
        status: 'In Progress', assignedTo: 'Owner', caseAssignments: { initiator: 'Owner', reviewer: 'Reviewer', signerApprover: 'Approver' },
        budget: '1000000', billingSettings: { currency: 'RWF' },
        matterType: template.matterType, workflowTemplateId: template._id,
        caseManagement: { qualityScore: 85, qualityScoredBy: 'Reviewer', qualityScoredAt: new Date() },
      });
      const instance = await Workflow.create({ caseId: matter._id, templateId: template._id, steps: steps.map((step) => ({
        ...step, stepKey: step.key, status: 'Not Started', stageTitle: 'Delivery', stageOrder: 1,
        startAt: new Date(Date.now() - 3600000), dueAt: new Date(Date.now() + 86400000),
      })) });
      matter.workflowInstanceId = instance._id;
      await matter.save();
      await Invoice.create({ caseId: matter._id, invoiceNo: `VERIFY-INV-${fixtureNumber}`, year: 2026, seqYear: fixtureNumber, seqCase: 1,
        date: '2026-10-26', amount: 1000000, status: 'Paid' });
      return { id: String(matter._id), template, matter, instance };
    };
    const create = (f: { id: string }, name = 'Winnie', role = 'Initiator', keys = ['action-1']) => ok(name, '/independent-tasks', {
      title: `${role} verification`, assignee: name, supervisor: 'Reviewer', startDate: '2026-10-25', dueDate: '2026-11-05',
      relatedMatterId: f.id, caseRole: role, keyActionKeys: keys,
    });
    const start = (name: string, task: any) => ok(name, `/independent-tasks/${task._id}/transition`, { status: 'In Progress' });
    const submit = (name: string, task: any) => ok(name, `/independent-tasks/${task._id}/case-lifecycle`, {});
    const state = (f: { id: string }) => ok('Reviewer', `/case-management/cases/${f.id}`);
    for (const contributor of ['Intern', 'Trainee']) {
      const juniorFixture = await fixture();
      const options = await ok(contributor, `/independent-tasks/case-options/${juniorFixture.id}`);
      assert.equal(options.keyActions.length, 1);
      const juniorTask = await create(juniorFixture, contributor);
      await start(contributor, juniorTask);
      await submit(contributor, juniorTask);
      assert.equal((await state(juniorFixture)).steps[0].status, 'Awaiting Review');
      assert.equal((await request(contributor, '/independent-tasks', {
        title: 'Cannot self authorize review', assignee: contributor, supervisor: 'Reviewer',
        startDate: '2026-10-25', dueDate: '2026-11-05', relatedMatterId: juniorFixture.id,
        caseRole: 'Reviewer', keyActionKeys: ['action-1'],
      })).status, 400);
      assert.equal((await request('Reviewer', '/independent-tasks', {
        title: 'Cannot assign unauthorized reviewer', assignee: contributor, supervisor: 'Reviewer',
        startDate: '2026-10-25', dueDate: '2026-11-05', relatedMatterId: juniorFixture.id,
        caseRole: 'Reviewer', keyActionKeys: ['action-1'],
      })).status, 400);
    }
    pass('Interns and trainees can select, create and submit initiator work without receiving review authority');
    const staffRoles = ['managing_director', 'managing_partner', 'senior_partner', 'partner', 'associate_partner',
      'executive_associate_partner', 'senior_associate', 'senior_executive_assistant', 'associate',
      'trainee_associate', 'executive_assistant', 'executive_partner', 'executive_managing_partner', 'originating_attorney', 'intern'];
    for (const role of staffRoles) {
      await User.updateOne({ _id: users.Winnie._id }, { $set: { role } });
      const ownFixture = await fixture(3);
      const options = await ok('Winnie', `/independent-tasks/case-options/${ownFixture.id}`);
      assert(options.keyActions.every((action: any) => action.eligibility.Initiator));
      const ownTask = await ok('Winnie', '/independent-tasks', {
        title: 'Self assigned batch ' + role, assignee: 'stale display name', assigneeUserId: String(users.Winnie._id),
        supervisorUserId: String(users.Reviewer._id), startDate: '2026-10-25', dueDate: '2026-11-05',
        relatedMatterId: ownFixture.id, caseRole: 'Initiator', keyActionKeys: ['action-1', 'action-2', 'action-3'],
      });
      assert.equal(ownTask.assignee, 'Winnie');
      await start('Winnie', ownTask);
      await submit('Winnie', ownTask);
      assert((await state(ownFixture)).steps.every((step: any) => step.status === 'Awaiting Review'));
      const seniorFixture = await fixture();
      const seniorAssigned = await ok('ManagingPartner', '/independent-tasks', {
        title: 'Senior assigned ' + role, assigneeUserId: String(users.Winnie._id), supervisorUserId: String(users.Reviewer._id),
        startDate: '2026-10-25', dueDate: '2026-11-05', relatedMatterId: seniorFixture.id,
        caseRole: 'Initiator', keyActionKeys: ['action-1'],
      });
      await start('Winnie', seniorAssigned);
      await submit('Winnie', seniorAssigned);
    }
    await User.updateOne({ _id: users.Winnie._id }, { $set: { role: 'associate' } });
    pass('Every staff role can self-create multi-action initiator work and perform senior-assigned work using account IDs');
    await User.updateOne({ _id: users.Intern._id }, { $set: { isActive: false } });
    const inactiveResult = await request('ManagingPartner', '/independent-tasks', {
      title: 'Inactive assignee', assigneeUserId: String(users.Intern._id), supervisorUserId: String(users.Reviewer._id),
      startDate: '2026-10-25', dueDate: '2026-11-05',
    });
    assert.equal(inactiveResult.status, 400);
    assert.match(inactiveResult.data.message, /inactive/);
    await User.updateOne({ _id: users.Intern._id }, { $set: { isActive: true } });
    pass('Inactive accounts receive a specific assignment error');
    const sequenceFixture = await fixture(4);
    // Simulate a legacy instance containing only each stage's first action.
    const sequenceTemplate: any = await Template.findById(sequenceFixture.template._id);
    sequenceTemplate.stages = [
      { key: 'second', title: 'Second stage', order: 2, percentage: 50 },
      { key: 'first', title: 'First stage', order: 1, percentage: 50 },
    ];
    sequenceTemplate.steps.forEach((step: any, index: number) => { step.stageKey = index < 2 ? 'first' : 'second'; });
    await sequenceTemplate.save();
    const sparse: any = await Workflow.findById(sequenceFixture.instance._id);
    sparse.steps = [sparse.steps[2], sparse.steps[0]];
    await sparse.save();
    const sequenceOptions = await ok('Winnie', `/independent-tasks/case-options/${sequenceFixture.id}`);
    assert.deepEqual(sequenceOptions.keyActions.map((step: any) => step.key), ['action-1', 'action-2', 'action-3', 'action-4']);
    assert.equal((await Workflow.findById(sparse._id))!.steps.length, 4);
    for (const keys of [['action-2'], ['action-2', 'action-1'], ['action-1', 'action-3']]) {
      const result = await request('Winnie', '/independent-tasks', {
        title: 'Skipped selection', assignee: 'Winnie', supervisor: 'Reviewer', startDate: '2026-10-25', dueDate: '2026-11-05',
        relatedMatterId: sequenceFixture.id, caseRole: 'Initiator', keyActionKeys: keys,
      });
      assert.equal(result.status, 400);
      assert.match(result.data.message, /sequence/);
    }
    const sequentialTask = await create(sequenceFixture, 'Winnie', 'Initiator', ['action-1', 'action-2', 'action-3', 'action-4']);
    await start('Winnie', sequentialTask);
    await submit('Winnie', sequentialTask);
    assert((await state(sequenceFixture)).steps.every((step: any) => step.status === 'Awaiting Review'));
    pass('All stage actions are restored and ordered; skipped/reversed selections are rejected and ordered batches submit');
    const f = await fixture();
    const task = await create(f);
    await start('Winnie', task);
    assert.equal((await state(f)).steps[0].status, 'In Progress');
    await submit('Winnie', task);
    assert.equal((await state(f)).steps[0].status, 'Awaiting Review');
    assert.equal((await ok('Winnie', `/independent-tasks/${task._id}`)).status, 'Awaiting Review');
    assert.equal((await Case.findById(f.id))!.caseAssignments!.initiator, 'Owner');
    pass('Non-assigned initiator submits through the actual workflow; assignments stay intact');

    assert.equal((await request('Other', `/case-management/cases/${f.id}/return-for-corrections`, { stepKey: 'action-1', reason: 'Unauthorized' })).status, 403);
    await ok('Reviewer', `/case-management/cases/${f.id}/return-for-corrections`, { stepKey: 'action-1', reason: 'Please correct the supporting analysis.' });
    const returned = await ok('Winnie', `/independent-tasks/${task._id}`);
    assert.equal(returned.status, 'In Progress');
    assert.equal(returned.caseWork.lifecycleStatus, 'Changes Requested');
    assert.match(returned.caseWork.selectedKeyActions[0].correctionRequest.reason, /supporting analysis/);
    await ok('Winnie', `/independent-tasks/${task._id}/comments`, { body: 'Updated the analysis and saved my correction.' });
    await submit('Winnie', task);
    assert.equal((await state(f)).steps[0].status, 'Awaiting Review');
    let live = await Workflow.findById(f.instance._id);
    assert.deepEqual(live!.steps[0]!.reviewHistory!.map((entry) => entry.action), ['Returned', 'Resubmitted']);
    assert.equal(live!.steps[0]!.independentContributors!.length, 1);
    pass('Authorized return, feedback, corrections and resubmission preserve history without duplicate credit');

    const reviewer = await create(f, 'DelegateReviewer', 'Reviewer');
    await start('DelegateReviewer', reviewer);
    await ok('DelegateReviewer', `/independent-tasks/${reviewer._id}/return-for-corrections`, { stepKey: 'action-1', reason: 'One final clarification.' });
    await submit('Winnie', task);
    await submit('DelegateReviewer', reviewer);
    assert.equal((await state(f)).steps[0].status, 'Awaiting Approval');
    pass('Delegated reviewer returns and forwards corrected work without becoming a case assignee');

    const approver = await create(f, 'DelegateApprover', 'Signer/Approver');
    await start('DelegateApprover', approver);
    await ok('DelegateApprover', `/independent-tasks/${approver._id}/return-for-corrections`, { stepKey: 'action-1', reason: 'Attach a final corrected copy.' });
    assert.equal((await request('DelegateApprover', `/independent-tasks/${approver._id}/case-lifecycle`, {})).status, 400);
    await submit('Winnie', task);
    await submit('DelegateReviewer', reviewer);
    await submit('DelegateApprover', approver);
    assert.equal((await state(f)).steps[0].status, 'Completed');
    assert.equal((await ok('Winnie', `/independent-tasks/${task._id}`)).status, 'Completed');
    pass('Delegated approver returns work, requires a fresh review, then completes all linked tasks');

    const finalState = await state(f);
    const contributor = finalState.earnedFees.team.find((member: any) => member.name === 'Winnie' && member.role === 'Initiator');
    const owner = finalState.earnedFees.team.find((member: any) => member.name === 'Owner' && member.role === 'Initiator');
    assert(contributor && contributor.earnedFee > 0, 'Delegated initiator should have realized collected earnings');
    assert.equal(owner.taskFeeCollected, 0);
    assert.equal(owner.earnedFee || 0, 0);
    const taskResult = await ok('Winnie', `/independent-tasks/${task._id}`);
    assert.equal(taskResult.caseWork.earnedFee, contributor.earnedFee);
    assert(contributor.timelinessScore <= 100);
    pass('Financial attribution credits the actual performer and excludes duplicate original-owner earnings');

    const dashboard = await ok('Winnie', '/independent-tasks/dashboard');
    assert.equal(dashboard.independentTaskEarnings.earnedFee, contributor.earnedFee);
    const rawMatter = await Case.findById(f.id).lean();
    live = await Workflow.findById(f.instance._id);
    const common = computeCaseEarnedFees({ caseDoc: rawMatter, template: f.template.toObject(), workflowInstance: live!.toObject(),
      tasks: [], collectedAmount: 1000000, roleByName: buildRoleByName(Object.values(users)) });
    assert.equal(common.team.find((member) => member.name === 'Winnie')!.earnedFee, contributor.earnedFee);
    pass('Independent Task, case financial projection and contributor dashboard agree with the shared reporting calculation');

    const docsFixture = await fixture();
    const docsTask = await create(docsFixture);
    const token = jwt.sign({ id: String(users.Winnie._id) }, process.env.JWT_SECRET!);
    const form = new FormData();
    form.set('file', new Blob(['corrected supporting analysis'], { type: 'text/plain' }), 'analysis.txt');
    const upload = await fetch(`${base}/independent-tasks/${docsTask._id}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    assert.equal(upload.status, 201);
    const attachment = await upload.json() as any;
    const document = await Document.findById(attachment.caseDocumentId);
    assert(document && document.url === attachment.url && String(document.caseId) === docsFixture.id);
    assert.equal(await mongoose.connection.db!.collection('uploads.files').countDocuments({}), 1);
    assert.equal(await (await fetch(`${base}${attachment.url}`)).text(), 'corrected supporting analysis');
    await ok('Winnie', `/independent-task-attachments/${attachment._id}`, undefined, 'DELETE');
    assert(await Document.exists({ _id: document._id }));
    assert.equal((await fetch(`${base}${attachment.url}`)).status, 200);
    pass('One physical upload is shared with the matter and survives removal of the task attachment');

    await ok('Winnie', `/independent-tasks/${docsTask._id}`, undefined, 'DELETE');
    assert.equal(await IndependentTask.findById(docsTask._id), null);
    assert.equal(await History.countDocuments({ taskId: docsTask._id }), 0);
    assert(!(await Workflow.findById(docsFixture.instance._id))!.steps[0]!.delegatedClaim);
    const cancelled = await ok('Winnie', `/independent-tasks/${task._id}`, undefined, 'DELETE');
    assert.equal(cancelled.cancelled, true);
    await ok('Winnie', `/independent-tasks/${task._id}`, undefined, 'DELETE');
    assert.equal((await IndependentTask.findById(task._id))!.status, 'Cancelled');
    assert(await AuditLog.exists({ independentTaskId: task._id }));
    assert.equal((await state(f)).earnedFees.team.find((member: any) => member.name === 'Winnie').earnedFee, contributor.earnedFee);
    pass('Unstarted deletion releases claims; repeated submitted cancellation preserves audit and financial records');

    const race = await fixture();
    const attempts = await Promise.all(['Winnie', 'Other'].map((name) => request(name, '/independent-tasks', {
      title: 'Concurrent claim', assignee: name, supervisor: 'Reviewer', startDate: '2026-10-25', dueDate: '2026-11-05',
      relatedMatterId: race.id, caseRole: 'Initiator', keyActionKeys: ['action-1'],
    })));
    assert.equal(attempts.filter((result) => result.status === 201).length, 1);
    assert.equal(await IndependentTask.countDocuments({ relatedMatterId: race.id }), 1);
    pass('Two concurrent exclusive claims create exactly one task and reservation');

    const standard = await ok('Winnie', '/independent-tasks', { title: 'Standard task', assignee: 'Winnie', supervisor: 'Reviewer', startDate: '2026-10-25', dueDate: '2026-11-05' });
    const unrelated = await ok('Winnie', '/independent-tasks', { title: 'Standard task', assignee: 'Winnie', supervisor: 'Reviewer', startDate: '2026-10-25', dueDate: '2026-11-05' });
    await ok('Winnie', `/independent-tasks/${standard._id}/comments`, { body: 'Shared comment wording' });
    await ok('Winnie', `/independent-tasks/${unrelated._id}/comments`, { body: 'Shared comment wording' });
    const privateFilesBefore = await mongoose.connection.db!.collection('uploads.files').countDocuments({});
    const privateUpload = new FormData();
    privateUpload.set('file', new Blob(['private task file'], { type: 'text/plain' }), 'private.txt');
    const privateResponse = await fetch(`${base}/independent-tasks/${standard._id}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: privateUpload });
    assert.equal(privateResponse.status, 201);
    const privateAttachment: any = await privateResponse.json();
    assert(!privateAttachment.caseDocumentId);
    for (const status of ['Acknowledged', 'In Progress', 'Awaiting Review', 'Completed']) await ok('Winnie', `/independent-tasks/${standard._id}/transition`, { status });
    assert.equal((await ok('Winnie', `/independent-tasks/${standard._id}`)).status, 'Completed');
    await ok('Winnie', `/independent-tasks/${standard._id}/transition`, { status: 'Closed' });
    await ok('Winnie', `/independent-tasks/${standard._id}`, undefined, 'DELETE');
    assert.equal(await IndependentTask.findById(standard._id), null);
    assert.equal(await History.countDocuments({ taskId: standard._id }), 0);
    assert.equal(await TaskComment.countDocuments({ taskId: standard._id }), 0);
    assert.equal(await Notification.countDocuments({ taskId: standard._id }), 0);
    assert.equal(await AuditLog.countDocuments({ independentTaskId: standard._id }), 0);
    assert.equal(await mongoose.connection.db!.collection('uploads.files').countDocuments({}), privateFilesBefore);
    assert(await TaskComment.exists({ taskId: unrelated._id }));
    assert(await AuditLog.exists({ independentTaskId: unrelated._id }));
    pass('Standard lifecycle and closed-task deletion remove all private records/files without affecting same-title tasks');

    const multi = await fixture(2);
    const first = await create(multi);
    await start('Winnie', first);
    await submit('Winnie', first);
    const second = await create(multi, 'Other', 'Initiator', ['action-2']);
    await start('Other', second);
    await submit('Other', second);
    for (const stepKey of ['action-1', 'action-2']) {
      await ok('Reviewer', `/case-management/cases/${multi.id}/request-approval`, { stepKey });
      await ok('Approver', `/case-management/cases/${multi.id}/approve`, { stepKey });
    }
    const team = (await state(multi)).earnedFees.team;
    assert(team.find((member: any) => member.name === 'Winnie').earnedFee > 0);
    assert(team.find((member: any) => member.name === 'Other').earnedFee > 0);
    assert.equal(team.find((member: any) => member.name === 'Owner').taskFeeCollected, 0);
    assert.equal(team.find((member: any) => member.name === 'Owner').earnedFee || 0, 0);
    pass('Multiple delegated contributors receive their individual action allocations');

    const locked = await fixture(2);
    const options = await ok('Winnie', `/independent-tasks/case-options/${locked.id}`);
    assert.equal(options.keyActions[1].eligibility.Initiator, true);
    assert.equal((await request('Intern', '/independent-tasks', { title: 'Invalid', assignee: 'Intern', supervisor: 'Reviewer', startDate: '2026-10-25', dueDate: '2026-11-05', relatedMatterId: locked.id, caseRole: 'Reviewer', keyActionKeys: ['action-1'] })).status, 400);
    assert.equal((await request('Approver', `/case-management/cases/${locked.id}/approve`, { stepKey: 'action-1' })).status, 400);
    pass('Multiple initiator actions are selectable; unauthorized reviewers cannot bypass mandatory review');

    const partial = await fixture(2);
    const partialFirst = await create(partial);
    await start('Winnie', partialFirst);
    await submit('Winnie', partialFirst);
    const partialSecond = await create(partial, 'Other', 'Initiator', ['action-2']);
    await start('Other', partialSecond);
    await submit('Other', partialSecond);
    const batchReviewer = await create(partial, 'DelegateReviewer', 'Reviewer', ['action-1', 'action-2']);
    await start('DelegateReviewer', batchReviewer);
    await submit('DelegateReviewer', batchReviewer);
    const batchApprover = await create(partial, 'DelegateApprover', 'Signer/Approver', ['action-1', 'action-2']);
    await start('DelegateApprover', batchApprover);
    await ok('DelegateApprover', `/independent-tasks/${batchApprover._id}/return-for-corrections`, { stepKey: 'action-2', reason: 'Correct only the second action.' });
    await submit('DelegateApprover', batchApprover);
    assert.equal((await IndependentTask.findById(batchApprover._id))!.status, 'Awaiting Review');
    assert.equal(await History.countDocuments({ taskId: batchApprover._id, action: 'TASK_COMPLETED' }), 0);
    await submit('Other', partialSecond);
    await submit('DelegateReviewer', batchReviewer);
    await submit('DelegateApprover', batchApprover);
    assert.equal((await IndependentTask.findById(batchApprover._id))!.status, 'Completed');
    assert.equal((await state(partial)).steps.filter((step: any) => step.status === 'Completed').length, 2);
    await IndependentTask.findByIdAndUpdate(batchApprover._id, { $set: { status: 'Closed', closedAt: new Date() } });
    assert.equal((await ok('DelegateApprover', `/independent-tasks/${batchApprover._id}`)).caseWork.lifecycleStatus, 'Closed');
    assert.equal((await ok('DelegateApprover', `/independent-tasks/${batchApprover._id}`, undefined, 'DELETE')).cancelled, true);
    assert.equal((await IndependentTask.findById(batchApprover._id))!.status, 'Cancelled');
    pass('Partial multi-action approval stays pending; correction/resubmission preserves already-approved work');

    const own = await fixture();
    const ownInitiator = await create(own);
    await start('Winnie', ownInitiator);
    await submit('Winnie', ownInitiator);
    const ownReviewer = await create(own, 'Winnie', 'Reviewer');
    await start('Winnie', ownReviewer);
    assert.equal((await request('Winnie', `/independent-tasks/${ownReviewer._id}/case-lifecycle`, {})).status, 400);
    assert.equal((await request('Winnie', `/independent-tasks/${ownReviewer._id}/return-for-corrections`, { stepKey: 'action-1', reason: 'Attempted self-review' })).status, 400);
    assert.equal((await state(own)).steps[0].status, 'Awaiting Review');
    assert.equal((await request('Reviewer', `/case-management/cases/${own.id}/return-for-corrections`, { stepKey: 'action-1', reason: '  ' })).status, 400);
    assert.equal((await state(own)).steps[0].status, 'Awaiting Review');
    pass('Self-review and blank correction feedback are rejected without changing workflow state');
    const identityTask = await ok('Winnie', '/independent-tasks', { title: 'Creator identity regression', assignee: 'Other', supervisor: 'Reviewer', startDate: '2026-10-25', dueDate: '2026-11-05' });
    await User.findByIdAndUpdate(users.Other._id, { $set: { name: 'Winnie' } });
    assert.equal((await request('Other', `/independent-tasks/${identityTask._id}`, undefined, 'DELETE')).status, 403);
    assert(await IndependentTask.exists({ _id: identityTask._id }));
    await User.findByIdAndUpdate(users.Other._id, { $set: { name: 'Other' } });
    await User.findByIdAndUpdate(users.Winnie._id, { $set: { name: 'Winnie Updated' } });
    assert.equal((await ok('Winnie', `/independent-tasks/${identityTask._id}`)).canDelete, true);
    assert((await ok('Winnie', '/independent-tasks?limit=100')).items.some((item: any) => item._id === identityTask._id));
    await ok('Winnie', `/independent-tasks/${identityTask._id}`, undefined, 'DELETE');
    assert.equal(await IndependentTask.findById(identityTask._id), null);
    pass('Creator ID authorizes deletion after a name change and rejects a different user with the same name');
    for (const senior of ['ManagingPartner', 'ExecutiveAssistant', 'SeniorExecutiveAssistant', 'Reviewer', 'Approver']) {
      const managedTask = await ok('Other', '/independent-tasks', { title: 'Senior deletion permission ' + senior, assignee: 'Other', supervisor: 'Other', startDate: '2026-10-25', dueDate: '2026-11-05' });
      assert.equal((await ok(senior, `/independent-tasks/${managedTask._id}`)).canDelete, true);
      assert((await ok(senior, '/independent-tasks?limit=100')).items.some((item: any) => item._id === managedTask._id));
      assert.equal((await request('Winnie', `/independent-tasks/${managedTask._id}`, undefined, 'DELETE')).status, 403);
      await ok(senior, `/independent-tasks/${managedTask._id}`, undefined, 'DELETE');
      assert.equal(await IndependentTask.findById(managedTask._id), null);
    }
    pass('Managing Partner, Executive Assistant, senior assistant, Senior Associate and Partner can view and delete others’ tasks; ordinary non-creators cannot');
    const cancelledFixture = await fixture();
    const cancelledDraft = await create(cancelledFixture, 'Other');
    await start('Other', cancelledDraft);
    assert.equal((await ok('Other', `/independent-tasks/${cancelledDraft._id}`, undefined, 'DELETE')).cancelled, true);
    assert.equal((await IndependentTask.findById(cancelledDraft._id))!.status, 'Cancelled');
    await ok('Other', `/independent-tasks/${cancelledDraft._id}`, undefined, 'DELETE');
    assert.equal(await IndependentTask.findById(cancelledDraft._id), null);
    assert.equal(await History.countDocuments({ taskId: cancelledDraft._id }), 0);
    assert(!(await Workflow.findById(cancelledFixture.instance._id))!.steps[0]!.delegatedClaim);
    pass('Cancelled delegated task with zero submitted contributions can be permanently deleted');
    console.log(`Verified ${passed} database-backed scenario groups using a disposable MongoDB replica set.`);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    await mongoose.disconnect();
    await replica.stop();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
