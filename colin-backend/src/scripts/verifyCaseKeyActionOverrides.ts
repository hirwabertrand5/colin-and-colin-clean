/**
 * Verification for case-only Key Action edits/deletes (pure fixtures).
 * Run with:  npx tsx src/scripts/verifyCaseKeyActionOverrides.ts
 */
import { alignInstanceStepsToTemplate, hasSupersededTemplateSteps } from '../utils/workflowAlignment';
import { calculateCollectedKeyActionEarnings } from '../utils/keyActionEarnings';

let passed = 0;
let failed = 0;
const check = (name: string, condition: boolean, detail?: unknown) => {
  if (condition) { passed += 1; console.log(`  PASS  ${name}`); return; }
  failed += 1; console.log(`  FAIL  ${name}`);
  if (detail !== undefined) console.log('        ', JSON.stringify(detail));
};
const start = new Date('2026-01-05T09:00:00.000Z');
const template: any = {
  _id: 'tpl-1', name: 'COMMERCIAL WORKFLOW', matterType: 'Commercial',
  caseType: 'Transactional Cases', version: 1, active: true, draft: false,
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

console.log('A. An overridden Key Action keeps its case values across alignment');
const prevTitle = 'Conflict check (matter-specific wording)';
const alignedA = alignInstanceStepsToTemplate(
  [
    { stepKey: 'ON_1', title: 'Client onboarding', stageKey: 'onboarding', order: 1, status: 'Not Started', actions: [] },
    { stepKey: 'ON_2', title: prevTitle, stageKey: 'execution', stageTitle: 'Execution', stageOrder: 1, stagePercentage: 50, percentage: 10, order: 2.5, customOrder: 2.5, overridden: true, status: 'In Progress', startAt: start, dueAt: new Date('2026-01-15T09:00:00.000Z'), actions: [] },
    { stepKey: 'EX_1', title: 'Draft agreement', stageKey: 'execution', order: 3, status: 'Not Started', actions: [] },
  ] as any, template, start);
const keptA = alignedA.steps.find((s: any) => s.stepKey === 'ON_2');
check('the edited Key Action stays on the checklist', Boolean(keptA));
check('its case title wins over the template', keptA?.title === prevTitle, keptA?.title);
check('its case stage wins over the template', keptA?.stageKey === 'execution', keptA?.stageKey);
check('its case position wins over the template', keptA?.order === 2.5, keptA?.order);
check('its case percentage wins over the template', keptA?.percentage === 10, keptA?.percentage);
check('it stays flagged as a case override', keptA?.overridden === true);
check('its lifecycle status is untouched', keptA?.status === 'In Progress');

console.log('B. Lifecycle fields survive with the override');
const dueB = new Date('2026-02-01T09:00:00.000Z');
const alignedB = alignInstanceStepsToTemplate(
  [{ stepKey: 'ON_2', title: 'Renamed on this matter', stageKey: 'onboarding', order: 1.5, overridden: true, status: 'Done', doneAt: dueB, dueAt: dueB, startAt: start, extensionHistory: [{ days: 2, reason: 'client delay' }], actions: [] }] as any,
  template, start);
const keptB = alignedB.steps.find((s: any) => s.stepKey === 'ON_2');
check('the edited Key Action survives', Boolean(keptB));
check('it keeps its Done status', keptB?.status === 'Done');
check('it keeps its deadline', Boolean(keptB?.dueAt) && new Date(keptB?.dueAt as any).getTime() === dueB.getTime());
check('it keeps its amendment history', Array.isArray(keptB?.extensionHistory) && keptB.extensionHistory.length === 1);

console.log('C. A case-deleted Key Action never returns');
const alignedC = alignInstanceStepsToTemplate(
  [
    { stepKey: 'ON_1', title: 'Client onboarding', stageKey: 'onboarding', order: 1, status: 'Not Started', actions: [] },
    { stepKey: 'EX_1', title: 'Draft agreement', stageKey: 'execution', order: 3, status: 'Not Started', actions: [] },
  ] as any, template, start, { deletedStepKeys: ['ON_2'] });
const keysC = alignedC.steps.map((s: any) => s.stepKey);
check('alignment does not restore the deleted step', !keysC.includes('ON_2'), keysC);
check('the deleted step is not archived either', !alignedC.archivedSteps.some((s: any) => s.stepKey === 'ON_2'));
check('a deleted step is not reported as drift', hasSupersededTemplateSteps(
  [
    { stepKey: 'ON_1', title: 'Client onboarding', stageKey: 'onboarding', order: 1 },
    { stepKey: 'EX_1', title: 'Draft agreement', stageKey: 'execution', order: 3 },
  ] as any, template, ['ON_2']) === false);

console.log('D. Earnings honour the case-only edit and delete');
const earnings = calculateCollectedKeyActionEarnings({
  matter: { contractValue: 100000 }, template,
  workflowInstance: {
    steps: [
      { stepKey: 'ON_1', title: 'Client onboarding', status: 'Completed', completedAt: start, percentage: 25 },
      { stepKey: 'ON_2', title: 'Conflict check (matter wording)', status: 'Completed', completedAt: start, percentage: 10, overridden: true },
    ],
    deletedStepKeys: ['EX_1'],
  },
  tasks: [], collectedAmount: 100000,
});
check('completed percent uses the case percentage (25 + 10 = 35)', earnings.completedPercent === 35, earnings.completedPercent);
check('the deleted step earns nothing', !earnings.completedActions.some((a) => a.key === 'EX_1'));
check('the deleted step is absent from progress rows', !earnings.keyActions.some((a) => a.key === 'EX_1'));

console.log('E. A Completed (ticked) Key Action keeps its stamps under a case edit');
const doneAt = new Date('2026-03-01T10:00:00.000Z');
const alignedE = alignInstanceStepsToTemplate(
  [{
    stepKey: 'ON_1', title: 'Client onboarding (updated wording)', stageKey: 'onboarding',
    order: 1.25, customOrder: 1.25, overridden: true, status: 'Completed',
    completedAt: doneAt, doneAt, submittedAt: doneAt, reviewedAt: doneAt,
    startAt: start, dueAt: new Date('2026-01-15T09:00:00.000Z'),
    extensionHistory: [{ days: 1, reason: 'client delay' }], actions: [],
  }] as any,
  template, start);
const keptE = alignedE.steps.find((s: any) => s.stepKey === 'ON_1');
check('the completed Key Action survives alignment', Boolean(keptE));
check('it keeps its Completed status', keptE?.status === 'Completed');
check('it keeps its completion stamp', Boolean(keptE?.completedAt) && new Date(keptE?.completedAt as any).getTime() === doneAt.getTime());
check('it keeps its frozen work-finished stamp', Boolean(keptE?.doneAt) && new Date(keptE?.doneAt as any).getTime() === doneAt.getTime());
check('it keeps its review-chain stamps', Boolean(keptE?.submittedAt) && Boolean(keptE?.reviewedAt));

console.log('');
console.log(`Case-only Key Action checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

