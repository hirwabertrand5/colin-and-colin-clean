import WorkflowTemplate from '../models/workflowTemplateModel';

export const seedArbitrationTemplate = async () => {
  const name = 'Arbitration';
  const version = 1;

  const exists = await WorkflowTemplate.findOne({ name, version });
  if (exists) return exists;

  return WorkflowTemplate.create({
    name,
    matterType: 'Arbitration',
    caseType: 'Litigation Cases',
    version,
    active: true,

    stages: [
      { key: 'onboarding', order: 1, title: 'Client Onboarding & Conflict Check' },
      { key: 'clause_strategy', order: 2, title: 'Arbitration Clause Review & Strategy' },
      { key: 'commencement', order: 3, title: 'Commencement of Arbitration' },
      { key: 'interim', order: 4, title: 'Interim Measures' },
      { key: 'hearings', order: 5, title: 'Hearings' },
      { key: 'post_award', order: 6, title: 'Post-Award & Enforcement' },
    ],

    steps: [
      {
        key: 'ARB_1_ONBOARDING',
        order: 1,
        stageKey: 'onboarding',
        title: 'Client Onboarding & Conflict Check',
        actions: [
          'Conduct conflict search',
          'Discuss needs, goals, and facts of the case',
          'Sign engagement letter/retainer',
        ],
        outputs: [
          { key: 'engagement_letter', name: 'Engagement letter', required: true, category: 'Engagement' },
          { key: 'conflict_declaration', name: 'Conflict declaration', required: true, category: 'Compliance' },
        ],
        legalBasis: [{ text: 'Art 139 internal rules of RBA / Contract law (per workflow doc)' }],
        fee: { type: 'fixed', currency: 'RWF', min: 30000, max: 30000, text: '30,000 RWF' },
        sla: { unit: 'hours', min: 4, max: 8, text: '4–8 hours' },
      },
      {
        key: 'ARB_2_STRATEGY',
        order: 2,
        stageKey: 'clause_strategy',
        title: 'Arbitration Clause Review & Strategy',
        actions: [
          'Assess client rights and remedies under contract',
          'Assess validity/scope/seat/governing law',
          'Draft findings, risks and recommended actions report',
          'Analyse procedural requirements',
          'Demand & negotiation',
        ],
        outputs: [
          { key: 'legal_opinion', name: 'Legal opinion', required: true, category: 'Advice' },
          { key: 'demand_letter', name: 'Demand letter', required: false, category: 'Correspondence' },
        ],
        legalBasis: [{ text: 'Contract law; Art 9-10 law 005/2008 (per workflow doc)' }],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 300000 },
        sla: { unit: 'days', min: 2, max: 3, text: '2–3 days' },
      },
      {
        key: 'ARB_3_COMMENCEMENT',
        order: 3,
        stageKey: 'commencement',
        title: 'Commencement of Arbitration',
        actions: [
          'Draft notice/request for arbitration',
          'Draft initial claim summary and relief sought',
          'Analyze defenses and jurisdiction objections',
          'Tribunal selection and disclosures (if required)',
          'Procedure determination / procedural orders',
          'Written submissions preparation',
        ],
        outputs: [
          { key: 'notice_of_arbitration', name: 'Notice/Request for arbitration', required: true, category: 'Pleadings' },
          { key: 'procedural_orders', name: 'Procedural orders', required: false, category: 'Procedure' },
          { key: 'written_submissions', name: 'Written submissions bundle', required: false, category: 'Pleadings' },
        ],
        legalBasis: [{ text: 'Law 005/2008; KIAC Rules (per workflow doc)' }],
        fee: { type: 'range', currency: 'RWF', min: 500000, max: 5000000 },
        sla: { unit: 'days', min: 3, max: 4, text: '3–4 days (varies)' },
      },
      {
        key: 'ARB_4_INTERIM',
        order: 4,
        stageKey: 'interim',
        title: 'Interim Measures',
        actions: ['Request interim relief / emergency arbitration (if needed)'],
        outputs: [{ key: 'interim_orders', name: 'Interim orders', required: false, category: 'Orders' }],
        legalBasis: [{ text: 'Art 24 Law 005/2008; KIAC Rules 33–34 (per workflow doc)' }],
        fee: { type: 'included', text: 'N/A / depends' },
        sla: { unit: 'days', min: 0, max: 2, text: 'Within 2 days of instruction' },
      },
      {
        key: 'ARB_5_HEARINGS',
        order: 5,
        stageKey: 'hearings',
        title: 'Hearings',
        actions: ['Represent client in oral proceedings'],
        outputs: [{ key: 'hearing_records', name: 'Hearing records', required: false, category: 'Hearing' }],
        legalBasis: [{ text: 'Art 36 Law 005/2008; KIAC rules (per workflow doc)' }],
        fee: { type: 'range', currency: 'RWF', min: 500000, max: 5000000 },
        sla: { unit: 'weeks', text: 'Dependent on tribunal and parties' },
      },
      {
        key: 'ARB_6_POST_AWARD',
        order: 6,
        stageKey: 'post_award',
        title: 'Post-Award & Enforcement',
        actions: [
          'Interpret operative orders and advise on compliance',
          'File correction/setting aside if needed',
          'Assist enforcement of award',
        ],
        outputs: [
          { key: 'post_award_opinion', name: 'Post-award legal opinion', required: false, category: 'Advice' },
          { key: 'enforcement_application', name: 'Application for enforcement of award', required: false, category: 'Enforcement' },
        ],
        legalBasis: [{ text: 'Art 45, 51-52 Law 005/2008 (per workflow doc)' }],
        fee: { type: 'text', text: '½ of first instance fee / or 100,000–300,000 RWF depending on action (per workflow doc)' },
        sla: { unit: 'days', min: 10, max: 20, text: '10–20 days after award (varies)' },
      },
    ],
  });
};