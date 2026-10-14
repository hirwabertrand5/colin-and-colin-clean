/**
 * Verification for case-specific ("custom") Key Actions.
 *
 * A user may add a Key Action to any stage of a case's checklist from the Case
 * Workspace Overview. These Key Actions live only on the workflow INSTANCE and
 * must never be touched by the workflow template. This script proves, with pure
 * fixtures (no database):
 *
 *   A. a custom Key Action stays on the ACTIVE checklist when the case is
 *      re-aligned with its template (it is never archived/dropped like a
 *      superseded template step);
 *   B. `hasSupersededTemplateSteps` ignores custom steps, so a case that only
 *      carries custom additions is not flagged as drifted;
 *   C. a custom Key Action keeps its own ticks/deadline/status across alignment;
 *   D. a genuinely superseded (non-custom) step is still archived as before.
 *
 * Run with:  npx tsx src/scripts/verifyCustomKeyActions.ts
 */
import {
  alignInstanceStepsToTemplate,
  hasSupersededTemplateSteps,
} from '../utils/workflowAlignment';

let passed = 0;
let failed = 0;

const check = (name: string, condition: boolean, detail?: unknown) => {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL  ${name}`);
  if (detail !== undefined) console.log('        ', JSON.stringify(detail));
};

const start = new Date('2026-01-05T09:00:00.000Z');

const template = {
  _id: 'tpl-1',
  name: 'COMMERCIAL WORKFLOW',
  matterType: 'Commercial',
  caseType: 'Transactional Cases',
  version: 1,
  active: true,
  draft: false,
  stages: [
    { key: 'onboarding', title: 'Onboarding', percentage: 50, order: 1 },
    { key: 'execution', title: 'Execution', percentage: 50, order: 2 },
  ],
  steps: [
    { key: 'ON_1', title: 'Client onboarding', stageKey: 'onboarding', order: 1, percentage: 25 },
    { key: 'ON_2', title: 'Conflict check', stageKey: 'onboarding', order: 2, percentage: 25 },
    { key: 'EX_1', title: 'Draft agreement', stageKey: 'execution', order: 3, percentage: 50 },
  ],
};

console.log('A. A custom Key Action stays on the active checklist across alignment');
{
  const instanceSteps = [
    { stepKey: 'ON_1', title: 'Client onboarding', stageKey: 'onboarding', order: 1, status: 'Completed', actions: [] },
    { stepKey: 'CUSTOM_1', title: 'Collect KYC pack', stageKey: 'onboarding', order: 1.5, custom: true, customOrder: 1.5, status: 'In Progress', actions: [] },
    { stepKey: 'ON_2', title: 'Conflict check', stageKey: 'onboarding', order: 2, status: 'Not Started', actions: [] },
    { stepKey: 'EX_1', title: 'Draft agreement', stageKey: 'execution', order: 3, status: 'Not Started', actions: [] },
  ];

  const result = alignInstanceStepsToTemplate(instanceSteps as any, template as any, start);

console.log('B. hasSupersededTemplateSteps ignores custom steps');
{
  const withOnlyCustom = [
    { stepKey: 'ON_1', title: 'Client onboarding', stageKey: 'onboarding', order: 1 },
    { stepKey: 'CUSTOM_1', title: 'Collect KYC pack', stageKey: 'onboarding', order: 1.5, custom: true },
    { stepKey: 'ON_2', title: 'Conflict check', stageKey: 'onboarding', order: 2 },
    { stepKey: 'EX_1', title: 'Draft agreement', stageKey: 'execution', order: 3 },
  ];
  check('only custom extras => not drifted', hasSupersededTemplateSteps(withOnlyCustom as any, template as any) === false);

  const withRealDrift = [
    ...withOnlyCustom,
    { stepKey: 'OLD_TEMPLATE_STEP', title: 'Removed from template', stageKey: 'execution', order: 4 },
  ];
  check('a real non-template step is still detected as drift', hasSupersededTemplateSteps(withRealDrift as any, template as any) === true);
}

console.log('C. A custom Key Action keeps its tick and deadline across alignment');
{
  const dueAt = new Date('2026-02-01T09:00:00.000Z');
  const instanceSteps = [
    { stepKey: 'ON_1', title: 'Client onboarding', stageKey: 'onboarding', order: 1, status: 'Completed', actions: [] },
    { stepKey: 'CUSTOM_2', title: 'Send welcome pack', stageKey: 'onboarding', order: 2.5, custom: true, status: 'Done', dueAt, actions: [{ text: 'pack', done: true, doneAt: new Date('2026-01-20T09:00:00.000Z') }] },
    { stepKey: 'ON_2', title: 'Conflict check', stageKey: 'onboarding', order: 2, status: 'Not Started', actions: [] },
    { stepKey: 'EX_1', title: 'Draft agreement', stageKey: 'execution', order: 3, status: 'Not Started', actions: [] },
  ];

  const result = alignInstanceStepsToTemplate(instanceSteps as any, template as any, start);
  const kept = result.steps.find((s: any) => s.stepKey === 'CUSTOM_2');
  check('the custom Key Action survives', Boolean(kept));
  check('it keeps its Done status', kept?.status === 'Done');
  check('it keeps its deadline', Boolean(kept?.dueAt) && new Date(kept?.dueAt as any).getTime() === dueAt.getTime());
  check('it keeps its ticked sub-checklist', Array.isArray(kept?.actions) && kept?.actions?.[0]?.done === true);
}

console.log('D. A genuinely superseded (non-custom) step is still archived (no regression)');
{
  const instanceSteps = [
    { stepKey: 'ON_1', title: 'Client onboarding', stageKey: 'onboarding', order: 1, status: 'Completed', actions: [] },
    { stepKey: 'ON_2', title: 'Conflict check', stageKey: 'onboarding', order: 2, status: 'Not Started', actions: [] },
    { stepKey: 'EX_1', title: 'Draft agreement', stageKey: 'execution', order: 3, status: 'Not Started', actions: [] },
    { stepKey: 'LEGACY_DONE', title: 'Old completed work', stageKey: 'execution', order: 9, status: 'Completed', actions: [] },
  ];

  const result = alignInstanceStepsToTemplate(instanceSteps as any, template as any, start);
  const activeKeys = result.steps.map((s: any) => s.stepKey);
  check('the superseded step is off the active checklist', !activeKeys.includes('LEGACY_DONE'), activeKeys);
  check('the superseded step is archived (not lost)', result.archivedSteps.some((s: any) => s.stepKey === 'LEGACY_DONE'));
  check('the archived step is flagged archivedFromTemplate', result.archivedSteps.find((s: any) => s.stepKey === 'LEGACY_DONE')?.archivedFromTemplate === true);
}

console.log('E. A custom Key Action inherits and keeps the stage deadline (timeliness)');
{
  // Every Key Action in a stage shares the stage's start/deadline. A custom Key
  // Action is created with that same timing (addStep copies it from a sibling),
  // so it must never look like it has "no deadline" and must keep it across
  // alignment.
  const stageStart = new Date('2026-01-05T09:00:00.000Z');
  const stageDue = new Date('2026-01-15T09:00:00.000Z');
  const instanceSteps = [
    { stepKey: 'ON_1', title: 'Client onboarding', stageKey: 'onboarding', order: 1, status: 'Completed', startAt: stageStart, dueAt: stageDue, slaText: '10 days', actions: [] },
    { stepKey: 'CUSTOM_3', title: 'Collect KYC pack', stageKey: 'onboarding', order: 1.5, custom: true, status: 'Not Started', startAt: stageStart, dueAt: stageDue, slaText: '10 days', actions: [] },
    { stepKey: 'ON_2', title: 'Conflict check', stageKey: 'onboarding', order: 2, status: 'Not Started', startAt: stageStart, dueAt: stageDue, slaText: '10 days', actions: [] },
    { stepKey: 'EX_1', title: 'Draft agreement', stageKey: 'execution', order: 3, status: 'Not Started', actions: [] },
  ];

  const result = alignInstanceStepsToTemplate(instanceSteps as any, template as any, start);
  const custom = result.steps.find((s: any) => s.stepKey === 'CUSTOM_3');
  check('the custom Key Action has a deadline (not blank)', Boolean(custom?.dueAt));
  check('it inherits the same deadline as its stage siblings', Boolean(custom?.dueAt) && new Date(custom?.dueAt as any).getTime() === stageDue.getTime());
  check('it inherits the stage start too', Boolean(custom?.startAt) && new Date(custom?.startAt as any).getTime() === stageStart.getTime());
  check('it keeps the stage duration text', custom?.slaText === '10 days');
}

console.log('');
console.log(`Custom Key Action checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

  const activeKeys = result.steps.map((s: any) => s.stepKey);
  check('the custom Key Action is still on the active checklist', activeKeys.includes('CUSTOM_1'), activeKeys);
  check('the custom Key Action was NOT archived', !result.archivedSteps.some((s: any) => s.stepKey === 'CUSTOM_1'));
  check('the custom Key Action keeps its status', result.steps.find((s: any) => s.stepKey === 'CUSTOM_1')?.status === 'In Progress');
  check('all template steps remain present', ['ON_1', 'ON_2', 'EX_1'].every((k) => activeKeys.includes(k)), activeKeys);
}
