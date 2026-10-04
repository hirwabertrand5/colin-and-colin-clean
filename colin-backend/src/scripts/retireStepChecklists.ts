/**
 * Retire the per-step sub-checklist from the live workflow data.
 *
 * Reported issue: inside a Key Action card (Case Workspace Overview / Case
 * Management) a nested "Key Actions" list was rendered that is not part of the
 * workflow template a user maintains in Templates settings. That list was the
 * retired per-step sub-checklist (`step.actions`), still copied from the seeds
 * into every case. This script removes it for good:
 *
 * 1. a step whose stored checklist is fully ticked and that is still in the
 *    working lifecycle ("Not Started" / "In Progress") is COMPLETED first, so
 *    work that was fully checked keeps its checked state;
 * 2. every remaining checklist item is removed from the step (`actions: []`):
 *    ticked items are archived on the instance (`archivedActions`) with their
 *    text, tick and timestamp, unticked items are discarded;
 * 3. templates lose their retired `actions` arrays as well, so new matters are
 *    created without the retired checklist.
 *
 * Closed matters are included, and their ticked items are archived first — no
 * finished work is destroyed. The script is idempotent: a second run reports
 * nothing to do.
 *
 * Usage:
 *   npx tsx src/scripts/retireStepChecklists.ts            (report only)
 *   npx tsx src/scripts/retireStepChecklists.ts --apply    (write)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import WorkflowTemplate from '../models/workflowTemplateModel';
import { writeAudit } from '../services/auditService';
import { isStepChecklistReadyToAutoComplete } from '../utils/workflowCompute';
import { stripManualNumberPrefix } from '../utils/workflowText';
import { updateCaseWorkflowProgress } from '../controllers/workflowController';

const archiveKey = (stepKey: unknown, text: unknown) =>
  `${String(stepKey || '')}::${stripManualNumberPrefix(text).replace(/\s+/g, ' ').trim().toLowerCase()}`;

(async () => {
  const apply = process.argv.includes('--apply');
  await connectDB();

  const instances: any[] = await WorkflowInstance.find({});
  const templates: any[] = await WorkflowTemplate.find({});

  let instancesWithChecklist = 0;
  let stepsCleared = 0;
  let stepsCompleted = 0;
  let actionsArchived = 0;
  let actionsDropped = 0;
  let instancesChanged = 0;
  let templatesWithChecklist = 0;

  for (const inst of instances) {
    const steps: any[] = Array.isArray(inst.steps) ? inst.steps : [];
    const stepsWithChecklist = steps.filter((step: any) => Array.isArray(step?.actions) && step.actions.length > 0);
    if (!stepsWithChecklist.length) continue;
    instancesWithChecklist += 1;

    const archivedByKey = new Map<string, any>();
    for (const action of Array.isArray(inst.archivedActions) ? inst.archivedActions : []) {
      const key = archiveKey(action?.stepKey, action?.text);
      if (key !== '::') archivedByKey.set(key, action);
    }

    let completeAnyStep = false;
    for (const step of stepsWithChecklist) {
      stepsCleared += 1;
      actionsArchived += step.actions.filter((action: any) => action?.done).length;
      actionsDropped += step.actions.filter((action: any) => !action?.done).length;
      if (isStepChecklistReadyToAutoComplete(step)) {
        stepsCompleted += 1;
        completeAnyStep = true;
      }
    }

    if (!apply) continue;

    for (const step of stepsWithChecklist) {
      // Keep the checked state of fully-completed checklists before retiring
      // the checklist itself.
      if (isStepChecklistReadyToAutoComplete(step)) {
        step.status = 'Completed';
        step.completedAt = step.completedAt || new Date();
      }
      for (const action of step.actions) {
        const text = stripManualNumberPrefix(String(action?.text || ''));
        if (!text || !action?.done) continue;
        const key = archiveKey(step.stepKey, text);
        if (!key || key === '::' || archivedByKey.has(key)) continue;
        archivedByKey.set(key, {
          stepKey: String(step.stepKey || ''),
          stepTitle: String(step.title || ''),
          text,
          done: true,
          ...(action?.doneAt ? { doneAt: action.doneAt } : {}),
          reason: 'sub-checklist-retired',
          archivedAt: new Date(),
        });
      }
      step.actions = [];
    }

    if (steps.length > 0 && steps.every((step: any) => String(step?.status || '') === 'Completed')) {
      inst.status = 'Completed';
    }

    inst.archivedActions = Array.from(archivedByKey.values());
    await inst.save();
    await inst.collection.updateOne(
      { _id: inst._id },
      { $set: { steps: inst.steps, status: inst.status, archivedActions: inst.archivedActions } }
    );
    instancesChanged += 1;

    // Completing a formerly fully-checked step changes the matter's earned
    // progress, so resync the case exactly like the workflow engine does.
    if (completeAnyStep) {
      const caseDoc: any = await Case.findById(inst.caseId);
      if (caseDoc) await updateCaseWorkflowProgress(caseDoc, inst);
    }

    await writeAudit({
      caseId: String(inst.caseId),
      actorName: 'System (checklist retirement)',
      action: 'WORKFLOW_STEP_UPDATED',
      message: 'Retired the per-step sub-checklist',
      detail:
        `${stepsWithChecklist.length} step(s) cleaned` +
        (completeAnyStep ? `, ${stepsCompleted} fully-checked step(s) completed` : '') +
        `, ${Array.from(archivedByKey.values()).length} ticked item(s) archived`,
    });
  }

  for (const template of templates) {
    const steps: any[] = Array.isArray(template.steps) ? template.steps : [];
    const carrying = steps.some((step: any) => Array.isArray(step?.actions) && step.actions.length > 0);
    if (!carrying) continue;
    templatesWithChecklist += 1;
    if (!apply) continue;
    for (const step of steps) step.actions = [];
    await template.save();
  }

  console.log('');
  console.log('================ PER-STEP SUB-CHECKLIST RETIREMENT ================');
  console.log(`Instances scanned: ${instances.length} | templates scanned: ${templates.length}`);
  console.log(`Instances still carrying the retired checklist: ${instancesWithChecklist}`);
  console.log(`- steps to clean/cleaned:            ${stepsCleared}`);
  console.log(`- ticked items to archive/archived:  ${actionsArchived}`);
  console.log(`- unticked items to drop/dropped:    ${actionsDropped}`);
  console.log(`- fully-checked steps completed:     ${stepsCompleted}`);
  console.log(`Templates still carrying it:         ${templatesWithChecklist}`);
  if (apply) {
    console.log(`Applied: ${instancesChanged} instance(s) rewritten, ${templatesWithChecklist} template(s) cleaned.`);
  } else {
    console.log('Report only — re-run with --apply to retire the checklist.');
  }

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('Retirement failed:', error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});

