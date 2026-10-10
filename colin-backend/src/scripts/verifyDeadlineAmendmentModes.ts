import { buildInstanceSteps } from '../utils/workflowCompute';
import {
  activeAmendmentsOf,
  amendmentModeOf,
  effectiveAmendedDueAt,
  hasActiveFixedAmendment,
} from '../utils/workflowSchedule';

let failures = 0;
const check = (label: string, cond: boolean, detail?: string) => {
  if (cond) console.log(`ok - ${label}`);
  else {
    failures += 1;
    console.error(`FAIL - ${label}${detail ? `: ${detail}` : ''}`);
  }
};

const d = (iso: string) => new Date(iso);
const START = d('2026-10-09T12:00:00.000Z');
const template = {
  stages: [
    { key: 's1', order: 1, title: 'S1', sla: { unit: 'days', max: 10 } },
    { key: 's2', order: 2, title: 'S2', sla: { unit: 'days', max: 8 } },
  ],
  steps: [
    { key: 'a', order: 1, title: 'a', stageKey: 's1', sla: { unit: 'days', max: 10 } },
    { key: 'b', order: 2, title: 'b', stageKey: 's2', sla: { unit: 'days', max: 8 } },
  ],
};

// Simulate the amend endpoint's standard propagation on plain step objects.
const applyAmendment = (steps: any[], key: string, newDue: Date, mode: 'standard' | 'fixed') => {
  const rankOf = (s: any) => (typeof s?.stageOrder === 'number' ? Number(s.stageOrder) : Number(s?.order ?? 0));
  const ordered = steps.slice().sort((a, b) => rankOf(a) - rankOf(b) || Number(a?.order ?? 0) - Number(b?.order ?? 0));
  const step = steps.find((s) => s.stepKey === key);
  const oldDue = new Date(step.dueAt);
  const delta = newDue.getTime() - oldDue.getTime();
  step.dueAt = newDue;
  step.extensionHistory = step.extensionHistory || [];
  step.extensionHistory.push({ previousDueAt: oldDue, newDueAt: newDue, days: delta / 86400000, mode });
  if (mode !== 'fixed') {
    const idx = ordered.findIndex((s) => s.stepKey === key);
    for (const down of ordered.slice(idx + 1)) {
      if (hasActiveFixedAmendment(down)) continue;
      down.startAt = new Date(new Date(down.startAt).getTime() + delta);
      down.dueAt = new Date(new Date(down.dueAt).getTime() + delta);
    }
  }
  return delta;
};

// 3/6. Fixed pins only its own action; standard propagates as before.
{
  const steps: any[] = buildInstanceSteps(template as never, START);
  const bPlanned = new Date(steps.find((s: any) => s.stepKey === 'b').dueAt);
  applyAmendment(steps, 'a', d('2026-10-15T12:00:00.000Z'), 'fixed');
  const b = steps.find((s: any) => s.stepKey === 'b');
  check('fixed: downstream untouched', new Date(b.dueAt).getTime() === bPlanned.getTime());
  check('fixed: mode persisted on record', amendmentModeOf(b && steps.find((s: any) => s.stepKey === 'a').extensionHistory[0]) === 'fixed');
  check('fixed: hasActiveFixedAmendment', hasActiveFixedAmendment(steps.find((s: any) => s.stepKey === 'a')) === true);
}
{
  const steps: any[] = buildInstanceSteps(template as never, START);
  const bPlanned = new Date(steps.find((s: any) => s.stepKey === 'b').dueAt);
  applyAmendment(steps, 'a', d('2026-10-15T12:00:00.000Z'), 'standard');
  const b = steps.find((s: any) => s.stepKey === 'b');
  check('standard: downstream shifts equally', new Date(b.dueAt).getTime() - bPlanned.getTime() === d('2026-10-15T12:00:00.000Z').getTime() - d('2026-10-19T12:00:00.000Z').getTime());
}

// 4. History is append-only with per-record modes.
{
  const steps: any[] = buildInstanceSteps(template as never, START);
  applyAmendment(steps, 'a', d('2026-10-15T12:00:00.000Z'), 'fixed');
  applyAmendment(steps, 'a', d('2026-10-20T12:00:00.000Z'), 'standard');
  const a = steps.find((s: any) => s.stepKey === 'a');
  check('history: two distinct records', a.extensionHistory.length === 2);
  check('history: modes preserved per record', amendmentModeOf(a.extensionHistory[0]) === 'fixed' && amendmentModeOf(a.extensionHistory[1]) === 'standard');
  check('history: effective = newest active', (effectiveAmendedDueAt(a) as Date).getTime() === d('2026-10-20T12:00:00.000Z').getTime());
  check('history: active count', activeAmendmentsOf(a).length === 2);
}

// 5. Revocation reconciles from remaining history, never by subtraction.
{
  const steps: any[] = buildInstanceSteps(template as never, START);
  applyAmendment(steps, 'a', d('2026-10-15T12:00:00.000Z'), 'fixed');
  applyAmendment(steps, 'a', d('2026-10-20T12:00:00.000Z'), 'standard');
  const a = steps.find((s: any) => s.stepKey === 'a');
  a.extensionHistory[1].revoked = true;
  check('revoke: newest active wins', (effectiveAmendedDueAt(a) as Date).getTime() === d('2026-10-15T12:00:00.000Z').getTime());
  a.extensionHistory[0].revoked = true;
  check('revoke: no active records -> undefined (baseline restore path)', effectiveAmendedDueAt(a) === undefined);
}

// Legacy compatibility: no mode means standard.
{
  check('legacy: missing mode reads as standard', amendmentModeOf({ days: 2 }) === 'standard');
  check('legacy: revoked record inactive', activeAmendmentsOf({ extensionHistory: [{ days: 1, revoked: true }] } as never).length === 0);
  check('legacy: step without history has no pin', hasActiveFixedAmendment({ extensionHistory: [] }) === false);
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All deadline amendment mode checks passed.');

