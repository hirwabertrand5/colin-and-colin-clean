/**
 * READ-ONLY audit of two workflow integrity problems:
 *
 * 1. Closed matters whose progress is stuck below 100% even though the matter
 *    is closed. Either the workflow instance is still Active / has pending
 *    steps, or `workflowProgress.percent` was never recomputed after the steps
 *    were completed.
 *
 * 2. Key Actions completed out of order: a step is Completed while an earlier
 *    step (lower order) is not. Completing a step is supposed to require the
 *    previous one to be completed first, so these are violations to inspect.
 *
 * Writes nothing. Usage:
 *   npm run audit:workflow-integrity
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import WorkflowTemplate from '../models/workflowTemplateModel';

const round2 = (value: number) => Math.round(value * 100) / 100;

const isClosedCase = (c: any) =>
  String(c?.status || '').toLowerCase() === 'closed' ||
  String(c?.workflowProgress?.status || '').toLowerCase() === 'completed' ||
  String(c?.workflowProgress?.status || '').toLowerCase() === 'temporarily closed';

(async () => {
  await connectDB();

  const cases: any[] = await Case.find({}).select('_id caseNo parties status workflowProgress workflowTemplateId').lean();
  const caseById = new Map<string, any>(cases.map((c: any) => [String(c._id), c]));
  const instances: any[] = await WorkflowInstance.find({}).lean();
  const templates: any[] = await WorkflowTemplate.find({}).lean();

  console.log('');
  console.log('============ WORKFLOW INTEGRITY AUDIT (read-only) ============');
  console.log(`Matters: ${cases.length} | instances: ${instances.length}`);

  // ---- Issue 1: closed matters that are not fully complete -------------
  const closedIssues: string[] = [];
  for (const inst of instances as any[]) {
    const c: any = caseById.get(String(inst.caseId));
    if (!c || !isClosedCase(c)) continue;

    const steps = Array.isArray(inst.steps) ? inst.steps.slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0)) : [];
    const pending = steps.filter((s: any) => String(s?.status || '') !== 'Completed');
    const percent = Number(c?.workflowProgress?.percent);
    const instanceStatus = String(inst.status || '');
    const caseStatus = String(c?.workflowProgress?.status || '');

    const notAllComplete = pending.length > 0;
    const stalePercent = !Number.isFinite(percent) || percent < 100;
    const instanceNotCompleted = instanceStatus.toLowerCase() !== 'completed';

    if (notAllComplete || stalePercent || instanceNotCompleted) {
      closedIssues.push(
        [
          String(c.caseNo || '?'),
          `inst=${instanceStatus || '?'}`,
          `caseStatus=${caseStatus || '?'}`,
          `percent=${Number.isFinite(percent) ? percent : 'n/a'}`,
          `steps=${steps.length - pending.length}/${steps.length}`,
          notAllComplete ? `PENDING[${pending.slice(0, 3).map((s: any) => s.stepKey).join(',')}]` : '',
          instanceNotCompleted ? 'INSTANCE-NOT-COMPLETED' : '',
        ]
          .filter(Boolean)
          .join(' | ')
      );
    }
  }

  console.log('');
  console.log(`--- Closed matters with incomplete progress: ${closedIssues.length} ---`);
  for (const line of closedIssues.slice(0, 25)) console.log(`  ${line}`);
  if (closedIssues.length > 25) console.log(`  ... and ${closedIssues.length - 25} more`);

  // ---- Issue 2: Key Actions completed out of order -------------------
  const orderIssues: string[] = [];
  for (const inst of instances as any[]) {
    const steps = Array.isArray(inst.steps) ? inst.steps.slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0)) : [];
    let seenPending = false;
    const violations: string[] = [];
    for (const step of steps) {
      const completed = String(step?.status || '') === 'Completed';
      if (!completed) {
        seenPending = true;
      } else if (seenPending) {
        violations.push(String(step?.stepKey || '?'));
      }
    }
    if (violations.length) {
      const c: any = caseById.get(String(inst.caseId));
      orderIssues.push(
        `${String(c?.caseNo || '?')} | completed-after-pending: ${violations.slice(0, 6).join(', ')}${
          violations.length > 6 ? ` (+${violations.length - 6} more)` : ''
        }`
      );
    }
  }

  console.log('');
  console.log(`--- Matters with Key Actions completed out of order: ${orderIssues.length} ---`);
  for (const line of orderIssues.slice(0, 25)) console.log(`  ${line}`);
  if (orderIssues.length > 25) console.log(`  ... and ${orderIssues.length - 25} more`);

  console.log('');
  console.log('Template step percentage totals (each should reach 100):');
  for (const t of templates as any[]) {
    const steps = Array.isArray(t?.steps) ? t.steps : [];
    const sum = steps.reduce((s: number, st: any) => s + (Number(st?.percentage) || 0), 0);
    const missing = steps.filter((st: any) => !(Number(st?.percentage) > 0)).length;
    const flag = Math.abs(sum - 100) < 0.01 ? 'ok' : 'TOTAL!=100';
    console.log(
      `  ${String(t?.name || '?')} — ${steps.length} steps, weights total ${round2(sum)}% [${flag}]${missing ? `, ${missing} step(s) with no weight` : ''}`
    );
  }

  await mongoose.disconnect();
})();