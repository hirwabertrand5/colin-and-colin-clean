/** One-matter, transactionally backed-up workflow conversion. Dry-run unless --apply. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);
const { EJSON } = require('bson');
const { buildInstanceSteps } = require('../dist/utils/workflowCompute');
const { computeCompletedPercentFromInstance, computeStageBreakdownFromInstance } = require('../dist/utils/workflowPercentages');
const MATTER_ID = '6ae4aa603303df92c293acad';
const OLD_TEMPLATE_ID = '6ac7d144aaebe80bd2c9e0ce';
const TARGET_ID = '6a41454d462ec344673ad89b';
const clone = value => EJSON.parse(EJSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(EJSON.stringify(value)).digest('hex');

// Explicit semantic mapping; the numeric keys of the two workflows are unrelated.
// No completion is inferred merely because the old and new action share a key.
const EQUIVALENTS = [
  [2, [1], 'Conflict check completed'],
  [4, [5, 6, 7], 'Engagement executed and opening fees confirmed'],
  [5, [17], 'Legal issues identified'],
  [6, [16], 'Applicable law, regulations and contractual sources reviewed'],
  [7, [8], 'Responsible lawyer assigned and deadline diary opened'],
  [8, [12], 'Completeness checked and factual/document gaps flagged to client'],
  [9, [16], 'Applicable labour law and regulations researched'],
  [10, [17, 18], 'Legal issues, merits and risks assessed'],
  [13, [18, 19], 'Merits and remedies applied to the matter in the legal opinion'],
  [14, [18], 'Merits, risks and recovery assessed'],
  [16, [19], 'Conclusions on merits, risks and remedies drafted'],
  [17, [19], 'Legal opinion drafted'],
  [21, [19], 'Draft opinion has a recorded reviewer approval'],
  [24, [19], 'Draft opinion has recorded internal final approval'],
  [25, [19], 'Approved action explicitly records drafting and sending the opinion'],
];
const lifecycleFields = ['startAt', 'dueAt', 'doneAt', 'submittedAt', 'reviewedAt', 'completedAt'];

function buildPlan(snapshot) {
  const matter = snapshot.matters.find(m => String(m._id) === MATTER_ID);
  assert(matter && matter.caseNo === 'CASE-2026-00047' && matter.parties === 'RWANDA FARMERS COFFEE COMPANY', 'Exact matter identity required');
  assert.equal(matter.status, 'Active');
  const original = snapshot.workflows.find(w => String(w.caseId) === MATTER_ID);
  assert(original && String(original.templateId) === OLD_TEMPLATE_ID, 'Expected original Labour workflow required; never apply twice');
  const template = snapshot.legalOpinionTemplates.find(t => String(t._id) === TARGET_ID);
  assert(template && template.active && !template.draft && template.name.toLowerCase() === 'legal opinion');
  assert.equal(template.steps.length, 33, 'Review mapping if template changes');
  const oldByKey = new Map(original.steps.map(s => [s.stepKey, s]));
  assert.equal(original.steps.filter(s => s.status === 'Completed').length, 19, 'Completed work changed: re-inspect before applying');
  const steps = buildInstanceSteps(template, new Date(matter.workflowStartDate || matter.createdAt));
  const mappings = [];
  for (const [target, sources, reason] of EQUIVALENTS) {
    const destination = steps.find(s => s.stepKey === `key_action_${target}`);
    const inputs = sources.map(n => oldByKey.get(`key_action_${n}`));
    assert(destination && inputs.every(s => s?.status === 'Completed' && s.submittedAt && s.reviewedAt && s.completedAt), 'Only proven approved work can carry approval');
    const primary = inputs.slice().sort((a, b) => +new Date(b.completedAt) - +new Date(a.completedAt))[0];
    destination.status = 'Completed';
    for (const field of lifecycleFields) {
      const values = inputs.map(s => s[field]).filter(Boolean).map(d => +new Date(d));
      if (values.length) destination[field] = new Date(field === 'startAt' ? Math.min(...values) : Math.max(...values));
    }
    for (const field of ['tpaSnapshots', 'independentContributors', 'reviewHistory', 'correctionRequest', 'extensionHistory']) {
      if (primary[field]) destination[field] = clone(primary[field]);
    }
    // Existing output documents remain on the case and in the full archived
    // workflow. Do not relabel an unrelated document as a required new output.
    mappings.push({ targetKey: destination.stepKey, targetTitle: destination.title, sourceKeys: inputs.map(s => s.stepKey), reason,
      timestamps: Object.fromEntries(lifecycleFields.map(field => [field, destination[field] || null])) });
  }
  const current = steps.find(s => s.status !== 'Completed');
  current.status = 'In Progress';
  // Keep the actual in-flight deadline instead of silently granting extra time.
  const oldCurrent = oldByKey.get(original.currentStepKey);
  if (oldCurrent && oldCurrent.status === 'In Progress') {
    current.startAt = new Date(oldCurrent.startAt);
    current.dueAt = new Date(oldCurrent.dueAt);
    current.extensionHistory = clone(oldCurrent.extensionHistory || []);
  }
  const percent = computeCompletedPercentFromInstance(steps);
  const planned = Number(matter.workflowProgress?.plannedValue?.amount) || Number(String(matter.budget || '').replace(/[^\d.]/g, '')) || 0;
  const progress = { ...clone(matter.workflowProgress), status: 'In Progress', percent,
    currentStepKey: current.stepKey, currentStepTitle: current.title, currentStepStartAt: current.startAt,
    currentStepDueAt: current.dueAt, currentStepExtension: current.extensionHistory?.at(-1), nextDueAt: current.dueAt,
    stagePercent: computeStageBreakdownFromInstance(steps),
    completedValue: { amount: Math.round(planned * percent / 100), currency: 'RWF' } };
  const workflow = { ...clone(original), templateId: template._id, steps, currentStepKey: current.stepKey,
    archivedSteps: [...clone(original.archivedSteps || []), ...clone(original.steps).map(s => ({ ...s, archivedFromTemplate: true }))],
    deletedStepKeys: [], updatedAt: new Date(), __v: (original.__v || 0) + 1 };
  const casePatch = { workflow: template.name, matterType: template.matterType, workflowTemplateId: template._id,
    workflowProgress: progress, 'billingSettings.accruedUnbilled': progress.completedValue.amount, updatedAt: workflow.updatedAt };
  const oldTasks = snapshot.tasks.filter(t => String(t.caseId) === MATTER_ID && t.workflowStepKey);
  const byTaskKey = new Map(oldTasks.map(t => [t.workflowStepKey, t]));
  const tasks = steps.map(step => {
    const sourceTask = byTaskKey.get(step.stepKey);
    assert(sourceTask, `Missing task slot for ${step.stepKey}; inspect before applying`);
    const task = clone(sourceTask);
    task.title = step.title;
    task.description = step.title;
    task.workflowStageKey = step.stageKey;
    task.status = step.status === 'Completed' ? 'Completed' : step.status;
    task.workflowStage = task.status === 'Completed' ? 'Completed' : task.status === 'In Progress' ? 'In Progress' : 'Assigned';
    task.startDate = new Date(step.startAt).toISOString().slice(0, 10);
    task.dueDate = new Date(step.dueAt).toISOString();
    task.tpaSnapshots = clone(step.tpaSnapshots || []);
    delete task.completedAt; delete task.submittedAt; delete task.approvedAt;
    if (task.status === 'Completed') {
      task.completedAt = step.completedAt; task.submittedAt = step.submittedAt; task.approvedAt = step.completedAt;
      task.approvalStatus = task.requiresApproval ? 'Approved' : 'Not Required';
    }
    for (const stage of task.taskStages || []) {
      stage.status = task.status === 'Completed' ? 'Completed' : 'Assigned';
      delete stage.completedAt;
      if (task.status === 'Completed') stage.completedAt = stage.role === 'Initiator' ? step.submittedAt : stage.role === 'Reviewer' ? step.reviewedAt : step.completedAt;
    }
    task.updatedAt = workflow.updatedAt;
    return task;
  });
  assert.deepEqual(steps.map(s => [s.stepKey, s.title, s.percentage]), template.steps.slice().sort((a,b) => a.order-b.order).map(s => [s.key, s.title, s.percentage]));
  return { matter, original, template, workflow, tasks, oldTasks, casePatch, mappings, percent,
    guard: hash({ matter, original, tasks: snapshot.tasks, ledger: snapshot.ledger, template }) };
}

async function inspect(db, session) {
  const options = session ? { session } : {};
  const id = new mongoose.Types.ObjectId(MATTER_ID);
  // Sequential inside transactions: the driver does not support parallel operations there.
  const matters = await db.collection('cases').find({ _id: id }, options).toArray();
  const workflows = await db.collection('workflowinstances').find({ caseId: id }, options).toArray();
  const legalOpinionTemplates = await db.collection('workflowtemplates').find({ _id: new mongoose.Types.ObjectId(TARGET_ID) }, options).toArray();
  const tasks = await db.collection('tasks').find({ caseId: id }, options).sort({ _id: 1 }).toArray();
  const ledger = await db.collection('staffearningsledgers').find({ caseId: id }, options).sort({ _id: 1 }).toArray();
  return { inspectedAt: new Date(), matters, workflows, legalOpinionTemplates, tasks, ledger };
}

async function main() {
  const folder = path.resolve(__dirname, '../.local-operations'); fs.mkdirSync(folder, { recursive: true });
  const offline = process.argv.indexOf('--snapshot');
  if (offline >= 0) {
    const plan = buildPlan(JSON.parse(fs.readFileSync(path.resolve(process.argv[offline + 1]), 'utf8')));
    fs.writeFileSync(path.join(folder, 'coffee-legal-opinion-preview.json'), JSON.stringify({ caseNo: plan.matter.caseNo, percent: plan.percent, mappings: plan.mappings, steps: plan.workflow.steps }, null, 2));
    console.log(JSON.stringify({ mode: 'offline preview', caseNo: plan.matter.caseNo, approved: plan.mappings.length, total: plan.workflow.steps.length, progress: plan.percent }));
    return;
  }
  require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  require('node:dns').setServers(['8.8.8.8', '1.1.1.1']);
  mongoose.set('autoIndex', false);
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, socketTimeoutMS: 20000, maxPoolSize: 1, maxConnecting: 1, family: 4 });
  console.log('Connected for the scoped matter operation.');
  try {
    const db = mongoose.connection.db;
    const before = await inspect(db);
    const plan = buildPlan(before);
    console.log(JSON.stringify({ prepared: true, caseNo: plan.matter.caseNo, oldProgress: plan.matter.workflowProgress.percent, progress: plan.percent }));
    fs.writeFileSync(path.join(folder, `coffee-legal-opinion-backup-${Date.now()}.ejson`), EJSON.stringify(before, null, 2));
    fs.writeFileSync(path.join(folder, 'coffee-legal-opinion-preview.json'), JSON.stringify({ caseNo: plan.matter.caseNo, guard: plan.guard, percent: plan.percent, mappings: plan.mappings }, null, 2));
    if (!process.argv.includes('--apply')) {
      console.log(JSON.stringify({ mode: 'read-only preview', guard: plan.guard, caseNo: plan.matter.caseNo, approved: plan.mappings.length, progress: plan.percent })); return;
    }
    const session = await mongoose.startSession();
    let migrationId;
    try {
      await session.withTransaction(async () => {
        const fresh = await inspect(db, session);
        const currentPlan = buildPlan(fresh);
        assert.equal(currentPlan.guard, plan.guard, 'Matter, template or history changed concurrently; no writes applied');
        migrationId = new mongoose.Types.ObjectId();
        await db.collection('caseworkflowmigrations').insertOne({ _id: migrationId, caseId: plan.matter._id,
          reason: 'User-requested Labour to Legal Opinion conversion; standard target weights and equivalent completed work',
          createdAt: new Date(), before: fresh, mappings: plan.mappings, previousProgress: plan.matter.workflowProgress.percent, nextProgress: plan.percent }, { session });
        const wf = await db.collection('workflowinstances').replaceOne({ _id: plan.original._id, updatedAt: plan.original.updatedAt, templateId: plan.original.templateId }, plan.workflow, { session });
        assert.equal(wf.modifiedCount, 1);
        const c = await db.collection('cases').updateOne({ _id: plan.matter._id, updatedAt: plan.matter.updatedAt }, { $set: plan.casePatch, $inc: { __v: 1 } }, { session });
        assert.equal(c.modifiedCount, 1);
        const taskResult = await db.collection('tasks').bulkWrite(plan.tasks.map(task => ({ replaceOne: {
          filter: { _id: task._id, caseId: plan.matter._id }, replacement: task,
        } })), { session });
        assert.equal(taskResult.matchedCount, plan.tasks.length);
        const kept = new Set(plan.tasks.map(t => String(t._id)));
        const retiredTaskIds = plan.oldTasks.filter(t => !kept.has(String(t._id))).map(t => t._id);
        if (retiredTaskIds.length) await db.collection('tasks').deleteMany({ caseId: plan.matter._id, _id: { $in: retiredTaskIds } }, { session });
        // Retain every original financial snapshot under an archive identity.
        // The two templates reuse key_action_N, so leaving those identities live
        // would attach the old activity's ledger/rate to an unrelated new action.
        const ledgerChanges = fresh.ledger.map(entry => {
          const archiveKey = `archived:${migrationId}:${entry.keyActionKey}`;
          return { updateOne: { filter: { _id: entry._id, caseId: plan.matter._id }, update: { $set: {
            entryKey: `${MATTER_ID}:${archiveKey}:${entry.staffKey}:${entry.assignmentRole}`, keyActionKey: archiveKey,
            originalEntryKey: entry.entryKey, originalKeyActionKey: entry.keyActionKey, workflowMigrationId: migrationId,
            supersededByEntryKey: `workflow-migration:${migrationId}`,
          } } } };
        });
        if (ledgerChanges.length) {
          const result = await db.collection('staffearningsledgers').bulkWrite(ledgerChanges, { session });
          assert.equal(result.matchedCount, fresh.ledger.length);
        }
        // All current identities are new after the archive. Generate their
        // inputs with the production earnings engine and insert in one batch
        // so the transaction also fits within Atlas's lifetime across a WAN.
        const { loadEarningRows } = require('../dist/services/earningSnapshotService');
        const { buildLedgerEntryKey } = require('../dist/utils/staffEarningsLedger');
        const Ledger = require('../dist/models/staffEarningsLedgerModel').default;
        const earningRows = await loadEarningRows([MATTER_ID], session);
        const newEntries = earningRows.filter(row => row.completionAt).map(row => {
          const doc = new Ledger({ ...row, entryKey: buildLedgerEntryKey(row), revision: 1,
            recordedBy: 'Authorized workflow migration; original activity times and rates carried forward',
            createdAt: new Date(), updatedAt: new Date() });
          const invalid = doc.validateSync(); if (invalid) throw invalid;
          return doc.toObject();
        });
        if (newEntries.length) await db.collection('staffearningsledgers').insertMany(newEntries, { session });
        await db.collection('auditlogs').insertOne({ caseId: plan.matter._id, actorName: 'Authorized case workflow migration',
          action: 'WORKFLOW_TEMPLATE_ALIGNED', message: 'Changed this matter from Labour to Legal Opinion; equivalent approved work carried forward using standard Legal Opinion weights',
          detail: JSON.stringify({ migrationId: String(migrationId), oldTemplateId: OLD_TEMPLATE_ID, templateId: TARGET_ID,
            previousProgress: plan.matter.workflowProgress.percent, progress: plan.percent, mappings: plan.mappings,
            assigneesPreserved: true, originalActionsArchived: plan.original.steps.length, financialSnapshotsArchived: fresh.ledger.length }), createdAt: new Date() }, { session });
        const check = await inspect(db, session);
        assert.equal(check.matters[0].workflowProgress.percent, plan.percent);
        assert.deepEqual(check.matters[0].caseAssignments, plan.matter.caseAssignments);
        assert.equal(check.matters[0].assignedTo, plan.matter.assignedTo);
        assert.equal(hash(check.legalOpinionTemplates[0]), hash(plan.template), 'Shared template must remain unchanged');
        assert.equal(check.workflows[0].steps.length, 33);
        assert.equal(check.tasks.filter(t => t.workflowStepKey).length, 33);
        assert.equal(check.ledger.filter(e => String(e.workflowMigrationId) === String(migrationId)).length, fresh.ledger.length);
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', wtimeoutMS: 15000 }, maxCommitTimeMS: 15000 });
    } finally { await session.endSession(); }
    const after = await inspect(db);
    fs.writeFileSync(path.join(folder, `coffee-legal-opinion-after-${Date.now()}.ejson`), EJSON.stringify(after, null, 2));
    console.log(JSON.stringify({ applied: true, caseNo: after.matters[0].caseNo, workflow: after.matters[0].workflow,
      progress: after.matters[0].workflowProgress.percent, completedActions: after.workflows[0].steps.filter(s => s.status === 'Completed').length,
      activeActions: after.workflows[0].steps.length, assignees: after.matters[0].caseAssignments, migrationId: String(migrationId) }));
  } finally { await mongoose.disconnect(); }
}
module.exports = { buildPlan, EQUIVALENTS, main };
if (require.main === module) main().catch(error => { console.error(String(error.message).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[redacted]')); process.exitCode = 1; });
