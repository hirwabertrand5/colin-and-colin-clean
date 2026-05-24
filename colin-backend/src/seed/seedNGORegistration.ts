import WorkflowTemplate from '../models/workflowTemplateModel';

export const seedNGORegistrationTemplate = async () => {
  const name = 'NGO Registration';
  const version = 1;

  const exists = await WorkflowTemplate.findOne({ name, version });
  if (exists) return exists;

  return WorkflowTemplate.create({
    name,
    matterType: 'NGO Registration',
    caseType: 'Transactional Cases',
    version,
    active: true,

    stages: [
      { key: 'onboarding', order: 1, title: 'Client onboarding & Conflict check' },
      { key: 'setup', order: 2, title: 'Initial Setup' },
      { key: 'home_country', order: 3, title: 'Home Country Proof (foreign individuals)' },
      { key: 'leadership', order: 4, title: 'Vetting Leadership' },
      { key: 'approval', order: 5, title: 'External Approval' },
      { key: 'planning', order: 6, title: 'Strategic Planning' },
      { key: 'structure', order: 7, title: 'Structural Setup' },
      { key: 'filing', order: 8, title: 'Final Filing' },
    ],

    steps: [
      {
        key: 'NGO_1_ONBOARDING',
        order: 1,
        stageKey: 'onboarding',
        title: 'Client onboarding & Conflict check',
        actions: ['Receive client instructions', 'Conduct conflict check', 'Open client file'],
        outputs: [
          { key: 'client_file', name: 'Client file created', required: true, category: 'Administration' },
          { key: 'conflict_clearance', name: 'Conflict clearance confirmation', required: true, category: 'Compliance' },
        ],
        legalBasis: [{ text: 'N/A' }],
        fee: { type: 'range', currency: 'RWF', min: 50000, max: 200000 },
        sla: { unit: 'hours', min: 4, max: 8, text: '4–8 hours' },
      },
      {
        key: 'NGO_2_SETUP',
        order: 2,
        stageKey: 'setup',
        title: 'Initial Setup',
        actions: ['Draft statutes', 'Notarize founding documents'],
        outputs: [
          { key: 'statutes', name: 'Notarized statutes', required: true, category: 'Documents' },
          { key: 'minutes', name: 'Notarized minutes of meeting', required: false, category: 'Documents' },
        ],
        legalBasis: [{ text: 'Art 20 (NGO law) — see workflow document' }],
        fee: { type: 'range', currency: 'RWF', min: 500000, max: 3000000 },
        sla: { unit: 'days', min: 0, max: 1, text: 'Same day' },
      },
      {
        key: 'NGO_3_HOME_COUNTRY',
        order: 3,
        stageKey: 'home_country',
        title: 'Home Country Proof (foreign individuals)',
        actions: ['Verify legal status in country of origin'],
        outputs: [{ key: 'home_country_proof', name: 'Official authorization to operate', required: false, category: 'Compliance' }],
        legalBasis: [{ text: 'Art 29 (NGO law) — see workflow document' }],
      },
      {
        key: 'NGO_4_LEADERSHIP',
        order: 4,
        stageKey: 'leadership',
        title: 'Vetting Leadership',
        actions: ['Identify legal representatives', 'Submit credentials'],
        outputs: [
          { key: 'ids', name: 'IDs and particulars', required: true, category: 'Compliance' },
          { key: 'criminal_records', name: 'Criminal records & acceptance declarations (local NGO)', required: false, category: 'Compliance' },
        ],
        legalBasis: [{ text: 'Art 20 / Art 29 (NGO law) — see workflow document' }],
        sla: { unit: 'hours', min: 4, max: 8, text: '4–8 hours' },
      },
      {
        key: 'NGO_5_APPROVAL',
        order: 5,
        stageKey: 'approval',
        title: 'External Approval',
        actions: ['Seek institutional approvals', 'Secure required agreements'],
        outputs: [
          { key: 'district_letter', name: 'District collaboration letter (local NGO)', required: false, category: 'Approvals' },
          { key: 'partnership_agreement', name: 'Partnership agreement (international NGO)', required: false, category: 'Approvals' },
        ],
        legalBasis: [{ text: 'Art 20 / Art 29 (NGO law) — see workflow document' }],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 600000 },
        sla: { unit: 'hours', min: 4, max: 8, text: '4–8 hours' },
      },
      {
        key: 'NGO_6_PLANNING',
        order: 6,
        stageKey: 'planning',
        title: 'Strategic Planning',
        actions: ['Prepare action plan', 'Develop budget', 'Identify funding sources'],
        outputs: [
          { key: 'action_plan', name: 'Annual action plan', required: true, category: 'Planning' },
          { key: 'budget', name: 'Budget and funding source', required: false, category: 'Planning' },
        ],
        legalBasis: [{ text: 'Art 20 / Art 29 (NGO law) — see workflow document' }],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 300000 },
        sla: { unit: 'hours', min: 24, max: 72, text: '24–72 hours' },
      },
      {
        key: 'NGO_7_STRUCTURE',
        order: 7,
        stageKey: 'structure',
        title: 'Structural Setup',
        actions: ['Define organizational structure'],
        outputs: [{ key: 'org_structure', name: 'Organizational structure', required: true, category: 'Governance' }],
        legalBasis: [{ text: 'Art 29 (NGO law) — see workflow document' }],
        fee: { type: 'text', text: '2,000,000 – 15,000,000 RWF' },
        sla: { unit: 'hours', min: 24, max: 72, text: '24–72 hours' },
      },
      {
        key: 'NGO_8_FILING',
        order: 8,
        stageKey: 'filing',
        title: 'Final Filing',
        actions: ['Submit application', 'Pay required fees'],
        outputs: [
          { key: 'submission_confirmation', name: 'Electronic submission confirmation', required: true, category: 'Filing' },
          { key: 'payment_proof', name: 'Proof of non-refundable fee payment', required: true, category: 'Filing' },
        ],
        legalBasis: [{ text: 'Art 6 (NGO law) — see workflow document' }],
        fee: { type: 'range', currency: 'RWF', min: 500000, max: 2000000 },
        sla: { unit: 'hours', min: 24, max: 24, text: '24 hours' },
      },
    ],
  });
};