/** Read-only full source/timing/lifecycle/audit comparison for the requested matter. */
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { EJSON } = require('bson');
const { connect, readSnapshot } = require('./inspectCoffeeSequence.cjs');
const { resolveWorkflowWorkTime } = require('../dist/utils/workflowWorkTime');
const { orderWorkflowSteps } = require('../dist/utils/workflowSchedule');
const { computeStepWorkTimelinessScore } = require('../dist/utils/caseEarnedFees');

async function main() {
  await connect();
  try {
    const db = mongoose.connection.db;
    const snapshot = await readSnapshot(db);
    snapshot.audits = await db.collection('auditlogs').find({ caseId: snapshot.matter._id }).sort({ _id: 1 }).toArray();
    const folder = path.resolve(__dirname, '../.local-operations'); fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `coffee-full-comparison-${Date.now()}.ejson`);
    fs.writeFileSync(file, EJSON.stringify(snapshot, null, 2));
    const comparison = steps => steps.filter(step => step.submittedAt || step.carriedWork?.submittedAt).map(step => {
      const work = resolveWorkflowWorkTime(step);
      return { key: step.stepKey, status: step.status, submittedAt: work.at, dueAt: step.dueAt,
        result: work.at && step.dueAt ? +work.at <= +new Date(step.dueAt) ? 'on-time' : 'late' : 'unknown',
        timelinessScore: computeStepWorkTimelinessScore(step),
        sourceKeys: step.carriedWork?.sourceStepKeys };
    });
    const ordered = orderWorkflowSteps(snapshot.workflow.steps, snapshot.template);
    console.log(JSON.stringify({ snapshot: file, caseNo: snapshot.matter.caseNo,
      original: comparison(snapshot.workflow.archivedSteps || []), current: comparison(ordered),
      firstUnticked: ordered.find(step => ['Not Started','In Progress'].includes(step.status))?.stepKey,
      instanceReviewPointer: snapshot.workflow.currentStepKey, matterWorkPointer: snapshot.matter.workflowProgress.currentStepKey,
      states: Object.fromEntries(['Not Started','In Progress','Done','Awaiting Review','Awaiting Approval','Completed'].map(status => [status, ordered.filter(s => s.status === status).length])),
      taskMismatch: snapshot.tasks.filter(task => {
        const step = ordered.find(s => s.stepKey === task.workflowStepKey);
        return step && ((step.status === 'Completed' && task.status !== 'Completed') || (step.status === 'Done' && task.status === 'Not Started'));
      }).map(task => ({ key: task.workflowStepKey, taskStatus: task.status })),
      auditCount: snapshot.audits.length, auditBytes: Buffer.byteLength(EJSON.stringify(snapshot.audits)),
    }, null, 2));
  } finally { await mongoose.disconnect(); }
}
main().catch(error => { console.error(String(error.message).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[redacted]')); process.exitCode = 1; });
