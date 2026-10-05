/**
 * Verification for the Case Workspace member permissions.
 *
 * Requested behaviour:
 *  1. The Initiator and the Reviewer assigned to a matter can tick off the Key
 *     Actions they completed and amend deadlines from the Overview tab.
 *  2. The Reviewer and the Approver assigned to a matter can enter the Quality
 *     Score.
 *
 * Both rules must keep the Case Initiator out of Quality Score entry even when
 * they hold a senior role, and must never widen access to unassigned people.
 *
 * Pure predicates — no database is touched. Run with:
 *   npm run verify:case-permissions
 */
import {
  canEnterQualityScore,
  canManageWorkflowStepsOfCase,
  resolveAssignedSlot,
} from '../utils/caseAssignmentPermissions';

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

const matter = (initiator = 'Alice', reviewer = 'Robert', approver = 'Grace') => ({
  _id: 'matter-1',
  caseNo: 'C-001',
  caseAssignments: { initiator, reviewer, signerApprover: approver },
});

const ALICE = { name: 'Alice', email: 'alice@firm.com', role: 'associate' };
const ROBERT = { name: 'Robert', email: 'robert@firm.com', role: 'associate' };
const GRACE = { name: 'Grace', email: 'grace@firm.com', role: 'executive_assistant' };
const STRANGER = { name: 'Mallory', email: 'mallory@firm.com', role: 'associate' };
const INTERN = { name: 'Ivan', email: 'ivan@firm.com', role: 'intern' };

const c = matter();

console.log('A. Overview tab: the assigned members may tick Key Actions and amend deadlines');
check('the Case Initiator can complete Key Actions', canManageWorkflowStepsOfCase(c, ALICE));
check('the Reviewer can complete Key Actions', canManageWorkflowStepsOfCase(c, ROBERT));
check('the Approver can complete Key Actions', canManageWorkflowStepsOfCase(c, GRACE));
check('an administrator can complete Key Actions', canManageWorkflowStepsOfCase(c, { name: 'Managing Partner', role: 'managing_partner' }));
check('a Managing Director who is not assigned can complete Key Actions', canManageWorkflowStepsOfCase(c, { name: 'MD', role: 'managing_director' }));

console.log('\nB. Overview tab: unassigned people are refused');
check('an unassigned staff member cannot complete Key Actions', !canManageWorkflowStepsOfCase(c, STRANGER));
check('an unassigned intern cannot complete Key Actions', !canManageWorkflowStepsOfCase(c, INTERN));

console.log('\nC. Matching is case- and whitespace-insensitive, and accepts e-mail');
check('name matching ignores case', canManageWorkflowStepsOfCase(matter('alice', 'robert', 'grace'), { name: 'ALICE' }));
check('name matching ignores surrounding spaces', canManageWorkflowStepsOfCase(matter('Alice'), { name: '  Alice  ' }));
// An assignment slot holds a single literal string, so a slot filled with an
// e-mail address is recognised by that e-mail — the same exact-match convention
// used by `caseMatchesAssignee` everywhere else in the app.
check(
  'an assignment stored as an e-mail is recognised by that e-mail',
  canManageWorkflowStepsOfCase(matter('robert@firm.com'), { email: 'ROBERT@FIRM.COM' })
);
check(
  'a different e-mail does not match that assignment',
  !canManageWorkflowStepsOfCase(matter('robert@firm.com'), { email: 'rob@firm.com' })
);

console.log('\nD. Legacy matters that only store the initiator in assignedTo');
const legacyMatter = { _id: 'legacy', assignedTo: 'Alice', caseAssignments: {} };
check('the legacy assignedTo initiator can complete Key Actions', canManageWorkflowStepsOfCase(legacyMatter, ALICE));
check('someone else cannot complete Key Actions on a legacy matter', !canManageWorkflowStepsOfCase(legacyMatter, ROBERT));

console.log('\nE. Slot resolution never double-assigns a person');
check('the slot of Alice is initiator', resolveAssignedSlot(c, ALICE) === 'initiator');
check('the slot of Robert is reviewer', resolveAssignedSlot(c, ROBERT) === 'reviewer');
check('the slot of Grace is approver', resolveAssignedSlot(c, GRACE) === 'approver');
check('an unassigned person has no slot', resolveAssignedSlot(c, STRANGER) === 'none');
check(
  'a person filling two slots resolves to the first (initiator)',
  resolveAssignedSlot(matter('Alice', 'Alice', 'Alice'), ALICE) === 'initiator'
);

console.log('\nF. Quality Score: the Reviewer and the Approver may score');
check('the Reviewer can enter the Quality Score', canEnterQualityScore(c, ROBERT, 'reviewer'));
check('the Approver can enter the Quality Score', canEnterQualityScore(c, GRACE, 'approver'));
check('a Managing Partner can enter the Quality Score', canEnterQualityScore(c, { name: 'MP', role: 'managing_partner' }, 'admin'));
check('an Executive Assistant can enter the Quality Score', canEnterQualityScore(c, { name: 'EA', role: 'executive_assistant' }, 'none'));

console.log('\nG. Quality Score: the Initiator is never allowed');
check('the Case Initiator cannot enter the Quality Score', !canEnterQualityScore(c, ALICE, 'initiator'));
check(
  'the Case Initiator cannot score even while holding a senior role',
  !canEnterQualityScore(c, { name: 'Alice', role: 'managing_partner' }, 'initiator')
);
check(
  'an unassigned person with a non-supervisory role cannot score',
  !canEnterQualityScore(c, { name: 'Mallory', role: 'associate' }, 'none')
);
check(
  'an unassigned intern cannot score',
  !canEnterQualityScore(c, { name: 'Ivan', role: 'intern' }, 'none')
);
// Pre-existing rule that this change deliberately preserves: the senior
// supervisory roles may score on any matter they oversee, assigned or not.
check(
  'a Partner keeps firm-wide Quality Score rights (unchanged rule)',
  canEnterQualityScore(c, { name: 'Mallory', role: 'partner' }, 'none')
);

console.log('\nH. Quality Score permission can be resolved without a pre-computed role');
check('slot-based resolution grants the Reviewer', canEnterQualityScore(c, ROBERT));
check('slot-based resolution grants the Approver', canEnterQualityScore(c, GRACE));
check('slot-based resolution refuses the Initiator', !canEnterQualityScore(c, ALICE));
check('slot-based resolution refuses an unassigned intern', !canEnterQualityScore(c, INTERN));

console.log('\nI. A user with no identity at all is refused everywhere');
check('no identity means no Overview rights', !canManageWorkflowStepsOfCase(c, {}));
check('no identity means no Quality Score rights', !canEnterQualityScore(c, {}));
check('a null user is handled safely', !canManageWorkflowStepsOfCase(c, null));

console.log('\nJ. Empty assignments never grant access');
const emptyMatter = { _id: 'empty', caseAssignments: {} };
check('an empty assignment block grants nothing', !canManageWorkflowStepsOfCase(emptyMatter, ALICE));
check('an empty assignment block grants no Quality Score', !canEnterQualityScore(emptyMatter, ALICE, 'initiator'));

console.log(`\nResult: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);