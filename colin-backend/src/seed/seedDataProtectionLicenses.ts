import WorkflowTemplate from '../models/workflowTemplateModel';

export const seedDataProtectionLicensesTemplate = async () => {
  const name = 'Data Protection Licenses';
  const version = 1;

  const exists = await WorkflowTemplate.findOne({ name, version });
  if (exists) return exists;

  return WorkflowTemplate.create({
    name,
    matterType: 'Data Protection Licenses',
    caseType: 'Transactional Cases',
    version,
    active: true,

    stages: [
      { key: 'onboarding', order: 1, title: 'Client onboarding & conflict check' },
      { key: 'assessment', order: 2, title: 'Pre-registration file assessment' },
      { key: 'preparation', order: 3, title: 'Registration file preparation' },
      { key: 'filing', order: 4, title: 'Filing application and follow-up' },
      { key: 'issuance', order: 5, title: 'Certificate issuance and handover' },
    ],

    steps: [
      {
        key: 'DPP_1_ONBOARDING',
        order: 1,
        stageKey: 'onboarding',
        title: 'Client onboarding and conflict check',
        actions: [
          'Conduct conflict search',
          'Discuss needs/objectives/requirements',
          'Sign engagement/retainer agreement',
        ],
        outputs: [
          {
            key: 'engagement_retainer_agreement',
            name: 'Engagement/retainer agreement',
            required: true,
            category: 'Administration',
          },
          { key: 'client_file', name: 'Client file', required: true, category: 'Administration' },
        ],
        legalBasis: [
          { text: 'Art 139 internal rules of RBA' },
          { text: 'DPO registration guide' },
        ],
        fee: { type: 'fixed', currency: 'RWF', min: 30000, max: 30000, text: '30,000 RWF (Opening file)' },
        sla: { unit: 'hours', min: 4, max: 8, text: 'Within 4–8 hrs of first contact' },
      },
      {
        key: 'DPP_2_ASSESSMENT',
        order: 2,
        stageKey: 'assessment',
        title: 'Pre-registration file assessment',
        actions: [
          'Legal analysis to determine controller/processor/both',
          'Confirm Rwanda nexus',
          'Identify cross-border transfer/storage',
        ],
        outputs: [{ key: 'legal_opinion', name: 'Legal opinion', required: true, category: 'Legal' }],
        legalBasis: [{ text: 'Arts. 29 & 30 of DPP Law; DPO guidance' }],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 300000, text: '100,000 – 300,000 RWF' },
        sla: { unit: 'hours', min: 24, max: 72, text: '24–72 hrs after instruction' },
      },
      {
        key: 'DPP_3_PREPARATION',
        order: 3,
        stageKey: 'preparation',
        title: 'Registration file preparation',
        actions: [
          'Fill registration form (details, processing, recipients, transfers, risks)',
          'Identify data subjects/types/purposes',
          'Identify recipients/transfer countries/security gaps',
          'Identify risks/safeguards',
          'Draft data processing contracts (if needed)',
          'Application letter to CEO NCSA',
          'Local representative agreement (if needed)',
          'Draft/review additional documents (privacy notice, policies, DPIA, breach docs, etc.)',
        ],
        outputs: [
          { key: 'signed_registration_application', name: 'Signed registration application', required: true, category: 'Filing' },
          { key: 'data_processing_contracts', name: 'Data processing contracts', required: false, category: 'Contracts' },
          { key: 'application_letter', name: 'Application letter', required: true, category: 'Filing' },
          { key: 'consent_forms', name: 'Consent/withdrawal forms', required: false, category: 'Compliance' },
          { key: 'privacy_policies', name: 'Policies (privacy, cookie, PDP, retention)', required: false, category: 'Compliance' },
          { key: 'dpia_register', name: 'DPIA register', required: false, category: 'Compliance' },
          { key: 'breach_response_docs', name: 'Breach response docs', required: false, category: 'Compliance' },
        ],
        legalBasis: [
          { text: 'Articles 6–9, 17, 30, 38, 42, 46–47, 52; Articles 43–45 of DPP Law; DPO registration guide' },
        ],
        fee: { type: 'text', text: '2,000,000 – 15,000,000 FRW (art. 23[VII])' },
        sla: { unit: 'days', min: 3, max: 7, text: '3 to 7 days (matter-specific)' },
      },
      {
        key: 'DPP_4_FILING',
        order: 4,
        stageKey: 'filing',
        title: 'Filing application and follow-up',
        actions: [
          'Submit application to supervisory authority (NCSA), track acknowledgement',
          'Respond to queries/deficiency notices',
        ],
        outputs: [
          { key: 'submission_proof', name: 'Filed application and proof of submission', required: true, category: 'Filing' },
        ],
        legalBasis: [{ text: 'Art. 29 of DPP Law' }],
        fee: { type: 'range', currency: 'RWF', min: 500000, max: 3000000, text: '500,000 – 3,000,000 FRW (art. 34)' },
        sla: { unit: 'days', min: 0, max: 1, text: 'Same day filing; follow-up as needed' },
      },
      {
        key: 'DPP_5_ISSUANCE',
        order: 5,
        stageKey: 'issuance',
        title: 'Certificate issuance and handover',
        actions: ['Follow up until certificate is issued', 'Store in file', 'Alert client of obligations'],
        outputs: [
          {
            key: 'registration_certificate',
            name: 'Registration certificate (controller/processor)',
            required: true,
            category: 'Compliance',
          },
        ],
        legalBasis: [{ text: 'Art. 31 of DPP Law' }],
        fee: { type: 'included', text: 'Included above' },
        sla: { unit: 'days', text: 'Within 30 working days where requirements are met' },
      },
    ],
  });
};

