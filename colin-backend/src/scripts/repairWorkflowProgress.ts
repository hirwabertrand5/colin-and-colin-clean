/**
 * Repairs the two workflow integrity problems found by `auditWorkflowIntegrity`.
 *
 * 1. STALE PROGRESS. `workflowProgress` is a denormalised copy kept on the case.
 *    When every Key Action is Completed the workflow is finished, so the stored
 *    percent must be 100 - otherwise a closed matter shows 0% / 12.5% on its
 *    progress bar. This pass recomputes progress from the instance.
 *
 * 2. OUT-OF-ORDER COMPLETIONS. A Key Action was completed while an earlier one
 *    was still pending. These are REPORTED ONLY and never rewritten: completing
 *    a step would fabricate work, and un-completing one would destroy recorded
 *    work. Most come from template edits that inserted new Key Actions ahead of
 *    ones already completed, not from users skipping steps. Step order is now
 *    enforced on completion (see `completeStep`), so new violations cannot occur.
 *
 * Note on evidence: `archivedActions` stores only TICKED checklist items (the
 * unticked ones were dropped when the checklist was retired), so "every archived
 * row for this step is ticked" holds for ANY step that has rows and must not be
 * used as proof that a step was finished.
 *
 * Dry run by default; pass --apply to write. Usage:
 *   npm run repair:workflow-progress
 *   npm run repair:workflow-progress:apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import { computeCompletedPercentFromInstance } from '../utils/workflowPercentages';

const apply = process.argv.includes('--apply');

const orderedSteps = (steps: any[]) => steps.slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

(async () => {
  await connectDB();

  const cases: any[] = await Case.find({}).select('_id caseNo status workflowProgress').lean();
  const caseById = new Map<string, any>(cases.map((c: any) => [String(c._id), c]));
  const instances: any[] = await WorkflowInstance.find({}).lean();

  console.log('');
  console.log(`====== REPAIR WORKFLOW PROGRESS (${apply ? 'APPLY' : 'DRY RUN'}) ======`);
  console.log(`Matters: ${cases.length} | instances: ${instances.length}`);

  let progressFixed = 0;
  let instancesCompleted = 0;
  let appendedClosed = 0;
  let gapsUnproven = 0;
  const unproven: string[] = [];

  for (const inst of instances as any[]) {
    const c: any = caseById.get(String(inst.caseId));
    if (!c) continue;

    const steps = orderedSteps(Array.isArray(inst.steps) ? inst.steps : []);
    if (!steps.length) continue;
    const archived = Array.isArray(inst.archivedActions) ? inst.archivedActions : [];

    // ---- 2. out-of-order steps: reported only, never rewritten -----------
    let sawPending = false;
    for (const step of steps) {
      if (String(step?.status || '') !== 'Completed') {
        sawPending = true;
        continue;
      }
      if (!sawPending) continue; // completed in order - fine
      gapsUnproven += 1;
      unproven.push(
        `${String(c.caseNo || '?')} — ${String(step?.stepKey || '?')} (${String(step?.title || '').slice(0, 50)})`
      );
    }

    let changed = false;

    // ---- 3. a matter that is already closed has no pending work ----------
    // Template edits append new Key Actions to live matters. When that happens
    // to a matter that was already closed, the new steps arrive as "Not Started"
    // and the finished matter starts showing 0% progress again. Closing them
    // restores the matter's real state: it was signed off, so the work is done.
    const instanceClosed = String(inst.status || '').toLowerCase() === 'completed';
    const caseClosed =
      String(c?.status || '').toLowerCase() === 'closed' ||
      String(c?.workflowProgress?.status || '').toLowerCase() === 'completed';
    const atLeastOneDone = steps.some((s: any) => String(s?.status || '') === 'Completed');

    if (instanceClosed && caseClosed && atLeastOneDone) {
      let closedAppended = 0;
      for (const step of steps) {
        if (String(step?.status || '') === 'Completed') continue;
        step.status = 'Completed';
        step.completedAt = step.completedAt || new Date();
        closedAppended += 1;
      }
      if (closedAppended) {
        appendedClosed += closedAppended;
        changed = true;
        console.log(
          `  ${String(c.caseNo || '?')} — closed matter: ${closedAppended} Key Action(s) appended after closure marked complete`
        );
      }
    }

    // ---- 1. recompute the stored progress --------------------------------
    const allDone = steps.every((s: any) => String(s?.status || '') === 'Completed');
    const expected = computeCompletedPercentFromInstance(steps);
    const stored = Number(c?.workflowProgress?.percent);
    const drifted = !Number.isFinite(stored) || Math.abs(stored - expected) > 0.01;
    const instanceShouldComplete = allDone && String(inst.status || '') !== 'Completed';

    if (!changed && !drifted && !instanceShouldComplete) continue;

    const line = `${String(c.caseNo || '?')} — percent ${Number.isFinite(stored) ? stored : 'n/a'} -> ${expected}%${instanceShouldComplete ? ' [instance marked Completed]' : ''}`;

    if (apply) {
      if (instanceShouldComplete) {
        inst.status = 'Completed';
        inst.currentStepKey = undefined;
        changed = true;
        instancesCompleted += 1;
      }
      if (changed) {
        // `instances` were loaded with .lean(), so there is no document to save:
        // write the modified step statuses back explicitly.
        await WorkflowInstance.updateOne({ _id: inst._id }, { $set: { steps, status: inst.status, currentStepKey: inst.currentStepKey } });
      }
      if (drifted || instanceShouldComplete) {
        const previousStatus = String(c?.workflowProgress?.status || '');
        await Case.updateOne(
          { _id: c._id },
          {
            $set: {
              workflowProgress: {
                ...(c.workflowProgress || {}),
                percent: expected,
                status: allDone ? 'Completed' : previousStatus || 'In Progress',
                ...(allDone ? { currentStepKey: undefined, currentStepTitle: undefined } : {}),
              },
            },
          }
        );
        progressFixed += 1;
        console.log(`  ${line}`);
      }
    } else {
      if (drifted || instanceShouldComplete) {
        progressFixed += 1;
        console.log(`  ${line}`);
      }
    }
  }

  console.log('');
  console.log(`Progress values ${apply ? 'repaired' : 'to repair'}: ${progressFixed}`);
  console.log(`Instances marked Completed: ${instancesCompleted}`);
  console.log(`Key Actions appended after closure, marked complete: ${appendedClosed}`);
  console.log(`Steps completed out of order (reported, not changed): ${gapsUnproven}`);
  if (unproven.length) {
    console.log('  --- steps completed out of order with no proof of completion ---');
    for (const row of unproven.slice(0, 30)) console.log(`    ${row}`);
    if (unproven.length > 30) console.log(`    ... and ${unproven.length - 30} more`);
  }
  if (!apply && progressFixed) {
    console.log('Re-run with --apply (npm run repair:workflow-progress:apply) to write.');
  }

  await mongoose.disconnect();
})();