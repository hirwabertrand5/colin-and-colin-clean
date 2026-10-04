/**
 * Verification for the workflow-template matching + case alignment fixes.
 *
 * Reproduces the reported issue with fixtures: a matter type exists as both an
 * older duplicate/version and the current template, and a case was created
 * against the wrong copy. It then checks that:
 *
 *   A. matching always resolves to the canonical template (published, newest
 *      version, most recently updated) — not "the first document found";
 *   B. alignment rebuilds the checklist from the template while keeping ticks
 *      by action text, deadlines, status and completed history;
 *   C. unticked leftovers of a superseded template are removed;
 *   D. completed legacy work is preserved by default and pruned only when the
 *      caller asks for it;
 *   E. the retired per-step sub-checklist leaves the active checklist: ticked
 *      items are archived with their tick and timestamp, unticked items are
 *      dropped, and the step itself keeps its status and deadline.
 *
 * Pure functions only — no database is touched. Run with:
 *   npx tsx src/scripts/verifyMatterTypeAlignment.ts
 */
import { alignInstanceStepsToTemplate } from '../utils/workflowAlignment';
import {
  buildCanonicalTemplateIndex,
  resolveCanonicalTemplateForCase,
  templateCanonicalGroupKey,
} from '../utils/workflowTemplateMatch';

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

const oldCivilTemplate = {
  _id: 'old-civil',
  name: 'CIVIL PROCEDURE WORKFLOW',
  matterType: 'Civil Litigation',
  caseType: 'Litigation Cases',
  version: 1,
  active: true,
  draft: false,
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  stages: [{ key: 'intake', title: 'Intake', percentage: 50, order: 1 }],
  steps: [
    {
      key: 'key_action_1',
      title: 'Receive client and conduct initial interview',
      stageKey: 'intake',
      order: 1,
      percentage: 50,
      actions: ['Receive client and conduct initial interview'],
    },
  ],
};

const civilTemplate = {
  _id: 'civil-v2',
  name: 'Civil Litigation',
  matterType: 'Civil Litigation',
  caseType: 'Litigation Cases',
  version: 2,
  active: true,
  draft: false,
  updatedAt: new Date('2026-02-01T00:00:00.000Z'),
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
      actions: ['Conflict check, open file, sign retainer and collect documents', 'Advise on merits, costs and risks'],
    },
    {
      key: 'CIV_2_PRE_LITIGATION',
      title: 'Demand, filing, service and defence response',
      stageKey: 'pre_litigation',
      order: 2,
      percentage: 80,
      actions: ['Draft demand letter and attempt amicable settlement'],
    },
  ],
};


console.log('\nA. Canonical template matching');
const index = buildCanonicalTemplateIndex([oldCivilTemplate, civilTemplate]);
check(
  'the published newest version wins over an older duplicate',
  String(index.get(templateCanonicalGroupKey('Civil Litigation', 'Litigation Cases'))?._id) === 'civil-v2'
);
check(
  'matching is case/space insensitive and case-type aware',
  String(
    resolveCanonicalTemplateForCase([oldCivilTemplate, civilTemplate], {
      matterType: ' civil  litigation ',
      caseType: 'Litigation Cases',
    })?._id
  ) === 'civil-v2'
);
check(
  'a legacy label that stored the template name still resolves',
  String(
    resolveCanonicalTemplateForCase([oldCivilTemplate, civilTemplate], {
      name: 'civil litigation',
      caseType: 'Litigation Cases',
    })?._id
  ) === 'civil-v2'
);

