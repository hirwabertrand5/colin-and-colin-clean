/**
 * Assignment continuity for a matter's three delivery roles.
 *
 * The current assignment slots answer "who owns the next action?".  They are
 * not enough to answer "who completed an action last week?" after a handover.
 * This helper keeps those two questions separate: work is always attributed to
 * the person holding the relevant role when their part of the Key Action was
 * recorded (Initiator work, Reviewer review, or Signer/Approver sign-off).
 */

export type CaseAssignmentRole = 'Initiator' | 'Reviewer' | 'Signer/Approver';

export type CaseAssignmentHandover = {
  role: CaseAssignmentRole;
  previousAssignee?: string;
  nextAssignee?: string;
  changedAt: Date | string;
  changedBy?: string;
};

export type CaseAssignmentSlots = {
  initiator?: string;
  reviewer?: string;
  signerApprover?: string;
};

export type CaseAssignmentContributor = {
  role: CaseAssignmentRole;
  name: string;
  /** True only for the person currently responsible for this role. */
  isCurrentAssignment: boolean;
  /** The latest time this person took this role, when the matter has a handover record. */
  assignmentStartedAt: Date | null;
};

const clean = (value: unknown) => String(value || '').trim();
const same = (left: unknown, right: unknown) => clean(left).toLowerCase() === clean(right).toLowerCase();

export const CASE_ASSIGNMENT_ROLE_CONFIG: Array<{
  role: CaseAssignmentRole;
  slot: keyof CaseAssignmentSlots;
}> = [
  { role: 'Initiator', slot: 'initiator' },
  { role: 'Reviewer', slot: 'reviewer' },
  { role: 'Signer/Approver', slot: 'signerApprover' },
];

const validDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
};

const historyForRole = (caseDoc: any, role: CaseAssignmentRole): CaseAssignmentHandover[] =>
  (Array.isArray(caseDoc?.assignmentHandoverHistory) ? caseDoc.assignmentHandoverHistory : [])
    .filter((entry: any) => clean(entry?.role) === role && validDate(entry?.changedAt))
    .map((entry: any): CaseAssignmentHandover => {
      const previousAssignee = clean(entry?.previousAssignee);
      const nextAssignee = clean(entry?.nextAssignee);
      const changedBy = clean(entry?.changedBy);
      return {
        role,
        ...(previousAssignee ? { previousAssignee } : {}),
        ...(nextAssignee ? { nextAssignee } : {}),
        changedAt: entry.changedAt,
        ...(changedBy ? { changedBy } : {}),
      };
    })
    .sort((left: CaseAssignmentHandover, right: CaseAssignmentHandover) =>
      (validDate(left.changedAt)?.getTime() || 0) - (validDate(right.changedAt)?.getTime() || 0)
    );

export const currentCaseAssignmentForRole = (caseDoc: any, role: CaseAssignmentRole) => {
  const assignments: CaseAssignmentSlots = caseDoc?.caseAssignments || {};
  const config = CASE_ASSIGNMENT_ROLE_CONFIG.find((item) => item.role === role);
  if (!config) return '';
  return clean(assignments[config.slot] || (role === 'Initiator' ? caseDoc?.assignedTo : ''));
};

/** Build immutable handover events; callers append these when saving a case. */
export const buildCaseAssignmentHandovers = (
  before: CaseAssignmentSlots | undefined,
  next: CaseAssignmentSlots | undefined,
  options: { changedAt?: Date; changedBy?: string } = {}
): CaseAssignmentHandover[] => {
  const changedAt = options.changedAt || new Date();
  return CASE_ASSIGNMENT_ROLE_CONFIG.flatMap(({ role, slot }) => {
    const previousAssignee = clean(before?.[slot]);
    const nextAssignee = clean(next?.[slot]);
    if (same(previousAssignee, nextAssignee)) return [];
    return [{
      role,
      ...(previousAssignee ? { previousAssignee } : {}),
      ...(nextAssignee ? { nextAssignee } : {}),
      changedAt,
      ...(clean(options.changedBy) ? { changedBy: clean(options.changedBy) } : {}),
    }];
  });
};

/**
 * Resolve the role owner at a specific time. For older records with no
 * handover history, the live assignment remains the backward-compatible
 * answer. Missing dates likewise use the live assignment rather than
 * inventing historical ownership.
 */
export const resolveCaseAssignmentOwnerAt = (caseDoc: any, role: CaseAssignmentRole, at?: Date | string | null) => {
  const current = currentCaseAssignmentForRole(caseDoc, role);
  const instant = validDate(at);
  const events = historyForRole(caseDoc, role);
  if (!events.length || !instant) return current;

  let owner = clean(events[0]?.previousAssignee) || current;
  for (const event of events) {
    const changedAt = validDate(event.changedAt);
    if (!changedAt || changedAt.getTime() > instant.getTime()) break;
    owner = clean(event.nextAssignee) || owner;
  }
  return owner || current;
};

/** All people who can legitimately appear in a role's work/fee history. */
export const getCaseAssignmentContributors = (caseDoc: any): CaseAssignmentContributor[] => {
  const contributors: CaseAssignmentContributor[] = [];

  for (const { role } of CASE_ASSIGNMENT_ROLE_CONFIG) {
    const current = currentCaseAssignmentForRole(caseDoc, role);
    const events = historyForRole(caseDoc, role);
    const startedAtByName = new Map<string, Date | null>();

    if (events.length) {
      const first = clean(events[0]?.previousAssignee);
      if (first) startedAtByName.set(first.toLowerCase(), null);
      for (const event of events) {
        const next = clean(event.nextAssignee);
        if (next) startedAtByName.set(next.toLowerCase(), validDate(event.changedAt));
      }
    }
    if (current) {
      const currentKey = current.toLowerCase();
      if (!startedAtByName.has(currentKey)) startedAtByName.set(currentKey, null);
    }

    for (const [normalizedName, assignmentStartedAt] of startedAtByName) {
      const eventName = events
        .flatMap((event) => [clean(event.previousAssignee), clean(event.nextAssignee)])
        .find((name) => name.toLowerCase() === normalizedName);
      const name = eventName || (current.toLowerCase() === normalizedName ? current : '');
      if (!name) continue;
      contributors.push({
        role,
        name,
        isCurrentAssignment: same(name, current),
        assignmentStartedAt,
      });
    }
  }

  return contributors;
};
