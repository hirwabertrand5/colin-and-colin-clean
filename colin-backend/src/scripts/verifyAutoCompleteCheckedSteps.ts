/**
 * Verification for the automatic section completion fix.
 *
 * Reported issue: a section whose Key Actions were all ticked stayed
 * "In Progress" because the big completion checkbox can only be ticked by users
 * with matter-management permission (interns/associates tick Key Actions only).
 * Ticking the last Key Action now completes the section automatically, and the
 * repair script clears that state on existing matters.
 *
 * Pure functions only — no database is touched. Run with:
 *   npx tsx src/scripts/verifyAutoCompleteCheckedSteps.ts
 */
import { isStepChecklistReadyToAutoComplete } from '../utils/workflowCompute';

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

const step = (stepKey: string, order: number, status: string, actions: Array<{ text: string; done: boolean }>) => ({
  stepKey,
  order,
  title: `Section ${order}`,
  status,
  actions,
});
const done = (text: string) => ({ text, done: true });
const pending = (text: string) => ({ text, done: false });

/** Mirrors the ordered walk used by toggleStepAction and the repair script. */
const planRepair = (steps: any[]) => {
  const ordered = [...steps].sort((a, b) => (a.order || 0) - (b.order || 0));
  const completed: string[] = [];
  let blockedBy: any = null;
  for (const candidate of ordered) {
    if (String(candidate?.status || '') === 'Completed') continue;
    if (!isStepChecklistReadyToAutoComplete(candidate)) {
      blockedBy = candidate;
      break;
    }
    completed.push(String(candidate.stepKey));
  }
  const remaining = ordered.filter(
    (candidate) => String(candidate?.status || '') !== 'Completed' && !completed.includes(String(candidate.stepKey))
  );
  return { completed, blockedBy, closesMatter: remaining.length === 0, currentStepKey: remaining[0]?.stepKey ?? null };
};

console.log('A. Ticking the last Key Action makes the section auto-completable');
check('an In Progress section with every Key Action ticked is ready', isStepChecklistReadyToAutoComplete(step('A', 1, 'In Progress', [done('x'), done('y')])));
check('a Not Started section with every Key Action ticked is ready', isStepChecklistReadyToAutoComplete(step('A', 1, 'Not Started', [done('x')])));
check('a section with a pending Key Action is not ready', !isStepChecklistReadyToAutoComplete(step('A', 1, 'In Progress', [done('x'), pending('y')])));
check('a section without Key Actions is never auto-completed', !isStepChecklistReadyToAutoComplete(step('A', 1, 'In Progress', [])));
check('a malformed section without actions is never auto-completed', !isStepChecklistReadyToAutoComplete({ stepKey: 'A', status: 'In Progress' }));

console.log('\nB. The Case Management review chain is never bypassed');
check('an Awaiting Review section stays with the Reviewer', !isStepChecklistReadyToAutoComplete(step('A', 1, 'Awaiting Review', [done('x')])));
check('an Awaiting Approval section stays with the Signer', !isStepChecklistReadyToAutoComplete(step('A', 1, 'Awaiting Approval', [done('x')])));
check('a Completed section is left alone', !isStepChecklistReadyToAutoComplete(step('A', 1, 'Completed', [done('x')])));

console.log('\nC. The repair pass completes every fully checked section in order');
const repair = planRepair([
  step('S1', 1, 'In Progress', [done('a'), done('b')]),
  step('S2', 2, 'Not Started', [done('c')]),
  step('S3', 3, 'In Progress', [done('d'), pending('e')]),
  step('S4', 4, 'In Progress', [done('f')]),
]);
check('both fully checked sections are completed', repair.completed.join(',') === 'S1,S2', repair);
check('the pass stops at the first section with pending Key Actions', String(repair.blockedBy?.stepKey) === 'S3', repair);
check('later sections are not completed out of order', !repair.completed.includes('S4'));
check('the matter stays open and points at the pending section', !repair.closesMatter && repair.currentStepKey === 'S3', repair);

console.log('\nD. A section awaiting review stops the pass without completing it');
const reviewChain = planRepair([
  step('S1', 1, 'Completed', [done('a')]),
  step('S2', 2, 'Awaiting Review', [done('b')]),
  step('S3', 3, 'In Progress', [done('c')]),
]);
check('the awaiting-review section is not completed', !reviewChain.completed.includes('S2'), reviewChain);
check('the pass stops at the review chain', String(reviewChain.blockedBy?.stepKey) === 'S2');
check('later fully checked sections wait for the review chain', !reviewChain.completed.includes('S3'));

console.log('\nE. A matter whose last section is completed by the pass closes');
const finalPass = planRepair([
  step('S1', 1, 'Completed', [done('a')]),
  step('S2', 2, 'In Progress', [done('b'), done('c')]),
]);
check('the last fully checked section is completed', finalPass.completed.join(',') === 'S2', finalPass);
check('the matter workflow completes (case closes, like the manual checkbox)', finalPass.closesMatter);
check('no current section remains', finalPass.currentStepKey === null);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
