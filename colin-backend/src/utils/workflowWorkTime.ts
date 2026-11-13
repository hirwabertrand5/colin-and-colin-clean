import { resolveDeadlineDateTime } from './deadlineUtils';
/** Pure work-event rules shared by the API and browser. Explicit instants stay exact. */
export type CarriedWorkTiming = {
  sourceTemplateId: string;
  sourceStepKeys: string[];
  startAt?: Date | string;
  dueAt?: Date | string;
  doneAt?: Date | string;
  submittedAt?: Date | string;
  recordedAt: Date | string;
  /** Opt-in for the migrated matter; other matters keep their deadline colours. */
  colorBasis?: 'percentage-bands';
};

export type WorkTimingStep = {
  status?: string;
  startAt?: Date | string;
  dueAt?: Date | string;
  doneAt?: Date | string;
  submittedAt?: Date | string;
  completedAt?: Date | string;
  reviewedAt?: Date | string;
  actions?: Array<{ done?: boolean; doneAt?: Date | string }>;
  carriedWork?: CarriedWorkTiming;
};

export function parseWorkTimestamp(value?: Date | string): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return Number.isFinite(+value) ? new Date(value) : undefined;
  const raw = String(value).trim();
  // Date-only legacy values retain the existing noon convention. An explicit
  // midnight timestamp is an actual instant and must never move by 12 hours.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00.000Z` : raw);
  return Number.isFinite(+date) ? date : undefined;
}

export type StepWorkTime = { at: Date | null; source: 'submitted' | 'lastActionTicked' | 'completed' | 'reviewed' | null };

export function resolveWorkflowWorkTime(step: WorkTimingStep | null | undefined): StepWorkTime {
  if (!step) return { at: null, source: null };
  // A workflow conversion does not turn historical work into work performed
  // today when the new checklist is subsequently submitted for review.
  const priorSubmission = parseWorkTimestamp(step.carriedWork?.submittedAt);
  if (priorSubmission) return { at: priorSubmission, source: 'submitted' };
  const priorDone = parseWorkTimestamp(step.carriedWork?.doneAt);
  if (priorDone) return { at: priorDone, source: 'lastActionTicked' };
  const submitted = parseWorkTimestamp(step.submittedAt);
  if (submitted) return { at: submitted, source: 'submitted' };
  if (step.actions?.length && step.actions.every(action => action.done)) {
    const ticks = step.actions.map(action => parseWorkTimestamp(action.doneAt)).filter((date): date is Date => Boolean(date));
    if (ticks.length) return { at: new Date(Math.max(...ticks.map(Number))), source: 'lastActionTicked' };
  }
  for (const [field, source] of [['doneAt', 'lastActionTicked'], ['completedAt', 'completed'], ['reviewedAt', 'reviewed']] as const) {
    const at = parseWorkTimestamp(step[field]);
    if (at) return { at, source };
  }
  return { at: null, source: null };
}

export function classifyWorkflowWork(step: WorkTimingStep) {
  const finished = ['Done', 'Awaiting Review', 'Awaiting Approval', 'Completed'].includes(step.status || '');
  const event = resolveWorkflowWorkTime(step);
  const due = resolveDeadlineDateTime(step.dueAt);
  const outcome: 'pending' | 'unknown' | 'on-time' | 'late' = !finished ? 'pending'
    : !event.at || !due ? 'unknown' : +event.at <= +due ? 'on-time' : 'late';
  const score = finished ? scoreWorkflowTimeliness(step, event.at) : null;
  return { outcome, at: event.at, due: due || null, source: event.source, score,
    performance: timelinessBand(score),
    lateByMs: outcome === 'late' ? +event.at! - +due! : 0 };
}

/** Existing score: percentage of the allowed window remaining at submission. */
export function scoreWorkflowTimeliness(step: Pick<WorkTimingStep, 'startAt' | 'dueAt'>, eventTime: Date | null): number | null {
  const start = resolveDeadlineDateTime(step.startAt), due = resolveDeadlineDateTime(step.dueAt);
  if (!start || !due || !eventTime || !Number.isFinite(+eventTime) || +due <= +start) return null;
  const consumed = Math.round(((+eventTime - +start) / (+due - +start)) * 1000) / 10;
  return Math.min(100, Math.max(0, Math.round(100 - consumed)));
}

/** The established 25/55/85 percent-used bands, expressed as the displayed remaining score. */
export function timelinessBand(score: number | null) {
  if (score === null || !Number.isFinite(score)) return { color: 'gray' as const, label: 'Untracked' };
  if (score >= 75) return { color: 'blue' as const, label: 'Excellent' };
  if (score >= 45) return { color: 'green' as const, label: 'Good' };
  if (score >= 15) return { color: 'yellow' as const, label: 'Delayed' };
  return { color: 'red' as const, label: 'At risk' };
}

export function summarizeWorkflowWork(steps: WorkTimingStep[]) {
  const result = { total: steps.length, onTime: 0, late: 0, unknown: 0, pending: 0,
    readyToSubmit: 0, awaitingReview: 0, awaitingApproval: 0, approved: 0 };
  for (const step of steps) {
    const { outcome } = classifyWorkflowWork(step);
    if (outcome === 'on-time') result.onTime++;
    else if (outcome === 'late') result.late++;
    else if (outcome === 'unknown') result.unknown++;
    else result.pending++;
    if (step.status === 'Done') result.readyToSubmit++;
    if (step.status === 'Awaiting Review') result.awaitingReview++;
    if (step.status === 'Awaiting Approval') result.awaitingApproval++;
    if (step.status === 'Completed') result.approved++;
  }
  return result;
}
