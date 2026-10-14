/**
 * Standalone check for the Key Action deadline clock + urgency color rules.
 * Pure functions only — run with:  npx tsx src/scripts/verifyDeadlineClock.ts
 */
import {
  getUrgencyColorForDueDate,
  getKeyActionDeadlineClock,
} from '../utils/workflowDeadline';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log('         ', JSON.stringify(detail));
  }
};

const NOW = new Date('2026-06-01T12:00:00.000Z');
const day = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

console.log('A. Urgency color follows ABSOLUTE remaining time (no sticky window ratio)');
{
  // 30 days out, but the window started 100 days ago: old ratio logic => red.
  // Correct (absolute) => blue.
  check(
    '30 days left is blue even with a long elapsed window',
    getUrgencyColorForDueDate(iso(NOW.getTime() + 30 * day), iso(NOW.getTime() - 100 * day), NOW) === 'blue'
  );
  check('10 days left is green', getUrgencyColorForDueDate(iso(NOW.getTime() + 10 * day), undefined, NOW) === 'green');
  check('5 days left is yellow', getUrgencyColorForDueDate(iso(NOW.getTime() + 5 * day), undefined, NOW) === 'yellow');
  check('20 hours left is red', getUrgencyColorForDueDate(iso(NOW.getTime() + 20 * 60 * 60 * 1000), undefined, NOW) === 'red');
  check('overdue is red', getUrgencyColorForDueDate(iso(NOW.getTime() - 3 * day), undefined, NOW) === 'red');
  check('no deadline is gray', getUrgencyColorForDueDate(undefined, undefined, NOW) === 'gray');
}

console.log('B. Amending (extending) a deadline changes the color immediately');
{
  const start = NOW.getTime() - 2 * day;
  const beforeColor = getUrgencyColorForDueDate(iso(NOW.getTime() + 4 * day), iso(start), NOW); // yellow
  const afterColor = getUrgencyColorForDueDate(iso(NOW.getTime() + 25 * day), iso(start), NOW); // blue after extension
  check('before extension is yellow', beforeColor === 'yellow', beforeColor);
  check('after extension becomes blue', afterColor === 'blue', afterColor);
}

console.log('C. Open Key Action: live countdown + live color');
{
  const open = getKeyActionDeadlineClock({ status: 'In Progress', dueAt: iso(NOW.getTime() + 3 * day) }, NOW);
  check('open is not frozen', open.frozen === false);
  check('open countdown counts down', /left$/.test(open.countdown), open.countdown);
  check('open color is yellow (3 days)', open.color === 'yellow', open.color);
}

console.log('D. Done Key Action: clock FREEZES at the finish moment');
{
  // Finished 2 days BEFORE a deadline 10 days out => "Done on time", calm color.
  const onTime = getKeyActionDeadlineClock(
    { status: 'Done', dueAt: iso(NOW.getTime() + 10 * day), doneAt: iso(NOW.getTime() - 2 * day) },
    NOW
  );
  check('done on time is frozen', onTime.frozen === true);
  check('done on time text', onTime.countdown === 'Done on time', onTime.countdown);
  check('done on time keeps a calm (green) color', onTime.color === 'green', onTime.color);

  // A later "now" must NOT change a frozen result.
  const later = new Date(NOW.getTime() + 40 * day);
  const onTimeLater = getKeyActionDeadlineClock(
    { status: 'Done', dueAt: iso(NOW.getTime() + 10 * day), doneAt: iso(NOW.getTime() - 2 * day) },
    later
  );
  check('frozen result is identical much later', onTimeLater.countdown === onTime.countdown && onTimeLater.color === onTime.color, onTimeLater);
}

console.log('E. Done LATE Key Action: frozen red, shows how late');
{
  const late = getKeyActionDeadlineClock(
    { status: 'Completed', dueAt: iso(NOW.getTime() - 3 * day), completedAt: iso(NOW.getTime() - 1 * day) },
    NOW
  );
  check('late is frozen', late.frozen === true);
  check('late color is red', late.color === 'red', late.color);
  check('late text reports lateness', /^Done .* late$/.test(late.countdown), late.countdown);
}

console.log('F. Freeze uses the EARLIEST work-finished stamp');
{
  // doneAt earlier than submittedAt/completedAt => freeze at doneAt (on time).
  const step = {
    status: 'Completed',
    dueAt: iso(NOW.getTime() + 5 * day),
    doneAt: iso(NOW.getTime() - 1 * day), // finished before due
    submittedAt: iso(NOW.getTime() + 1 * day),
    completedAt: iso(NOW.getTime() + 2 * day),
  };
  const clock = getKeyActionDeadlineClock(step, NOW);
  check('freezes at doneAt (on time), not the later approval', clock.countdown === 'Done on time', clock.countdown);
}

console.log('');
console.log(`Deadline clock checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
