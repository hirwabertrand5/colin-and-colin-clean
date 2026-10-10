import { buildInstanceSteps } from '../utils/workflowCompute';
import { buildWorkflowSchedule, selectNextScheduledStepKey, selectNextWorkPendingStepKey } from '../utils/workflowSchedule';

let failures = 0;
const check = (label: string, cond: boolean, detail?: string) => {
  if (cond) console.log(`ok - ${label}`);
  else {
    failures += 1;
    console.error(`FAIL - ${label}${detail ? `: ${detail}` : ''}`);
  }
};

const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
const START = new Date('2026-10-09T12:00:00.000Z');

// 1. Three actions in a 10-day stage share one deadline.
{
  const template = {
    stages: [{ key: 'intake', order: 1, sla: { unit: 'days', max: 10 } }],
    steps: [1, 2, 3].map((n) => ({
      key: `a${n}`,
      order: n,
      title: `action ${n}`,
      stageKey: 'intake',
      sla: { unit: 'days', max: 10 },
    })),
  };
  const plan = buildWorkflowSchedule(template as never, START);
  const first = plan[0];
  check('1. same-stage actions share one deadline', plan.length === 3 && Boolean(first) && plan.every((s) => s.dueAt.getTime() === (first as { dueAt: Date }).dueAt.getTime()));
  check('1. offset is 10 days', Boolean(first) && daysBetween(START, (first as { dueAt: Date }).dueAt) === 10, String(first && daysBetween(START, (first as { dueAt: Date }).dueAt)));
}

// 2. 10/8/30-day stages give cumulative offsets 10/18/48.
{
  const template = {
    stages: [
      { key: 's1', order: 1, sla: { unit: 'days', max: 10 } },
      { key: 's2', order: 2, sla: { unit: 'days', max: 8 } },
      { key: 's3', order: 3, sla: { unit: 'days', max: 30 } },
    ],
    steps: [
      { key: 'a', order: 1, title: 'a', stageKey: 's1', sla: { unit: 'days', max: 10 } },
      { key: 'b', order: 2, title: 'b', stageKey: 's2', sla: { unit: 'days', max: 8 } },
      { key: 'c', order: 3, title: 'c', stageKey: 's3', sla: { unit: 'days', max: 30 } },
    ],
  };
  const plan = buildWorkflowSchedule(template as never, START);
  const offsets = plan.map((s) => daysBetween(START, s.dueAt));
  check('2. cumulative offsets 10/18/48', JSON.stringify(offsets) === JSON.stringify([10, 18, 48]), JSON.stringify(offsets));
}

// 3. A shorter later stage can never end before the previous stage.
{
  const template = {
    stages: [
      { key: 's1', order: 1, sla: { unit: 'days', max: 30 } },
      { key: 's2', order: 2, sla: { unit: 'days', max: 2 } },
    ],
    steps: [
      { key: 'a', order: 1, title: 'a', stageKey: 's1', sla: { unit: 'days', max: 30 } },
      { key: 'b', order: 2, title: 'b', stageKey: 's2', sla: { unit: 'days', max: 2 } },
    ],
  };
  const plan = buildWorkflowSchedule(template as never, START);
  const first = plan[0];
  const second = plan[1];
  check('3. later deadline is not earlier', Boolean(first) && Boolean(second) && (second as { dueAt: Date }).dueAt.getTime() >= (first as { dueAt: Date }).dueAt.getTime());
  check('3. offsets 30/32', Boolean(first) && Boolean(second) && daysBetween(START, (first as { dueAt: Date }).dueAt) === 30 && daysBetween(START, (second as { dueAt: Date }).dueAt) === 32);
}


// 4. Stage order (not action-array position) drives the schedule.
{
  const template = {
    stages: [
      { key: 's1', order: 1, sla: { unit: 'days', max: 10 } },
      { key: 's2', order: 2, sla: { unit: 'days', max: 8 } },
    ],
    steps: [
      { key: 'late', order: 9, title: 'late', stageKey: 's2', sla: { unit: 'days', max: 8 } },
      { key: 'early', order: 1, title: 'early', stageKey: 's1', sla: { unit: 'days', max: 10 } },
    ],
  };
  const plan = buildWorkflowSchedule(template as never, START);
  const early = plan.find((s) => s.key === 'early');
  const late = plan.find((s) => s.key === 'late');
  check('4. stage order wins over array position', (early?.dueAt.getTime() ?? 0) < (late?.dueAt.getTime() ?? 0));
}

// 5. Explicit action-level durations still work.
{
  const template = {
    stages: [{ key: 'documents', order: 1, sla: { unit: 'days', max: 5 } }],
    steps: [
      { key: 'shared', order: 1, title: 'shared', stageKey: 'documents', sla: { unit: 'days', max: 5 } },
      { key: 'explicit', order: 2, title: 'explicit', stageKey: 'documents', sla: { unit: 'hours', max: 48 } },
    ],
  };
  const plan = buildWorkflowSchedule(template as never, START);
  const shared = plan.find((s) => s.key === 'shared');
  const explicit = plan.find((s) => s.key === 'explicit');
  check('5. explicit action keeps its own deadline', Number(explicit?.hasExplicitDuration) === 1);
  check('5. explicit 48h < shared 5d', (explicit?.dueAt.getTime() ?? 0) < (shared?.dueAt.getTime() ?? 0));
  check('5. shared action inherits stage deadline', Number(shared?.hasExplicitDuration) === 0);
}

