/**
 * Align every live case workflow with its canonical template.
 *
 * Reported issue: after creating a case, the Case Workspace showed Key Actions
 * that did not match the workflow selected for its "Suggested Matter Type" in
 * Templates settings. Root cause: a matter type can exist in more than one
 * template document (older seeds, re-imports, restored snapshots), and cases
 * kept pointing at the deleted/older/duplicate copy of the workflow.
 *
 * This script:
 * - re-links each open case workflow to the canonical template for its matter
 *   type (published, newest version, most recently updated);
 * - rebuilds the case checklist from that template so the Case Workspace shows
 *   exactly the Key Actions defined in Templates settings;
 * - keeps every tick, deadline, completed step and extension (ticks follow the
 *   action text, never a position);
 * - drops only untouched leftovers of the old/superseded template;
 * - syncs Suggested Matter Type / matterType / caseType with the template so
 *   every screen shows the same values.
 *
 * Closed/completed matters are never touched: their workflow is a terminal
 * snapshot. The script is idempotent — a second run changes nothing.
 *
 * Completed work that belonged to the old template (for example a case that was
 * started on a flattened 60-step copy of a workflow) is preserved by default.
 * Pass --prune-legacy to remove it as well, so the checklist matches the
 * template 1:1; every pruned item is written to the case audit log.
 *
 * Usage:
 *   npx tsx src/scripts/alignCaseWorkflowsWithTemplates.ts                     (report only)
 *   npx tsx src/scripts/alignCaseWorkflowsWithTemplates.ts --apply             (repair)
 *   npx tsx src/scripts/alignCaseWorkflowsWithTemplates.ts --apply --prune-legacy
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import { reconcileInstanceTemplateWithCanonical } from '../controllers/workflowController';

type AlignmentLine = {
  caseId: string;
  caseNo: string;
  parties: string;
  template: string;
  addedSteps: number;
  addedActions: number;
  droppedSteps: string[];
  droppedActions: string[];
  keptLegacySteps: string[];
  keptLegacyActions: string[];
};

const isTerminalMatter = (caseDoc: any, inst: any) =>
  String(caseDoc?.status || '').trim().toLowerCase() === 'closed' ||
  String(caseDoc?.workflowProgress?.status || '').trim() === 'Completed' ||
  String(inst?.status || '').trim() === 'Completed';

(async () => {
  const apply = process.argv.includes('--apply');
  const pruneLegacy = process.argv.includes('--prune-legacy');
  await connectDB();

  const caseSummaries: any[] = await Case.find({}).select('_id caseNo parties').lean();
  const instances: any[] = await WorkflowInstance.find({}).select('caseId').lean();
  const caseIdsWithInstance = new Set(instances.map((inst: any) => String(inst.caseId)));

  let scanned = 0;
  let alignedAlready = 0;
  let withoutInstance = 0;
  let terminalSkipped = 0;
  let failed = 0;
  const changes: AlignmentLine[] = [];

  for (const summary of caseSummaries) {
    scanned += 1;
    if (!caseIdsWithInstance.has(String(summary._id))) {
      withoutInstance += 1;
      continue;
    }

    const [caseDoc, inst]: any[] = await Promise.all([
      Case.findById(summary._id),
      WorkflowInstance.findOne({ caseId: summary._id }),
    ]);
    if (!caseDoc || !inst) {
      withoutInstance += 1;
      continue;
    }
    if (isTerminalMatter(caseDoc, inst)) {
      terminalSkipped += 1;
      continue;
    }

    let result: any = null;
    try {
      result = await reconcileInstanceTemplateWithCanonical(caseDoc, inst, {
        force: true,
        dryRun: !apply,
        pruneLegacy,
      });
    } catch (error: any) {
      failed += 1;
      console.log(`  FAIL  ${caseDoc.caseNo || String(caseDoc._id)} :: ${error?.message || 'alignment failed'}`);
      continue;
    }

    if (!result) {
      alignedAlready += 1;
      continue;
    }

    changes.push({
      caseId: String(caseDoc._id),
      caseNo: String(caseDoc.caseNo || caseDoc._id),
      parties: String(caseDoc.parties || '').slice(0, 40),
      template: `${result.template?.name || ''} (${result.template?.matterType || ''})`,
      addedSteps: result.summary.addedTemplateSteps,
      addedActions: result.summary.addedActions,
      droppedSteps: result.summary.droppedSteps,
      droppedActions: result.summary.droppedActions,
      keptLegacySteps: result.summary.keptLegacySteps,
      keptLegacyActions: result.summary.keptLegacyActions,
    });
  }

  console.log('');
  console.log(`Scanned ${scanned} case(s): ${changes.length} need alignment, ${alignedAlready} already aligned, ` +
    `${terminalSkipped} closed/completed (left untouched), ${withoutInstance} without a workflow instance, ${failed} failed.`);
  console.log(apply ? 'Applied changes (report below):' : 'Planned changes (run with --apply to repair):');
  if (pruneLegacy) {
    console.log('Mode: --prune-legacy — completed work from superseded templates is removed and recorded in the case audit log.');
  }

  for (const line of changes) {
    console.log(
      `  ${line.caseNo} | ${line.parties} | -> ${line.template} | +${line.addedSteps} step(s) +${line.addedActions} key action(s) ` +
        `| -${line.droppedSteps.length} stale step(s) -${line.droppedActions.length} stale key action(s) ` +
        `| kept legacy: ${line.keptLegacySteps.length} step(s), ${line.keptLegacyActions.length} key action(s)`
    );
    for (const dropped of line.droppedActions.slice(0, 3)) console.log(`      dropped key action: ${dropped}`);
    for (const kept of line.keptLegacySteps.slice(0, 3)) console.log(`      kept completed legacy step: ${kept}`);
  }

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('Alignment failed:', error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
