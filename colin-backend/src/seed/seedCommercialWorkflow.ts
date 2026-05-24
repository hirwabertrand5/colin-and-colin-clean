import WorkflowTemplate from '../models/workflowTemplateModel';

export const seedCommercialWorkflowTemplate = async () => {
  const name = 'Commercial Litigation Workflow';
  const version = 1;

  const exists = await WorkflowTemplate.findOne({ name, version });
  if (exists) return exists;

  return WorkflowTemplate.create({
    name,
    matterType: 'Commercial Litigation',
    caseType: 'Litigation Cases',
    version,
    active: true,

    stages: [
      { key: 'onboarding', order: 1, title: 'Client Onboarding & Conflict Check' },
      { key: 'assessment', order: 2, title: 'Case Assessment & Evidence' },
      { key: 'pre_action', order: 3, title: 'Pre-Action Steps (Demand / Notice)' },
      { key: 'filing', order: 4, title: 'Filing & Registration Follow-up' },
      { key: 'pretrial', order: 5, title: 'Pre-Trial Conference' },
      { key: 'hearing', order: 6, title: 'Hearing Stage' },
      { key: 'judgment', order: 7, title: 'Judgment' },
      { key: 'post_judgment', order: 8, title: 'Post-Judgment / Enforcement' },
      { key: 'appeal', order: 9, title: 'Appeal' },
    ],

    steps: [
      {
        key: 'COM_1_ONBOARDING',
        order: 1,
        stageKey: 'onboarding',
        title: 'Client Onboarding & Conflict Check',
        actions: ['Receive client inquiry', 'Verify identity', 'Conflict check', 'Sign engagement letter'],
        outputs: [
          { key: 'client_file', name: 'Client file opened', required: true, category: 'Administration' },
          { key: 'engagement_letter', name: 'Signed engagement letter', required: true, category: 'Engagement' },
          { key: 'conflict_check', name: 'Conflict check record', required: true, category: 'Compliance' },
        ],
        legalBasis: [{ text: 'Art 85 (procedure law) / RBA fees scale (per workflow doc)' }],
        fee: { type: 'range', currency: 'RWF', min: 50000, max: 200000 },
        sla: { unit: 'hours', min: 4, max: 8, text: '4–8 hours' },
      },
      {
        key: 'COM_2_ASSESSMENT_EVIDENCE',
        order: 2,
        stageKey: 'assessment',
        title: 'Case Assessment & Evidence Collection',
        actions: [
          'Interview client and review facts',
          'Assess evidence',
          'Prepare legal opinion',
          'Gather and organize documents',
          'Identify witnesses',
          'Identify disputes and prepare strategy memo',
        ],
        outputs: [
          { key: 'legal_opinion', name: 'Legal opinion', required: false, category: 'Advice' },
          { key: 'evidence_dossier', name: 'Evidence dossier', required: false, category: 'Evidence' },
          { key: 'strategy_memo', name: 'Strategy memo', required: false, category: 'Strategy' },
        ],
        legalBasis: [{ text: 'Art 33 / Art 12 (procedure law) (per workflow doc)' }],
        fee: { type: 'included', text: 'Included in consultation fees (per workflow doc)' },
        sla: { unit: 'hours', min: 24, max: 72, text: '24–72 hours' },
      },
      {
        key: 'COM_3_PRE_ACTION',
        order: 3,
        stageKey: 'pre_action',
        title: 'Pre-Action Steps (Demand Letter / Notice of Intent)',
        actions: ['Draft demand letter', 'Review and send demand letter', 'Draft formal notice of intent to sue and serve it'],
        outputs: [
          { key: 'demand_letter', name: 'Demand letter', required: false, category: 'Correspondence' },
          { key: 'formal_notice', name: 'Formal notice served + proof of delivery', required: false, category: 'Correspondence' },
        ],
        legalBasis: [{ text: 'N/A / RBA fees scale (per workflow doc)' }],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 300000 },
        sla: { unit: 'days', min: 0, max: 1, text: '1 hour – 24 hours (per workflow doc)' },
      },
      {
        key: 'COM_4_FILING',
        order: 4,
        stageKey: 'filing',
        title: 'Filing Case & Registration Follow-up',
        actions: ['File claim', 'Pay court fees and obtain receipt', 'Monitor registry until case registered'],
        outputs: [
          { key: 'court_receipt', name: 'Court filing receipt', required: false, category: 'Court' },
          { key: 'case_registered', name: 'Case registration confirmation', required: false, category: 'Court' },
        ],
        legalBasis: [{ text: 'Art 20–21 (procedure law) (per workflow doc)' }],
        fee: { type: 'range', currency: 'RWF', min: 500000, max: 3500000 },
        sla: { unit: 'days', min: 1, max: 5, text: '1–5 days (per workflow doc)' },
      },
      {
        key: 'COM_5_PRETRIAL',
        order: 5,
        stageKey: 'pretrial',
        title: 'Pre-Trial Conference',
        actions: ['Prepare and attend pre-trial meeting', 'Produce pretrial report'],
        outputs: [{ key: 'pretrial_report', name: 'Pretrial report', required: false, category: 'Court' }],
        legalBasis: [{ text: 'Art 24–30 (procedure law) (per workflow doc)' }],
        fee: { type: 'included', text: 'Included in judgment-related fees (per workflow doc)' },
        sla: { unit: 'weeks', text: '1–3 months (per workflow doc)' },
      },
      {
        key: 'COM_6_HEARING',
        order: 6,
        stageKey: 'hearing',
        title: 'Hearing Stage',
        actions: ['Prepare and attend hearings', 'Maintain hearing record'],
        outputs: [{ key: 'hearing_record', name: 'Hearing record', required: false, category: 'Court' }],
        legalBasis: [{ text: 'Art 66–72 (procedure law) (per workflow doc)' }],
        fee: { type: 'text', text: 'Tariffs apply; may include transaction amounts (per workflow doc)' },
        sla: { unit: 'weeks', text: '3–6 months (per workflow doc)' },
      },
      {
        key: 'COM_7_JUDGMENT',
        order: 7,
        stageKey: 'judgment',
        title: 'Judgment',
        actions: ['Follow decision', 'Notify client'],
        outputs: [{ key: 'judgment_copy', name: 'Judgment copy / decision notice', required: false, category: 'Court' }],
        legalBasis: [{ text: 'Art 130–137 (procedure law) (per workflow doc)' }],
        fee: { type: 'text', text: '500,000–3,500,000 or % of value (per workflow doc)' },
        sla: { unit: 'weeks', text: '1–2 months (per workflow doc)' },
      },
      {
        key: 'COM_8_POST_JUDGMENT',
        order: 8,
        stageKey: 'post_judgment',
        title: 'Post-Judgment / Enforcement',
        actions: ['Execute/enforce judgment', 'Work with bailiff if necessary'],
        outputs: [{ key: 'enforcement_result', name: 'Enforcement result / execution record', required: false, category: 'Enforcement' }],
        legalBasis: [{ text: 'Art 247 (procedure law) (per workflow doc)' }],
        fee: { type: 'text', text: 'N/A (per workflow doc)' },
        sla: { unit: 'weeks', text: '3–6 months (per workflow doc)' },
      },
      {
        key: 'COM_9_APPEAL',
        order: 9,
        stageKey: 'appeal',
        title: 'Appeal',
        actions: ['Draft appeal', 'File appeal', 'Represent client'],
        outputs: [{ key: 'appeal_submission', name: 'Appeal submission / case filed', required: false, category: 'Appeal' }],
        legalBasis: [{ text: 'Art 147–168 (procedure law) (per workflow doc)' }],
        fee: { type: 'range', currency: 'RWF', min: 500000, max: 3500000 },
        sla: { unit: 'weeks', text: '1 month (per workflow doc)' },
      },
    ],
  });
};