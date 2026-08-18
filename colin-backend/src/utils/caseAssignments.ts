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

export const normalizeCaseAssignmentsPayload = (payload: any): CaseAssignments | null => {
  if (!payload || typeof payload !== 'object') return null;

  const source = payload.caseAssignments && typeof payload.caseAssignments === 'object' ? payload.caseAssignments : payload;
  const initiator = normalizeCaseAssignee(source.initiator);
  const reviewer = normalizeCaseAssignee(source.reviewer);
  const signerApprover = normalizeCaseAssignee(source.signerApprover);

  if (!initiator && !reviewer && !signerApprover) return null;

  return { initiator, reviewer, signerApprover };
};
