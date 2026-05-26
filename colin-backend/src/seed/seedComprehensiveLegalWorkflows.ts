import WorkflowTemplate, {
  IFeeSpec,
  ISlaSpec,
  IWorkflowStepTemplate,
  IWorkflowTemplate,
} from '../models/workflowTemplateModel';

type WorkflowSeed = Pick<
  IWorkflowTemplate,
  'name' | 'matterType' | 'caseType' | 'version' | 'active' | 'stages' | 'steps'
>;

const latestVersion = 2;

const output = (key: string, name: string, category = 'Deliverable', required = true) => ({
  key,
  name,
  required,
  category,
});

const legal = (...items: string[]) => items.map((text) => ({ text }));

const fee = (text: string, min?: number, max?: number): IFeeSpec => {
  const hasAmount = min !== undefined || max !== undefined;
  return {
    type: hasAmount ? 'range' : 'text',
    ...(hasAmount ? { currency: 'RWF' } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    text,
  };
};

const sla = (text: string, unit: ISlaSpec['unit'] = 'days', min?: number, max?: number): ISlaSpec => ({
  unit,
  ...(min !== undefined ? { min } : {}),
  ...(max !== undefined ? { max } : {}),
  text,
});

const step = (
  key: string,
  order: number,
  stageKey: string,
  title: string,
  actions: string[],
  outputs: ReturnType<typeof output>[],
  legalBasis: string[],
  feeSpec: IFeeSpec,
  slaSpec: ISlaSpec
): IWorkflowStepTemplate => ({
  key,
  order,
  stageKey,
  title,
  actions,
  outputs,
  legalBasis: legal(...legalBasis),
  fee: feeSpec,
  sla: slaSpec,
});

const templates: WorkflowSeed[] = [
  {
    name: 'Mediation',
    matterType: 'Mediation',
    caseType: 'Litigation Cases',
    version: latestVersion,
    active: true,
    stages: [
      { key: 'intake', order: 1, title: 'Client Intake & Preliminary Assessment' },
      { key: 'proceedings', order: 2, title: 'Mediation Proceedings' },
      { key: 'settlement', order: 3, title: 'Settlement & Closure' },
    ],
    steps: [
      step(
        'MED_1_INTAKE',
        1,
        'intake',
        'Client intake, legal assessment and demand letter',
        [
          'Conduct conflict check, open file and sign retainer',
          'Advise on mediation suitability, costs and timelines',
          'Draft and send formal demand or pre-mediation letter',
        ],
        [
          output('engagement_letter', 'Engagement letter', 'Engagement'),
          output('conflict_declaration', 'Conflict declaration', 'Compliance'),
          output('demand_letter', 'Demand letter', 'Correspondence'),
        ],
        ['Art. 85 Law No 22/2018', 'Contract Law No 45/2011'],
        fee('RWF 30,000 file opening; RWF 100,000 - 300,000 assessment', 30000, 300000),
        sla('4-8 hrs intake; 24-72 hrs opinion', 'hours', 4, 72)
      ),
      step(
        'MED_2_PROCEEDINGS',
        2,
        'proceedings',
        'Mediator selection, session preparation and representation',
        [
          'Assist in selecting a neutral mediator',
          'Prepare statements, evidence and negotiation strategy',
          'Accompany client in mediation sessions',
        ],
        [
          output('mediator_appointment', 'Mediator appointment', 'ADR'),
          output('position_statement', 'Position statement', 'ADR'),
          output('attendance_record', 'Attendance record', 'ADR'),
        ],
        ['Art. 3 Law No 005/2008', 'Mediation agreement clauses'],
        fee('RWF 100,000 - 300,000 under Art. 22(1) RBA Reg.', 100000, 300000),
        sla('Dependent on mediator and parties; typically 1-4 sessions', 'weeks')
      ),
      step(
        'MED_3_SETTLEMENT',
        3,
        'settlement',
        'Settlement agreement and enforcement',
        ['Prepare and review binding settlement terms', 'File agreement with competent court if needed'],
        [
          output('settlement_agreement', 'Settlement agreement', 'ADR'),
          output('court_filing', 'Court filing if needed', 'Court', false),
        ],
        ['Art. 9 and 10 Law No 005/2008', 'Contract Law No 45/2011'],
        fee('RWF 100,000 - 500,000 under Art. 22(1) RBA Reg.', 100000, 500000),
        sla('Within 5 days of agreement', 'days', 1, 5)
      ),
    ],
  },
  {
    name: 'Arbitration',
    matterType: 'Arbitration',
    caseType: 'Litigation Cases',
    version: latestVersion,
    active: true,
    stages: [
      { key: 'intake', order: 1, title: 'Client Intake & Clause Review' },
      { key: 'commencement', order: 2, title: 'Commencement of Arbitration' },
      { key: 'proceedings', order: 3, title: 'Arbitral Proceedings' },
      { key: 'post_award', order: 4, title: 'Post-Award & Enforcement' },
    ],
    steps: [
      step(
        'ARB_V2_1_INTAKE',
        1,
        'intake',
        'Onboarding, clause review and strategy',
        [
          'Conduct conflict search and sign engagement letter',
          'Assess validity, scope, seat and governing law of arbitration clause',
          'Draft legal opinion and prepare demand letter',
        ],
        [
          output('engagement_letter', 'Engagement letter', 'Engagement'),
          output('legal_opinion', 'Legal opinion', 'Advice'),
          output('demand_letter', 'Demand letter', 'Correspondence'),
        ],
        ['Art. 139 RBA Internal Rules', 'Contract Law No 45/2011', 'Art. 9 and 10 Law No 005/2008'],
        fee('RWF 30,000 file; RWF 100,000 - 300,000 opinion', 30000, 300000),
        sla('4-8 hrs onboarding; 2-3 days opinion', 'days', 1, 3)
      ),
      step(
        'ARB_V2_2_COMMENCEMENT',
        2,
        'commencement',
        'Request, tribunal selection and written submissions',
        [
          'Draft request for arbitration with claim summary and relief',
          'Coordinate arbitrator appointment and conflict checks',
          'Attend case management, negotiate rules and timelines',
          'Draft statement of claim and sign Terms of Reference',
        ],
        [
          output('notice_of_arbitration', 'Notice of arbitration', 'Pleadings'),
          output('appointment_forms', 'Appointment forms', 'Procedure'),
          output('procedural_orders', 'Procedural orders', 'Procedure'),
          output('statement_of_claim', 'Statement of claim', 'Pleadings'),
          output('terms_of_reference', 'Signed Terms of Reference', 'Procedure'),
        ],
        ['Art. 33 and 40 Law No 005/2008', 'KIAC Rules Arts. 5, 6, 13, 14, 17, 25, 29 and 31'],
        fee('RWF 500,000 - 5,000,000 filing and submissions', 500000, 5000000),
        sla('3-4 days per submission; tribunal timelines vary', 'days', 3, 4)
      ),
      step(
        'ARB_V2_3_PROCEEDINGS',
        3,
        'proceedings',
        'Interim measures and hearings',
        [
          'Request interim relief or emergency arbitration where needed',
          'Represent client in oral proceedings and present evidence',
        ],
        [output('interim_orders', 'Interim orders', 'Orders'), output('hearing_records', 'Hearing records', 'Hearing')],
        ['Art. 24 and 36 Law No 005/2008', 'KIAC Rules Arts. 33-34 and 36'],
        fee('Hearings: RWF 500,000 - 5,000,000; interim measures depend on action', 500000, 5000000),
        sla('Interim within 2 days; hearings depend on tribunal', 'days', 1, 2)
      ),
      step(
        'ARB_V2_4_POST_AWARD',
        4,
        'post_award',
        'Post-award advice, correction and enforcement',
        [
          'Interpret award and advise on compliance',
          'File corrections or challenge if needed',
          'Assist in enforcing arbitral award before competent court',
        ],
        [
          output('post_award_opinion', 'Legal opinion', 'Advice'),
          output('correction_application', 'Application for correction', 'Court', false),
          output('enforcement_application', 'Application for enforcement', 'Enforcement'),
        ],
        ['Art. 45, 51 and 52 Law No 005/2008', 'KIAC Rules Art. 40'],
        fee('Half first-instance fee; RWF 100,000 - 300,000 enforcement', 100000, 300000),
        sla('10-20 days post-award; enforcement within 24-48 hrs of final award', 'days', 1, 20)
      ),
    ],
  },
  {
    name: 'Civil Litigation',
    matterType: 'Civil Litigation',
    caseType: 'Litigation Cases',
    version: latestVersion,
    active: true,
    stages: [
      { key: 'intake', order: 1, title: 'Client Intake' },
      { key: 'pre_litigation', order: 2, title: 'Pre-Litigation Phase' },
      { key: 'litigation', order: 3, title: 'Litigation Phase' },
      { key: 'post_trial', order: 4, title: 'Post-Trial Phase' },
      { key: 'post_judgment', order: 5, title: 'Post-Judgment Phase' },
    ],
    steps: [
      step('CIV_1_INTAKE', 1, 'intake', 'Client intake and due diligence', ['Conflict check, open file, sign retainer and collect documents', 'Search relevant institutions and assess documents', 'Advise on merits, costs and risks'], [output('engagement_letter', 'Engagement letter', 'Engagement'), output('legal_opinion', 'Legal opinion if needed', 'Advice', false)], ['Art. 85 Law No 22/2018'], fee('RWF 100,000 - 300,000', 100000, 300000), sla('3-7 days', 'days', 3, 7)),
      step('CIV_2_PRE_LITIGATION', 2, 'pre_litigation', 'Demand, filing, service and defence response', ['Draft demand letter and attempt amicable settlement', 'Draft submissions, review internally and gather evidence', 'File suit, pay filing fees and extract case number', 'Liaise with bailiff for service of summons', 'Review defence and counterclaims and draft response'], [output('demand_letter', 'Demand letter', 'Correspondence'), output('case_number_receipt', 'Case number receipt', 'Court'), output('defense_response', 'Defense response', 'Pleadings', false)], ['Art. 8, 20 and 34-35 Law No 22/2018'], fee('RWF 100,000 - 300,000; RWF 500,000 - 5,000,000 complexity-based', 100000, 5000000), sla('7-14 days', 'days', 7, 14)),
      step('CIV_3_LITIGATION', 3, 'litigation', 'Pre-trial management and hearing', ['Follow up on hearing dates', 'Attend hearing and conduct oral arguments'], [output('update_report', 'Update report', 'Client Communication')], ['Art. 13 and 24-27 Law No 22/2018'], fee('RWF 500,000 - 3,000,000 plus emergency/complexity uplift', 500000, 3000000), sla('2-6 months', 'weeks')),
      step('CIV_4_POST_TRIAL', 4, 'post_trial', 'Final submissions and judgment advice', ['Prepare written final arguments within court deadlines', 'Obtain judgment and explain it to client', 'Advise on appeal or execution'], [output('judgment_report', 'Judgment report', 'Court'), output('descriptive_report', 'Descriptive report', 'Client Communication')], ['Art. 14 Law No 22/2018'], fee('RWF 500,000 - 5,000,000 plus percentage of recovered debt', 500000, 5000000), sla('2-3 months', 'weeks')),
      step('CIV_5_POST_JUDGMENT', 5, 'post_judgment', 'Enforcement advice and file transition', ['Advise on enforcement options', 'Archive file or transition to appeal'], [output('legal_advisory', 'Legal advisory', 'Advice')], ['Art. 192 Law No 22/2018'], fee('Renegotiate with client on next steps'), sla('29 days following pronouncement', 'days', 1, 29)),
    ],
  },
  {
    name: 'Criminal Case Handling Procedure',
    matterType: 'Criminal Procedure',
    caseType: 'Litigation Cases',
    version: latestVersion,
    active: true,
    stages: [
      { key: 'intake', order: 1, title: 'Client Intake & Preliminary Assessment' },
      { key: 'investigation', order: 2, title: 'Investigation Stage' },
      { key: 'prosecution', order: 3, title: 'Prosecution Stage - Pre-Trial' },
      { key: 'trial', order: 4, title: 'Trial Stage' },
      { key: 'special', order: 5, title: 'Special Proceedings' },
      { key: 'appeals', order: 6, title: 'Appeals & Post-Judgment' },
    ],
    steps: [
      step('CRI_V2_1_INTAKE', 1, 'intake', 'Intake, legal assessment and criminal/civil advice', ['Assess facts, conflict check and sign engagement letter', 'Advise on criminal procedure, rights and outcomes', 'Advise whether to pursue criminal, civil or both actions'], [output('engagement_letter', 'Engagement letter', 'Engagement'), output('legal_opinion_note', 'Legal opinion note', 'Advice'), output('written_legal_advice', 'Written legal advice', 'Advice'), output('referral_letter', 'Referral letter if needed', 'Correspondence', false)], ['Art. 1, 3, 4, 10 and 13 Law No 027/2019'], fee('RWF 30,000 file; RWF 100,000 - 300,000 assessment', 30000, 300000), sla('4-8 hrs intake; 24-72 hrs opinion', 'hours', 4, 72)),
      step('CRI_V2_2_INVESTIGATION', 2, 'investigation', 'Complaint, evidence, summons, interrogation and detention support', ['Draft and submit complaint to Police/RIB', 'Compile evidence and witnesses', 'Send preservation request to investigators', 'Prepare and accompany client before investigator', 'Advise on search, seizure, arrest and detention', 'File habeas corpus if detention is unlawful'], [output('complaint_letter', 'Complaint letter', 'Filing'), output('evidence_bundle', 'Evidence bundle', 'Evidence'), output('witness_statements', 'Witness list/statements', 'Evidence'), output('summons_response', 'Summons response', 'Investigation'), output('written_objection', 'Written objection if unlawful', 'Remedy', false), output('habeas_corpus', 'Habeas corpus if needed', 'Court', false)], ['Art. 15-20, 29-32, 45, 47, 49, 55, 57, 59, 61 and 66-69 Law No 027/2019'], fee('RWF 50,000 - 500,000 depending on action', 50000, 500000), sla('Immediate to 2-5 days depending on action', 'days', 0, 5)),
      step('CRI_V2_3_PROSECUTION', 3, 'prosecution', 'Fine, plea, detention challenge, bail and indictment review', ['Advise and negotiate transactional fine', 'Negotiate and draft plea agreement', 'File application for release and affidavits', 'Draft bail application and negotiate conditions', 'Review indictment and draft defence submissions'], [output('plea_bargain', 'Plea bargain agreement', 'Prosecution'), output('bail_application', 'Bail application', 'Court'), output('release_application', 'Application for release', 'Court'), output('defence_submissions', 'Defence submissions', 'Pleadings')], ['Art. 25-27, 74 and 81-94 Law No 027/2019'], fee('RWF 200,000 - 1,000,000', 200000, 1000000), sla('24-48 hrs for most actions; within 5 days for plea', 'days', 1, 5)),
      step('CRI_V2_4_TRIAL', 4, 'trial', 'Preliminary hearing, evidence strategy and trial representation', ['Attend preliminary hearing and raise procedural objections', 'Prepare evidence analysis, witnesses and expert requests', 'Represent client, cross-examine and make legal arguments', 'File civil action and damages statement where needed'], [output('written_objections', 'Written objections/motions', 'Court'), output('evidence_analysis', 'Evidence analysis memo', 'Evidence'), output('written_submissions', 'Written submissions', 'Pleadings'), output('civil_action_filing', 'Civil action filing', 'Court', false)], ['Art. 107-109, 111, 118, 125, 129, 132 and 135 Law No 027/2019'], fee('RWF 500,000 - 5,000,000', 500000, 5000000), sla('Ongoing; updates within 24 hrs post-hearing', 'hours', 24, 24)),
      step('CRI_V2_5_SPECIAL', 5, 'special', 'Juvenile, legal aid and fugitive proceedings', ['Represent minors and request social inquiry', 'Apply for legal aid for indigent clients', 'Handle proceedings against fugitive and review fugitive judgment'], [output('social_inquiry_request', 'Social inquiry request', 'Special Proceedings'), output('legal_aid_application', 'Legal aid application', 'Special Proceedings'), output('publication_order_request', 'Publication order request', 'Special Proceedings')], ['Art. 147, 151, 159-162 and 169 Law No 027/2019'], fee('Juvenile RWF 200,000 - 500,000; legal aid N/A; fugitive RWF 300,000 - 1,000,000', 200000, 1000000), sla('24-48 hrs from arrest or charge', 'hours', 24, 48)),
      step('CRI_V2_6_APPEALS', 6, 'appeals', 'Appeal, enforcement and rehabilitation', ['Draft notice and grounds of appeal', 'Apply for stay of execution', 'File execution application and pursue civil damages', 'Advise on civil degradation and rehabilitation'], [output('notice_of_appeal', 'Notice and grounds of appeal', 'Appeal'), output('stay_application', 'Application for stay', 'Appeal'), output('enforcement_letter', 'Enforcement letter', 'Enforcement'), output('rehabilitation_application', 'Rehabilitation application', 'Court', false)], ['Title IV - Appeals, Art. 170 et seq. Law No 027/2019', 'Art. 113 and 166 Law No 027/2019'], fee('Half first-instance fee; RWF 200,000 - 500,000 enforcement; RWF 100,000 - 300,000 degradation', 100000, 500000), sla('Appeal within 30 days; enforcement within 24-48 hrs of final judgment', 'days', 1, 30)),
    ],
  },
  {
    name: 'Commercial Litigation Workflow',
    matterType: 'Commercial Litigation',
    caseType: 'Litigation Cases',
    version: latestVersion,
    active: true,
    stages: [
      { key: 'assessment', order: 1, title: 'Onboarding, Assessment & Evidence' },
      { key: 'demand', order: 2, title: 'Dispute Resolution & Demand' },
      { key: 'filing_hearing', order: 3, title: 'Filing to Hearing' },
      { key: 'judgment_appeal', order: 4, title: 'Judgment, Post-Judgment & Appeal' },
    ],
    steps: [
      step('COM_V2_1_ASSESSMENT', 1, 'assessment', 'Client onboarding, case assessment and evidence collection', ['Receive inquiry, verify identity, conflict check and sign engagement letter', 'Interview client, review facts, assess evidence and provide legal opinion', 'Gather documents and identify witnesses'], [output('client_file', 'Client file opened', 'Administration'), output('legal_opinion', 'Legal opinion', 'Advice'), output('evidence_dossier', 'Evidence dossier', 'Evidence')], ['Art. 3, 12 and 85 Law No 22/2018'], fee('RWF 50,000 - 200,000; assessment included in consultation', 50000, 200000), sla('4-8 hrs onboarding; 24-72 hrs assessment', 'hours', 4, 72)),
      step('COM_V2_2_DEMAND', 2, 'demand', 'Dispute resolution mechanism, demand and notice', ['Review contract to identify agreed dispute mechanism', 'Draft, review, send and follow up demand letter', 'Draft formal notice, state facts and claims and set compliance deadline'], [output('strategy_memo', 'Strategy memo', 'Strategy'), output('demand_letter', 'Demand letter', 'Correspondence'), output('formal_notice_served', 'Formal notice served', 'Correspondence')], ['Contract terms', 'Civil Procedure Law No 22/2018'], fee('RWF 100,000 - 300,000 each', 100000, 300000), sla('Strategy same day; demand 24 hrs; notice 1 hr', 'hours', 1, 24)),
      step('COM_V2_3_FILING_HEARING', 3, 'filing_hearing', 'Filing, registration follow-up, pre-trial and hearings', ['File claim, pay court fees and obtain receipt', 'Monitor registry until case is registered', 'Prepare and attend pre-trial meeting', 'Prepare and represent client at hearings'], [output('case_filed', 'Case filed', 'Court'), output('case_registered', 'Case registered', 'Court'), output('pretrial_report', 'Pre-trial report', 'Court'), output('hearing_record', 'Hearing record', 'Court')], ['Art. 20, 21, 24-30 and 66-72 Law No 22/2018'], fee('RWF 500,000 - 3,500,000 filing; hearing uplifts apply by region', 500000, 3500000), sla('Filing 1-3 days; pre-trial 1-3 months; hearing 3-6 months', 'weeks')),
      step('COM_V2_4_JUDGMENT_APPEAL', 4, 'judgment_appeal', 'Judgment, enforcement and appeal', ['Follow court decision and notify client', 'Execute judgment and work with bailiff', 'Draft, file and represent client in appeal'], [output('judgment', 'Judgment', 'Court'), output('enforcement_result', 'Enforcement result', 'Enforcement'), output('appeal_case', 'Appeal case', 'Appeal')], ['Art. 130-137, 147-168 and 247 Law No 22/2018'], fee('RWF 500,000 - 3,500,000 or 1%-5% of value', 500000, 3500000), sla('Judgment 1-2 months; post-judgment 3-6 months; appeal 1 month', 'weeks')),
    ],
  },
  {
    name: 'Immigration',
    matterType: 'Immigration',
    caseType: 'Transactional Cases',
    version: latestVersion,
    active: true,
    stages: [
      { key: 'intake', order: 1, title: 'Client Intake & Immigration Assessment' },
      { key: 'visas', order: 2, title: 'Visa Applications' },
      { key: 'residence', order: 3, title: 'Residence Permits' },
      { key: 'travel_docs', order: 4, title: 'Rwandan Travel Documents' },
      { key: 'entry_exit', order: 5, title: 'Entry, Transit & Exit Procedures' },
      { key: 'special', order: 6, title: 'Diplomat / Special Category Cases' },
      { key: 'enforcement', order: 7, title: 'Compliance, Cancellation & Enforcement' },
      { key: 'closure', order: 8, title: 'File Closure & Post-Matter Obligations' },
    ],
    steps: [
      step('IMM_V2_1_CONSULTATION', 1, 'intake', 'Initial consultation', ['Receive client and conduct intake interview', 'Identify immigration goal', 'Explain procedure and rights', 'Conduct conflict check', 'Sign engagement or retainer letter'], [output('client_intake_form', 'Client intake form', 'Administration'), output('conflict_declaration', 'Conflict-of-interest declaration', 'Compliance'), output('engagement_letter', 'Signed engagement letter', 'Engagement'), output('case_file', 'Immigration case file opened', 'Administration')], ['Art. 1 and 2 Ministerial Order No 06/01 of 29/05/2019'], fee('RWF 30,000 opening file under Art. 21 RBA', 30000, 30000), sla('Within 4-8 hrs of first contact', 'hours', 4, 8)),
      step('IMM_V2_2_ASSESSMENT', 2, 'intake', 'Legal assessment', ['Advise on immigration options', 'Analyze applicable visa or permit category', 'Prepare written legal opinion note', 'Identify required documentation'], [output('legal_opinion_note', 'Written legal opinion note', 'Advice'), output('pathway_analysis', 'Immigration pathway analysis', 'Advice'), output('document_checklist', 'Document checklist', 'Compliance')], ['Art. 3, 10-13 and 20 Ministerial Order No 06/01'], fee('RWF 100,000 - 300,000 under Art. 22(1) RBA', 100000, 300000), sla('24-72 hrs after instruction', 'hours', 24, 72)),
      step('IMM_V2_3_TRANSIT_VISA', 3, 'visas', 'Transit visa', ['Confirm transit visa requirement', 'Gather passport, onward ticket and proof of funds', 'Complete IREMBO online application', 'Submit to DGIE'], [output('transit_visa_file', 'Transit visa application file', 'Filing'), output('dgie_submission_receipt', 'DGIE submission receipt', 'Filing'), output('transit_visa', 'Approved transit visa', 'Outcome')], ['Art. 11, 3, 8 and 9 Ministerial Order No 06/01'], fee('RWF 50,000 - 150,000', 50000, 150000), sla('Preparation 1-2 days; DGIE decision 3-7 days', 'days', 1, 7)),
      step('IMM_V2_4_VISITOR_VISA', 4, 'visas', 'Visitor visa', ['Confirm visitor criteria', 'Prepare passport, photos, return ticket, accommodation proof and financial statement', 'Submit to DGIE or Rwandan Embassy', 'Follow up with authorities'], [output('visitor_visa_dossier', 'Complete visa application dossier', 'Filing'), output('submission_acknowledgement', 'Submission acknowledgement', 'Filing'), output('visitor_visa', 'Visitor visa sticker or e-visa', 'Outcome')], ['Art. 12, 3, 24 and 37 Ministerial Order No 06/01'], fee('RWF 100,000 - 300,000', 100000, 300000), sla('Preparation 2-5 days; DGIE decision 5-15 business days', 'days', 2, 15)),
      step('IMM_V2_5_SPECIAL_ARRANGEMENT_VISA', 5, 'visas', 'Special arrangement visa', ['Verify bilateral agreement or EAC protocol coverage', 'Prepare diplomatic note or formal request', 'Liaise with Ministry of Foreign Affairs where required', 'Submit and track application'], [output('diplomatic_file', 'Diplomatic correspondence file', 'Filing'), output('mfa_letter', 'MFA coordination letter', 'Correspondence'), output('special_arrangement_visa', 'Approved visa under special arrangement', 'Outcome')], ['Art. 10 and 24 Ministerial Order No 06/01'], fee('RWF 200,000 - 500,000', 200000, 500000), sla('Preparation 3-7 days; MFA/DGIE 14-30 days', 'days', 3, 30)),
      step('IMM_V2_6_TEMP_RESIDENCE', 6, 'residence', 'Temporary residence permit', ['Identify correct class', 'Compile application dossier', 'Submit through IREMBO/DGIE', 'Monitor decision and collect permit', 'Advise on obligations'], [output('temporary_residence_dossier', 'Complete application dossier', 'Filing'), output('dgie_receipt', 'DGIE submission receipt', 'Filing'), output('temporary_residence_card', 'Temporary Residence Permit card', 'Outcome'), output('obligations_note', 'Obligations briefing note', 'Advice')], ['Art. 13-18 Ministerial Order No 06/01'], fee('RWF 200,000 - 600,000', 200000, 600000), sla('Preparation 3-7 days; DGIE decision 15-30 days', 'days', 3, 30)),
      step('IMM_V2_7_INTRA_COMPANY', 7, 'residence', 'Intra-company transfer permit', ['Verify qualifying employment relationship', 'Obtain company authorisation letter', 'Compile transfer documentation and employment evidence', 'File under Art. 19 procedure with DGIE', 'Advise on permit conditions and work rights'], [output('transfer_application_file', 'Intra-company transfer application file', 'Filing'), output('company_authorisations', 'Company authorisation letters', 'Correspondence'), output('work_residence_permit', 'Approved residence/work permit', 'Outcome')], ['Art. 19, 13 and 18 Ministerial Order No 06/01'], fee('RWF 300,000 - 700,000', 300000, 700000), sla('Preparation 5-10 days; DGIE decision 20-30 days', 'days', 5, 30)),
      step('IMM_V2_8_PERMANENT_RESIDENCE', 8, 'residence', 'Permanent residence permit', ['Confirm eligibility criteria', 'Assemble comprehensive dossier', 'Verify no cancellation grounds', 'Submit to DGIE and attend interview if required', 'Collect permit and advise on rights'], [output('permanent_residence_dossier', 'Complete permanent residence dossier', 'Filing'), output('dgie_permanent_receipt', 'DGIE submission receipt', 'Filing'), output('permanent_residence_card', 'Permanent Residence Permit card', 'Outcome'), output('resident_identity_card', 'Resident identity card', 'Outcome')], ['Art. 20-23 Ministerial Order No 06/01'], fee('RWF 500,000 - 1,000,000', 500000, 1000000), sla('Preparation 7-14 days; DGIE decision 30-60 days', 'days', 7, 60)),
      step('IMM_V2_9_PASSPORT', 9, 'travel_docs', 'Ordinary passport application', ['Advise on required documents', 'Assist IREMBO passport application', 'Submit to DGIE/Immigration Office', 'Track progress and collect passport'], [output('passport_application', 'Completed passport application form', 'Filing'), output('passport_bundle', 'Supporting documents bundle', 'Filing'), output('ordinary_passport', 'Issued Rwandan ordinary passport', 'Outcome')], ['Art. 26, 37 and 38 Ministerial Order No 06/01'], fee('RWF 50,000 - 150,000', 50000, 150000), sla('Preparation 1-2 days; DGIE processing 5-10 business days', 'days', 1, 10)),
      step('IMM_V2_10_ETD', 10, 'travel_docs', 'Emergency travel document', ['Confirm genuine emergency', 'Prepare emergency request with justification', 'Submit ETD application to DGIE', 'Coordinate with Ministry of Foreign Affairs if abroad'], [output('emergency_application', 'Emergency application file', 'Filing'), output('justification_letter', 'Justification letter', 'Correspondence'), output('emergency_travel_document', 'Emergency Travel Document issued', 'Outcome')], ['Art. 32, 9 and 37 Ministerial Order No 06/01'], fee('RWF 100,000 - 250,000', 100000, 250000), sla('Same day or within 24 hrs', 'hours', 0, 24)),
      step('IMM_V2_11_REFUGEE_TRAVEL', 11, 'travel_docs', 'Refugee / resident travel document', ['Verify refugee or resident status with UNHCR/DGIE', 'Compile required documents', 'Submit travel document application', 'Follow up and collect travel document'], [output('travel_document_dossier', 'Application dossier', 'Filing'), output('unhcr_dgie_letter', 'DGIE/UNHCR coordination letter', 'Correspondence'), output('travel_document', 'Refugee or resident travel document', 'Outcome')], ['Art. 33-35 and 37 Ministerial Order No 06/01'], fee('RWF 100,000 - 300,000', 100000, 300000), sla('Preparation 3-5 days; DGIE decision 10-21 days', 'days', 3, 21)),
      step('IMM_V2_12_ENTRY', 12, 'entry_exit', 'Entry assistance', ['Advise on lawful entry conditions', 'Prepare support or invitation letter if required', 'Accompany client to border post or airport if needed', 'Address entry refusal or provisional interception'], [output('entry_support_letter', 'Entry support letter', 'Correspondence'), output('entry_advice', 'Written legal advice on entry rights', 'Advice'), output('interception_objection', 'Interception objection letter', 'Remedy', false)], ['Art. 3, 4, 8 and 9 Ministerial Order No 06/01'], fee('RWF 50,000 - 200,000', 50000, 200000), sla('Immediate / same day', 'hours', 0, 24)),
      step('IMM_V2_13_TRANSIT_ASSISTANCE', 13, 'entry_exit', 'Transit assistance', ['Confirm transit eligibility and permitted duration', 'Advise on transit visa if required', 'Prepare transit documentation package', 'Represent client if transit dispute arises'], [output('transit_package', 'Transit documentation package', 'Filing'), output('transit_advice', 'Written transit advice note', 'Advice'), output('transit_visa_if_applicable', 'Transit visa if applicable', 'Outcome', false)], ['Art. 6, 11, 8 and 9 Ministerial Order No 06/01'], fee('RWF 50,000 - 150,000', 50000, 150000), sla('Preparation 1-2 days initial advice', 'days', 1, 2)),
      step('IMM_V2_14_EXIT', 14, 'entry_exit', 'Exit assistance and clearance', ['Verify exit eligibility and outstanding obligations', 'Address exit ban or restriction', 'Coordinate with DGIE for exit clearance', 'Advise family members and children on separate exit requirements'], [output('exit_clearance_application', 'Exit clearance application', 'Filing'), output('exit_authorisation', 'DGIE exit authorisation letter', 'Outcome'), output('exit_advice', 'Written legal advice on exit conditions', 'Advice')], ['Art. 7, 4 and 5 Ministerial Order No 06/01'], fee('RWF 100,000 - 300,000', 100000, 300000), sla('1-5 business days', 'days', 1, 5)),
      step('IMM_V2_15_DIPLOMAT_WORK_AUTH', 15, 'special', 'Diplomat family member work authorisation', ['Verify diplomat family member status', 'Prepare work authorisation application', 'Liaise with MFA and DGIE', 'Submit application and collect authorisation'], [output('work_auth_file', 'Work authorisation application file', 'Filing'), output('mfa_correspondence', 'MFA coordination correspondence', 'Correspondence'), output('work_auth_certificate', 'Work authorisation certificate', 'Outcome')], ['Art. 25, 17 and 24 Ministerial Order No 06/01'], fee('RWF 200,000 - 500,000', 200000, 500000), sla('Preparation 5-10 days; MFA/DGIE 21-45 days', 'days', 5, 45)),
      step('IMM_V2_16_WAIVER', 16, 'special', 'Visa / permit cost waiver application', ['Identify applicable waiver agreement', 'Prepare waiver application with diplomatic documentation', 'Submit to DGIE for cost waiver approval', 'Confirm waiver and proceed with underlying application'], [output('waiver_application', 'Waiver application file', 'Filing'), output('diplomatic_notes', 'Diplomatic notes if applicable', 'Correspondence', false), output('waiver_letter', 'Confirmed waiver letter from DGIE', 'Outcome')], ['Art. 24 and 10 Ministerial Order No 06/01'], fee('RWF 100,000 - 300,000', 100000, 300000), sla('Preparation 3-7 days; decision 14-30 days', 'days', 3, 30)),
      step('IMM_V2_17_CANCELLATION_DEFENCE', 17, 'enforcement', 'Permit / visa cancellation defence', ['Review grounds for cancellation', 'Advise on rights and appeal options', 'Prepare written objection to DGIE', 'File appeal with competent administrative court if needed'], [output('objection_letter', 'Written objection letter to DGIE', 'Remedy'), output('administrative_appeal_file', 'Administrative appeal file', 'Court'), output('dgie_hearing_representation', 'Representation at DGIE hearing', 'Hearing')], ['Art. 22 and 18 Ministerial Order No 06/01'], fee('RWF 300,000 - 800,000', 300000, 800000), sla('Immediate upon cancellation notice', 'hours', 0, 24)),
      step('IMM_V2_18_DEPORTATION_CHALLENGE', 18, 'enforcement', 'Deportation / refusal of entry challenge', ['Review legality of deportation order or entry refusal', 'Advise client on intercepted traveller rights', 'File urgent representation with DGIE or Immigration Court', 'Apply for interim relief or stay of deportation', 'Coordinate with UNHCR if refugee protection issue arises'], [output('urgent_representation', 'Urgent representation letter', 'Remedy'), output('stay_application', 'Stay of deportation application', 'Court'), output('court_filing', 'Court filing if escalated', 'Court', false), output('unhcr_note', 'UNHCR coordination note', 'Protection', false)], ['Art. 3, 8, 9 and 22 Ministerial Order No 06/01', 'International refugee law if applicable'], fee('RWF 500,000 - 1,500,000 urgency and complexity premium', 500000, 1500000), sla('Immediate same day filing', 'hours', 0, 24)),
      step('IMM_V2_19_COMPLIANCE', 19, 'closure', 'Post-matter follow-up and compliance advice', ['Confirm permit or visa has been received and is valid', 'Advise on renewal timelines and obligations', 'Send reminder letters 60 and 30 days before expiry', 'Update client file with DGIE correspondence'], [output('compliance_note', 'Post-matter compliance note', 'Advice'), output('renewal_reminders', 'Renewal reminder letters', 'Client Communication'), output('updated_client_file', 'Updated client file', 'Administration')], ['Art. 14, 16 and 18 Ministerial Order No 06/01'], fee('RWF 50,000 - 100,000 advisory note', 50000, 100000), sla('Within 24 hrs of matter closure', 'hours', 0, 24)),
      step('IMM_V2_20_BILLING_CLOSURE', 20, 'closure', 'Billing, fee notes and file closure', ['Prepare final fee note with RBA-required identification', 'Include advocate tax ID and VAT number', 'Send final invoice and close client file', 'Archive matter and issue file closure letter'], [output('final_fee_note', 'Final fee notes with tax ID and VAT', 'Billing'), output('payment_receipt', 'Receipt of payment', 'Billing'), output('file_closure_letter', 'File closure letter to client', 'Client Communication'), output('archived_file', 'Archived matter file', 'Administration')], ['RBA Reg. Art. 17, 19 and 20', 'RBA Reg. Art. 10-17'], fee('Per agreed fee schedule under RBA Reg. Art. 10-17'), sla('Within 24 hrs of final delivery', 'hours', 0, 24)),
    ],
  },
  {
    name: 'Corporate & NGO Registration',
    matterType: 'Corporate & NGO Registration',
    caseType: 'Transactional Cases',
    version: latestVersion,
    active: true,
    stages: [
      { key: 'setup', order: 1, title: 'Onboarding & Initial Setup' },
      { key: 'vetting', order: 2, title: 'Verification & Vetting' },
      { key: 'approvals', order: 3, title: 'External Approvals & Strategic Planning' },
      { key: 'filing', order: 4, title: 'Structural Setup & Final Filing' },
    ],
    steps: [
      step('CNGO_1_SETUP', 1, 'setup', 'Client onboarding and initial setup', ['Receive instructions, conflict check and open client file', 'Draft statutes or articles of incorporation', 'Notarize founding documents for local or international NGO'], [output('client_file', 'Client file', 'Administration'), output('notarized_statutes', 'Notarized statutes', 'Documents'), output('notarized_minutes', 'Notarized minutes of meeting', 'Documents'), output('authorization', 'Authorization for international NGO', 'Documents', false)], ['Art. 20 Law No 058/2024', 'RDB Regulations for companies'], fee('RWF 50,000 - 200,000 onboarding; RWF 500,000 - 3,000,000 setup', 50000, 3000000), sla('4-8 hrs onboarding; same day setup', 'hours', 4, 24)),
      step('CNGO_2_VETTING', 2, 'vetting', 'Home country proof and leadership vetting', ['Verify legal status in country of origin for foreign individuals', 'Obtain authorization', 'Identify legal representatives', 'Submit IDs, criminal records and acceptance declarations'], [output('official_authorization', 'Official authorization', 'Compliance'), output('ids_particulars', 'IDs and particulars', 'Compliance'), output('criminal_records', 'Criminal records', 'Compliance'), output('passports', 'Passports for international NGO', 'Compliance', false)], ['Art. 20 and 29 Law No 058/2024'], fee('N/A government fees only'), sla('4-8 hrs', 'hours', 4, 8)),
      step('CNGO_3_APPROVALS', 3, 'approvals', 'External approval and strategic planning', ['Seek district collaboration letter or ministry agreement', 'Prepare action plan and budget', 'Identify funding sources'], [output('district_letter', 'District collaboration letter', 'Approval', false), output('ministry_agreement', 'Ministry partnership agreement', 'Approval', false), output('action_plan', 'Annual action plan', 'Planning'), output('budget_funding', 'Budget and funding source', 'Planning')], ['Art. 20 and 29 Law No 058/2024'], fee('RWF 100,000 - 600,000 representation; RWF 100,000 - 300,000 planning', 100000, 600000), sla('4-8 hrs external approval; 24-72 hrs planning', 'hours', 4, 72)),
      step('CNGO_4_FILING', 4, 'filing', 'Structural setup and final filing', ['Define organizational structure', 'Draft power of attorney for international NGO', 'Submit electronic application to RDB/LODA', 'Pay registration fee'], [output('organization_structure', 'Organizational structure', 'Documents'), output('power_of_attorney', 'Power of attorney', 'Documents', false), output('submission_confirmation', 'Electronic submission confirmation', 'Filing'), output('fee_payment_proof', 'Fee payment proof', 'Filing')], ['Art. 6 and 29 Law No 058/2024'], fee('RWF 2,000,000 - 15,000,000 structure; RWF 500,000 - 2,000,000 filing', 500000, 15000000), sla('24-72 hrs structure; 24 hrs filing', 'hours', 24, 72)),
    ],
  },
  {
    name: 'Licences',
    matterType: 'Licences',
    caseType: 'Transactional Cases',
    version: latestVersion,
    active: true,
    stages: [
      { key: 'identification', order: 1, title: 'Client Intake & Licence Identification' },
      { key: 'filing', order: 2, title: 'Application Preparation & Filing' },
      { key: 'issuance', order: 3, title: 'Monitoring & Issuance' },
    ],
    steps: [
      step('LIC_1_IDENTIFICATION', 1, 'identification', 'Business activity review and licence roadmap', ['Understand business activity and identify required licences', 'Determine issuing authority, conditions and fees'], [output('engagement_letter', 'Engagement letter', 'Engagement'), output('licence_roadmap', 'Licence roadmap', 'Advice')], ['Sector-specific licensing laws', 'RDB/Sector Regulations'], fee('RWF 50,000 - 200,000', 50000, 200000), sla('4-8 hrs', 'hours', 4, 8)),
      step('LIC_2_FILING', 2, 'filing', 'Compile documents and submit application', ['Gather ID, registration certificate, tax clearance and other required documents', 'Complete prescribed forms, pay licence fees and file with issuing authority'], [output('application_file', 'Complete application file', 'Filing'), output('submission_receipt', 'Submission receipt', 'Filing')], ['Sector licensing regulations', 'RDB online portal'], fee('RWF 100,000 - 500,000', 100000, 500000), sla('1-3 days', 'days', 1, 3)),
      step('LIC_3_ISSUANCE', 3, 'issuance', 'Follow-up, issuance and compliance advice', ['Monitor progress', 'Respond to requests for additional information', 'Collect licence', 'Advise on conditions, renewal dates and compliance obligations'], [output('status_updates', 'Status updates', 'Client Communication'), output('licence_copy', 'Licence copy', 'Outcome'), output('compliance_checklist', 'Compliance checklist', 'Compliance')], ['Sector licensing regulations'], fee('RWF 100,000 - 300,000', 100000, 300000), sla('5-30 days depending on authority', 'days', 5, 30)),
    ],
  },
  {
    name: 'Auction & Mortgage Enforcement',
    matterType: 'Auction & Mortgage Enforcement',
    caseType: 'Transactional Cases',
    version: latestVersion,
    active: true,
    stages: [
      { key: 'intake', order: 1, title: 'Client Intake' },
      { key: 'registration', order: 2, title: 'Mortgage Registration' },
      { key: 'auction', order: 3, title: 'Auction Procedure' },
      { key: 'post_auction', order: 4, title: 'Post-Auction Phase' },
    ],
    steps: [
      step('AME_1_INTAKE', 1, 'intake', 'Client onboarding and security due diligence', ['Conflict check, open file, sign retainer and collect documents', 'Search NLA/RDB for encumbrances', 'Review evidence legally'], [output('engagement_letter', 'Engagement letter', 'Engagement'), output('title_search_report', 'Title search report / abstract', 'Due Diligence')], ['Art. 25 Law No 10/2009 on Mortgages'], fee('RWF 100,000 - 300,000', 100000, 300000), sla('1-2 hrs intake; advice within 24-72 hrs', 'hours', 1, 72)),
      step('AME_2_REGISTRATION', 2, 'registration', 'Mortgage assessment, agreement, consents and registration', ['Coordinate certified valuer and review report', 'Prepare mortgage contract and notarized abstract', 'Draft board resolutions or spousal consent', 'Upload documents to RDB Electronic Mortgage Registration System'], [output('valuation_report', 'Certified evaluation report', 'Valuation'), output('mortgage_agreement', 'Mortgage agreement and abstract', 'Documents'), output('consents', 'Notarized resolutions/consents', 'Documents'), output('rdb_confirmation', 'RDB registration confirmation', 'Filing')], ['Art. 4 Law No 10/2009 on Mortgages'], fee('RWF 100,000 - 600,000; 0.5%-3% of property value, minimum RWF 500,000', 100000, 600000), sla('Complete within 24-48 hrs', 'hours', 24, 48)),
      step('AME_3_AUCTION', 3, 'auction', 'Security verification, default notice, permit to sell and auction monitoring', ['Confirm creditor priority status', 'Draft and serve default notice', 'File application with Registrar General for Decision to Sell', 'Assist receiver appointment', 'Ensure auction notices are published', 'Review bidding report and verify successful bidder payment'], [output('demand_letter', 'Demand letter', 'Correspondence'), output('decision_to_sell', 'Decision to Sell', 'Approval'), output('receiver_appointment', 'Receiver appointment', 'Auction'), output('auction_notice', 'Auction notice', 'Auction'), output('bidding_report', 'Bidding Report (Inyandikomvaho)', 'Auction')], ['Art. 14, 15 and 18 Law No 10/2009 on Mortgages'], fee('RWF 500,000 - 3,000,000', 500000, 3000000), sla('Progress update every 10-14 days', 'days', 10, 14)),
      step('AME_4_POST_AUCTION', 4, 'post_auction', 'Transfer of ownership and distribution', ['Finalize transfer of ownership', 'Account for funds', 'Close creditor file'], [output('ownership_transfer', 'Ownership transfer documents', 'Transfer'), output('fund_distribution', 'Proof of fund distribution', 'Accounting')], ['Law No 10/2009 on Mortgages'], fee('RWF 500,000 - 3,500,000 or 1%-5% of recovered amount', 500000, 3500000), sla('30-45 days', 'days', 30, 45)),
    ],
  },
  {
    name: 'Contract Drafting & Negotiation',
    matterType: 'Contract Drafting & Negotiation',
    caseType: 'Transactional Cases',
    version: latestVersion,
    active: true,
    stages: [
      { key: 'instructions', order: 1, title: 'Client Instructions & Pre-Drafting Formalities' },
      { key: 'formation', order: 2, title: 'Formation' },
      { key: 'negotiation', order: 3, title: 'Negotiation' },
      { key: 'execution', order: 4, title: 'Execution' },
      { key: 'post_execution', order: 5, title: 'Post-Execution' },
    ],
    steps: [
      step('CDN_1_INSTRUCTIONS', 1, 'instructions', 'Instructions, scope and pre-drafting checks', ['Receive instructions and confirm transaction objectives', 'Conduct conflict check and open file', 'Collect background documents', 'Identify parties, authority, signing capacity and risk areas'], [output('instruction_note', 'Client instruction note', 'Administration'), output('conflict_check', 'Conflict check', 'Compliance'), output('document_checklist', 'Document checklist', 'Documents'), output('drafting_plan', 'Drafting plan', 'Planning')], ['Contract Law No 45/2011', 'RBA fee regulations'], fee('RWF 30,000 file opening; RWF 100,000 - 300,000 assessment', 30000, 300000), sla('4-8 hrs intake; 24-72 hrs assessment', 'hours', 4, 72)),
      step('CDN_2_FORMATION', 2, 'formation', 'Contract structure and first draft', ['Confirm essential terms and applicable law', 'Draft clauses, warranties, obligations and remedies', 'Build annexures and execution blocks', 'Run legal quality review'], [output('first_draft', 'First contract draft', 'Drafting'), output('issues_list', 'Issues list', 'Review'), output('annexures', 'Annexures', 'Documents', false)], ['Contract Law No 45/2011'], fee('RWF 100,000 - 500,000 depending on complexity', 100000, 500000), sla('1-5 days depending on complexity', 'days', 1, 5)),
      step('CDN_3_NEGOTIATION', 3, 'negotiation', 'Negotiation and revision', ['Share draft with counterparties', 'Track comments and proposed changes', 'Negotiate risk allocation and commercial terms', 'Prepare revised draft and negotiation memo'], [output('redline_draft', 'Redline draft', 'Negotiation'), output('negotiation_memo', 'Negotiation memo', 'Negotiation'), output('revised_contract', 'Revised contract', 'Drafting')], ['Contract Law No 45/2011', 'Applicable sector rules'], fee('RWF 100,000 - 1,000,000 depending on rounds and complexity', 100000, 1000000), sla('Dependent on parties; typical turnaround 24-72 hrs per round', 'hours', 24, 72)),
      step('CDN_4_EXECUTION', 4, 'execution', 'Finalization, signing and notarization', ['Prepare clean execution copy', 'Confirm approvals and authority to sign', 'Coordinate signature, notarization and stamping where required', 'Deliver executed copy to client'], [output('execution_copy', 'Final execution copy', 'Execution'), output('approval_evidence', 'Approval evidence', 'Compliance'), output('signed_contract', 'Signed contract', 'Execution'), output('notarized_copy', 'Notarized copy if required', 'Execution', false)], ['Contract Law No 45/2011', 'Notarial and sector-specific rules where applicable'], fee('RWF 100,000 - 500,000 plus disbursements', 100000, 500000), sla('Same day to 3 days after approval', 'days', 0, 3)),
      step('CDN_5_POST_EXECUTION', 5, 'post_execution', 'Post-execution obligations and closure', ['Advise on obligations, renewal and termination dates', 'Prepare compliance calendar', 'Archive executed documents', 'Issue final fee note and file closure letter'], [output('obligations_summary', 'Obligations summary', 'Advice'), output('compliance_calendar', 'Compliance calendar', 'Compliance'), output('archived_contract', 'Archived contract file', 'Administration'), output('closure_letter', 'File closure letter', 'Client Communication')], ['RBA fee regulations', 'Contract Law No 45/2011'], fee('Per agreed fee schedule; advisory follow-up as agreed'), sla('Within 24 hrs of final delivery', 'hours', 0, 24)),
    ],
  },
  {
    name: 'Motor Vehicle Transfer',
    matterType: 'Motor Vehicle Transfer',
    caseType: 'Transactional Cases',
    version: latestVersion,
    active: true,
    stages: [
      { key: 'intake', order: 1, title: 'Initial Client Intake & Preliminary Assessment' },
      { key: 'documentation', order: 2, title: 'Preparation & Documentation' },
      { key: 'submission', order: 3, title: 'Online Submission' },
      { key: 'inspection', order: 4, title: 'Physical Verification & Inspection' },
      { key: 'completion', order: 5, title: 'Payment & Completion of Transfer' },
      { key: 'post_transfer', order: 6, title: 'Post-Transfer Obligations & Compliance' },
    ],
    steps: [
      step('MVT_1_INTAKE', 1, 'intake', 'Client intake and ownership review', ['Receive seller and buyer instructions', 'Verify IDs and transaction facts', 'Review Yellow Card and vehicle ownership records', 'Identify liens, fines or transfer restrictions'], [output('client_intake', 'Client intake record', 'Administration'), output('ownership_review', 'Ownership review note', 'Due Diligence'), output('document_checklist', 'Required document checklist', 'Compliance')], ['RRA motor vehicle transfer requirements'], fee('Professional fees as agreed; government fees separate'), sla('Same day initial assessment', 'hours', 0, 24)),
      step('MVT_2_DOCUMENTS', 2, 'documentation', 'Sale agreement and supporting documents', ['Prepare sale agreement', 'Collect buyer and seller IDs', 'Collect Yellow Card, insurance and supporting documents', 'Arrange notarization where required'], [output('sale_agreement', 'Sale agreement', 'Documents'), output('id_bundle', 'Buyer and seller ID bundle', 'Compliance'), output('yellow_card', 'Yellow Card copy', 'Documents'), output('notarized_contract', 'Notarized contract', 'Documents')], ['RRA/RNP administrative requirements'], fee('Professional fees as agreed; notarization fees apply'), sla('1-2 business days', 'days', 1, 2)),
      step('MVT_3_SUBMISSION', 3, 'submission', 'RRA / IREMBO portal submission', ['Create or access portal request', 'Upload transfer documents', 'Submit seller and buyer confirmations', 'Track portal status'], [output('portal_submission', 'Portal submission acknowledgement', 'Filing'), output('tracking_reference', 'Transfer tracking reference', 'Filing')], ['RRA online portal requirements'], fee('Administrative fees as applicable'), sla('Same day submission if documents are complete', 'hours', 0, 24)),
      step('MVT_4_INSPECTION', 4, 'inspection', 'Physical vehicle inspection', ['Book inspection appointment', 'Present vehicle and original documents', 'Support VIN/chassis and engine number verification', 'Resolve discrepancies and reschedule if needed'], [output('inspection_booking', 'Inspection booking', 'Inspection'), output('inspection_result', 'Inspection clearance certificate', 'Inspection')], ['RRA physical inspection requirements'], fee('Inspection fees as applicable'), sla('Appointment-dependent', 'days', 1, 7)),
      step('MVT_5_COMPLETION', 5, 'completion', 'Transfer fee payment and approval', ['Generate transfer fee invoice after inspection clearance', 'Pay transfer fee through approved channels', 'Confirm payment status on portal', 'Obtain ownership transfer approval and new Yellow Card'], [output('payment_invoice', 'RRA payment invoice/reference', 'Billing'), output('payment_receipt', 'Payment receipt', 'Billing'), output('transfer_approval', 'Transfer approval notification', 'Outcome'), output('new_yellow_card', "New Yellow Card in buyer's name", 'Outcome')], ['RRA payment and vehicle register requirements'], fee('RWF 60,000 vehicles; RWF 30,000 motorcycles', 30000, 60000), sla('1-3 business days after payment', 'days', 1, 3)),
      step('MVT_6_POST_TRANSFER', 6, 'post_transfer', 'Insurance, road tax, plates and dispute correction', ['Update insurance to new owner', 'Pay road tax if due and obtain roadworthiness certificate if applicable', 'Advise on number plate retention or change', 'Resolve rejected transfers or ownership disputes'], [output('updated_insurance', 'Updated insurance certificate', 'Compliance'), output('road_tax_clearance', 'Road tax clearance', 'Compliance'), output('plate_result', 'Retained or new plates', 'Outcome'), output('correction_submission', 'Corrected submission or dispute complaint reference', 'Remedy', false)], ['RRA and RURA post-transfer requirements'], fee('Variable insurance/road tax; RWF 10,000 - 20,000 if new plates requested', 10000, 20000), sla('Within 7 days of transfer; disputes 2-10 business days', 'days', 2, 10)),
    ],
  },
];

export const seedComprehensiveLegalWorkflows = async () => {
  const seeded = [];

  for (const template of templates) {
    await WorkflowTemplate.updateMany(
      { name: template.name, version: { $lt: template.version } },
      { $set: { active: false } }
    );

    const result = await WorkflowTemplate.findOneAndUpdate(
      { name: template.name, version: template.version },
      { $set: template },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    );

    seeded.push(result);
  }

  return seeded;
};
