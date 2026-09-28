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
 *   npm run restore:template -- --name="X" --version=1 --apply   (specific version)
 *   npm run restore:template -- --name="X" --replace --apply     (replace instead of merge)
 *   npm run restore:template -- --scan                           (scan every template)
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

/**
 * Read-only scan across every workflow template: reports which ones still have
 * Key Actions or percentages that only exist in their case snapshots (i.e.
 * data the old seed-overwrite bug removed and we have not restored yet).
 */
const scanAllTemplates = async () => {
  const templates: any[] = await WorkflowTemplate.find({}).lean();
  const instances: any[] = await WorkflowInstance.find({}).lean();
  const instancesByTemplate = new Map<string, any[]>();
  for (const instance of instances) {
    const key = String(instance.templateId);
    if (!instancesByTemplate.has(key)) instancesByTemplate.set(key, []);
    instancesByTemplate.get(key)!.push(instance);
  }

  const recoverable: any[] = [];
  const emptyPercentages: any[] = [];
  let compared = 0;

  for (const template of templates) {
    const snapshots = instancesByTemplate.get(String(template._id)) || [];
    const templateSteps: any[] = Array.isArray(template.steps) ? template.steps : [];
    if (!templateSteps.length) continue;
    const templateStepByKey = new Map(templateSteps.map((step: any) => [String(step?.key || ''), step]));
    const templateStages: any[] = Array.isArray(template.stages) ? template.stages : [];
    const templateStageByKey = new Map(templateStages.map((stage: any) => [String(stage?.key || ''), stage]));
    const templateHasAnyPercentage =
      templateSteps.some((step: any) => Number(step?.percentage) > 0) ||
      templateStages.some((stage: any) => Number(stage?.percentage) > 0);

    if (!snapshots.length) {
      if (!templateHasAnyPercentage) {
        emptyPercentages.push({
          name: template.name,
          version: template.version,
          active: template.active,
          keyActions: templateSteps.length,
          caseSnapshots: 0,
        });
      }
      continue;
    }
    compared += 1;

    const richest: any = snapshots
      .slice()
      .sort((a, b) => {
        const aSteps = Array.isArray(a.steps) ? a.steps.length : 0;
        const bSteps = Array.isArray(b.steps) ? b.steps.length : 0;
        if (bSteps !== aSteps) return bSteps - aSteps;
        const aPct = (Array.isArray(a.steps) ? a.steps : []).filter((step: any) => Number(step?.percentage) > 0).length;
        const bPct = (Array.isArray(b.steps) ? b.steps : []).filter((step: any) => Number(step?.percentage) > 0).length;
        return bPct - aPct;
      })[0];

    const snapshotSteps: any[] = Array.isArray(richest.steps) ? richest.steps : [];
    const missingSteps = snapshotSteps.filter(
      (step: any) => step?.stepKey && !templateStepByKey.has(String(step.stepKey))
    );
    const missingStepPercentages = snapshotSteps.filter((step: any) => {
      if (!(Number(step?.percentage) > 0)) return false;
      const templateStep: any = templateStepByKey.get(String(step?.stepKey));
      return Boolean(templateStep) && !(Number(templateStep?.percentage) > 0);
    });
    const missingStageKeys = [
      ...new Set(
        snapshotSteps
          .filter((step: any) => Number(step?.stagePercentage) > 0)
          .filter((step: any) => {
            const templateStage: any = templateStageByKey.get(String(step?.stageKey));
            return Boolean(templateStage) && !(Number(templateStage?.percentage) > 0);
          })
          .map((step: any) => String(step?.stageKey))
      ),
    ];

    if (missingSteps.length || missingStepPercentages.length || missingStageKeys.length) {
      recoverable.push({
        name: template.name,
        version: template.version,
        active: template.active,
        keyActionsNow: templateSteps.length,
        keyActionsInSnapshot: snapshotSteps.length,
        caseSnapshots: snapshots.length,
        missingKeyActions: missingSteps.length,
        missingStepPercentages: missingStepPercentages.length,
        missingStagePercentages: missingStageKeys.length,
        sampleKeyActions: missingSteps.slice(0, 6).map((step: any) => step.stepKey),
      });
    } else if (!templateHasAnyPercentage && !snapshotSteps.some((step: any) => Number(step?.percentage) > 0)) {
      emptyPercentages.push({
        name: template.name,
        version: template.version,
        active: template.active,
        keyActions: templateSteps.length,
        caseSnapshots: snapshots.length,
      });
    }
  }

  console.log(`Scanned ${templates.length} template(s); ${compared} could be compared against case snapshots.`);
  console.log('');
  if (recoverable.length) {
    console.log(`TEMPLATES WITH UNRESTORED DATA: ${recoverable.length}`);
    for (const entry of recoverable) console.log(' -', JSON.stringify(entry));
  } else {
    console.log('No template has recoverable Key Actions / percentages from its case snapshots.');
  }
  if (emptyPercentages.length) {
    console.log('');
    console.log(`NO PERCENTAGES CONFIGURED (verify manually — no snapshot evidence of loss): ${emptyPercentages.length}`);
    for (const entry of emptyPercentages) console.log(' -', JSON.stringify(entry));
  }
};

