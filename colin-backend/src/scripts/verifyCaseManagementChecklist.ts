/**
 * Verification for the Case Management checklist fix.
 *
 * Reported issue: some matters showed the Key Actions checklist on the Case
 * Workspace Overview tab, but the Case Management tab rendered the same steps
 * with "No key actions configured for this step." Root cause: the Overview tab
 * (and the workflow endpoint's self-heal) derives the checklist from the
 * workflow template when the case's workflow instance stored no actions, while
 * Case Management read the instance's empty `actions` array only.
 *
 * This script reproduces that scenario with fixtures and checks that the shared
 * rule now used by the Case Management controller:
 *
 *   A. derives the template's Key Actions for legacy steps that stored none;
 *   B. never overwrites real progress — an instance's own ticks always win;
 *   C. ignores blank template actions and unknown steps;
 *   D. still resolves the checklist after the legacy step normalisation
 *      (percentages derived from the template) runs first.
 *
 * Pure functions only — no database is touched. Run with:
 *   npx tsx src/scripts/verifyCaseManagementChecklist.ts
 */
import {
  normalizeEffectiveWorkflowSteps,
  resolveEffectiveStepActions,
} from '../utils/caseEarnedFees';

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

/** The maintained template — authoritative for the checklist text. */
const template: any = {
  _id: 'tpl-civil-v2',
  name: 'CIVIL PROCEDURE WORKFLOW',
  matterType: 'Civil Litigation',
  caseType: 'Litigation Cases',
  version: 2,
  active: true,
  draft: false,
  stages: [
    { key: 'intake', title: 'Client intake and due diligence', percentage: 40, order: 1 },
    { key: 'pre_litigation', title: 'Demand, filing, service and defence response', percentage: 60, order: 2 },
  ],
  steps: [
    {
      key: 'CIV_1_INTAKE',
      title: 'Client intake and due diligence',
      stageKey: 'intake',
      order: 1,
      percentage: 20,
      actions: ['Receive client and conduct intake interview', 'Run conflict check', 'Sign engagement letter'],
    },
    {
      key: 'CIV_2_PRE_LITIGATION',
      title: 'Demand, filing, service and defence response',
      stageKey: 'pre_litigation',
      order: 2,
      percentage: 20,
      actions: ['Draft formal demand letter', 'File the claim in court'],
    },
  ],
};

/**
 * The reported case: a legacy instance whose steps carry no `actions` at all.
 * The Overview tab still showed the checklist because it falls back to the
 * template; Case Management used to show an empty step.
 */
const legacyInstance: any = {
  _id: 'inst-1',
  caseId: 'case-1',
  templateId: 'tpl-civil-v2',
  status: 'Active',
  currentStepKey: 'CIV_1_INTAKE',
  steps: [
    {
      stepKey: 'CIV_1_INTAKE',
      title: 'Client intake and due diligence',
      stageKey: 'intake',
      order: 1,
      status: 'In Progress',
      actions: [],
    },
    {
      stepKey: 'CIV_2_PRE_LITIGATION',
      title: 'Demand, filing, service and defence response',
      stageKey: 'pre_litigation',
      order: 2,
      status: 'Not Started',
      actions: [],
    },
  ],
};

console.log('A. Legacy instance step (no stored actions) derives the template checklist');
const intake = legacyInstance.steps[0];
const derivedIntake = resolveEffectiveStepActions(intake, template);
check(
  'the Key Actions from the template are returned when the instance stored none',
  derivedIntake.length === template.steps[0].actions.length,
  derivedIntake
);
check(
  'the checklist text matches the template 1:1 and in order',
  derivedIntake.every((action, index) => action.text === template.steps[0].actions[index]),
  derivedIntake
);
check('derived actions start unticked (progress is never invented)', derivedIntake.every((action) => action.done === false));

const preLitigation = resolveEffectiveStepActions(legacyInstance.steps[1], template);
check(
  'every step of the matter gets its own checklist instead of "No key actions configured"',
  preLitigation.length === template.steps[1].actions.length && preLitigation.length > 0
);

// The Case Management loader persists this same derivation before responding.
const backfilled = legacyInstance.steps.map((step: any) => ({ ...step, actions: resolveEffectiveStepActions(step, template) }));
check(
  'the backfill stores the template checklist on each formerly empty step',
  backfilled.every((step: any) => step.actions.length > 0 && step.actions.every((action: any) => action.done === false))
);

console.log('\nB. An instance with its own actions keeps its progress (ticks win over the template)');
const trackedInstance = {
  ...legacyInstance,
  steps: [
    {
      ...intake,
      actions: [
        { text: 'Receive client and conduct intake interview', done: true },
        { text: 'Run conflict check', done: true },
        { text: 'Sign engagement letter', done: false },
      ],
    },
  ],
};
const trackedActions = resolveEffectiveStepActions(trackedInstance.steps[0], template);
check(
  'the stored ticks are preserved exactly as recorded',
  trackedActions.map((action) => action.done).join(',') === 'true,true,false',
  trackedActions
);
check(
  'the stored action text is kept (no template override of live work)',
  trackedActions.map((action) => action.text).join('|') ===
    trackedInstance.steps[0].actions.map((action: any) => action.text).join('|')
);

console.log('\nC. Blank template actions and unknown steps stay empty');
const blankTemplate = {
  steps: [{ key: 'CIV_1_INTAKE', actions: ['', '   ', 'Real action'] }],
};
const filtered = resolveEffectiveStepActions({ stepKey: 'CIV_1_INTAKE', actions: [] }, blankTemplate);
check('blank checklist entries are dropped', filtered.length === 1 && filtered[0]?.text === 'Real action', filtered);
const unknown = resolveEffectiveStepActions({ stepKey: 'LEGACY_STEP', actions: [] }, template);
check('a step the template no longer defines resolves to an empty checklist', unknown.length === 0);
check(
  'a matter without a readable template keeps its empty checklist without throwing',
  resolveEffectiveStepActions({ stepKey: 'CIV_1_INTAKE', actions: [] }, null).length === 0
);

console.log('\nD. The checklist still resolves after legacy step normalisation');
const effectiveSteps = normalizeEffectiveWorkflowSteps(legacyInstance, template);
check(
  'normalisation keeps the empty actions untouched (checklist comes from the template)',
  effectiveSteps.every((step: any) => Array.isArray(step.actions) && step.actions.length === 0)
);
check(
  'normalisation derives the missing percentages from the template',
  effectiveSteps.every((step: any) => Number(step.percentage) > 0 && Number(step.stagePercentage) > 0),
  effectiveSteps.map((step: any) => ({
    stepKey: step.stepKey,
    percentage: step.percentage,
    stagePercentage: step.stagePercentage,
  }))
);
const caseManagementPayload = effectiveSteps.map((step: any) => ({
  stepKey: step.stepKey,
  actions: resolveEffectiveStepActions(step, template),
}));
check(
  'the Case Management payload now carries a checklist for every step',
  caseManagementPayload.every((step: any) => step.actions.length > 0),
  caseManagementPayload
);
check(
  'the Case Management checklist equals the Overview checklist for the same step',
  JSON.stringify(caseManagementPayload[0]?.actions.map((action: any) => action.text)) ===
    JSON.stringify(template.steps[0].actions)
);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);

