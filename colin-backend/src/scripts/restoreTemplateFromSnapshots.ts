/**
 * Recover a workflow template from its live case snapshots.
 *
 * The old seeding code overwrote workflow templates on every backend restart,
 * which erased admin Key Actions and percentages — while the cases that already
 * existed kept their own workflow instance snapshot of the original template.
 * This script reads the richest snapshot of a template's cases and writes the
 * missing Key Actions / percentages back onto the template.
 *
 * It is strictly additive: nothing is deleted, existing checklist items and
 * reference data (outputs, legal basis, fees, timelines) are preserved. Key
 * Actions that survived get their original title/percentage back, and Key
 * Actions that were lost entirely are re-added with the reference data of their
 * section (inherited from the section's base Key Action).
 *
 * Default is a dry run. Apply with --apply.
 *   npm run restore:template                          (dry run, default template)
 *   npm run restore:template -- --apply
 *   npm run restore:template -- --name="Other Workflow" --apply
 */
import 'dotenv/config';
import connectDB from '../config/db';
import WorkflowInstance from '../models/workflowInstanceModel';
import WorkflowTemplate from '../models/workflowTemplateModel';
import { stripManualNumberPrefix } from '../utils/workflowText';
import { parsePercentage } from '../utils/workflowPercentages';

const DEFAULT_TEMPLATE_NAME = 'Auction & Mortgage Enforcement';

