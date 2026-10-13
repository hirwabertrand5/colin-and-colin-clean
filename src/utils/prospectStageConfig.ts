import { getUrgencyColorForDueDate, resolveDeadlineDateTime, type UrgencyColor } from './workflowDeadline';

/**
 * Canonical Intake & Prospect stage configuration.
 *
 * The prospect stages themselves are unchanged (Inquiry -> ... -> Engagement ->
 * Converted / Non-Converted). This module is the single place that layers the
 * "workflow-control and client-experience" rules from the onboarding document on
 * top of those stages:
 *
 *   - an indicative turnaround time (SLA / "Indicative TAT") per stage,
 *   - the stage's mandatory "Key Actions" checklist,
 *   - the next stage in the flow, and
 *   - which document stage it maps to.
 *
 * SLAs are deliberately centralised here (rather than hard-coded at each call
 * site) so they can be tuned per stage / service type in one place, as the
 * document requires ("SLAs must be configurable by stage and matter/service
 * type rather than hard-coded").
 *
 * NOTE: the backend has a mirrored copy in
 * colin-backend/src/utils/prospectStageConfig.ts. Keep the two in sync.
 */

export const PROSPECT_STAGE_ORDER = [
  'Inquiry',
  'Consultation',
  'Conflict Check',
  'Quotation',
  'Quotation Preparation',
  'Conversion Assessment',
  'Quotation Issued',
  'Awaiting Client Decision',
  'Final Follow-Up',
  'Engagement',
  'Converted',
  'Non-Converted',
] as const;

export type ProspectStageName = (typeof PROSPECT_STAGE_ORDER)[number];

export const PROSPECT_TERMINAL_STAGES: ProspectStageName[] = ['Converted', 'Non-Converted'];

export type ProspectStageStatus = 'Not Started' | 'In Progress' | 'Completed' | 'Blocked';
export type ProspectWaitingOn = 'Firm' | 'Client' | 'Third Party' | 'None';

export interface ProspectStageDefinition {
  stage: ProspectStageName;
  /** Human order used for the progress tracker (1-based among active stages). */
  order: number;
  /** Indicative turnaround time, in hours. Drives the auto-calculated due date. */
  slaHours: number;
  /** Human-readable SLA label shown in the UI ("Within 4 hours"). */
  slaLabel: string;
  /** Whether the SLA depends on a client/third-party event (follow-up configurable). */
  clientDependent?: boolean;
  /** The document's workflow stage this maps to. */
  docStage: string;
  /** The mandatory Key Actions checklist for this stage. */
  checklist: string[];
  /** Terminal stages have no next stage. */
  terminal?: boolean;
}

/**
 * The full ordered configuration. `order` is only meaningful for active stages;
 * terminal stages are excluded from the active tracker but kept here for lookup.
 */
