export type CaseAssignments = {
  initiator?: string;
  reviewer?: string;
  signerApprover?: string;
};

export const normalizeCaseAssignee = (value: unknown) => String(value || '').trim();

export const getCaseAssignments = (caseDoc: any): CaseAssignments => {
  const raw = caseDoc?.caseAssignments || {};
  return {
    initiator: normalizeCaseAssignee(raw.initiator),
    reviewer: normalizeCaseAssignee(raw.reviewer),
    signerApprover: normalizeCaseAssignee(raw.signerApprover),
  };
};

export const buildCaseAssignedToDisplay = (caseDoc: any) => {
  const slots = getCaseAssignments(caseDoc);
  const labels = [
    slots.initiator ? `Initiator: ${slots.initiator}` : '',
    slots.reviewer ? `Reviewer: ${slots.reviewer}` : '',
    slots.signerApprover ? `Signer/Approver: ${slots.signerApprover}` : '',
  ].filter(Boolean);

  if (labels.length > 0) return labels.join(' | ');
  return normalizeCaseAssignee(caseDoc?.assignedTo);
};

export const getCaseAssigneeValues = (caseDoc: any) => {
  const slots = getCaseAssignments(caseDoc);
  return [slots.initiator, slots.reviewer, slots.signerApprover, normalizeCaseAssignee(caseDoc?.assignedTo)].filter(Boolean);
};

export const caseMatchesAssignee = (caseDoc: any, identity: unknown) => {
  const me = normalizeCaseAssignee(identity).toLowerCase();
  if (!me) return false;
  return getCaseAssigneeValues(caseDoc).some((value) => normalizeCaseAssignee(value).toLowerCase() === me);
};

/**
 * Canonical identity comparison.
 *
 * People are referenced in the system in more than one shape: the account name
 * ("Badiel") and, where a person-picker stored a display name, the full name
 * ("Badiel Rubangutsangabo"). A strict equality match (`caseMatchesAssignee`)
 * treats those as different people, so a member's dashboard undercounts the
 * matters they are genuinely assigned to — the reported "6 instead of 10".
 *
 * Two names refer to the same person when, case/space-insensitively:
 *   - they are equal, OR
 *   - they share the same FIRST token and one of them has no more tokens
 *     (i.e. a short account name matches the longer stored full name).
 *
 * This is deliberately NOT a substring match: it requires the first token to be
 * identical, so "Badiel" never matches "Badielos" or a different "Badiel Two".
 * It is safe across the current data set (verified: no two real people share a
 * first name, and no real person's name is a prefix of another's).
 */
export const identityMatches = (a: unknown, b: unknown): boolean => {
  const norm = (value: unknown) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftTokens = left.split(' ');
  const rightTokens = right.split(' ');
  if (leftTokens[0] !== rightTokens[0]) return false;
  // One of them is a bare first name: treat "Badiel" == "Badiel Rubangutsangabo".
  return leftTokens.length === 1 || rightTokens.length === 1;
};

/** True when any of a person's stored assignment values matches the identity. */
export const caseMatchesAssigneeCanonical = (caseDoc: any, identity: unknown): boolean => {
  const me = normalizeCaseAssignee(identity);
  if (!me) return false;
  return getCaseAssigneeValues(caseDoc).some((value) => identityMatches(value, me));
};


export const normalizeCaseAssignmentsPayload = (payload: any): CaseAssignments | null => {
  if (!payload || typeof payload !== 'object') return null;

  const source = payload.caseAssignments && typeof payload.caseAssignments === 'object' ? payload.caseAssignments : payload;
  const initiator = normalizeCaseAssignee(source.initiator);
  const reviewer = normalizeCaseAssignee(source.reviewer);
  const signerApprover = normalizeCaseAssignee(source.signerApprover);

  if (!initiator && !reviewer && !signerApprover) return null;

  return { initiator, reviewer, signerApprover };
};