console.log('\nB. Checklist alignment keeps progress');
const caseSteps = [
  {
    stepKey: 'key_action_1',
    title: 'Receive client and conduct initial interview',
    stageKey: 'intake',
    order: 1,
    status: 'Completed',
    completedAt: new Date('2026-01-06T00:00:00.000Z'),
    startAt: new Date('2026-01-05T09:00:00.000Z'),
    dueAt: new Date('2026-01-07T09:00:00.000Z'),
    percentage: 50,
    actions: [
      { text: 'Receive client and conduct initial interview', done: true, doneAt: new Date('2026-01-06T00:00:00.000Z') },
    ],
  },
  {
    stepKey: 'CIV_1_INTAKE',
    title: 'Client intake and due diligence',
    stageKey: 'intake',
    order: 2,
    status: 'In Progress',
    startAt: new Date('2026-01-05T09:00:00.000Z'),
    dueAt: new Date('2026-01-08T09:00:00.000Z'),
    percentage: 0,
    actions: [{ text: '1. Conflict check, open file, sign retainer and collect documents', done: true }],
  },
];

const aligned = alignInstanceStepsToTemplate(caseSteps, civilTemplate, start);
const civIntake = aligned.steps.find((step: any) => step.stepKey === 'CIV_1_INTAKE');
const civPreLit = aligned.steps.find((step: any) => step.stepKey === 'CIV_2_PRE_LITIGATION');

check('every template step is present', Boolean(civIntake && civPreLit));
check(
  'the live deadline is kept',
  civIntake?.dueAt instanceof Date && civIntake.dueAt.toISOString() === '2026-01-08T09:00:00.000Z'
);
check('the active checklist no longer carries a per-step sub-checklist', civIntake?.actions?.length === 0);
check(
  'the ticked checklist item is archived with its numbered text cleaned',
  aligned.archivedActions.length === 1 &&
    aligned.archivedActions[0]?.text === 'Conflict check, open file, sign retainer and collect documents' &&
    aligned.archivedActions[0]?.done === true &&
    aligned.archivedActions[0]?.reason === 'sub-checklist-retired'
);
check(
  'a completed legacy step is ARCHIVED, not listed on the active checklist',
  aligned.summary.keptLegacySteps.length === 1 && aligned.archivedSteps.length === 1
);
check(
  'the active checklist only carries the template steps',
  !aligned.steps.some((step: any) => String(step.stepKey) === 'key_action_1')
);
check(
  'the archived legacy step keeps its completed status and ticks',
  aligned.archivedSteps[0]?.status === 'Completed' &&
    aligned.archivedSteps[0]?.actions?.some((action: any) => action?.done)
);
check(
  'completed legacy work is never reported as dropped',
  !aligned.summary.droppedActions.some((text: string) => text.includes('Receive client and conduct initial interview'))
);


console.log('\nC. Unticked leftovers of the old template are removed');
const withLeftover = alignInstanceStepsToTemplate(
  [
    ...caseSteps,
    {
      stepKey: 'key_action_9',
      title: 'Flattened old step',
      stageKey: 'intake',
      order: 9,
      status: 'Not Started',
      percentage: 1,
      actions: [{ text: 'Unticked leftover of a superseded template', done: false }],
    },
    {
      stepKey: 'CIV_1_INTAKE',
      title: 'Client intake and due diligence',
      stageKey: 'intake',
      order: 2,
      status: 'In Progress',
      startAt: new Date('2026-01-05T09:00:00.000Z'),
      dueAt: new Date('2026-01-08T09:00:00.000Z'),
      percentage: 0,
      actions: [
        { text: 'Conflict check, open file, sign retainer and collect documents', done: true },
        { text: 'Stale unticked extra key action', done: false },
      ],
    },
  ],
  civilTemplate,
  start
);
check(
  'an unticked stale step is dropped',
  withLeftover.summary.droppedSteps.some((key: string) => key.startsWith('key_action_9'))
);
check(
  'an unticked stale key action is dropped',
  withLeftover.summary.droppedActions.some((text: string) => text.includes('Stale unticked extra key action'))
);
check(
  'the aligned checklist no longer carries the unticked stale step',
  !withLeftover.steps.some((step: any) => String(step.stepKey) === 'key_action_9')
);
check(
  'completed legacy steps are archived in the same pass, never re-listed',
  withLeftover.archivedSteps.some((step: any) => String(step.stepKey) === 'key_action_1') &&
    !withLeftover.steps.some((step: any) => String(step.stepKey) === 'key_action_1')
);
check(
  'the unticked stale key action is dropped, not archived',
  withLeftover.summary.droppedActions.some((text: string) => text.includes('Stale unticked extra key action')) &&
    !withLeftover.archivedActions.some((action: any) => action.text.includes('Stale unticked extra key action'))
);
check(
  'the ticked checklist item on the matching step is archived, not lost',
  withLeftover.archivedActions.some(
    (action: any) =>
      action.stepKey === 'CIV_1_INTAKE' &&
      action.text === 'Conflict check, open file, sign retainer and collect documents'
  )
);

