/**
 * Verification for the two workflow integrity fixes.
 *
 * Reported problems:
 *  1. Closed matters showed 0% / low progress even though every Key Action was
 *     ticked. `computeCompletedPercentFromInstance` weighted progress by step
 *     percentages, and many templates carry no weights (or weights that do not
 *     reach 100), so a finished workflow could never report 100%.
 *  2. Key Actions could be completed out of order, because only the UI
 *     disabled the checkbox - bulk operations and direct API calls bypassed it.
 *
 * Pure functions only - no database is touched. Run with:
 *   npm run verify:progress-and-order
 */
import { computeCompletedPercentFromInstance } from '../utils/workflowPercentages';

/** Mirrors the guard added to `completeStep`. */
const blockersBefore = (steps: any[], stepKey: string) => {
  const ordered = steps.slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  const index = ordered.findIndex((s: any) => s.stepKey === stepKey);
  if (index <= 0) return [];
  return ordered.slice(0, index).filter((s: any) => String(s?.status || '') !== 'Completed');
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

console.log('\nD. A Key Action cannot be completed before its predecessors');
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

console.log(`\nResult: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);