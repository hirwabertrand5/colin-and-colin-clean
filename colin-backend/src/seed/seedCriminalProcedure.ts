import WorkflowTemplate from '../models/workflowTemplateModel';

export const seedCriminalProcedureTemplate = async () => {
  const name = 'Criminal Case Handling Procedure';
  const version = 1;

  const exists = await WorkflowTemplate.findOne({ name, version });
  if (exists) return exists;

  return WorkflowTemplate.create({
    name,
    matterType: 'Criminal Procedure',
    caseType: 'Litigation Cases',
    version,
    active: true,

    stages: [
      { key: 'intake', order: 1, title: 'Client Intake & Preliminary Assessment' },
      { key: 'investigation', order: 2, title: 'Investigation Stage' },
      { key: 'prosecution_pretrial', order: 3, title: 'Prosecution Stage (Pre-Trial)' },
      { key: 'trial', order: 4, title: 'Trial Stage' },
      { key: 'appeal_enforcement', order: 5, title: 'Appeals & Enforcement' },
    ],

    steps: [
      {
        key: 'CRIM_1_INTAKE',
        order: 1,
        stageKey: 'intake',
        title: 'Intake, Conflict Check & Legal Assessment',
        actions: [
          'Receive client and conduct initial interview',
          'Assess facts and nature of offence',
          'Conduct conflict of interest check',
          'Sign engagement letter',
          'Prepare legal opinion note',
          'Advise whether to pursue criminal/civil/both',
        ],
        outputs: [
          { key: 'intake_form', name: 'Intake form / instruction letter', required: false, category: 'Intake' },
          { key: 'engagement_letter', name: 'Engagement letter', required: true, category: 'Engagement' },
          { key: 'conflict_declaration', name: 'Conflict of Interest Declaration', required: true, category: 'Compliance' },
          { key: 'legal_opinion', name: 'Legal opinion note', required: false, category: 'Advice' },
        ],
        legalBasis: [{ text: 'Law No. 027/2019 (Criminal Procedure) (per workflow doc)' }],
        fee: { type: 'text', text: '30,000 opening file; 100,000–300,000 assessment (per workflow doc)' },
        sla: { unit: 'hours', min: 4, max: 72, text: '4–8 hours intake; 24–72 hours opinion' },
      },
      {
        key: 'CRIM_2_INVESTIGATION',
        order: 2,
        stageKey: 'investigation',
        title: 'Investigation Stage (Police/RIB)',
        actions: [
          'File complaint/report and compile evidence bundle',
          'Preserve evidence (letters if needed)',
          'Respond to summons; accompany client',
          'Draft witness statements and coordinate testimony',
          'Provide interrogation support',
          'Handle search/seizure advice and objections',
          'Arrest/detention advice and habeas corpus if needed',
          'Follow up on case file submission',
        ],
        outputs: [
          { key: 'complaint_letter', name: 'Complaint letter / report', required: false, category: 'Investigation' },
          { key: 'evidence_bundle', name: 'Supporting evidence bundle', required: false, category: 'Evidence' },
          { key: 'summons_response', name: 'Summons response letter (if any)', required: false, category: 'Investigation' },
          { key: 'witness_statements', name: 'Witness statements', required: false, category: 'Evidence' },
        ],
        legalBasis: [{ text: 'Arts 15–69 Criminal Procedure (per workflow doc)' }],
        fee: { type: 'text', text: 'Varies per action/session (per workflow doc)' },
        sla: { unit: 'days', text: 'Within 24–48 hours for urgent actions; ongoing investigation' },
      },
      {
        key: 'CRIM_3_PRETRIAL',
        order: 3,
        stageKey: 'prosecution_pretrial',
        title: 'Prosecution Stage (Pre-Trial)',
        actions: [
          'Fine without trial (transaction) advice and filing',
          'Plea bargaining advice and negotiation',
          "Review prosecution case file (detention)",
          'Challenge provisional detention / bail application',
          'Review indictment; prepare defense submissions',
          'Prepare for summons to appear before court',
        ],
        outputs: [
          { key: 'bail_application', name: 'Bail / release application', required: false, category: 'Court' },
          { key: 'plea_agreement', name: 'Plea bargain agreement (if any)', required: false, category: 'Court' },
          { key: 'defense_submissions', name: 'Defense submissions', required: false, category: 'Court' },
        ],
        legalBasis: [{ text: 'Arts 74–98 Criminal Procedure (per workflow doc)' }],
        fee: { type: 'text', text: 'Varies; many items are 200,000–1,000,000 RWF (per workflow doc)' },
        sla: { unit: 'days', text: 'Often within 24–48 hours of detention/indictment (per workflow doc)' },
      },
      {
        key: 'CRIM_4_TRIAL',
        order: 4,
        stageKey: 'trial',
        title: 'Trial Stage',
        actions: [
          'Attend preliminary hearing; raise procedural objections',
          'Prepare evidence strategy and witnesses/experts',
          'Represent client during hearing; cross-examine',
          'File submissions and civil action (if applicable)',
          'Obtain and review judgment; advise next steps',
        ],
        outputs: [
          { key: 'motions_objections', name: 'Written objections/motions', required: false, category: 'Court' },
          { key: 'submissions', name: 'Written submissions / trial brief', required: false, category: 'Court' },
          { key: 'judgment_copy', name: 'Judgment copy', required: false, category: 'Court' },
        ],
        legalBasis: [{ text: 'Arts 96–145 Criminal Procedure (per workflow doc)' }],
        fee: { type: 'text', text: '500,000–5,000,000 RWF (per workflow doc)' },
        sla: { unit: 'weeks', text: 'Depends on court schedule' },
      },
      {
        key: 'CRIM_5_APPEAL_ENF',
        order: 5,
        stageKey: 'appeal_enforcement',
        title: 'Appeals & Enforcement',
        actions: ['Draft and file appeal', 'Apply for stay if needed', 'Enforcement of judgment / civil damages recovery'],
        outputs: [
          { key: 'notice_of_appeal', name: 'Notice of appeal / grounds', required: false, category: 'Appeal' },
          { key: 'enforcement_application', name: 'Enforcement application', required: false, category: 'Enforcement' },
        ],
        legalBasis: [{ text: 'Appeals & enforcement titles (per workflow doc)' }],
        fee: { type: 'text', text: '½ of first instance fee; enforcement varies (per workflow doc)' },
        sla: { unit: 'days', text: 'Appeal within statutory deadline (typically 30 days)' },
      },
    ],
  });
};