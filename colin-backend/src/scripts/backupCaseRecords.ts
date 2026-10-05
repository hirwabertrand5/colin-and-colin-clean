/**
 * READ-ONLY backup of every collection that references a matter, taken before
 * orphan cleanup so the deletion can be reversed if it removes something it
 * should not have.
 *
 * Usage:
 *   npm run backup:case-records
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
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

(async () => {
  await connectDB();

  const baseDir = path.resolve(__dirname, '..', '..');
  const caseIds = (await Case.find({}).select('_id').lean()).map((c: any) => String(c._id));
  const live = new Set(caseIds);
  const orphansOf = (docs: any[]) => docs.filter((d: any) => !live.has(String(d?.caseId || '')));

  const payload: Record<string, any> = { takenAt: new Date().toISOString(), liveMatters: caseIds.length };

  const [instances, tasks, attachments, documents, events, invoices, notifications, reports, expenses, takeRequests] =
    await Promise.all([
      WorkflowInstance.find({}).lean(),
      Task.find({}).lean(),
      TaskAttachment.find({}).lean(),
      Document.find({}).lean(),
      Event.find({}).lean(),
      Invoice.find({}).lean(),
      Notification.find({}).lean(),
      ClientReport.find({}).lean(),
      PettyCashExpense.find({}).lean(),
      CaseTakeRequest.find({}).lean(),
    ]);

  // Store only the orphan rows â€” the live data is untouched by the cleanup.
  payload.orphaned = {
    workflowInstances: orphansOf(instances as any[]),
    tasks: orphansOf(tasks as any[]),
    taskAttachments: orphansOf(attachments as any[]),
    documents: orphansOf(documents as any[]),
    events: orphansOf(events as any[]),
    invoices: orphansOf(invoices as any[]),
    notifications: orphansOf(notifications as any[]),
    clientReports: orphansOf(reports as any[]),
    pettyCashExpenses: orphansOf(expenses as any[]),
    takeRequests: orphansOf(takeRequests as any[]),
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(baseDir, `case-records-backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));

  const counts = Object.entries(payload.orphaned)
    .map(([key, value]: [string, any]) => `${key}: ${Array.isArray(value) ? value.length : 0}`)
    .join(' â€¢ ');

  console.log('');
  console.log('============ CASE RECORDS BACKUP (orphans only) ============');
  console.log(`Live matters: ${caseIds.length}`);
  console.log(counts);
  console.log(`Written to: ${file}`);
  await mongoose.disconnect();
})();
