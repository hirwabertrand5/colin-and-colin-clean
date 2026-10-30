/** Preview mirror of colin-backend/src/utils/additionalKeyActionAllocation.ts. Keep the allocation algorithm in sync. */
export interface KeyActionAllocationInput {
  key: string;
  percentage: number;
  adjustable: boolean;
}

export const rebalanceAdditionalKeyActions = (
  steps: KeyActionAllocationInput[],
  additionalPercentages: number[]
) => {
  if (!additionalPercentages.length) throw new Error('Add at least one additional Key Action.');
  for (const percentage of additionalPercentages) {
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100
      || Math.abs(percentage * 100 - Math.round(percentage * 100)) > 0.0000001) {
      throw new Error('Additional Key Action percentages must be above 0%, at most 100%, and use up to two decimal places.');
    }
  }
  for (const step of steps) {
    if (!Number.isFinite(step.percentage) || step.percentage < 0 || step.percentage > 100) {
      throw new Error('The matter has an invalid Key Action percentage. Correct its workflow before adding work.');
    }
  }
  const addedTotal = additionalPercentages.reduce((sum, percentage) => sum + percentage, 0);
  const protectedTotal = steps.filter((step) => !step.adjustable).reduce((sum, step) => sum + step.percentage, 0);
  const available = 100 - protectedTotal - addedTotal;
  const adjustable = steps.filter((step) => step.adjustable && step.percentage > 0);
  const percentages = new Map(steps.map((step) => [step.key, step.percentage]));
  if (available < -0.00000001 || available + 0.00000001 < adjustable.length * 0.01) {
    throw new Error('There is not enough unstarted, unreserved workflow allocation for these additional Key Actions. Reduce their percentages.');
  }
  if (!adjustable.length) {
    if (Math.abs(available) > 0.00000001) {
      throw new Error('No untouched Key Actions are available to rebalance this workflow to 100%.');
    }
  } else {
    // Reserve one cent of a percent for every positive action, then allocate
    // the rest proportionally. Largest remainders keep rounding deterministic.
    const availableCents = Math.floor(available * 100 + 0.00000001);
    const distributableCents = availableCents - adjustable.length;
    const weightTotal = adjustable.reduce((sum, step) => sum + step.percentage, 0);
    const shares = adjustable.map((step, index) => {
      const exact = distributableCents * step.percentage / weightTotal;
      return { step, index, cents: 1 + Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let remainingCents = availableCents - shares.reduce((sum, share) => sum + share.cents, 0);
    const remainderOrder = shares.slice().sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (const share of remainderOrder) {
      if (remainingCents-- <= 0) break;
      share.cents++;
    }
    for (const share of shares) percentages.set(share.step.key, share.cents / 100);
    // Legacy protected weights may have more than two decimals. Preserve those
    // exact weights rather than rounding historical work; absorb the fractional
    // cent in the final adjustable action.
    const final = shares[shares.length - 1]!;
    const fractionalRemainder = available - availableCents / 100;
    percentages.set(final.step.key, final.cents / 100 + fractionalRemainder);
  }
  return {
    percentages,
    changes: steps.filter((step) => Math.abs((percentages.get(step.key) ?? 0) - step.percentage) > 0.00000001)
      .map((step) => ({ key: step.key, from: step.percentage, to: percentages.get(step.key)! })),
    total: [...percentages.values()].reduce((sum, percentage) => sum + percentage, addedTotal),
  };
};

