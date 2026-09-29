/**
 * Case Workspace navigation helpers.
 *
 * The whole matter is now one task: every action that used to open the task
 * board or a task detail page opens the Case Management tab of the matter in
 * the Case Workspace instead. These helpers keep that link format in one place
 * so every dashboard, board and notification produces the same, deep-linkable
 * URL (`/cases/:id?tab=case-management`).
 */

export const CASE_WORKSPACE_TABS = [
  'overview',
  'caseManagement',
  'teamStages',
  'tasks',
  'calendar',
  'documents',
  'billing',
  'audit',
  'reports',
] as const;

export type CaseWorkspaceTabName = (typeof CASE_WORKSPACE_TABS)[number];

/** URL slug used for each Case Workspace tab. */
export const CASE_WORKSPACE_TAB_SLUG: Record<CaseWorkspaceTabName, string> = {
  overview: 'overview',
  caseManagement: 'case-management',
  teamStages: 'team-stages',
  tasks: 'tasks',
  calendar: 'calendar',
  documents: 'documents',
  billing: 'billing',
  audit: 'audit',
  reports: 'reports',
};

/** Accepts "case-management", "caseManagement", "casemanagement", … */
export const normalizeCaseWorkspaceTab = (raw: unknown): CaseWorkspaceTabName | null => {
  const value = String(raw ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!value) return null;
  const compact = value.replace(/-/g, '');
  for (const tab of CASE_WORKSPACE_TABS) {
    if (CASE_WORKSPACE_TAB_SLUG[tab] === value || tab.toLowerCase() === compact) return tab;
  }
  return null;
};

/**
 * Deep link to a matter's Case Management tab. `stepKey` focuses one workflow
 * section (used when a key action or task points at its section).
 * Falls back to the matters list when no matter id is known.
 */
export const buildCaseManagementLink = (caseId?: string | null, stepKey?: string | null) => {
  const id = String(caseId ?? '').trim();
  if (!id) return '/matters';
  const params = new URLSearchParams();
  params.set('tab', CASE_WORKSPACE_TAB_SLUG.caseManagement);
  const step = String(stepKey ?? '').trim();
  if (step) params.set('step', step);
  return `/cases/${id}?${params.toString()}`;
};
