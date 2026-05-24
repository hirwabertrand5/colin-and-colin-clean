import WorkflowTemplate from '../models/workflowTemplateModel';

export const seedTontineRegistrationTemplate = async () => {
  const name = 'Tontine Registration';
  const version = 1;

  const exists = await WorkflowTemplate.findOne({ name, version });
  if (exists) return exists;

  return WorkflowTemplate.create({
    name,
    matterType: 'Tontine Registration',
    caseType: 'Transactional Cases',
    version,
    active: true,

    stages: [
      { key: 'intake', order: 1, title: 'Initial Client Intake & Pre-registration' },
      { key: 'filing', order: 2, title: 'Filing the Application for Registration' },
      { key: 'post_registration', order: 3, title: 'Post Registration – Ongoing Compliance' },
    ],

    steps: [
      {
        key: 'TONTINE_1_INTAKE',
        order: 1,
        stageKey: 'intake',
        title: 'Client onboarding & conflict check',
        actions: [
          'Conduct conflict check',
          'Discuss with client to understand needs/goals/facts',
          'Sign engagement/retainer',
        ],
        outputs: [
          { key: 'engagement_letter', name: 'Engagement letter', required: true, category: 'Administration' },
          {
            key: 'conflict_of_interest_declaration',
            name: 'Conflict of Interest declaration',
            required: true,
            category: 'Compliance',
          },
        ],
        legalBasis: [{ text: 'Article 139 of the internal rules and regulations of the RBA' }],
        fee: { type: 'fixed', currency: 'RWF', min: 30000, max: 30000, text: '30,000 RWF (Opening file)' },
        sla: { unit: 'hours', min: 4, max: 8, text: '4–8 hours' },
      },
      {
        key: 'TONTINE_2_ASSESSMENT',
        order: 2,
        stageKey: 'intake',
        title: 'Pre-registration file assessment',
        actions: ['Conduct requirements analysis', 'Identify required documents', 'Identify appropriate procedure'],
        outputs: [{ key: 'legal_opinion', name: 'Legal opinion', required: true, category: 'Legal' }],
        legalBasis: [
          { text: 'Ministerial order n° 001/24/10/tc of 21/08/2024 governing tontines' },
          { text: 'Ministerial Instructions n° 001/25/10/TC of 21/01/2025 (template of rules of procedure)' },
        ],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 300000, text: '100,000 – 300,000 RWF' },
        sla: { unit: 'hours', min: 24, max: 72, text: 'Within 24–72 hours of instruction' },
      },
      {
        key: 'TONTINE_3_RULES',
        order: 3,
        stageKey: 'filing',
        title: 'Drafting rules of procedure',
        actions: ['Coordinate with client needs', 'Advise on governance structure'],
        outputs: [{ key: 'rules_of_procedure', name: 'Rules of procedure', required: true, category: 'Documents' }],
        legalBasis: [
          { text: 'Article 27 of Ministerial order n° 001/24/10/tc' },
          { text: 'Ministerial Instructions n° 001/25/10/TC' },
        ],
        fee: { type: 'range', currency: 'RWF', min: 500000, max: 2000000, text: '500,000 – 2,000,000 RWF' },
        sla: { unit: 'hours', min: 48, max: 72, text: '48–72 hours' },
      },
      {
        key: 'TONTINE_4_APPLICATION',
        order: 4,
        stageKey: 'filing',
        title: 'Application for registration of tontine',
        actions: ['Gather/draft required documents', 'Apply for tontine registration'],
        outputs: [{ key: 'application_file', name: 'Complete application file', required: true, category: 'Filing' }],
        legalBasis: [{ text: 'Article 13 of Ministerial order n° 001/24/10/tc' }],
        fee: { type: 'included', text: 'Included above' },
        sla: { unit: 'hours', min: 24, max: 48, text: '24–48 hours' },
      },
      {
        key: 'TONTINE_5_CERTIFICATE',
        order: 5,
        stageKey: 'post_registration',
        title: 'Issuance of registration certificate',
        actions: ['Notify the client of the issuance of the registration certificate'],
        outputs: [
          { key: 'notification_letter', name: 'Notification letter', required: false, category: 'Client Communication' },
          { key: 'registration_certificate', name: 'Registration certificate', required: true, category: 'Compliance' },
        ],
        legalBasis: [{ text: 'N/A' }],
        fee: { type: 'text', text: 'N/A' },
        sla: { unit: 'hours', text: 'Immediately upon issuance' },
      },
      {
        key: 'TONTINE_6_COMPLIANCE',
        order: 6,
        stageKey: 'post_registration',
        title: 'Compliance obligations',
        actions: ['Ensure compliance with internal control mechanisms', 'Open bank account for the tontine (if required)'],
        outputs: [
          {
            key: 'internal_controls',
            name: 'Internal control mechanisms',
            required: true,
            category: 'Compliance',
          },
          { key: 'bank_account', name: 'Bank account', required: false, category: 'Banking' },
        ],
        legalBasis: [{ text: 'Article 271 & 23 of Ministerial order n° 001/24/10/tc' }],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 300000, text: '100,000 – 300,000 RWF' },
        sla: { unit: 'hours', min: 24, max: 48, text: '24–48 hours' },
      },
    ],
  });
};