const run = async () => {
  await connectDB();

  const apply = process.argv.includes('--apply');
  if (process.argv.includes('--scan')) {
    await scanAllTemplates();
    process.exit(0);
  }
  const nameArg = process.argv.find((arg) => arg.startsWith('--name='));
  const templateName = nameArg ? nameArg.slice('--name='.length).replace(/^"|"$/g, '') : DEFAULT_TEMPLATE_NAME;
  const versionArg = process.argv.find((arg) => arg.startsWith('--version='));
  const versionFilter = versionArg ? Number(versionArg.slice('--version='.length)) : undefined;

  const templateFilter: any = { name: templateName };
  if (Number.isFinite(versionFilter)) templateFilter.version = versionFilter;

  const template: any = await WorkflowTemplate.findOne(templateFilter).lean();
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

  const replace = process.argv.includes('--replace');
  if (replace) {
    const replacementStages = Array.from(snapshotStages.values())
      .sort((a, b) => a.order - b.order)
      .map((stage, index) => ({
        key: stage.key,
        order: index + 1,
        title: stage.title,
        ...(stage.percentage !== undefined ? { percentage: stage.percentage } : {}),
      }));
    const rawSteps: any[] = Array.isArray(richest.steps) ? richest.steps : [];
    const replacementSteps = snapshotSteps.map((snapshot) => {
      const source: any = rawSteps.find((step: any) => String(step?.stepKey) === snapshot.key) || {};
      const slaText = String(source?.slaText || '').trim();
      const outputs = Array.isArray(source?.outputs) ? source.outputs : [];
      return {
        key: snapshot.key,
        order: snapshot.order,
        stageKey: snapshot.stageKey,
        title: snapshot.title || snapshot.key,
        actions: snapshot.actions.length ? snapshot.actions : snapshot.title ? [snapshot.title] : [],
        ...(snapshot.percentage !== undefined ? { percentage: snapshot.percentage } : {}),
        ...(outputs.length
          ? {
              outputs: outputs.map((output: any) => ({
                key: String(output?.key || ''),
                name: String(output?.name || ''),
                required: Boolean(output?.required),
                ...(output?.category ? { category: String(output.category) } : {}),
              })),
            }
          : {}),
        ...(slaText ? { sla: { text: slaText } } : {}),
      };
    });
    const replacementTotal = replacementSteps.reduce(
      (sum: number, step: any) => sum + (parsePercentage(step?.percentage) ?? 0),
      0
    );

    console.log('');
    console.log('REPLACE MODE: the template sections and Key Actions are rebuilt from the case snapshot.');
    console.log(
      `Sections: ${Array.isArray(template.stages) ? template.stages.length : 0} -> ${replacementStages.length} | ` +
        `Key Actions: ${Array.isArray(template.steps) ? template.steps.length : 0} -> ${replacementSteps.length} | ` +
        `percentages total: ${Math.round(replacementTotal * 100) / 100}%`
    );
    for (const stage of replacementStages) console.log('STAGE  ', JSON.stringify(stage));
    for (const step of replacementSteps) {
      console.log(
        'STEP   ',
        JSON.stringify({
          key: step.key,
          order: step.order,
          stageKey: step.stageKey,
          percentage: step.percentage,
          title: String(step.title).slice(0, 70),
          checklist: step.actions.length,
        })
      );
    }

    if (!apply) {
      console.log('');
      console.log('Dry run only. Re-run with --apply to write these changes to the template.');
      process.exit(0);
    }

    await WorkflowTemplate.updateOne({ _id: template._id }, { $set: { stages: replacementStages, steps: replacementSteps } });
    console.log('');
    console.log(
      `Applied. "${templateName}" v${template.version} now has ${replacementStages.length} sections and ${replacementSteps.length} Key Actions.`
    );
    process.exit(0);
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