export const PROSPECT_STAGE_CONFIG: ProspectStageDefinition[] = [
  {
    stage: 'Inquiry',
    order: 1,
    slaHours: 4,
    slaLabel: 'Within 4 hours',
    docStage: 'Initial Enquiry',
    checklist: [
      'Capture client/contact details',
      'Capture matter summary and assistance required',
      'Preliminary conflict check',
      'Identify responsible lawyer',
      'Schedule consultation / agree next step',
    ],
  },
  {
    stage: 'Consultation',
    order: 2,
    slaHours: 24,
    slaLabel: 'Within 24 hours',
    docStage: 'Consultation',
    checklist: [
      'Hold consultation',
      'Record key facts and objectives',
      'Identify immediate concerns',
      'Record documents/information required',
      'Determine whether matter can be scoped/priced or requires Legal Opinion',
    ],
  },
  {
    stage: 'Conflict Check',
    order: 3,
    slaHours: 24,
    slaLabel: 'Within 24 hours',
    docStage: 'Legal Opinion / Diagnostic',
    checklist: [
      'Run and document the conflict search',
      'Resolve or flag any conflicts',
      'Record the conflict decision and notes',
      'Clear the matter to proceed',
    ],
  },
  {
    stage: 'Quotation',
    order: 4,
    slaHours: 24,
    slaLabel: '24 hours after sufficient information',
    docStage: 'Substantive Scope & Quotation',
    checklist: [
      'Prepare the substantive quotation',
      'Review the quotation internally',
      'Issue the quotation to the client',
      'Record quotation date / status',
    ],
  },
  {
    stage: 'Quotation Preparation',
    order: 4,
    slaHours: 24,
    slaLabel: '24 hours after sufficient information',
    docStage: 'Substantive Scope & Quotation',
    checklist: ['Define scope', 'Define deliverables', 'Define timeline', 'Determine professional fee'],
  },
  {
    stage: 'Conversion Assessment',
    order: 5,
    slaHours: 12,
    slaLabel: 'Within 12 hours',
    docStage: 'Client Experience / Post-Opinion Feedback',
    checklist: [
      'Assess conversion readiness',
      'Trigger client-experience feedback',
      'Record client satisfaction / experience',
      'Capture any concerns or questions',
      'Escalate any material dissatisfaction to the responsible lawyer / Managing Partner',
    ],
  },
  {
    stage: 'Quotation Issued',
    order: 6,
    slaHours: 48,
    slaLabel: 'Client-dependent; configurable follow-up SLA',
    clientDependent: true,
    docStage: 'Client Acceptance / Follow-Up',
    checklist: [
      'Confirm the quotation was received',
      'Schedule a follow-up where there is no response',
      'Send the follow-up',
      'Record the response',
    ],
  },
  {
    stage: 'Awaiting Client Decision',
    order: 7,
    slaHours: 48,
    slaLabel: 'Client-dependent; configurable follow-up SLA',
    clientDependent: true,
    docStage: 'Client Acceptance / Follow-Up',
    checklist: [
      'Record acceptance / decline',
      'Confirm agreed scope and fee',
      'Schedule follow-up where no response',
      'Send follow-up',
      'Record response',
      'Escalate where follow-up threshold is exceeded',
      'Record final client decision',
    ],
  },
  {
    stage: 'Final Follow-Up',
    order: 8,
    slaHours: 48,
    slaLabel: 'Client-dependent; configurable follow-up SLA',
    clientDependent: true,
    docStage: 'Client Acceptance / Follow-Up',
    checklist: [
      'Send follow-up',
      'Record response',
      'Escalate where follow-up threshold is exceeded',
      'Record final client decision',
    ],
  },
  {
    stage: 'Engagement',
    order: 9,
    slaHours: 12,
    slaLabel: '12 hours once acceptance is confirmed',
    docStage: 'Engagement',
    checklist: [
      'Prepare Engagement Letter / Contract',
      'Issue to client',
      'Obtain signed engagement',
      'Confirm required onboarding documents / information',
      'Verify onboarding completion',
    ],
  },
  {
    stage: 'Converted',
    order: 10,
    slaHours: 0,
    slaLabel: 'Immediate upon completion of requirements',
    terminal: true,
    docStage: 'Convert to Active Matter',
    checklist: [
      'Confirm signed engagement',
      'Confirm mandatory onboarding requirements complete',
      'Assign matter / team',
      'Create Active Matter record from existing prospect record',
      'Preserve complete prospect history / audit trail',
    ],
  },
  {
    stage: 'Non-Converted',
    order: 10,
    slaHours: 0,
    slaLabel: 'Closure with recorded outcome / reason',
    terminal: true,
    docStage: 'Closed without conversion',
    checklist: ['Record the non-conversion outcome / reason', 'Record final client decision', 'Close the prospect'],
  },
];

const CONFIG_BY_STAGE = new Map<string, ProspectStageDefinition>(PROSPECT_STAGE_CONFIG.map((s) => [s.stage, s]));

