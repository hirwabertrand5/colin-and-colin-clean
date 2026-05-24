import WorkflowTemplate from '../models/workflowTemplateModel';

export const seedBusinessRegistrationTemplate = async () => {
  const name = 'Business Registration Procedure';
  const version = 1;

  const exists = await WorkflowTemplate.findOne({ name, version });
  if (exists) return exists;

  return WorkflowTemplate.create({
    name,
    matterType: 'Business Registration',
    caseType: 'Transactional Cases',
    version,
    active: true,

    stages: [
      { key: 'preincorporation', order: 1, title: 'Pre-Incorporation (Company Type)' },
      { key: 'name_reservation', order: 2, title: 'Company Name Reservation & Clearance' },
      { key: 'documents', order: 3, title: 'Preparation of Incorporation Documents' },
      { key: 'filing', order: 4, title: 'Filing Application for Incorporation' },
      { key: 'certificate', order: 5, title: 'Certificate of Incorporation & Legal Personality' },
      { key: 'post_incorp', order: 6, title: 'Post-Incorporation Compliance' },
    ],

    steps: [
      {
        key: 'BUS_1_PREINC',
        order: 1,
        stageKey: 'preincorporation',
        title: 'Determine Company Type & Requirements',
        actions: [
          'Advise client on appropriate company type',
          'Explain private/public company requirements',
          'Confirm general incorporation requirements',
        ],
        outputs: [
          { key: 'advisory_note', name: 'Advisory note on company type selection', required: false, category: 'Advice' },
          { key: 'requirements_checklist', name: 'Requirements checklist', required: false, category: 'Checklist' },
        ],
        legalBasis: [{ text: 'Law No. 007/2021 (as per workflow doc)' }],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 300000 },
        sla: { unit: 'days', min: 0, max: 3, text: 'Advice within 24–72 hours (per workflow doc)' },
      },
      {
        key: 'BUS_2_NAME',
        order: 2,
        stageKey: 'name_reservation',
        title: 'Company Name Selection & Search',
        actions: ['Advise on permissible names', 'Conduct name search/clearance with Registrar General'],
        outputs: [
          { key: 'name_search_result', name: 'Name search result / clearance confirmation', required: true, category: 'Registration' },
        ],
        legalBasis: [{ text: 'Company name provisions (per workflow doc)' }],
        fee: { type: 'range', currency: 'RWF', min: 50000, max: 100000 },
        sla: { unit: 'days', min: 0, max: 2, text: 'Complete within 24–48 hours (per workflow doc)' },
      },
      {
        key: 'BUS_3_DOCS',
        order: 3,
        stageKey: 'documents',
        title: 'Draft Incorporation Documents',
        actions: [
          'Draft Memorandum of Association',
          'Draft Articles of Association (optional)',
          'Collect consents (directors/secretary/shareholders)',
          'Prepare beneficial ownership information',
        ],
        outputs: [
          { key: 'memorandum', name: 'Memorandum of Association (draft/final)', required: true, category: 'Documents' },
          { key: 'articles', name: 'Articles of Association (if applicable)', required: false, category: 'Documents' },
          { key: 'consents', name: 'Signed consent forms', required: false, category: 'Documents' },
          { key: 'beneficial_ownership', name: 'Beneficial ownership declaration', required: false, category: 'Compliance' },
        ],
        legalBasis: [{ text: 'Incorporation docs requirements (per workflow doc)' }],
        fee: { type: 'text', text: 'Varies by document; see workflow doc fee ranges' },
        sla: { unit: 'days', min: 2, max: 5, text: 'Draft within 2–5 days (per workflow doc)' },
      },
      {
        key: 'BUS_4_FILING',
        order: 4,
        stageKey: 'filing',
        title: 'Submit Application to Registrar General',
        actions: ['Compile and submit incorporation application', 'Monitor review and respond to queries'],
        outputs: [
          { key: 'submission_proof', name: 'Proof of submission', required: true, category: 'Filing' },
          { key: 'response_queries', name: 'Responses to Registrar queries (if any)', required: false, category: 'Filing' },
        ],
        legalBasis: [{ text: 'Registrar General filing duties (per workflow doc)' }],
        fee: { type: 'range', currency: 'RWF', min: 300000, max: 1000000 },
        sla: { unit: 'days', min: 1, max: 2, text: 'File within 24–48 hours (per workflow doc)' },
      },
      {
        key: 'BUS_5_CERT',
        order: 5,
        stageKey: 'certificate',
        title: 'Certificate of Incorporation Issued',
        actions: ['Receive certificate', 'Advise on legal personality acquired', 'Deliver post-incorporation checklist'],
        outputs: [
          { key: 'certificate', name: 'Certificate of Incorporation', required: true, category: 'Registration' },
          { key: 'post_incorp_checklist', name: 'Post-incorporation checklist/advisory note', required: false, category: 'Advice' },
        ],
        legalBasis: [{ text: 'Certificate issuance and legal personality (per workflow doc)' }],
        fee: { type: 'included', text: 'Government fee (paid to Registrar) + included advisory' },
        sla: { unit: 'days', min: 0, max: 1, text: 'Deliver within 24 hours of receipt (per workflow doc)' },
      },
      {
        key: 'BUS_6_POST',
        order: 6,
        stageKey: 'post_incorp',
        title: 'Post-Incorporation Compliance',
        actions: [
          'Confirm registered office/address compliance',
          'Set up share structure and registers',
          'Establish board and records',
          'Annual returns filing guidance',
          'Audit requirements and director interest declarations',
        ],
        outputs: [
          { key: 'compliance_notes', name: 'Compliance advisory notes', required: false, category: 'Compliance' },
          { key: 'registers', name: 'Company registers (share/directors) guidance', required: false, category: 'Compliance' },
        ],
        legalBasis: [{ text: 'Ongoing compliance obligations (per workflow doc)' }],
        fee: { type: 'text', text: 'Varies per compliance item (per workflow doc)' },
        sla: { unit: 'weeks', text: 'Ongoing' },
      },
    ],
  });
};