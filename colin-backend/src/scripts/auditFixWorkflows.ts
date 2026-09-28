import 'dotenv/config';
import connectDB from '../config/db';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import { isWorkflowInstanceCompleted, updateCaseWorkflowProgress } from '../controllers/workflowController';
import {
  loadWorkflowTemplatesById,
  restoreWorkflowDataGaps,
  scanWorkflowDataGaps,
} from './workflowDataRestore';

const run = async () => {
  await connectDB();

  console.log('Scanning cases for workflow mismatches...');

  const cases = await Case.find({}).lean();
  const caseIds = cases.map((caseDoc: any) => caseDoc._id);
  const instances = caseIds.length
    ? await WorkflowInstance.find({ caseId: { $in: caseIds } }).lean()
    : [];
  const instanceByCaseId = new Map(instances.map((inst: any) => [String(inst.caseId), inst]));
  const mismatches: any[] = [];

  for (const c of cases) {
    const inst: any = instanceByCaseId.get(String((c as any)._id));
    const caseStatus = String((c as any).status || '').trim();
    const wfProgressStatus = (c as any).workflowProgress?.status || '';

    if (inst) {
      const instStatus = inst.status || '';
      if (instStatus === 'Completed' && (wfProgressStatus !== 'Completed' || caseStatus.toLowerCase() !== 'closed')) {
        mismatches.push({ caseId: (c as any)._id, caseNo: (c as any).caseNo, parties: (c as any).parties, issue: 'Instance Completed but case not closed', instStatus, caseStatus, wfProgressStatus });
        continue;
      }

      if (instStatus !== 'Completed' && (caseStatus.toLowerCase() === 'closed' || wfProgressStatus === 'Completed')) {
        mismatches.push({ caseId: (c as any)._id, caseNo: (c as any).caseNo, parties: (c as any).parties, issue: 'Case Closed but instance not completed', instStatus, caseStatus, wfProgressStatus });
        continue;
      }

      const allStepsCompleted = Array.isArray(inst.steps) && inst.steps.length > 0 && inst.steps.every((s: any) => s.status === 'Completed');
      if (allStepsCompleted && inst.status !== 'Completed') {
        mismatches.push({ caseId: (c as any)._id, caseNo: (c as any).caseNo, parties: (c as any).parties, issue: 'All steps completed but instance not Completed', instStatus: inst.status });
        continue;
      }
    } else {
      if (caseStatus.toLowerCase() === 'closed' || wfProgressStatus === 'Completed') {
        mismatches.push({ caseId: (c as any)._id, caseNo: (c as any).caseNo, parties: (c as any).parties, issue: 'Case closed/completed but no workflow instance exists', caseStatus, wfProgressStatus });
        continue;
      }
    }
  }

  console.log(`Found ${mismatches.length} mismatches.`);
  for (const m of mismatches) {
    console.log('-', JSON.stringify(m));
  }

  const shouldFix = process.argv.includes('--fix');
  if (shouldFix) {
    console.log('Applying safe fixes for completed workflows...');
    const applied: any[] = [];
    const skipped: any[] = [];
    for (const m of mismatches) {
      const cDoc: any = await Case.findById(m.caseId);
      if (!cDoc) continue;
      const inst: any = await WorkflowInstance.findOne({ caseId: cDoc._id });
      if (!inst) {
        skipped.push({ caseId: String(m.caseId), caseNo: cDoc.caseNo, issue: 'No workflow instance to repair' });
        continue;
      }

      const allStepsCompleted = Array.isArray(inst.steps) && inst.steps.length > 0 && inst.steps.every((step: any) => step.status === 'Completed');
      if (allStepsCompleted && inst.status !== 'Completed') {
        inst.status = 'Completed';
        await inst.save();
      }
      if (!isWorkflowInstanceCompleted(inst)) {
        // A closed case with unfinished workflow data needs a human review;
        // never mark unfinished work complete merely to silence an audit.
        skipped.push({ caseId: String(m.caseId), caseNo: cDoc.caseNo, issue: m.issue });
        continue;
      }
      await updateCaseWorkflowProgress(cDoc, inst);
      applied.push({ caseId: String(cDoc._id), caseNo: cDoc.caseNo, newStatus: cDoc.status, newWorkflowProgress: cDoc.workflowProgress?.status });
    }
    console.log(`Applied fixes to ${applied.length} cases.`);
    for (const a of applied) console.log('-', JSON.stringify(a));
    if (skipped.length) {
      console.log(`Skipped ${skipped.length} case(s) requiring review.`);
      for (const s of skipped) console.log('-', JSON.stringify(s));
    }
  }

  // ---- Missing Key Actions and percentages (restorable from the template) ----
  let scanCases: any[] = cases;
  let scanInstanceByCaseId: Map<string, any> = instanceByCaseId;
  if (shouldFix) {
    // The status repairs above may have closed matters; re-read the records so
    // the data report below never proposes changes to a freshly closed matter.
    scanCases = await Case.find({}).lean();
    const refreshedIds = scanCases.map((caseDoc: any) => caseDoc._id);
    const refreshedInstances = refreshedIds.length
      ? await WorkflowInstance.find({ caseId: { $in: refreshedIds } }).lean()
      : [];
    scanInstanceByCaseId = new Map(refreshedInstances.map((inst: any) => [String(inst.caseId), inst]));
  }

  const shouldRestore = shouldFix || process.argv.includes('--restore');
  const templateById = await loadWorkflowTemplatesById();
  const dataGaps = scanWorkflowDataGaps(scanCases, scanInstanceByCaseId, templateById);
  const recoverableGaps = dataGaps.filter((gap) => !gap.terminal);
  const closedGaps = dataGaps.filter((gap) => gap.terminal);
  const sumOf = (pick: (gap: any) => number) =>
    recoverableGaps.reduce((total, gap) => total + pick(gap), 0);

  console.log('');
  console.log(`Workflow data check: ${dataGaps.length} matter(s) differ from their template.`);
  const restorableTotal =
    sumOf((g) => g.actionsToAdd) +
    sumOf((g) => g.stepPercentagesToFill) +
    sumOf((g) => g.stagePercentagesToFill) +
    sumOf((g) => g.stageTitlesToFill);
  console.log(
    `- ${recoverableGaps.length} open matter(s) were checked against their template: ${sumOf((g) => g.actionsToAdd)} Key Action(s), ` +
      `${sumOf((g) => g.stepPercentagesToFill)} step percentage(s), ${sumOf((g) => g.stagePercentagesToFill)} stage percentage(s), ` +
      `${sumOf((g) => g.stageTitlesToFill)} stage title(s) to restore.`
  );
  if (recoverableGaps.length && restorableTotal === 0) {
    console.log('  (everything restorable has already been restored; see the review list below.)');
  }
  for (const gap of recoverableGaps) {
    console.log(
      '-',
      JSON.stringify({
        caseNo: gap.caseNo,
        parties: gap.parties,
        actionsToAdd: gap.actionsToAdd,
        stepPercentagesToFill: gap.stepPercentagesToFill,
        stagePercentagesToFill: gap.stagePercentagesToFill,
        stageTitlesToFill: gap.stageTitlesToFill,
        samples: gap.samples,
      })
    );
  }
  if (closedGaps.length) {
    console.log(`- ${closedGaps.length} closed/completed matter(s) also differ; they are kept as-is (terminal workflow snapshot).`);
  }
  const reviewGaps = dataGaps.filter(
    (gap) => gap.templateMissing || gap.templateOnlySteps > 0 || gap.zeroPercentagesForReview > 0
  );
  if (reviewGaps.length) {
    console.log(
      `- ${reviewGaps.length} matter(s) need review (missing template, template Key Action(s) absent from the case, or a stored 0% where the workflow defines a value):`
    );
    for (const gap of reviewGaps) {
      console.log(
        '!',
        JSON.stringify({
          caseNo: gap.caseNo,
          templateMissing: gap.templateMissing,
          templateOnlySteps: gap.templateOnlySteps,
          zeroPercentagesForReview: gap.zeroPercentagesForReview,
          samples: gap.samples,
        })
      );
    }
  }

  if (shouldRestore) {
    console.log('');
    console.log('Restoring missing Key Actions and percentages from the templates...');
    const { restored, skipped } = await restoreWorkflowDataGaps(recoverableGaps, templateById);
    console.log(`Restored ${restored.length} matter(s).`);
    for (const entry of restored) console.log('-', JSON.stringify(entry));
    if (skipped.length) {
      console.log(`Left ${skipped.length} matter(s) unchanged:`);
      for (const entry of skipped) console.log('-', JSON.stringify(entry));
    }
  } else {
    console.log('');
    console.log(
      'No changes applied. Re-run with --fix (status repairs + data restoration) or --restore (data restoration only).'
    );
  }

  process.exit(0);
};

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
