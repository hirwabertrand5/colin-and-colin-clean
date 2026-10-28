import { resolveDeadlineDateTime } from './deadlineUtils';
import { CaseAssignmentRole, resolveCaseAssignmentOwnerAt } from './caseAssignmentContinuity';
import { baseMemberName, resolveMemberTpa } from './workflowPercentages';

export type AppliedTpaSnapshot = {
  staffKey: string;
  staffName: string;
  assignmentRole: string;
  activityAt: Date;
  rate: number;
  recordedAt: Date;
};

/** The same durable event selects both the contributor and their applicable rate. */
export function resolveTpaAttribution(caseDoc: any, step: any, role: CaseAssignmentRole, fallback?: Date | string) {
  const delegated = (Array.isArray(step?.independentContributors) ? step.independentContributors : [])
    .filter((entry: any) => entry.role === role && entry.name)
    .sort((a: any, b: any) => +new Date(b.actedAt) - +new Date(a.actedAt))[0];
  let at: Date | undefined;
  if (delegated) at = resolveDeadlineDateTime(delegated.actedAt);
  else if (role === 'Initiator') {
    const ticks = (step?.actions || []).map((action: any) => resolveDeadlineDateTime(action.doneAt))
      .filter((date: Date | undefined): date is Date => Boolean(date));
    at = ticks.length ? new Date(Math.max(...ticks.map((date: Date) => +date)))
      : resolveDeadlineDateTime(step?.doneAt) || resolveDeadlineDateTime(step?.submittedAt) || resolveDeadlineDateTime(fallback);
  } else if (role === 'Reviewer') at = resolveDeadlineDateTime(step?.reviewedAt) || (!step ? resolveDeadlineDateTime(fallback) : undefined);
  else at = resolveDeadlineDateTime(step?.completedAt) || (!step ? resolveDeadlineDateTime(fallback) : undefined);
  const name = delegated?.name || resolveCaseAssignmentOwnerAt(caseDoc, role, at);
  return { name, at, delegated };
}

export function findAppliedTpa(snapshots: any[], name: string, role: string, at: Date | string) {
  return (snapshots || []).find(snapshot => snapshot.staffKey === baseMemberName(name) &&
    snapshot.assignmentRole === role && +new Date(snapshot.activityAt) === +new Date(at));
}

export function activityTpaRate(step: any, task: any, name: string, role: string, at: Date | string, users: Map<string, string>) {
  return findAppliedTpa(step?.tpaSnapshots, name, role, at)?.rate ??
    findAppliedTpa(task?.tpaSnapshots, name, role, at)?.rate ?? resolveMemberTpa(name, users, at).tpaPercent;
}
