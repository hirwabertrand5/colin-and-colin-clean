/** Read-only inspection. Local snapshot is ignored by Git; never prints credentials. */
const mongoose = require('mongoose');
const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('No configured MongoDB connection is available.');
  require('node:dns').setServers(['8.8.8.8', '1.1.1.1']);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, autoIndex: false });
  try {
    const db = mongoose.connection.db;
    const matters = await db.collection('cases').find({ $or: [{ parties: /rwanda.*farmers.*coffee/i }, { clientName: /rwanda.*farmers.*coffee/i }] }).toArray();
    const templates = await db.collection('workflowtemplates').find({ $or: [{ name: /legal.*opinion/i }, { matterType: /legal.*opinion/i }] }).toArray();
    const ids = matters.map(m => m._id);
    const workflows = await db.collection('workflowinstances').find({ caseId: { $in: ids } }).toArray();
    const linkedIds = workflows.map(w => w.templateId).filter(Boolean);
    const linkedTemplates = await db.collection('workflowtemplates').find({ _id: { $in: linkedIds } }).toArray();
    const tasks = await db.collection('tasks').find({ caseId: { $in: ids } }).toArray();
    const ledger = await db.collection('staffearningsledgers').find({ caseId: { $in: ids } }).toArray();
    const audits = await db.collection('auditlogs').find({ caseId: { $in: ids } }).sort({ createdAt: -1 }).limit(30).toArray();
    const independent = await db.collection('independenttasks').find({ relatedMatterId: { $in: ids } }).toArray();
    const snapshot = { inspectedAt: new Date().toISOString(), matters, workflows, linkedTemplates, legalOpinionTemplates: templates, tasks, ledger, audits, independent };
    const folder = path.resolve(__dirname, '../.local-operations'); fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `coffee-workflow-inspection-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
    const steps = list => (list || []).map(s => ({ key: s.key || s.stepKey, title: s.title, stage: s.stageKey, stagePercentage: s.stagePercentage,
      percentage: s.percentage, status: s.status, startAt: s.startAt, dueAt: s.dueAt, doneAt: s.doneAt,
      submittedAt: s.submittedAt, reviewedAt: s.reviewedAt, completedAt: s.completedAt,
      actionTicks: (s.actions || []).filter(a => a.done).length, actions: (s.actions || []).length, tpaSnapshots: (s.tpaSnapshots || []).length }));
    console.log(JSON.stringify({ snapshot: file,
      matters: matters.map(m => ({ id: m._id, caseNo: m.caseNo, parties: m.parties, status: m.status, assignedTo: m.assignedTo,
        caseAssignments: m.caseAssignments, workflow: m.workflow, matterType: m.matterType, workflowTemplateId: m.workflowTemplateId,
        legalServicePath: m.legalServicePath, progress: m.workflowProgress, updatedAt: m.updatedAt })),
      workflows: workflows.map(w => ({ id: w._id, templateId: w.templateId, status: w.status, currentStepKey: w.currentStepKey, steps: steps(w.steps) })),
      legalOpinionTemplates: templates.map(t => ({ id: t._id, name: t.name, matterType: t.matterType, caseType: t.caseType, status: t.status, published: t.published, stages: t.stages, steps: steps(t.steps) })),
      linkedTemplates: linkedTemplates.map(t => ({ id: t._id, name: t.name, matterType: t.matterType })),
      tasks: tasks.map(t => ({ id: t._id, title: t.title, stepKey: t.workflowStepKey, status: t.status, completedAt: t.completedAt, stages: t.taskStages })),
      ledgerCount: ledger.length, independentCount: independent.length,
      recentAudits: audits.slice(0, 10).map(a => ({ action: a.action, message: a.message, detail: a.detail, at: a.createdAt })),
    }, null, 2));
  } finally { await mongoose.disconnect(); }
}
main().catch(error => {
  const message = String(error.message || error).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[database connection redacted]');
  console.error(`${error.code || error.name}: ${message}`); process.exitCode = 1;
});
