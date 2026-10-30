/** Pure checks: no application database, network, or environment configuration. */
import assert from 'node:assert/strict';
import { isUntouchedKeyAction, rebalanceAdditionalKeyActions } from '../utils/additionalKeyActionAllocation';
import Workflow from '../models/workflowInstanceModel';
import mongoose from 'mongoose';
import { normalizeEffectiveWorkflowSteps } from '../utils/caseEarnedFees';

const original = [
  { key: 'completed', percentage: 25, adjustable: false },
  { key: 'reserved', percentage: 15, adjustable: false },
  { key: 'a', percentage: 40, adjustable: true },
  { key: 'b', percentage: 20, adjustable: true },
];
const snapshot = JSON.stringify(original);
const result = rebalanceAdditionalKeyActions(original, [10, 5]);
assert.equal(result.percentages.get('completed'), 25);
assert.equal(result.percentages.get('reserved'), 15);
assert.equal(result.percentages.get('a'), 30);
assert.equal(result.percentages.get('b'), 15);
assert.equal(result.total, 100);
assert.equal(JSON.stringify(original), snapshot, 'A preview must not mutate its inputs');

for (const invalid of [0, -1, 101, Infinity, NaN, 1.234]) {
  assert.throws(() => rebalanceAdditionalKeyActions(original, [invalid]));
}
assert.throws(() => rebalanceAdditionalKeyActions(original, [60]));
assert.throws(() => rebalanceAdditionalKeyActions(original, [51, 10]));
assert.throws(() => rebalanceAdditionalKeyActions([{ key: 'complete', percentage: 100, adjustable: false }], [1]));
assert.throws(() => rebalanceAdditionalKeyActions([{ key: 'missing', percentage: 0, adjustable: true }], [5]));

assert(isUntouchedKeyAction({ status: 'Not Started' }));
for (const recorded of [
  { status: 'In Progress' }, { status: 'Completed' },
  { delegatedClaim: { taskId: 'reserved' } }, { doneAt: new Date() },
  { submittedAt: new Date() }, { reviewedAt: new Date() },
  { independentContributors: [{ name: 'Contributor' }] },
  { tpaSnapshots: [{ rate: 5 }] }, { correctionRequest: { reason: 'Correct work' } },
  { reviewHistory: [{ action: 'Returned' }] },
  { outputs: [{ documentId: 'uploaded' }] }, { outputs: [{ uploadedAt: new Date() }] },
  { actions: [{ done: true }] },
]) assert(!isUntouchedKeyAction({ status: 'Not Started', ...recorded }), JSON.stringify(recorded));

// Exercise many weight ratios, minimum allocations and deterministic rounding.
for (let count = 1; count <= 100; count++) {
  const steps = Array.from({ length: count }, (_, index) => ({
    key: `action-${index}`, percentage: (index + 1) * 0.01, adjustable: true,
  }));
  const allocated = rebalanceAdditionalKeyActions(steps, [7.13, 4.87]);
  assert(Math.abs(allocated.total - 100) < 0.00000001);
  assert([...allocated.percentages.values()].every((percentage) => percentage >= 0.01));
  assert.deepEqual([...allocated.percentages], [...rebalanceAdditionalKeyActions(steps, [7.13, 4.87]).percentages]);
}

const third = 100 / 3;
const legacy = rebalanceAdditionalKeyActions([
  { key: 'historical-third', percentage: third, adjustable: false },
  { key: 'a', percentage: third, adjustable: true },
  { key: 'b', percentage: third, adjustable: true },
], [10]);
assert.equal(legacy.percentages.get('historical-third'), third);
assert(Math.abs(legacy.total - 100) < 0.00000001);

// Legacy instances with no stored weights still expose their real action data.
const legacyInstance = new Workflow({
  caseId: new mongoose.Types.ObjectId(), templateId: new mongoose.Types.ObjectId(),
  steps: [{ stepKey: 'legacy', title: 'Existing action', stageKey: 'delivery', order: 1,
    status: 'Not Started', percentage: 0,
    delegatedClaim: { taskId: new mongoose.Types.ObjectId(), role: 'Initiator', claimantName: 'Contributor', claimedAt: new Date() } }],
});
const normalized = normalizeEffectiveWorkflowSteps(legacyInstance, {
  stages: [{ key: 'delivery', title: 'Delivery', percentage: 100 }],
  steps: [{ key: 'legacy', stageKey: 'delivery', percentage: 100 }],
});
assert.equal(normalized[0].stepKey, 'legacy');
assert.equal(normalized[0].title, 'Existing action');
assert.equal(normalized[0].percentage, 100);
assert.equal(normalized[0].delegatedClaim.claimantName, 'Contributor');
console.log('Additional Key Action allocation: protected work, input validation, minimum weights, rounding and legacy fractional allocations passed.');
