import assert from 'node:assert/strict';
import { resolveTpaRate, validateTpaChange } from '../utils/tpaRates';
import { buildRoleByName, resolveMemberTpa, computeEarnedFee } from '../utils/workflowPercentages';
import { computeCaseTeamEarnedFees } from '../utils/caseEarnedFees';

const history = [
  { kind: 'normal', rate: 1, from: '1970-01-01T00:00:00Z', until: '2026-10-01T00:00:00Z' },
  { kind: 'normal', rate: 3, from: '2026-10-01T00:00:00Z', until: '2026-10-25T00:00:00Z' },
  { kind: 'normal', rate: 5, from: '2026-10-25T00:00:00Z', until: null },
  { kind: 'special', rate: 10, from: '2026-10-21T22:00:00Z', until: '2026-10-27T22:00:00Z' },
];
const cases: [string, number][] = [
  ['2026-09-30T23:59:59Z', 1], ['2026-10-01T00:00:00Z', 3],
  ['2026-10-21T21:59:59Z', 3], ['2026-10-22T00:00:00+02:00', 10],
  ['2026-10-26T00:00:00Z', 10], ['2026-10-28T00:00:00+02:00', 5],
];
for (const [date, rate] of cases) assert.equal(resolveTpaRate(history, date, 8), rate);
assert.equal(resolveTpaRate([], new Date(), 6), 6);
const map = buildRoleByName([{ name: 'Staff Member', role: 'associate', tpaHistory: history }]);
for (const [date, rate] of cases) assert.equal(resolveMemberTpa(' STAFF MEMBER ', map, date).tpaPercent, rate);
assert.equal(computeEarnedFee(1000, resolveMemberTpa('Staff Member', map, cases[0]![0]).tpaPercent, 100, 100), 10);
assert.equal(computeEarnedFee(0, 10, 100, 100), 0);
const input = { kind: 'special', rate: 10, from: '2026-10-23T00:00:00Z', reason: 'Approved', confirmBackdated: true };
assert.throws(() => validateTpaChange(history, input), /overlap/);
assert.throws(() => validateTpaChange([], { ...input, rate: -1 }), /Rate/);
assert.throws(() => validateTpaChange([], { ...input, from: '2026-10-23' }), /timezone/);
assert.throws(() => validateTpaChange([], { ...input, confirmBackdated: false }, new Date('2026-10-28T00:00:00Z')), /backdated/);
assert.throws(() => validateTpaChange([], { ...input, until: input.from }), /End/);
assert.throws(() => validateTpaChange([], { ...input, reason: ' ' }), /reason/);
const actions = [
  { key: 'old', completedAt: '2026-09-30T12:00:00Z' },
  { key: 'special', completedAt: '2026-10-23T12:00:00Z' },
];
const team = computeCaseTeamEarnedFees({
  caseDoc: { caseAssignments: { initiator: 'Staff Member' } },
  roleByName: map, completedActions: actions,
  actionCollectedBaseByKey: new Map([['old', 1000], ['special', 1000]]),
});
assert.equal(team.length, 1);
assert.equal(team[0]?.actionTpaRates.old, 1);
assert.equal(team[0]?.actionTpaRates.special, 10);
assert.equal(team[0]?.tpaPercent, 5.5);
assert.equal(team[0]?.taskFeeCollected, 2000);
const delegatedTeam = computeCaseTeamEarnedFees({
  caseDoc: {}, roleByName: map, completedActions: [actions[1]!],
  workflowInstance: { steps: [{ stepKey: 'special', submittedAt: '2026-10-23T12:00:00Z', independentContributors: [{ role: 'Initiator', name: 'Staff Member', actedAt: '2026-09-30T12:00:00Z', taskId: 'delegated' }] }] },
  actionCollectedBaseByKey: new Map([['special', 1000]]),
});
assert.equal(delegatedTeam[0]?.actionTpaRates.special, 1);
assert.deepEqual(delegatedTeam[0]?.independentTaskIds, ['delegated']);
console.log('TPA resolver, case attribution, delegation and validation checks passed.');
