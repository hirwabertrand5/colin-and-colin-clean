/**
 * READ-ONLY audit: did the retired per-step sub-checklist really leave the
 * workflow data?
 *
 * - instances that still carry checklist items on their steps (should be 0);
 * - the archived records of ticked items that were retired (expected);
 * - templates that still carry the retired `actions` arrays (should be 0).
 *
 * It writes nothing. Usage:
 *   npx tsx src/scripts/auditCaseChecklist.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import WorkflowTemplate from '../models/workflowTemplateModel';

(async () => {
  await connectDB();

  const cases: any[] = await Case.find({}).select('_id caseNo parties status').lean();
  const caseById = new Map<string, any>(cases.map((caseDoc: any) => [String(caseDoc._id), caseDoc]));
  const instances: any[] = await WorkflowInstance.find({}).lean();
  const templates: any[] = await WorkflowTemplate.find({}).lean();

  const withChecklist = instances.filter((inst: any) =>
    (inst.steps || []).some((step: any) => Array.isArray(step?.actions) && step.actions.length > 0)
  );
  const withArchive = instances.filter(
    (inst: any) => Array.isArray(inst.archivedActions) && inst.archivedActions.length > 0
  );
  const templatesWithChecklist = templates.filter((template: any) =>
    (template.steps || []).some((step: any) => Array.isArray(step?.actions) && step.actions.length > 0)
  );

  console.log('');
  console.log('================ CASE CHECKLIST AUDIT (read-only) ================');
  console.log(`Instances: ${instances.length} | templates: ${templates.length}`);
  console.log(`Instance steps still carrying the retired checklist: ${withChecklist.length}`);
  for (const inst of withChecklist.slice(0, 10)) {
    const caseDoc: any = caseById.get(String(inst.caseId));
    console.log(`  ${caseDoc?.caseNo || String(inst.caseId)} | ${String(caseDoc?.parties || '').slice(0, 45)}`);
    for (const step of inst.steps || []) {
      if (Array.isArray(step?.actions) && step.actions.length > 0) {
        console.log(`      ${String(step.stepKey)}: ${step.actions.length} item(s)`);
      }
    }
  }
  console.log(`Templates still carrying it: ${templatesWithChecklist.length}`);
  for (const template of templatesWithChecklist.slice(0, 10)) {
    console.log(`  ${String(template.name)} (${String(template.matterType)})`);
  }
  console.log('');
  console.log(`Instances holding archived (retired) ticked items: ${withArchive.length}`);
  let archiveTotal = 0;
  for (const inst of withArchive) {
    const caseDoc: any = caseById.get(String(inst.caseId));
    archiveTotal += inst.archivedActions.length;
    console.log(
      `  ${caseDoc?.caseNo || String(inst.caseId)} | ${String(caseDoc?.parties || '').slice(0, 45)} (${inst.archivedActions.length} item(s))`
    );
    for (const action of inst.archivedActions) {
      const when = action?.doneAt ? ` done ${new Date(action.doneAt).toISOString().slice(0, 10)}` : '';
      console.log(
        `      [${action?.done ? 'ticked' : 'open'}] ${String(action?.stepKey || '')} :: "${String(action?.text || '')}"${when}`
      );
    }
  }
  console.log(`Total archived records: ${archiveTotal}`);

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('Audit failed:', error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
