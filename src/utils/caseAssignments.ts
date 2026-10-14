export type CaseAssignments = {
  initiator?: string;
  reviewer?: string;
  signerApprover?: string;
};

export const normalizeCaseAssignee = (value: unknown) => String(value || '').trim();

export const getCaseAssignments = (caseData?: { caseAssignments?: CaseAssignments | null; assignedTo?: string | null } | null) => {
  const raw = caseData?.caseAssignments || {};
  return {
    initiator: normalizeCaseAssignee(raw.initiator),
    reviewer: normalizeCaseAssignee(raw.reviewer),
    signerApprover: normalizeCaseAssignee(raw.signerApprover),
  };
};

export const formatCaseAssignedTo = (caseData?: { caseAssignments?: CaseAssignments | null; assignedTo?: string | null } | null) => {
  const slots = getCaseAssignments(caseData);
  const labels = [
    slots.initiator ? `Initiator: ${slots.initiator}` : '',
    slots.reviewer ? `Reviewer: ${slots.reviewer}` : '',
    slots.signerApprover ? `Signer/Approver: ${slots.signerApprover}` : '',
  ].filter(Boolean);
  return labels.length ? labels.join(' | ') : normalizeCaseAssignee(caseData?.assignedTo);
};

export const getPrimaryCaseAssignee = (caseData?: { caseAssignments?: CaseAssignments | null; assignedTo?: string | null } | null) => {
  const slots = getCaseAssignments(caseData);
  return slots.signerApprover || slots.reviewer || slots.initiator || normalizeCaseAssignee(caseData?.assignedTo);
};

export const caseMatchesAssignee = (
  caseData?: { caseAssignments?: CaseAssignments | null; assignedTo?: string | null } | null,
  identity?: string | null
) => {
  const me = normalizeCaseAssignee(identity).toLowerCase();
  if (!me) return false;
  return [caseData?.assignedTo, caseData?.caseAssignments?.initiator, caseData?.caseAssignments?.reviewer, caseData?.caseAssignments?.signerApprover]
    .map((value) => normalizeCaseAssignee(value).toLowerCase())
    .some((value) => value && value === me);
};

/**
 * Canonical identity comparison (mirrors the backend `identityMatches`).
 *
 * The same person can appear as their account name ("Badiel") and as the full
 * name a person-picker stored ("Badiel Rubangutsangabo"). Exact equality treats
 * those as different people, so the Matters tables and the "Assigned Matters"
 * card disagree. Two names are the same person when, case/space-insensitively,
 * they are equal OR they share the same first token and one of them is just that
 * first token. This is not a substring match — the first token must be identical
 * — and it is safe for the current team (no two people share a first name).
 */
export const identityMatches = (a?: string | null, b?: string | null): boolean => {
  const norm = (value?: string | null) =>
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
  return leftTokens.length === 1 || rightTokens.length === 1;
};

/** True when any assignment slot on the matter matches the identity canonically. */
export const caseMatchesAssigneeCanonical = (
  caseData?: { caseAssignments?: CaseAssignments | null; assignedTo?: string | null } | null,
  identity?: string | null
) => {
  const me = normalizeCaseAssignee(identity);
  if (!me) return false;
  return [caseData?.assignedTo, caseData?.caseAssignments?.initiator, caseData?.caseAssignments?.reviewer, caseData?.caseAssignments?.signerApprover]
    .some((value) => identityMatches(value, me));
};

export const setCaseAssignmentSlot = (
  prev: CaseAssignments | undefined,
  slot: keyof CaseAssignments,
  value: string
) => ({
  ...(prev || {}),
  [slot]: value,
});
