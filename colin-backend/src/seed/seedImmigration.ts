import WorkflowTemplate from '../models/workflowTemplateModel';

export const seedImmigrationTemplate = async () => {
  const name = 'Immigration';
  const version = 1;

  const exists = await WorkflowTemplate.findOne({ name, version });
  if (exists) return exists;

  return WorkflowTemplate.create({
    name,
    matterType: 'Immigration',
    caseType: 'Transactional Cases',
    version,
    active: true,

    stages: [
      { key: 'intake', order: 1, title: 'Client intake & immigration assessment' },
      { key: 'visas', order: 2, title: 'Visa applications' },
      { key: 'residence', order: 3, title: 'Residence permits' },
    ],

    steps: [
      {
        key: 'IMM_1_CONSULTATION',
        order: 1,
        stageKey: 'intake',
        title: 'Initial consultation',
        actions: [
          'Receive client and conduct intake interview',
          'Identify immigration goal',
          'Explain procedure/rights',
          'Conflict check',
          'Sign engagement/retainer letter',
        ],
        outputs: [
          { key: 'intake_form', name: 'Client intake form', required: true, category: 'Administration' },
          {
            key: 'conflict_declaration',
            name: 'Conflict-of-interest declaration',
            required: true,
            category: 'Compliance',
          },
          { key: 'engagement_letter', name: 'Signed engagement letter', required: true, category: 'Administration' },
          { key: 'case_file', name: 'Immigration case file opened', required: true, category: 'Administration' },
        ],
        legalBasis: [{ text: 'Ministerial Order N°06/01 (immigration & emigration)' }],
        fee: { type: 'fixed', currency: 'RWF', min: 30000, max: 30000, text: 'RWF 30,000 (Opening file) – Art. 21 RBA' },
        sla: { unit: 'hours', min: 4, max: 8, text: 'Within 4–8 hrs of first contact' },
      },
      {
        key: 'IMM_2_ASSESSMENT',
        order: 2,
        stageKey: 'intake',
        title: 'Legal assessment',
        actions: [
          'Advise on options',
          'Analyze visa/permit category',
          'Prepare written legal opinion',
          'Identify required documentation',
        ],
        outputs: [
          { key: 'legal_opinion_note', name: 'Written legal opinion note', required: true, category: 'Legal' },
          { key: 'pathway_analysis', name: 'Pathway analysis', required: false, category: 'Legal' },
          { key: 'document_checklist', name: 'Document checklist', required: true, category: 'Compliance' },
        ],
        legalBasis: [{ text: 'Arts. 3, 10–12, 13, 20 (Ministerial Order N°06/01)' }],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 300000, text: 'RWF 100,000 – 300,000 (Art. 22(1) RBA)' },
        sla: { unit: 'hours', min: 24, max: 72, text: '24–72 hrs after instruction' },
      },
      {
        key: 'IMM_3_VISITOR_VISA',
        order: 3,
        stageKey: 'visas',
        title: 'Visitor visa',
        actions: [
          'Confirm eligibility criteria',
          'Prepare dossier (passport/photos/return ticket/accommodation/financials)',
          'Submit to DGIE/Embassy',
          'Follow up',
        ],
        outputs: [
          { key: 'visa_dossier', name: 'Complete visa dossier', required: true, category: 'Filing' },
          { key: 'submission_ack', name: 'Submission acknowledgement', required: false, category: 'Filing' },
          { key: 'visa_sticker', name: 'Visa sticker/e-visa', required: false, category: 'Outcome' },
        ],
        legalBasis: [{ text: 'Art. 12 (Visitor visa), Art. 3 (entry), Art. 24 (waiver)' }],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 300000, text: 'RWF 100,000 – 300,000' },
        sla: { unit: 'days', text: 'Prep: 2–5 days; Decision: 5–15 business days' },
      },
      {
        key: 'IMM_4_TEMP_RESIDENCE',
        order: 4,
        stageKey: 'residence',
        title: 'Temporary residence permit',
        actions: [
          'Identify correct class',
          'Compile dossier',
          'Submit via IREMBO/DGIE',
          'Monitor decision and collect permit',
          'Advise obligations',
        ],
        outputs: [
          { key: 'application_dossier', name: 'Complete application dossier', required: true, category: 'Filing' },
          { key: 'dgir_receipt', name: 'DGIE receipt', required: false, category: 'Filing' },
          { key: 'permit_card', name: 'Temporary Residence Permit card', required: false, category: 'Outcome' },
          { key: 'obligations_note', name: 'Client obligations note', required: false, category: 'Client Communication' },
        ],
        legalBasis: [{ text: 'Arts. 13–18 (Ministerial Order N°06/01)' }],
        fee: { type: 'range', currency: 'RWF', min: 200000, max: 600000, text: 'RWF 200,000 – 600,000' },
        sla: { unit: 'days', text: 'Prep: 3–7 days; Decision: 15–30 days' },
      },
    ],
  });
};

