/**
 * Purge workflow templates that are inactive or that carry no Key Action
 * percentage allocations.
 *
 * Only two kinds of template survive, which is exactly what the admin UI and
 * the earned-fee engine can use:
 *
 *   1. active templates (active === true — unpublished drafts are inactive);
 *   2. templates where at least one Key Action (step) carries a `percentage`.
 *
 * Stage-level percentages do NOT save a template. The per-Key-Action
 * percentage is what every surface reads (CreateCase "Key Action percentage"
 * or "Percentage missing", TaskDetail "Key Action Percentage", the builder's
 * KEY ACTION PERCENTAGE column), and workflowCompute.ts deliberately never
 * splits a stage percentage across Key Actions — a missing one stays visible
 * and worth 0.
 *
 * Live matters are untouched: every case keeps its workflow instance, which
 * stores its own copy of the steps, and the code paths that look a template
 * up by id all null-check the result.
 *
 * Dry run by default; pass --apply to delete. Before deleting, the FULL
 * collection is snapshotted to workflow-templates-backup-<date>.json (the same
 * convention as `npm run backup:workflows`), so the purge is recoverable.
 *
 * Usage:
 *   npm run purge:workflow-templates
 *   npm run purge:workflow-templates:apply
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import WorkflowTemplate from '../models/workflowTemplateModel';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';

const apply = process.argv.includes('--apply');

type TemplateRow = {
  _id: mongoose.Types.ObjectId;
  name: string;
  version?: number;
  active?: boolean;
  draft?: boolean;
  steps?: Array<{ percentage?: number }>;
};

const stepsOf = (template: TemplateRow) => (Array.isArray(template.steps) ? template.steps : []);

const countStepsWithPercentage = (template: TemplateRow) =>
  stepsOf(template).filter((step) => step?.percentage !== undefined && step?.percentage !== null).length;

/** A template is doomed when it is inactive or no Key Action has a percentage. */
const classify = (template: TemplateRow) => {
  const totalSteps = stepsOf(template).length;
  const withPercentage = countStepsWithPercentage(template);
  const reasons: string[] = [];
  if (template.active !== true) reasons.push(template.draft ? 'inactive (draft)' : 'inactive');
  if (withPercentage === 0) {
    reasons.push(totalSteps ? `no Key Action percentages (0/${totalSteps})` : 'no Key Actions at all');
  }
  return { totalSteps, withPercentage, reasons, doomed: reasons.length > 0 };
};

/** Suffixed file naming so an earlier backup from the same day is kept. */
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
  try {
    await connectDB();

    const templates = (await WorkflowTemplate.find({}).lean()) as unknown as TemplateRow[];
    const rows = templates.map((template) => ({ template, ...classify(template) }));
    const doomed = rows.filter((row) => row.doomed);
    const kept = rows.filter((row) => !row.doomed);

    // How many live matters still point at a template that is about to go.
    const doomedIds = doomed.map((row) => row.template._id);
    const caseRows: any[] = await Case.find({ workflowTemplateId: { $in: doomedIds } })
      .select('workflowTemplateId')
      .lean();
    const instanceRows: any[] = await WorkflowInstance.find({ templateId: { $in: doomedIds } })
      .select('templateId')
      .lean();
    const casesById = new Map<string, number>();
    for (const row of caseRows) {
      const key = String(row?.workflowTemplateId || '');
      casesById.set(key, (casesById.get(key) || 0) + 1);
    }
    const instancesById = new Map<string, number>();
    for (const row of instanceRows) {
      const key = String(row?.templateId || '');
      instancesById.set(key, (instancesById.get(key) || 0) + 1);
    }

    console.log('');
    console.log(`======= PURGE WORKFLOW TEMPLATES (${apply ? 'APPLY' : 'DRY RUN'}) =======`);
    console.log(`Templates scanned: ${templates.length} | to delete: ${doomed.length} | to keep: ${kept.length}`);
    console.log('');

    if (doomed.length) {
      console.log(`-- DELETE (${doomed.length}) --`);
      for (const row of doomed) {
        const cases = casesById.get(String(row.template._id)) || 0;
        const instances = instancesById.get(String(row.template._id)) || 0;
        console.log(
          `  ${row.template.name} v${row.template.version ?? 1} | ${row.reasons.join('; ')} | matters: ${cases} | instances: ${instances}`
        );
      }
      console.log('');
    }

    if (kept.length) {
      console.log(`-- KEEP (${kept.length}) --`);
      for (const row of kept) {
        console.log(
          `  ${row.template.name} v${row.template.version ?? 1} | active | ${row.withPercentage}/${row.totalSteps} Key Actions with percentage`
        );
      }
      console.log('');
    }

    if (!doomed.length) {
      console.log('Nothing to delete - every template is active and has Key Action percentages.');
      return;
    }

    if (!apply) {
      console.log('Re-run with --apply (npm run purge:workflow-templates:apply) to delete them.');
      return;
    }

    // Snapshot the FULL collection first so the purge is recoverable.
    const dateStamp = new Date().toISOString().slice(0, 10);
    const backupFile = writeBackup(
      path.resolve(__dirname, '..', '..'),
      'workflow-templates-backup',
      dateStamp,
      templates
    );
    console.log(`Backup written: ${backupFile}`);

    const result = await WorkflowTemplate.deleteMany({ _id: { $in: doomedIds } });
    console.log(`Deleted: ${result.deletedCount ?? 0}`);
    console.log('');

    const remaining = (await WorkflowTemplate.find({}).lean()) as unknown as TemplateRow[];
    const violations = remaining.filter((template) => classify(template).doomed);
    console.log(`Verification - templates remaining: ${remaining.length}`);
    console.log(`Verification - remaining that still violate the rule: ${violations.length}`);
    for (const template of violations) console.log(`  ! ${template.name} v${template.version ?? 1}`);
  } finally {
    await mongoose.disconnect();
  }
})().catch((error) => {
  console.error('Purge failed:', error);
  process.exit(1);
});