// 6. Missing/invalid durations never crash and invent nothing.
{
  const plan = buildWorkflowSchedule(
    { stages: [{ key: 's1', order: 1 }], steps: [{ key: 'a', order: 1, title: 'a', stageKey: 's1' }] } as never,
    START
  );
  const only = plan[0];
  check('6. missing duration: dueAt === startAt', Boolean(only) && (only as { dueAt: Date; startAt: Date }).dueAt.getTime() === (only as { dueAt: Date; startAt: Date }).startAt.getTime());
  const bad = buildWorkflowSchedule(
    {
      stages: [{ key: 's1', order: 1, sla: { text: 'Dependent on court' } as never }],
      steps: [{ key: 'a', order: 1, title: 'a', stageKey: 's1', sla: { text: 'Dependent on court' } as never }],
    } as never,
    START
  );
  const badOnly = bad[0];
  check('6. unparseable duration: dueAt === startAt', Boolean(badOnly) && (badOnly as { dueAt: Date; startAt: Date }).dueAt.getTime() === (badOnly as { dueAt: Date; startAt: Date }).startAt.getTime());
}

// 7. Next deadline respects completed progress (stage order, not min date).
{
  const steps = [
    { stepKey: 'a', status: 'Completed', stageOrder: 0, order: 1, dueAt: new Date('2026-10-10T12:00:00Z') },
    { stepKey: 'b', status: 'In Progress', stageOrder: 1, order: 2, dueAt: new Date('2026-11-10T12:00:00Z') },
    { stepKey: 'c', status: 'Not Started', stageOrder: 2, order: 3, dueAt: new Date('2026-10-11T12:00:00Z') },
  ];
  check('7. next is first pending in stage order', selectNextScheduledStepKey(steps as never) === 'b');
}

// 7b. Displayed current step follows WORK done (ticked), not approval: when a
// stage's actions are all ticked (Done, not yet Completed), the next stage's
// first action is already the current step.
{
  const steps = [
    { stepKey: 'i1', status: 'Done', stageOrder: 0, order: 1 },
    { stepKey: 'i2', status: 'Done', stageOrder: 0, order: 6 },
    { stepKey: 'p1', status: 'In Progress', stageOrder: 1, order: 2 },
    { stepKey: 'p2', status: 'Not Started', stageOrder: 1, order: 3 },
  ];
  check('7b. fully ticked stage surfaces next stage first action', selectNextWorkPendingStepKey(steps as never) === 'p1');
  const partial = [
    { stepKey: 'i1', status: 'Done', stageOrder: 0, order: 1 },
    { stepKey: 'i2', status: 'In Progress', stageOrder: 0, order: 6 },
    { stepKey: 'p1', status: 'Not Started', stageOrder: 1, order: 2 },
  ];
  check('7b. partially ticked stage stays on its unticked action', selectNextWorkPendingStepKey(partial as never) === 'i2');
  const reviewChain = [
    { stepKey: 'i1', status: 'Awaiting Review', stageOrder: 0, order: 1 },
    { stepKey: 'p1', status: 'Not Started', stageOrder: 1, order: 2 },
  ];
  check('7b. awaiting-review counts as work done', selectNextWorkPendingStepKey(reviewChain as never) === 'p1');
}

// 9/11. buildInstanceSteps (persisted) matches the schedule (preview).
{
  const appealLike = {
    stages: [
      { key: 'intake', order: 1, title: 'Intake', sla: { unit: 'days', max: 10 } },
      { key: 'pre', order: 2, title: 'Pre', sla: { unit: 'days', max: 28 } },
    ],
    steps: [
      { key: 'i1', order: 1, title: 'i1', stageKey: 'intake', sla: { unit: 'days', max: 10 } },
      { key: 'i2', order: 6, title: 'i2', stageKey: 'intake', sla: { unit: 'days', max: 10 } },
      { key: 'p1', order: 2, title: 'p1', stageKey: 'pre', sla: { unit: 'days', max: 28 } },
    ],
  };
  const built = buildInstanceSteps(appealLike as never, START);
  const i1 = built.find((s: any) => s.stepKey === 'i1');
  const i2 = built.find((s: any) => s.stepKey === 'i2');
  const p1 = built.find((s: any) => s.stepKey === 'p1');
  check('9/11. intake actions share day-10', daysBetween(START, new Date(i1.dueAt)) === 10 && daysBetween(START, new Date(i2.dueAt)) === 10);
  check('9/11. pre-litigation lands day-38', daysBetween(START, new Date(p1.dueAt)) === 38, String(daysBetween(START, new Date(p1.dueAt))));
  check('9/11. stageOrder persisted', Number((i1 as any).stageOrder) === 0 && Number((p1 as any).stageOrder) === 1);
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All workflow schedule checks passed.');
