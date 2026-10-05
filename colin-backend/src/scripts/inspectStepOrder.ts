/**
 * READ-ONLY: is `step.order` globally unique within each workflow instance?
 *
 * The "tick the next Key Action" rule depends on a single global sequence: a
 * Key Action unlocks when every EARLIER one, across all stages, is done. That
 * only works if `order` is unique across the whole workflow. If order restarts
 * per stage (or is duplicated), the sort is ambiguous and `slice(0, index)`
 * picks the wrong predecessors — which is exactly how a later stage's first
 * Key Action can look unlocked while an earlier stage still has unticked ones.
 *
 * Usage: npm run inspect:step-order
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import WorkflowInstance from '../models/workflowInstanceModel';
import WorkflowTemplate from '../models/workflowTemplateModel';

(async () => {
  await connectDB();

  const instances: any[] = await WorkflowInstance.find({}).lean();
  const templates: any[] = await WorkflowTemplate.find({}).lean();

  console.log('');
  console.log('======== STEP ORDER UNIQUENESS ========');

  let badInstances = 0;
  for (const inst of instances as any[]) {
    const steps = Array.isArray(inst.steps) ? inst.steps : [];
    const orders = steps.map((s: any) => Number(s.order));
    const seen = new Map<number, number>();
    for (const o of orders) seen.set(o, (seen.get(o) || 0) + 1);
    const dupes = Array.from(seen.entries()).filter(([, n]) => n > 1);
    const missing = orders.filter((o: number) => !Number.isFinite(o)).length;
    if (dupes.length || missing) {
      badInstances += 1;
      if (badInstances <= 8) {
        console.log(
          `  ${String(inst.caseId)} — ${steps.length} steps, ${dupes.length} duplicate order value(s)${missing ? `, ${missing} missing order` : ''}`
        );
        if (dupes.length) {
          console.log(
            `      duplicated: ${dupes
              .slice(0, 6)
              .map(([o, n]) => `order ${o} x${n}`)
              .join(', ')}`
          );
        }
      }
    }
  }
  console.log(`Instances with duplicate/missing order: ${badInstances} / ${instances.length}`);

  console.log('');
  console.log('--- template order ranges (first 12) ---');
  for (const t of templates as any[]) {
    const steps = (Array.isArray(t.steps) ? t.steps : []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
    if (!steps.length) continue;
    console.log(
      `  ${String(t.name || '?')} — ${steps.length} steps, order ${steps[0].order}..${steps[steps.length - 1].order}`
    );
  }

  // Show the exact predecessor set the UI would compute for the first action of
  // the second stage, for the first few instances.
  console.log('');
  console.log('--- second-stage first action: which predecessors gate it? ---');
  for (const inst of instances.slice(0, 6) as any[]) {
    const steps = (Array.isArray(inst.steps) ? inst.steps : []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
    const stages: string[] = [];
    for (const s of steps) {
      const k = String(s.stageKey || '');
      if (k && !stages.includes(k)) stages.push(k);
    }
    if (stages.length < 2) continue;
    const secondStageKey = stages[1];
    const target = steps.find((s: any) => String(s.stageKey || '') === secondStageKey);
    if (!target) continue;
    const idx = steps.findIndex((s: any) => s.stepKey === target.stepKey);
    const blockers = steps.slice(0, idx).filter((s: any) => String(s.status) !== 'Completed');
    console.log(
      `  ${String(inst.caseId)}: target "${target.title || target.stepKey}" (order ${target.order}) has ${blockers.length} blocker(s) before it`
    );
  }

  await mongoose.disconnect();
})();