export const getStageConfig = (stage?: string | null): ProspectStageDefinition | undefined =>
  stage ? CONFIG_BY_STAGE.get(stage) : undefined;

export const isTerminalStage = (stage?: string | null): boolean =>
  !!stage && (PROSPECT_TERMINAL_STAGES as string[]).includes(stage);

/** The next active stage after the given one (undefined for terminal stages). */
export const getNextStage = (stage?: string | null): ProspectStageName | undefined => {
  const active = PROSPECT_STAGE_CONFIG.filter((s) => !s.terminal);
  const idx = active.findIndex((s) => s.stage === stage);
  if (idx < 0) return undefined;
  return active[idx + 1]?.stage;
};

export const getStageSlaHours = (stage?: string | null): number => getStageConfig(stage)?.slaHours ?? 0;

export const getStageChecklist = (stage?: string | null): string[] => getStageConfig(stage)?.checklist ?? [];

/** Minimal shape the config helpers need from a prospect record. */
export interface ProspectLike {
  stage?: string | null;
  stageStatus?: string | null;
  stageStartedAt?: Date | string | null;
  stageDueAt?: Date | string | null;
  stageCompletedAt?: Date | string | null;
  stageCompletedBy?: string | null;
  dateReceived?: Date | string | null;
  createdAt?: Date | string | null;
  completedStages?: string[] | null;
  waitingOn?: string | null;
  outstandingRequirement?: string | null;
  stageChecklist?: Array<{ key?: string; label?: string; done?: boolean; doneBy?: string; doneAt?: Date | string }> | null;
  responsiblePartner?: unknown;
  responsibleAssociate?: unknown;
  assignedTo?: unknown;
}

const stageStartAt = (prospect: ProspectLike): Date | undefined => {
  const start = prospect.stageStartedAt || prospect.dateReceived || prospect.createdAt;
  return resolveDeadlineDateTime(start ?? undefined);
};

/** Auto-calculated due date for the current stage = stage start + stage SLA. */
export const computeStageDueAt = (prospect: ProspectLike): Date | undefined => {
  const start = stageStartAt(prospect);
  const sla = getStageSlaHours(prospect.stage);
  if (!start || !sla) return undefined;
  return new Date(start.getTime() + sla * 60 * 60 * 1000);
};


/**
 * Stage status, honouring an explicit override and deriving a sensible default:
 * terminal -> Completed, all mandatory items done -> Completed, active current
 * stage -> In Progress, future stage -> Not Started, explicit "Blocked" respected.
 */
export const deriveStageStatus = (prospect: ProspectLike): ProspectStageStatus => {
  const stage = prospect.stage || 'Inquiry';
  if (prospect.stageStatus === 'Blocked') return 'Blocked';
  if (isTerminalStage(stage)) return (prospect.stageStatus as ProspectStageStatus) || 'Completed';
  const checklist = resolveStageChecklist(prospect);
  const allDone = checklist.length > 0 && checklist.every((item) => item.done);
  if (allDone && prospect.stageStatus !== 'In Progress') return 'Completed';
  const currentIndex = PROSPECT_STAGE_ORDER.indexOf(stage as ProspectStageName);
  const reached = (prospect.completedStages || []).length;
  if (currentIndex >= 0 && currentIndex < reached) return 'Completed';
  if (currentIndex >= 0 && currentIndex === reached) return 'In Progress';
  return (prospect.stageStatus as ProspectStageStatus) || 'Not Started';
};

/**
 * Stage-gate: a stage may only be "Complete" when every mandatory checklist
 * requirement is done (otherwise "In Progress" / "Blocked").
 */
export type StageGateStatus = 'Complete' | 'In Progress' | 'Blocked';

