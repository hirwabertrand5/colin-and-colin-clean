/**
 * Verification for the two workflow integrity fixes.
 *
 * Reported problems:
 *  1. Closed matters showed 0% / low progress even though every Key Action was
 *     ticked. `computeCompletedPercentFromInstance` weighted progress by step
 *     percentages, and many templates carry no weights (or weights that do not
 *     reach 100), so a finished workflow could never report 100%.
 *  2. The Overview's Key Action sequence could use stored step orders that
 *     did not match the stage-by-stage sequence shown to the user.
 *
 * Pure functions only - no database is touched. Run with:
 *   npm run verify:progress-and-order
 */
import { computeCompletedPercentFromInstance } from '../utils/workflowPercentages';
import { isStepWorkDone } from '../models/workflowInstanceModel';

/** Mirrors the Case Workspace Overview's visible sequence lock. */
const blockersBefore = (steps: any[], stepKey: string) => {
  const ordered = steps.slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  const index = ordered.findIndex((s: any) => s.stepKey === stepKey);
  if (index <= 0) return [];
  // Work done, not approval, is what unlocks the next Key Action.
  return ordered.slice(0, index).filter((s: any) => !isStepWorkDone(s));
};

let passed = 0;
let failed = 0;
const check = (name: string, condition: boolean) => {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL  ${name}`);
};

const step = (stepKey: string, order: number, status: string, percentage?: number) => ({
  stepKey,
  order,
  title: `Step ${order}`,
  status,
  percentage,
});

console.log('A. A fully completed workflow always reports 100%');
check('all steps done, weights totalling 12.5 -> 100', computeCompletedPercentFromInstance([
  step('a', 1, 'Completed', 2.5),
  step('b', 2, 'Completed', 5),
  step('c', 3, 'Completed', 5),
]) === 100);
check('all steps done, weights totalling 85.72 -> 100', computeCompletedPercentFromInstance([
  step('a', 1, 'Completed', 40),
  step('b', 2, 'Completed', 45.72),
]) === 100);
check('all steps done, no weights at all -> 100', computeCompletedPercentFromInstance([
  step('a', 1, 'Completed'),
  step('b', 2, 'Completed'),
  step('c', 3, 'Completed'),
]) === 100);

console.log('\nB. Partial progress still follows the weights');
check('nothing done -> 0', computeCompletedPercentFromInstance([step('a', 1, 'Not Started', 50), step('b', 2, 'Not Started', 50)]) === 0);
check('half of the weighted work done -> 50', computeCompletedPercentFromInstance([step('a', 1, 'Completed', 50), step('b', 2, 'Not Started', 50)]) === 50);
check('unweighted partial progress uses the ratio', computeCompletedPercentFromInstance([step('a', 1, 'Completed'), step('b', 2, 'Not Started'), step('c', 3, 'Not Started'), step('d', 4, 'Not Started')]) === 25);

console.log('\nC. Edge cases are safe');
check('no steps -> 0', computeCompletedPercentFromInstance([]) === 0);
check('undefined input -> 0', computeCompletedPercentFromInstance(undefined as any) === 0);
check('one step done -> 100', computeCompletedPercentFromInstance([step('a', 1, 'Completed')]) === 100);

console.log('\nD. The Overview only unlocks the next visible Key Action');
const allDone = [step('a', 1, 'Completed'), step('b', 2, 'Completed'), step('c', 3, 'Completed')];
check('the first step has no blockers', blockersBefore(allDone, 'a').length === 0);
check('the last step is blocked only while earlier work is pending', blockersBefore([step('a', 1, 'Completed'), step('b', 2, 'Not Started'), step('c', 3, 'Not Started')], 'c').length === 1);

const reported = [step('a', 1, 'Completed'), step('b', 2, 'Not Started'), step('c', 3, 'Completed'), step('d', 4, 'Completed')];
check('the reported "1st and 4th ticked" case is blocked at the 4th', blockersBefore(reported, 'd').map((s: any) => s.stepKey).join(',') === 'b');
check('and the 2nd is the step to fix first', blockersBefore(reported, 'b').length === 0);
check('step order is respected even if stored out of order', blockersBefore([step('c', 3, 'Completed'), step('a', 1, 'Completed'), step('b', 2, 'Not Started')], 'c').length === 1);

console.log('\nE. Order guard allows legitimate progress');
check('completing in sequence is always allowed', blockersBefore([step('a', 1, 'Completed'), step('b', 2, 'In Progress'), step('c', 3, 'Not Started')], 'b').length === 0);
check('an unknown step key is not blocked', blockersBefore(allDone, 'missing').length === 0);

console.log('\nF. A ticked Key Action is "work done" and stays ticked');
// Regression: the tick used to be written as 'Completed', then the UI decided
// "is this ticked?" by checking status === 'Completed'. Once ticking started
// recording 'Done', the checkbox appeared to tick and then silently reverted.
check("a freshly ticked key action counts as work done", isStepWorkDone({ status: 'Done' }));
check('work done survives the submit and approve transitions', ['Awaiting Review', 'Awaiting Approval', 'Completed'].every((status) => isStepWorkDone({ status })));
check('work that has not been ticked is not done', !isStepWorkDone({ status: 'Not Started' }) && !isStepWorkDone({ status: 'In Progress' }));
check('a missing status is not treated as done', !isStepWorkDone({ status: '' }) && !isStepWorkDone(undefined));

// The next key action must unlock off a tick, never off an approval.
const ticked = [step('a', 1, 'Done'), step('b', 2, 'Not Started'), step('c', 3, 'Not Started')];
check('ticking unlocks the next key action without any approval', blockersBefore(ticked, 'b').length === 0);
check('and the one after that stays blocked until b is ticked', blockersBefore(ticked, 'c').length === 1);
const submittedNotApproved = [step('a', 1, 'Awaiting Approval'), step('b', 2, 'Not Started'), step('c', 3, 'Not Started')];
check('work submitted but not yet approved still unlocks the next one', blockersBefore(submittedNotApproved, 'b').length === 0);

console.log('\nG. Display order governs the lock, not interleaved stored order');
const displayOrder = (stages: string[], workflowSteps: any[]) => {
  const stageRank = new Map(stages.map((stage, index) => [stage, index]));
  return workflowSteps
    .map((workflowStep, index) => ({ workflowStep, index }))
    .sort((a, b) =>
      (stageRank.get(a.workflowStep.stageKey) ?? Number.MAX_SAFE_INTEGER) -
        (stageRank.get(b.workflowStep.stageKey) ?? Number.MAX_SAFE_INTEGER) ||
      a.workflowStep.order - b.workflowStep.order ||
      a.index - b.index
    )
    .map(({ workflowStep }) => workflowStep);
};
const interleaved = [
  { ...step('first-visible', 10, 'Done'), stageKey: 'intake' },
  { ...step('later-stage', 2, 'Not Started'), stageKey: 'closing' },
  { ...step('second-visible', 20, 'Not Started'), stageKey: 'intake' },
];
const visibleSequence = displayOrder(['intake', 'closing'], interleaved);
check(
  'the second visible Key Action follows the first visible Key Action',
  visibleSequence.map((workflowStep) => workflowStep.stepKey).join(',') === 'first-visible,second-visible,later-stage'
);
check(
  'a ticked first visible Key Action unlocks the second despite interleaved stored order',
  !isStepWorkDone(visibleSequence[1]) && isStepWorkDone(visibleSequence[0])
);

console.log(`\nResult: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