const normalizeActionKey = (value: unknown) =>
  stripManualNumberPrefix(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

type SnapshotStep = {
  key: string;
  order: number;
  stageKey: string;
  title: string;
  percentage: number | undefined;
  actions: string[];
};

const run = async () => {
  await connectDB();

  const apply = process.argv.includes('--apply');
  const nameArg = process.argv.find((arg) => arg.startsWith('--name='));
  const templateName = nameArg ? nameArg.slice('--name='.length).replace(/^"|"$/g, '') : DEFAULT_TEMPLATE_NAME;

  const template: any = await WorkflowTemplate.findOne({ name: templateName }).lean();
  if (!template) {
    console.error(`Template not found: ${templateName}`);
    process.exit(1);
  }

  const instances: any[] = await WorkflowInstance.find({ templateId: template._id }).lean();
  if (!instances.length) {
    console.error(`No case snapshots exist for "${templateName}" — nothing to recover from.`);
    process.exit(1);
  }

  // The richest snapshot (most Key Actions, then most percentages) is the best
  // evidence of the template the live cases were created from.
  const richest: any = instances
    .slice()
    .sort((a, b) => {
      const stepsA = Array.isArray(a.steps) ? a.steps : [];
      const stepsB = Array.isArray(b.steps) ? b.steps : [];
      if (stepsB.length !== stepsA.length) return stepsB.length - stepsA.length;
      const pctA = stepsA.filter((step: any) => Number(step?.percentage) > 0).length;
      const pctB = stepsB.filter((step: any) => Number(step?.percentage) > 0).length;
      return pctB - pctA;
    })[0];
  console.log(`Template: ${templateName} (v${template.version})`);
  console.log(`Snapshots: ${instances.length} case workflow(s); using the one with ${(richest.steps || []).length} Key Actions.`);

  const snapshotByKey = new Map<string, SnapshotStep>();
  const snapshotStages = new Map<string, { key: string; title: string; percentage: number | undefined; order: number }>();
  const snapshotSteps: SnapshotStep[] = [];
  for (const step of richest.steps || []) {
    const stageKey = String(step?.stageKey || '');
    const key = String(step?.stepKey || '');
    if (!key) continue;
    const snapshotStep: SnapshotStep = {
      key,
      order: Number(step?.order) || snapshotSteps.length + 1,
      stageKey,
      title: stripManualNumberPrefix(step?.title),
      percentage: parsePercentage(step?.percentage),
      actions: (Array.isArray(step?.actions) ? step.actions : [])
        .map((action: any) => stripManualNumberPrefix(action?.text))
        .filter(Boolean),
    };
    snapshotSteps.push(snapshotStep);
    snapshotByKey.set(key, snapshotStep);
    if (stageKey && !snapshotStages.has(stageKey)) {
      snapshotStages.set(stageKey, {
        key: stageKey,
        title: String(step?.stageTitle || '').trim() || stageKey,
        percentage: parsePercentage(step?.stagePercentage),
        order: Number(step?.order) || snapshotStages.size + 1,
      });
    }
  }

  const templateStages: any[] = Array.isArray(template.stages) ? template.stages : [];
  const templateSteps: any[] = Array.isArray(template.steps) ? template.steps : [];
  const templateStageKeys = new Set(templateStages.map((stage: any) => String(stage?.key || '')));
  const templateStepKeys = new Set(templateSteps.map((step: any) => String(step?.key || '')));

  // Reference data of each section's base Key Action (used for steps that were
  // lost entirely, so their deadlines/outputs behave like the rest of the section).
  const baseStepByStage = new Map<string, any>();
  for (const step of templateSteps) {
    const stageKey = String(step?.stageKey || '');
    if (stageKey && !baseStepByStage.has(stageKey)) baseStepByStage.set(stageKey, step);
  }

  const stageChanges: any[] = [];
  const stepChanges: any[] = [];
  const stepsAdded: any[] = [];

  const nextStages = templateStages.map((stage: any) => {
    const snapshot = snapshotStages.get(String(stage?.key || ''));
    if (!snapshot || snapshot.percentage === undefined) return stage;
    if (Number(stage?.percentage) === snapshot.percentage) return stage;
    stageChanges.push({
      key: stage.key,
      from: stage.percentage === undefined ? 'MISSING' : stage.percentage,
      to: snapshot.percentage,
    });
    return { ...stage, percentage: snapshot.percentage };
  });

  const nextSteps = templateSteps.map((step: any) => {
    const snapshot = snapshotByKey.get(String(step?.key || ''));
    if (!snapshot) return step;
    const next: any = { ...step };
    let changed = false;

    if (snapshot.title && snapshot.title !== step.title) {
      next.title = snapshot.title;
      changed = true;
    }
    if (snapshot.percentage !== undefined && Number(step?.percentage) !== snapshot.percentage) {
      next.percentage = snapshot.percentage;
      changed = true;
    }
    const existingActions = new Set(
      (Array.isArray(step?.actions) ? step.actions : []).map((text: any) => normalizeActionKey(text))
    );
    const missingActions = snapshot.actions.filter((text) => !existingActions.has(normalizeActionKey(text)));
    if (missingActions.length) {
      next.actions = [...(Array.isArray(step?.actions) ? step.actions : []), ...missingActions];
      changed = true;
    }
    if (changed) {
      stepChanges.push({
        key: step.key,
        title: snapshot.title !== step.title ? { from: step.title, to: snapshot.title } : undefined,
        percentage:
          snapshot.percentage !== undefined && Number(step?.percentage) !== snapshot.percentage
            ? { from: step.percentage === undefined ? 'MISSING' : step.percentage, to: snapshot.percentage }
            : undefined,
        actionsAdded: missingActions.length,
      });
    }
    return next;
  });

  for (const snapshot of snapshotSteps) {
    if (templateStepKeys.has(snapshot.key)) continue;
    const base: any = baseStepByStage.get(snapshot.stageKey);
    stepsAdded.push({
      key: snapshot.key,
      order: snapshot.order,
      stageKey: snapshot.stageKey,
      title: snapshot.title || snapshot.key,
      actions: snapshot.actions.length ? snapshot.actions : snapshot.title ? [snapshot.title] : [],
      ...(snapshot.percentage !== undefined ? { percentage: snapshot.percentage } : {}),
      ...(base?.outputs ? { outputs: base.outputs.map((output: any) => ({ ...output })) } : {}),
      ...(base?.legalBasis ? { legalBasis: base.legalBasis.map((basis: any) => ({ ...basis })) } : {}),
      ...(base?.fee ? { fee: { ...base.fee } } : {}),
      ...(base?.sla ? { sla: { ...base.sla } } : {}),
    });
  }

  const nextAllSteps = [...nextSteps, ...stepsAdded].sort(
    (a: any, b: any) => (Number(a.order) || 0) - (Number(b.order) || 0)
  );
  const stepTotal = nextAllSteps.reduce((sum: number, step: any) => sum + (parsePercentage(step?.percentage) ?? 0), 0);
  const unknownStageSteps = nextAllSteps.filter((step: any) => !templateStageKeys.has(String(step?.stageKey || '')));

  console.log('');
  console.log(`Stages: ${templateStages.length} | Key Actions now: ${templateSteps.length} | after recovery: ${nextAllSteps.length}`);
  console.log(`Recovered Key Action percentages total: ${Math.round(stepTotal * 100) / 100}%`);
  for (const change of stageChanges) console.log('STAGE  ', JSON.stringify(change));
  for (const change of stepChanges) console.log('KEYACT ', JSON.stringify(change));
  for (const added of stepsAdded) {
    console.log(
      'ADDED  ',
      JSON.stringify({
        key: added.key,
        order: added.order,
        stageKey: added.stageKey,
        percentage: added.percentage,
        title: added.title,
        checklist: added.actions.length,
      })
    );
  }
  if (unknownStageSteps.length) {
    console.log(
      `WARNING: ${unknownStageSteps.length} Key Action(s) reference a section that does not exist yet: ${unknownStageSteps
        .map((step: any) => step.key)
        .join(', ')}`
    );
  }
  const zeroSteps = nextAllSteps.filter((step: any) => parsePercentage(step?.percentage) === 0);
  if (zeroSteps.length) {
    console.log(
      `NOTE: ${zeroSteps.length} Key Action(s) carry 0% (restored exactly as stored in the case snapshot): ${zeroSteps
        .map((step: any) => step.key)
        .join(', ')}`
    );
  }

  if (!apply) {
    console.log('');
    console.log('Dry run only. Re-run with --apply to write these changes to the template.');
    process.exit(0);
  }

  await WorkflowTemplate.updateOne({ _id: template._id }, { $set: { stages: nextStages, steps: nextAllSteps } });
  console.log('');
  console.log(`Applied. "${templateName}" now has ${nextStages.length} sections and ${nextAllSteps.length} Key Actions.`);
  process.exit(0);
};

run().catch((err) => {
  console.error('Recovery failed:', err);
  process.exit(1);
});
