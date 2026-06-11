import 'dotenv/config';
import connectDB from '../config/db';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import { updateCaseWorkflowProgress } from '../controllers/workflowController';

const run = async () => {
  await connectDB();

  console.log('Scanning cases for workflow mismatches...');

  const cases = await Case.find({}).lean();
  const mismatches: any[] = [];

  for (const c of cases) {
    const inst: any = await WorkflowInstance.findOne({ caseId: (c as any)._id });
    const caseStatus = String((c as any).status || '').trim();
    const wfProgressStatus = (c as any).workflowProgress?.status || '';

    if (inst) {
      const instStatus = inst.status || '';
      if (instStatus === 'Completed' && wfProgressStatus !== 'Completed' && caseStatus.toLowerCase() !== 'closed') {
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
    console.log('Applying fixes where possible (syncing case state from workflow instance)...');
    const applied: any[] = [];
    for (const m of mismatches) {
      const cDoc: any = await Case.findById(m.caseId);
      if (!cDoc) continue;
      const inst: any = await WorkflowInstance.findOne({ caseId: cDoc._id });
      if (!inst) continue;
      await updateCaseWorkflowProgress(cDoc, inst);
      applied.push({ caseId: String(cDoc._id), caseNo: cDoc.caseNo, newStatus: cDoc.status, newWorkflowProgress: cDoc.workflowProgress?.status });
    }
    console.log(`Applied fixes to ${applied.length} cases.`);
    for (const a of applied) console.log('-', JSON.stringify(a));
  } else {
    console.log('No fixes applied. Re-run with --fix to apply safe fixes where a workflow instance exists.');
  }

  process.exit(0);
};

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
