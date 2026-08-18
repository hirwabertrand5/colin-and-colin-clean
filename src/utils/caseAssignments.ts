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

export const setCaseAssignmentSlot = (
  prev: CaseAssignments | undefined,
  slot: keyof CaseAssignments,
  value: string
) => ({
  ...(prev || {}),
  [slot]: value,
});