export const deriveStageGate = (prospect: ProspectLike): { status: StageGateStatus; done: number; total: number } => {
  const checklist = resolveStageChecklist(prospect);
  const done = checklist.filter((item) => item.done).length;
  const total = checklist.length;
  if (deriveStageStatus(prospect) === 'Blocked') return { status: 'Blocked', done, total };
  if (total > 0 && done === total) return { status: 'Complete', done, total };
  return { status: 'In Progress', done, total };
};

const personName = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' ? name.trim() : '';
};

export const getResponsiblePersonName = (prospect: ProspectLike): string => {
  for (const c of [prospect.responsiblePartner, prospect.responsibleAssociate, prospect.assignedTo]) {
    const name = personName(c);
    if (name) return name;
  }
  return '';
};

/** Deadline colour for the current stage (reuses the platform-wide rules). */
export const getStageUrgencyColor = (prospect: ProspectLike, now = new Date()): UrgencyColor => {
  if (isTerminalStage(prospect.stage)) {
    return prospect.stageStatus === 'Blocked' ? 'gray' : 'blue';
  }
  const due = getStageDueAt(prospect);
  if (!due) return 'gray';
  return getUrgencyColorForDueDate(due, stageStartAt(prospect), now);
};

export interface ProspectWorkflowSummary {
  currentStage: string;
  docStage: string;
  nextStage?: string;
  stageStatus: ProspectStageStatus;
  waitingOn: ProspectWaitingOn;
  responsiblePerson: string;
  slaHours: number;
  slaLabel: string;
  startAt?: Date;
  dueAt?: Date;
  timeRemainingMs?: number;
  urgencyColor: UrgencyColor;
  stageGate: StageGateStatus;
  checklistDone: number;
  checklistTotal: number;
  outstandingRequirement: string;
}

/** One-stop summary used by both the Intake list and the Prospect Workspace. */
export const computeProspectWorkflow = (prospect: ProspectLike, now = new Date()): ProspectWorkflowSummary => {
  const stage = prospect.stage || 'Inquiry';
  const config = getStageConfig(stage);
  const dueAt = getStageDueAt(prospect);
  const startAt = stageStartAt(prospect);
  const gate = deriveStageGate(prospect);
  const timeRemainingMs = dueAt && !isTerminalStage(stage) ? dueAt.getTime() - now.getTime() : undefined;
  return {
    currentStage: stage,
    docStage: config?.docStage || stage,
    nextStage: getNextStage(stage),
    stageStatus: deriveStageStatus(prospect),
    waitingOn: (prospect.waitingOn as ProspectWaitingOn) || 'Firm',
    responsiblePerson: getResponsiblePersonName(prospect),
    slaHours: config?.slaHours ?? 0,
    slaLabel: config?.slaLabel || '',
    startAt,
    dueAt,
    timeRemainingMs,
    urgencyColor: getStageUrgencyColor(prospect, now),
    stageGate: gate.status,
    checklistDone: gate.done,
    checklistTotal: gate.total,
    outstandingRequirement: prospect.outstandingRequirement || '',
  };
};

export const getStageDueAt = (prospect: ProspectLike): Date | undefined => {
  const explicit = resolveDeadlineDateTime(prospect.stageDueAt ?? undefined);
  if (explicit) return explicit;
  return computeStageDueAt(prospect);
};

export type ProspectStageChecklistItem = { key: string; label: string; done: boolean; doneBy?: string; doneAt?: Date | string };

const itemKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** Merge the stored checklist ticks with the stage's mandatory items. */
export const resolveStageChecklist = (prospect: ProspectLike): ProspectStageChecklistItem[] => {
  const labels = getStageChecklist(prospect.stage);
  const stored = Array.isArray(prospect.stageChecklist) ? prospect.stageChecklist : [];
  return labels.map((label) => {
    const key = itemKey(label);
    const hit = stored.find((item) => (item?.key || itemKey(item?.label || '')) === key);
    return { key, label, done: !!hit?.done, doneBy: hit?.doneBy, doneAt: hit?.doneAt };
  });
};

