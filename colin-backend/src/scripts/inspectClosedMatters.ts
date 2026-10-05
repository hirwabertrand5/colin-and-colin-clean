/**
 * READ-ONLY deep dive on the matters flagged by `auditWorkflowIntegrity`.
 *
 * For each matter it prints:
 * - whether it is a "historical" matter (workflow automation switched off);
 * - when the instance and the template were last changed, to tell "steps were
 *   appended after the matter closed" from "the matter was closed with work
 *   outstanding";
 * - the audit trail, so the real reason can be read from what happened.
 *
 * Usage:
 *   npm run inspect:closed-matters [caseNo ...]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import WorkflowTemplate from '../models/workflowTemplateModel';
import AuditLog from '../models/auditLogModel';

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));

(async () => {
  await connectDB();

  const cases: any[] = await Case.find(wanted.length ? { caseNo: { $in: wanted } } : {})
    .select('_id caseNo parties status matterTiming workflowAutomation workflowTemplateId workflowStartDate createdAt updatedAt workflowProgress')
    .lean();

  for (const c of cases as any[]) {
    const inst: any = await WorkflowInstance.findOne({ caseId: c._id }).lean();
    const template: any = inst ? await WorkflowTemplate.findById(inst.templateId).lean() : null;

    console.log('');
    console.log('================================================================');
    console.log(`MATTER ${c.caseNo}  (${c.parties || 'no parties'})`);
    console.log(`  case status        : ${c.status}`);
    console.log(`  workflowProgress   : ${c.workflowProgress?.status || '—'} @ ${c.workflowProgress?.percent ?? '—'}%`);
    console.log(`  matterTiming       : ${c.matterTiming || '—'}   automation: ${String(c.workflowAutomation)}`);
    console.log(`  case created       : ${c.createdAt}`);
    console.log(`  case updated       : ${c.updatedAt}`);
    if (inst) {
      const steps = (inst.steps || []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
      const completed = steps.filter((s: any) => String(s?.status) === 'Completed');
      console.log(`  instance status    : ${inst.status}   created ${inst.createdAt}  updated ${inst.updatedAt}`);
      console.log(`  instance steps     : ${completed.length}/${steps.length} completed`);
      if (template) {
        console.log(`  template           : ${template.name} (${(template.steps || []).length} steps) updated ${template.updatedAt}`);
        const tplUpdated = template.updatedAt ? new Date(template.updatedAt) : null;
        const instCompleted = completed.length ? new Date(completed[completed.length - 1].completedAt || c.updatedAt) : null;
        if (tplUpdated && instCompleted && tplUpdated > instCompleted) {
          console.log('  >> TEMPLATE CHANGED AFTER THE LAST COMPLETION — new steps were appended to a finished matter');
        }
      }
      const archived = Array.isArray(inst.archivedActions) ? inst.archivedActions.length : 0;
      if (archived) console.log(`  archived ticks     : ${archived}`);
      const gaps: string[] = [];
      let seenPending = false;
      for (const s of steps) {
        if (String(s?.status) === 'Completed') {
          if (seenPending) gaps.push(String(s.stepKey));
        } else {
          seenPending = true;
        }
      }
      if (gaps.length) console.log(`  OUT OF ORDER       : ${gaps.slice(0, 10).join(', ')}${gaps.length > 10 ? '…' : ''}`);
    } else {
      console.log('  instance           : NONE');
    }

    const audit: any[] = await AuditLog.find({ caseId: c._id }).sort({ createdAt: -1 }).limit(12).lean();
    console.log('  --- audit trail (latest 12) ---');
    for (const a of audit) {
      console.log(`    ${a.createdAt} | ${a.action} | ${a.actorName} | ${String(a.detail || a.message || '').slice(0, 90)}`);
    }
  }

  await mongoose.disconnect();
})();