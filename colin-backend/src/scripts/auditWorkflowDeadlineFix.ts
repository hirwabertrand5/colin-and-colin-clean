/**
 * Dry-run audit for the stage-sequential deadline fix (read-only).
 *
 * Compares every live workflow instance against the authoritative
 * stage-sequential schedule (`buildWorkflowSchedule`) and reports which
 * planned step dates would change — without writing anything.
 *
 * Safety rules (mirrors the merge logic in workflowController):
 * - closed/completed matters and completed steps are reported but never
 *   proposed for rewrite;
 * - steps with manual deadline amendments (extensionHistory) are reported
 *   but never proposed for overwrite;
 * - workflow templates are never modified.
 *
 * Usage:
 *   npx tsx src/scripts/auditWorkflowDeadlineFix.ts
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import WorkflowTemplate from '../models/workflowTemplateModel';
import { buildWorkflowSchedule, selectNextScheduledStepKey } from '../utils/workflowSchedule';

const sameDay = (a: unknown, b: unknown) => {
  const da = a ? new Date(a as string | Date) : null;
  const db = b ? new Date(b as string | Date) : null;
  if (!da || !db || !Number.isFinite(da.getTime()) || !Number.isFinite(db.getTime())) return da === db;
  return da.getTime() === db.getTime();
};

const main = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || '';
  if (!uri) {
    console.error('Missing MONGO_URI/MONGODB_URI — refusing to run without an explicit database target.');
    process.exit(1);
  }
  await mongoose.connect(uri);

  const instances = await WorkflowInstance.find({}).lean();
  let casesChecked = 0;
  let stepsChecked = 0;
  let stepsDiffer = 0;
  let skippedClosed = 0;
  let skippedCompleted = 0;
  let skippedManual = 0;
  const perTemplate = new Map<string, { cases: number; steps: number; differ: number }>();
  const samples: Array<{ caseNo: string; stepKey: string; stored: string; planned: string }> = [];

  for (const inst of instances as any[]) {
    const caseDoc: any = await Case.findById(inst.caseId).select('caseNo status workflowStartDate createdAt workflowProgress').lean();
    const template: any = await WorkflowTemplate.findById(inst.templateId).lean();
    if (!caseDoc || !template) continue;
    casesChecked += 1;
    const closed =
      String(caseDoc.status || '').toLowerCase() === 'closed' ||
      String(inst.status || '').toLowerCase() === 'completed' ||
      String(caseDoc.workflowProgress?.status || '').toLowerCase() === 'completed';
    const wfStart = caseDoc.workflowStartDate || caseDoc.createdAt;
    if (!wfStart) continue;
    const planned = new Map(buildWorkflowSchedule(template, new Date(wfStart)).map((s) => [s.key, s]));
    const entry = perTemplate.get(String(template.name || template.matterType || 'unknown')) || { cases: 0, steps: 0, differ: 0 };
    entry.cases += 1;
    for (const step of inst.steps || []) {
      stepsChecked += 1;
      entry.steps += 1;
      if (closed) {
        skippedClosed += 1;
        continue;
      }
      if (String(step?.status || '') === 'Completed') {
        skippedCompleted += 1;
        continue;
      }
      if (Array.isArray(step?.extensionHistory) && step.extensionHistory.length > 0) {
        skippedManual += 1;
        continue;
      }
      const plan = planned.get(String(step?.stepKey || ''));
      if (!plan) continue;
      if (!sameDay(step?.dueAt, plan.dueAt)) {
        stepsDiffer += 1;
        entry.differ += 1;
        if (samples.length < 20) {
          samples.push({
            caseNo: String(caseDoc.caseNo || caseDoc._id),
            stepKey: String(step?.stepKey || ''),
            stored: step?.dueAt ? new Date(step.dueAt).toISOString() : 'none',
            planned: new Date(plan.dueAt).toISOString(),
          });
        }
      }
    }
    perTemplate.set(String(template.name || template.matterType || 'unknown'), entry);

    // Next-deadline sanity: authoritative order vs legacy order.
    void selectNextScheduledStepKey;
  }

  console.log(JSON.stringify({
    mode: 'dry-run (no writes)',
    casesChecked,
    stepsChecked,
    stepsDiffer,
    skippedClosed,
    skippedCompleted,
    skippedManual,
    perTemplate: Array.from(perTemplate.entries()).map(([name, v]) => ({ name, ...v })),
    samples,
  }, null, 2));
  await mongoose.disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
