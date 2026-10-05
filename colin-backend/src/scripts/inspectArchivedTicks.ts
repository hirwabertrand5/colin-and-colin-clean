/**
 * Reports what `archivedActions` actually contains for a matter, because the
 * repair script's "was this step finished?" test depends on it.
 *
 * The checklist retirement archived TICKED items and DROPPED unticked ones, so
 * if that is true, "every archived row for a step is ticked" is vacuously true
 * for any step that has rows, and cannot prove completion on its own.
 *
 * Usage: npm run inspect:archived-ticks <caseNo>
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';

(async () => {
  await connectDB();
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const cases: any[] = await Case.find(wanted.length ? { caseNo: { $in: wanted } } : {}).select('_id caseNo').lean();

  for (const c of cases as any[]) {
    const inst: any = await WorkflowInstance.findOne({ caseId: c._id }).lean();
    const archived = Array.isArray(inst?.archivedActions) ? inst.archivedActions : [];
    const byStep = new Map<string, any[]>();
    for (const row of archived) {
      const key = String(row?.stepKey || '?');
      byStep.set(key, [...(byStep.get(key) || []), row]);
    }
    console.log('');
    console.log(`${c.caseNo}: ${archived.length} archived rows across ${byStep.size} step(s)`);
    const statuses = archived.reduce((acc: Record<string, number>, row: any) => {
      const k = `${row?.done === true ? 'done:true' : row?.done === false ? 'done:false' : `other:${String(row?.done)}`}`;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    console.log(`  archived row states: ${JSON.stringify(statuses)}`);
    for (const [stepKey, rows] of Array.from(byStep.entries()).slice(0, 6)) {
      console.log(`  ${stepKey}: ${rows.length} row(s) — statuses ${JSON.stringify(rows.map((r: any) => r.done))}`);
    }
  }
  await mongoose.disconnect();
})();