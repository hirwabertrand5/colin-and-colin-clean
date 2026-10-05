/**
 * Who may record work on the Case Workspace Overview tab.
 *
 * The Initiator, Reviewer and Signer/Approver of a matter are the people
 * actually doing the work, so they need to tick off the Key Actions they have
 * completed and amend a deadline. They are identified by name or e-mail, so
 * both forms work regardless of how the assignment was typed.
 *
 * These predicates are shared by the workflow controllers (which decide whether
 * the API accepts the request) and mirrored by the Case Workspace frontend, so
 * the UI never offers an action the server would reject.
 */
export const normalizeAssignmentIdentity = (value: unknown) => String(value || '').trim().toLowerCase();

/** The signed-in user's identity, as far as the assignment rules care. */
type CaseUser = { role?: string | null; name?: string | null; email?: string | null } | null | undefined;

/** Case Management assignment slots, with the legacy `assignedTo` fallback. */
export const readCaseAssignmentSlots = (foundCase: any) => {
  const assignments = foundCase?.caseAssignments || {};
  return {
    initiator: String(assignments.initiator || foundCase?.assignedTo || '').trim(),
    reviewer: String(assignments.reviewer || '').trim(),
    approver: String(assignments.signerApprover || '').trim(),
  };
};

/** Which of the three slots (if any) the signed-in user occupies. */
export const resolveAssignedSlot = (
  foundCase: any,
  user: { name?: string | null; email?: string | null }
): 'initiator' | 'reviewer' | 'approver' | 'none' => {
  const identities = [user?.name, user?.email]
    .map(normalizeAssignmentIdentity)
    .filter(Boolean);
  if (!identities.length) return 'none';
  const slots = readCaseAssignmentSlots(foundCase);
  if (identities.includes(normalizeAssignmentIdentity(slots.initiator))) return 'initiator';
  if (identities.includes(normalizeAssignmentIdentity(slots.reviewer))) return 'reviewer';
  if (identities.includes(normalizeAssignmentIdentity(slots.approver))) return 'approver';
  return 'none';
};

/** True when the user is one of the matter's assigned members. */
export const isAssignedCaseMember = (foundCase: any, user: CaseUser) =>
  resolveAssignedSlot(foundCase, user || {}) !== 'none';

/**
 * Overview-tab write permission: complete/reopen a Key Action and amend a
 * deadline. Administrators keep full rights; the matter's own members gain them.
 */
export const canManageWorkflowStepsOfCase = (foundCase: any, user: CaseUser) =>
  isWorkflowAdminRole(user?.role) || isAssignedCaseMember(foundCase, user);

/** The administrative roles that may manage any matter. */
export const isWorkflowAdminRole = (role?: string | null) =>
  role === 'managing_director' ||
  role === 'managing_partner' ||
  role === 'executive_managing_partner' ||
  role === 'senior_partner' ||
  role === 'partner' ||
  role === 'executive_partner' ||
  role === 'associate_partner' ||
  role === 'executive_associate_partner' ||
  role === 'senior_executive_assistant' ||
  role === 'originating_attorney' ||
  role === 'executive_assistant';

/** Senior roles that may score quality on any matter they supervise. */
export const isAllowedQualityScoreRole = (role?: string | null) =>
  role === 'managing_partner' ||
  role === 'executive_managing_partner' ||
  role === 'partner' ||
  role === 'executive_partner' ||
  role === 'executive_assistant';

/**
 * Quality Score permission.
 *
 * The Reviewer and the Approver of the matter enter the Quality Score, as do
 * the senior supervisory roles. The Case Initiator is always excluded — even
 * when they also hold a senior role, because scoring the work they ran the
 * matter on would defeat the purpose of the score.
 */
export const canEnterQualityScore = (foundCase: any, user: CaseUser, myRole?: 'admin' | 'initiator' | 'reviewer' | 'approver' | 'none') => {
  const slot = myRole ?? resolveAssignedSlot(foundCase, user || {});
  if (slot === 'initiator') return false;
  return slot === 'reviewer' || slot === 'approver' || isAllowedQualityScoreRole(user?.role);
};