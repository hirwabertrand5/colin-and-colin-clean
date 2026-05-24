import WorkflowTemplate from '../models/workflowTemplateModel';

export const seedLaborProcedureTemplate = async () => {
  const name = 'Labor Case Handling Procedure';
  const version = 1;

  const exists = await WorkflowTemplate.findOne({ name, version });
  if (exists) return exists;

  return WorkflowTemplate.create({
    name,
    matterType: 'Labor Case Handling',
    caseType: 'Labor Cases',
    version,
    active: true,

    stages: [
      { key: 'intake', order: 1, title: 'Initial Intake & Preliminary Assessment' },
      { key: 'administrative', order: 2, title: 'Administrative Complaint (Labor Inspector)' },
      { key: 'court', order: 3, title: 'Court Proceedings' },
      { key: 'post_judgment', order: 4, title: 'Appeal / Enforcement' },
    ],

    steps: [
      {
        key: 'LAB_1_INTAKE',
        order: 1,
        stageKey: 'intake',
        title: 'Client onboarding & conflict check / Case assessment',
        actions: [
          'Conduct conflict check',
          'Discuss client needs and facts of the case',
          'Sign engagement',
          'Review documents and evidence',
          'Advise on merits, risks, remedies',
          'Draft demand letter / settlement proposal',
          'Negotiate amicable settlement where possible',
        ],
        outputs: [
          { key: 'engagement_letter', name: 'Engagement letter', required: true, category: 'Engagement' },
          { key: 'conflict_declaration', name: 'Conflict of interest declaration', required: true, category: 'Compliance' },
          { key: 'legal_opinion', name: 'Legal opinion', required: false, category: 'Advice' },
          { key: 'demand_letter', name: 'Demand letter / settlement proposal', required: false, category: 'Correspondence' },
        ],
        legalBasis: [{ text: 'Art 139 RBA rules; Law 66/2018 (per workflow doc)' }],
        fee: { type: 'text', text: '30,000 RWF opening file; 100,000–300,000 RWF (per workflow doc)' },
        sla: { unit: 'hours', min: 4, max: 72, text: '4–8 hours intake; 24–72 hours advice' },
      },
      {
        key: 'LAB_2_LABOR_INSPECTOR',
        order: 2,
        stageKey: 'administrative',
        title: 'Administrative Complaint to the Labor Inspector',
        actions: [
          'Assess case and gather facts/documentation',
          'File complaint to Labor inspector',
          'Represent client in conciliation',
          'Provide updates to client',
        ],
        outputs: [
          { key: 'complaint', name: 'Complaint to labor inspector', required: true, category: 'Administrative' },
          { key: 'conciliation_record', name: 'Conciliation record / minutes', required: false, category: 'Administrative' },
        ],
        legalBasis: [{ text: 'Art 102–103 Law 66/2018 (per workflow doc)' }],
        fee: { type: 'text', text: '100,000 RWF; 100,000–200,000 per session (per workflow doc)' },
        sla: { unit: 'hours', min: 24, max: 48, text: '24–48 hours' },
      },
      {
        key: 'LAB_3_NOTIFICATION',
        order: 3,
        stageKey: 'court',
        title: 'Notification of Defendant / Intention to Institute Proceedings',
        actions: ['Notify the defendant the intention to institute proceedings'],
        outputs: [{ key: 'notification_letter', name: 'Notification letter', required: false, category: 'Court' }],
        legalBasis: [{ text: 'Art 35 Law 22/2018 (per workflow doc)' }],
        fee: { type: 'included', text: 'N/A (per workflow doc)' },
        sla: { unit: 'hours', min: 24, max: 24, text: 'Within 24 hours' },
      },
      {
        key: 'LAB_4_COURT_REP',
        order: 4,
        stageKey: 'court',
        title: 'Legal Representation Before Court',
        actions: [
          'File court submission to competent court',
          'Attend pre-trial conference',
          'Prepare and present oral arguments and submissions',
          'Attend hearings and trial proceedings',
          'Prepare final submissions/briefs',
        ],
        outputs: [
          { key: 'court_submission', name: 'Final court submission', required: false, category: 'Court' },
          { key: 'pretrial_record', name: 'Pre-trial record', required: false, category: 'Court' },
        ],
        legalBasis: [{ text: 'Law 22/2018; Law 30/2018 (jurisdiction) (per workflow doc)' }],
        fee: { type: 'range', currency: 'RWF', min: 500000, max: 5000000 },
        sla: { unit: 'weeks', text: 'Dependent on court' },
      },
      {
        key: 'LAB_5_POST',
        order: 5,
        stageKey: 'post_judgment',
        title: 'Post-Judgment (Enforcement / Appeal)',
        actions: ['Pursue enforcement or advise client to appeal', 'Assist enforcement of judgment'],
        outputs: [
          { key: 'appeal_submission', name: 'Appeal submission (if applicable)', required: false, category: 'Appeal' },
          { key: 'execution_application', name: 'Application for execution of judgment', required: false, category: 'Enforcement' },
        ],
        legalBasis: [{ text: 'Art 147 & 244 Law 22/2018 (per workflow doc)' }],
        fee: { type: 'text', text: '½ of first instance fee; enforcement 100,000–300,000 RWF (per workflow doc)' },
        sla: { unit: 'weeks', text: 'Within 1 month (appeal deadline) / 24–48 hours enforcement filing' },
      },
    ],
  });
};