/**
 * Complete every section whose checklist is fully checked, across all matters.
 *
 * Reported issue: sections showed "Step: Done" (every Key Action ticked) while
 * the step itself stayed "In Progress", because the big completion checkbox can
 * only be ticked by users with matter-management permission — interns and
 * associates can only tick the Key Actions. Ticking the last Key Action now
 * completes the section automatically; this script clears that state on the
 * matters that already have it.
 *
 * Per open matter (closed/completed matters are never touched):
 * - walks the sections in order and completes every section whose Key Actions
 *   are all ticked and that is still 'Not Started' / 'In Progress';
 * - stops at the first section that still has pending Key Actions — later
 *   sections stay untouched because the workflow is sequential;
 * - sections awaiting review or approval, completed sections and sections
 *   without Key Actions are left exactly as they are;
 * - re-points the matter's current section to the first remaining section and
 *   synchronises workflow progress (a matter whose last section completes is
 *   closed, exactly as if the big checkbox had been ticked manually);
 * - writes one WORKFLOW_STEP_COMPLETED audit entry per completed section with
 *   actor "System (auto-complete)".
 *
 * Default is a dry run. Apply with --apply:
 *   npx tsx src/scripts/autoCompleteCheckedSteps.ts
 *   npx tsx src/scripts/autoCompleteCheckedSteps.ts --apply
 *   npm run autocomplete:steps            (dry run)
 *   npm run autocomplete:steps:apply      (repair)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import {
  autoCompleteFullyCheckedSteps,
  isWorkflowInstanceCompleted,
} from '../controllers/workflowController';
import { isStepChecklistReadyToAutoComplete } from '../utils/workflowCompute';

const AUTO_COMPLETE_ACTOR = { actorName: 'System (auto-complete)' };

const isTerminalMatter = (caseDoc: any, inst: any) =>
  String(caseDoc?.status || '').trim().toLowerCase() === 'closed' ||
  String(caseDoc?.workflowProgress?.status || '').trim() === 'Completed' ||
  isWorkflowInstanceCompleted(inst);

type RepairLine = {
  caseNo: string;
  parties: string;
  completed: string[];
  blockedBy?: string | undefined;
  closesMatter: boolean;
};

(async () => {
  const apply = process.argv.includes('--apply');
  await connectDB();

  const caseSummaries: any[] = await Case.find({}).select('_id caseNo parties').lean();
  const instances: any[] = await WorkflowInstance.find({});
  const instancesByCase = new Map(instances.map((inst: any) => [String(inst.caseId), inst]));

  let scanned = 0;
  let withoutInstance = 0;
  let terminalSkipped = 0;
  let alreadyConsistent = 0;
  const repairs: RepairLine[] = [];

  for (const summary of caseSummaries) {
    scanned += 1;
    const inst: any = instancesByCase.get(String(summary._id));
    if (!inst) {
      withoutInstance += 1;
      continue;
    }
    const caseDoc: any = await Case.findById(summary._id);
    if (!caseDoc) {
      withoutInstance += 1;
      continue;
    }
    if (isTerminalMatter(caseDoc, inst)) {
      terminalSkipped += 1;
      continue;
    }

    // Plan the same ordered walk the server performs: complete every section
    // whose Key Actions are all ticked, stop at the first section that still
    // has pending Key Actions or is awaiting review/approval.
    const ordered: any[] = (Array.isArray(inst.steps) ? inst.steps : [])
      .slice()
      .sort((a: any, b: any) => (a?.order || 0) - (b?.order || 0));

    const completedKeys = new Set<string>();
    const completedDetails: string[] = [];
    let blockedBy: string | undefined;

    for (const step of ordered) {
      if (String(step?.status || '') === 'Completed') continue;
      if (!isStepChecklistReadyToAutoComplete(step)) {
        blockedBy = `${String(step?.stepKey || '')} :: ${String(step?.title || '')}`.trim();
        break;
      }
      completedKeys.add(String(step?.stepKey || ''));
      completedDetails.push(`${String(step?.stepKey || '')} :: ${String(step?.title || '')}`.trim());
    }

    if (!completedDetails.length) {
      alreadyConsistent += 1;
      continue;
    }

    const remainingOpen = ordered.filter(
      (step: any) =>
        String(step?.status || '') !== 'Completed' && !completedKeys.has(String(step?.stepKey || ''))
    );
    const closesMatter = remainingOpen.length === 0;

    if (apply) {
      // The shared controller pass completes the sections in order, re-points
      // currentStepKey and syncs case progress — a matter whose last section
      // completes is closed, exactly like the manual big checkbox.
      const appliedKeys = await autoCompleteFullyCheckedSteps(AUTO_COMPLETE_ACTOR, caseDoc, inst);
      if (appliedKeys.length !== completedKeys.size) {
        console.warn(
          `  ${String(caseDoc?.caseNo || summary._id)}: planned ${completedKeys.size} section(s) but completed ${appliedKeys.length}.`
        );
      }
    }

    repairs.push({
      caseNo: String(caseDoc?.caseNo || summary._id),
      parties: String(caseDoc?.parties || '').slice(0, 40),
      completed: completedDetails,
      blockedBy,
      closesMatter,
    });
  }

  console.log('');
  console.log(
    `Scanned ${scanned} matter(s): ${repairs.length} need repair, ${alreadyConsistent} already consistent, ` +
      `${terminalSkipped} closed/completed (left untouched), ${withoutInstance} without a workflow instance.`
  );
  console.log(
    apply
      ? 'Applied changes (report below):'
      : 'Planned changes (run with --apply to repair):'
  );

  for (const line of repairs) {
    console.log(
      `  ${line.caseNo} | ${line.parties} | completes ${line.completed.length} fully checked section(s)` +
        `${line.blockedBy ? ` | stops at pending section: ${line.blockedBy}` : ''}` +
        `${line.closesMatter ? ' | matter workflow completes (case closes)' : ''}`
    );
    for (const completed of line.completed.slice(0, 6)) console.log(`      completed: ${completed}`);
    if (line.completed.length > 6) console.log(`      ... and ${line.completed.length - 6} more`);
  }

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('Auto-complete repair failed:', error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
