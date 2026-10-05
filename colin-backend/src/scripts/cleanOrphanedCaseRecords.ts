/**
 * Removes records that reference a matter which no longer exists.
 *
 *
 * A matter deleted before the cascade delete existed leaves orphans behind.
 * Those orphans are still returned by endpoints that are not joined to the
 * case collection - above all GET /tasks, which feeds the staff dashboard
 * "My Work" list, so a staff member keeps seeing work from deleted matters.
 *
 * Dry run by default; pass --apply to actually delete. Audit log entries are
 * KEPT: they are the compliance trail that proves what happened, and they do
 * not feed any dashboard or list.
 *
 * Usage:
 *   npm run clean:orphaned-cases
 *   npm run clean:orphaned-cases:apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import Case from '../models/caseModel';
import Task from '../models/taskModel';
import TaskAttachment from '../models/taskAttachmentModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import Document from '../models/documentModel';
import Event from '../models/eventModel';
import Invoice from '../models/invoiceModel';
import Notification from '../models/notificationModel';
import ClientReport from '../models/clientReportModel';
import PettyCashExpense from '../models/pettyCashExpenseModel';
import CaseTakeRequest from '../models/caseTakeRequestModel';

const apply = process.argv.includes('--apply');

/**
 * Order matters: children first, so nothing is left pointing at a task we are
 * about to remove.
 */
const TARGETS: { label: string; Model: any }[] = [
  { label: 'Task attachments', Model: TaskAttachment },
  { label: 'Tasks', Model: Task },
  { label: 'Workflow instances', Model: WorkflowInstance },
  { label: 'Documents', Model: Document },
  { label: 'Events', Model: Event },
  { label: 'Invoices', Model: Invoice },
  { label: 'Notifications', Model: Notification },
  { label: 'Client reports', Model: ClientReport },
  { label: 'Petty cash expenses', Model: PettyCashExpense },
  { label: 'Case take requests', Model: CaseTakeRequest },
];

(async () => {
  await connectDB();

  const caseIds = (await Case.find({}).select('_id').lean()).map((c: any) => String(c._id));
  const liveCaseIds = new Set(caseIds);

  console.log('');
  console.log(`======= CLEAN ORPHANED CASE RECORDS (${apply ? 'APPLY' : 'DRY RUN'}) =======`);
  console.log(`Live matters: ${liveCaseIds.size}`);
  console.log('');

  let grandTotal = 0;
  for (const { label, Model } of TARGETS) {
    const docs: any[] = await Model.find({}).select('caseId').lean();
    const orphanIds = docs
      .filter((doc: any) => !liveCaseIds.has(String(doc?.caseId || '')))
      .map((doc: any) => doc._id);

    if (!orphanIds.length) {
      console.log(`  ${label.padEnd(20)} 0 removed`);
      continue;
    }

    if (apply) {
      const result = await Model.deleteMany({ _id: { $in: orphanIds } });
      grandTotal += result.deletedCount ?? 0;
      console.log(`  ${label.padEnd(20)} ${result.deletedCount ?? 0} removed`);
    } else {
      grandTotal += orphanIds.length;
      console.log(`  ${label.padEnd(20)} ${orphanIds.length} would be removed`);
    }
  }

  console.log('');
  console.log(`Total ${apply ? 'removed' : 'to remove'}: ${grandTotal}`);
  if (!apply && grandTotal > 0) {
    console.log('Re-run with --apply (npm run clean:orphaned-cases:apply) to delete them.');
  }
  if (apply) {
    const remaining = (await Task.find({}).select('caseId').lean()).filter(
      (t: any) => !liveCaseIds.has(String(t?.caseId || ''))
    ).length;
    console.log(`Verification â€” orphaned tasks remaining: ${remaining}`);
  }

  await mongoose.disconnect();
})();