console.log('\nD. Opt-in pruning of completed legacy work');
const pruned = alignInstanceStepsToTemplate(caseSteps, civilTemplate, start, { keepLegacyProgress: false });
check(
  'completed legacy step is pruned on request',
  pruned.summary.droppedSteps.length === 1 && pruned.summary.keptLegacySteps.length === 0
);
check('pruned legacy work is not archived either', pruned.archivedSteps.length === 0);
check('the checklist then matches the template exactly', pruned.steps.length === civilTemplate.steps.length);

const prunedExtras = alignInstanceStepsToTemplate(
  [
    {
      stepKey: 'CIV_1_INTAKE',
      title: 'Client intake and due diligence',
      stageKey: 'intake',
      order: 1,
      status: 'In Progress',
      actions: [
        { text: 'Conflict check, open file, sign retainer and collect documents', done: true },
        { text: 'Zzz ticked case-only key action', done: true },
      ],
    },
  ],
  civilTemplate,
  start,
  { keepLegacyProgress: false }
);
check(
  'a ticked case-only key action is pruned, not archived, when pruning is requested',
  prunedExtras.archivedActions.length === 0 &&
    prunedExtras.summary.droppedActions.some((text: string) => text.includes('Zzz ticked case-only key action'))
);

console.log('\nE. The retired per-step sub-checklist leaves the checklist and keeps its record');
const retired = alignInstanceStepsToTemplate(
  [
    {
      stepKey: 'CIV_1_INTAKE',
      title: 'Client intake and due diligence',
      stageKey: 'intake',
      order: 1,
      status: 'In Progress',
      startAt: new Date('2026-01-05T09:00:00.000Z'),
      dueAt: new Date('2026-01-08T09:00:00.000Z'),
      percentage: 0,
      actions: [
        { text: 'Conflict check, open file, sign retainer and collect documents', done: true, doneAt: new Date('2026-01-06T00:00:00.000Z') },
        { text: 'Follow up on president certificate confirming successful mediation', done: true, doneAt: new Date('2026-01-07T00:00:00.000Z') },
        { text: 'Unticked extra key action', done: false },
      ],
    },
  ],
  civilTemplate,
  start
);
const retiredIntake = retired.steps.find((step: any) => String(step.stepKey) === 'CIV_1_INTAKE');
check('the step itself stays on the active checklist', Boolean(retiredIntake));
check('no sub-checklist item stays on the active checklist', retiredIntake?.actions?.length === 0);
check(
  'every ticked checklist item is archived with its tick and timestamp',
  retired.archivedActions.length === 2 &&
    retired.archivedActions.every(
      (action: any) => action.done === true && action.doneAt instanceof Date && action.reason === 'sub-checklist-retired'
    )
);
check(
  'the unticked checklist item is dropped, not archived',
  retired.summary.droppedActions.some((text: string) => text.includes('Unticked extra key action')) &&
    !retired.archivedActions.some((action: any) => action.text === 'Unticked extra key action')
);
check('the step lifecycle is untouched', retiredIntake?.status === 'In Progress');
check(
  'the step deadline is untouched',
  retiredIntake?.dueAt instanceof Date && retiredIntake.dueAt.toISOString() === '2026-01-08T09:00:00.000Z'
);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
