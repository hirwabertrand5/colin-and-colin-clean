/**
 * Snapshot the workflow collections before a repair run.
 *
 * Writes the full WorkflowInstance and WorkflowTemplate documents to
 * `workflow-backup-<date>.json` and `workflow-templates-backup-<date>.json`
 * next to the backend package (the same convention as the committed
 * `workflow-backup-2026-10-02.json`). An existing file is never overwritten:
 * a suffixed name is used instead, so an earlier backup from the same day is
 * preserved.
 *
 * Usage: npx tsx src/scripts/backupWorkflowData.ts
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import WorkflowInstance from '../models/workflowInstanceModel';
import WorkflowTemplate from '../models/workflowTemplateModel';

const writeBackup = (baseDir: string, baseName: string, dateStamp: string, payload: unknown) => {
  let target = path.join(baseDir, `${baseName}-${dateStamp}.json`);
  let suffix = 2;
  while (fs.existsSync(target)) {
    target = path.join(baseDir, `${baseName}-${dateStamp}-${suffix}.json`);
    suffix += 1;
  }
  fs.writeFileSync(target, JSON.stringify(payload), 'utf8');
  return target;
};

(async () => {
  await connectDB();
  const dateStamp = new Date().toISOString().slice(0, 10);
  const baseDir = path.resolve(__dirname, '..', '..');

  const instances = await WorkflowInstance.find({}).lean();
  const templates = await WorkflowTemplate.find({}).lean();

  const instanceFile = writeBackup(baseDir, 'workflow-backup', dateStamp, instances);
  const templateFile = writeBackup(baseDir, 'workflow-templates-backup', dateStamp, templates);

  console.log(`Backed up ${instances.length} workflow instance(s) -> ${instanceFile}`);
  console.log(`Backed up ${templates.length} workflow template(s) -> ${templateFile}`);

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('Backup failed:', error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
