/**
 * Canonical Intake & Prospect stage configuration (backend mirror).
 *
 * Mirrors src/utils/prospectStageConfig.ts on the frontend. The prospect stages
 * are unchanged; this layers the onboarding document's workflow-control rules
 * (indicative TAT / SLA, mandatory Key Actions checklist, next stage) on top.
 *
 * SLAs are centralised here so they stay tunable per stage / service type
 * ("SLAs must be configurable by stage and matter/service type rather than
 * hard-coded"). Keep this in sync with the frontend copy.
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
  order: number;
  slaHours: number;
  slaLabel: string;
  clientDependent?: boolean;
  docStage: string;
  checklist: string[];
  terminal?: boolean;
}

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

export const getNextStage = (stage?: string | null): ProspectStageName | undefined => {
  const active = PROSPECT_STAGE_CONFIG.filter((s) => !s.terminal);
  const idx = active.findIndex((s) => s.stage === stage);
  if (idx < 0) return undefined;
  return active[idx + 1]?.stage;
};

export const getStageSlaHours = (stage?: string | null): number => getStageConfig(stage)?.slaHours ?? 0;

export const getStageChecklist = (stage?: string | null): string[] => getStageConfig(stage)?.checklist ?? [];

export const stageChecklistKey = (label: string): string =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** Auto-calculated due date for a stage = start + stage SLA. */
export const addSlaToDate = (start: Date, slaHours: number): Date =>
  new Date(start.getTime() + slaHours * 60 * 60 * 1000);

