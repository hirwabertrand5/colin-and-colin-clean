import WorkflowTemplate from '../models/workflowTemplateModel';

export const seedBusinessRegistrationTemplate = async () => {
  const name = 'Business Registration Procedure';
  const version = 1;

  const template = {
    name,
    matterType: 'Business Registration',
    caseType: 'Transactional Cases',
    version,
    active: true,

    stages: [
      { key: 'preincorporation', order: 1, title: 'Pre-Incorporation - Choosing the Company Type' },
      { key: 'name_reservation', order: 2, title: 'Company Name Reservation & Clearance' },
      { key: 'documents', order: 3, title: 'Preparation of Incorporation Documents' },
      { key: 'filing', order: 4, title: 'Filing the Application for Incorporation' },
      { key: 'certificate', order: 5, title: 'Issuance of Certificate of Incorporation' },
      { key: 'post_incorp', order: 6, title: 'Post-Incorporation Compliance Obligations' },
    ],

    steps: [
      {
        key: 'BUS_1_COMPANY_TYPE',
        order: 1,
        stageKey: 'preincorporation',
        title: 'Determine Company Type',
        actions: [
          'Advise client on the appropriate company type based on business objectives and structure',
          'Explain options: Private Company, Public Company, Subsidiary, Holding Company, company limited by guarantee, or unlimited liability',
        ],
        outputs: [
          { key: 'company_type_advisory', name: 'Advisory note on company type selection', required: true, category: 'Advice' },
          { key: 'client_recommendation', name: 'Written recommendation to client', required: true, category: 'Advice' },
        ],
        legalBasis: [
          { text: 'Law No. 007/2021, Art. 5 (Categories of companies)' },
          { text: 'Law No. 007/2021, Art. 11 (Types of companies)' },
        ],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 300000, text: 'Art. 22(1) RBA Regulation' },
        sla: { unit: 'days', min: 0, max: 3, text: '1-2 hours; deliver advice within 24-72 hours' },
      },
      {
        key: 'BUS_2_PRIVATE_REQUIREMENTS',
        order: 2,
        stageKey: 'preincorporation',
        title: 'Private Company Requirements',
        actions: [
          "Confirm name ends in 'Private Limited Company' or 'Ltd'",
          'Confirm one or more shares with restricted transfer rights',
          'Confirm one or more shareholders, maximum 100',
          'Confirm at least one director ordinarily resident in Rwanda',
          'Prepare incorporation documents',
        ],
        outputs: [
          { key: 'private_company_checklist', name: 'Checklist of private company requirements', required: false, category: 'Checklist' },
          { key: 'private_company_memo', name: 'Advice memo to client', required: false, category: 'Advice' },
        ],
        legalBasis: [
          { text: 'Law No. 007/2021, Art. 7 (Essential requirements for a private company)' },
          { text: 'Law No. 007/2021, Art. 8 (Characteristics of a private company)' },
        ],
        fee: { type: 'included', text: 'Included in general advisory fee' },
        sla: { unit: 'days', min: 0, max: 3, text: '1-2 hours; deliver advice within 24-72 hours' },
      },
      {
        key: 'BUS_3_PUBLIC_REQUIREMENTS',
        order: 3,
        stageKey: 'preincorporation',
        title: 'Public Company Requirements',
        actions: [
          "Confirm name ends in 'Public Limited Company' or 'PLC'",
          'Confirm one or more shareholders',
          'Confirm at least one director ordinarily resident in Rwanda',
          'Confirm shares are freely transferable',
          'Prepare incorporation documents',
        ],
        outputs: [
          { key: 'public_company_checklist', name: 'Checklist of public company requirements', required: false, category: 'Checklist' },
          { key: 'public_company_memo', name: 'Advice memo to client', required: false, category: 'Advice' },
        ],
        legalBasis: [
          { text: 'Law No. 007/2021, Art. 9 (Essential requirements for a public company)' },
          { text: 'Law No. 007/2021, Art. 10 (Characteristics of a public company)' },
        ],
        fee: { type: 'included', text: 'Included in general advisory fee' },
        sla: { unit: 'days', min: 0, max: 3, text: '1-2 hours; deliver advice within 24-72 hours' },
      },
      {
        key: 'BUS_4_GENERAL_REQUIREMENTS',
        order: 4,
        stageKey: 'preincorporation',
        title: 'General Requirements (All Companies)',
        actions: [
          'Confirm registered company name',
          'Confirm one or more shareholders',
          'Confirm one or more shares if limited by shares',
          'Confirm at least one director resident in Rwanda',
        ],
        outputs: [{ key: 'general_requirements', name: 'General requirements checklist', required: true, category: 'Checklist' }],
        legalBasis: [{ text: 'Law No. 007/2021, Art. 6 (Essential requirements for incorporation)' }],
        fee: { type: 'included', text: 'Included in general advisory fee' },
        sla: { unit: 'days', min: 1, max: 2, text: 'Complete within 24-48 hours' },
      },
      {
        key: 'BUS_5_NAME_SELECTION',
        order: 5,
        stageKey: 'name_reservation',
        title: 'Company Name Selection',
        actions: [
          'Advise client on permissible company names',
          'Conduct name search with Registrar General',
          'Verify name is not identical or similar to existing registered names',
          'Confirm name ends with correct suffix (Ltd / PLC)',
        ],
        outputs: [
          { key: 'name_search_result', name: 'Name search result', required: true, category: 'Registration' },
          { key: 'name_clearance', name: 'Name clearance confirmation', required: true, category: 'Registration' },
          { key: 'proposed_names', name: 'Proposed name list for client', required: false, category: 'Advice' },
        ],
        legalBasis: [
          { text: 'Law No. 007/2021, Art. 7(1) (Name for private company)' },
          { text: 'Law No. 007/2021, Art. 9(1) (Name for public company)' },
        ],
        fee: { type: 'range', currency: 'RWF', min: 50000, max: 100000, text: 'Art. 22(2) RBA Regulation' },
        sla: { unit: 'days', min: 1, max: 2, text: 'Complete within 24-48 hours' },
      },
      {
        key: 'BUS_6_NAME_DISPLAY',
        order: 6,
        stageKey: 'name_reservation',
        title: 'Name Display Obligation',
        actions: [
          'Advise client on obligation to display company name at registered office',
          'Confirm name is displayed on official correspondence and documents after registration',
        ],
        outputs: [{ key: 'name_display_advisory', name: 'Advisory note on name display obligations', required: false, category: 'Advice' }],
        legalBasis: [{ text: 'Law No. 007/2021, Art. 32 (Display of company name)' }],
        fee: { type: 'included', text: 'Included in incorporation fee' },
        sla: { unit: 'days', min: 0, max: 1, text: 'Immediate communication; ongoing obligation' },
      },
      {
        key: 'BUS_7_MEMORANDUM',
        order: 7,
        stageKey: 'documents',
        title: 'Draft Memorandum of Association',
        actions: [
          'Draft Memorandum of Association containing all required information',
          'Include company name, registered office, business activity, public/private status, liability status and company type',
        ],
        outputs: [
          { key: 'memorandum_draft', name: 'Memorandum of Association (draft)', required: true, category: 'Documents' },
          { key: 'memorandum_final', name: 'Final signed Memorandum of Association', required: true, category: 'Documents' },
        ],
        legalBasis: [{ text: 'Law No. 007/2021, Art. 20 (Contents of the memorandum of association)' }],
        fee: { type: 'range', currency: 'RWF', min: 200000, max: 500000, text: 'Art. 22(1) RBA Regulation' },
        sla: { unit: 'days', min: 2, max: 5, text: 'Progress update every 2-5 days; draft within 2-5 days' },
      },
      {
        key: 'BUS_8_ARTICLES',
        order: 8,
        stageKey: 'documents',
        title: 'Draft Articles of Association (Optional)',
        actions: [
          'Draft Articles of Association if company chooses to have them',
          'Confirm articles govern internal management of the company',
          'Advise that default provisions apply if no articles are adopted',
        ],
        outputs: [{ key: 'articles', name: 'Articles of Association (draft and final)', required: false, category: 'Documents' }],
        legalBasis: [{ text: 'Law No. 007/2021, Art. 21 (Articles of association)' }],
        fee: { type: 'range', currency: 'RWF', min: 150000, max: 400000, text: 'Art. 22(1) RBA Regulation' },
        sla: { unit: 'days', min: 2, max: 5, text: 'Completion within 2-5 days' },
      },
      {
        key: 'BUS_9_DIRECTOR_CONSENT',
        order: 9,
        stageKey: 'documents',
        title: 'Consent of Directors & Secretary',
        actions: [
          'Obtain signed consent of all persons named as directors and secretary',
          'Use prescribed consent format',
          'Ensure each named director and company secretary signs',
        ],
        outputs: [
          { key: 'director_consents', name: 'Signed consent forms (directors)', required: true, category: 'Documents' },
          { key: 'secretary_consent', name: 'Signed consent form (secretary)', required: false, category: 'Documents' },
        ],
        legalBasis: [{ text: 'Law No. 007/2021, Art. 19(2) (Consent of directors and secretary)' }],
        fee: { type: 'included', text: 'Included in incorporation fee' },
        sla: { unit: 'days', min: 1, max: 2, text: 'Send within 24 hours; complete within 24-48 hours' },
      },
      {
        key: 'BUS_10_SHAREHOLDER_CONSENT',
        order: 10,
        stageKey: 'documents',
        title: 'Consent of Shareholders / Members',
        actions: [
          'Obtain signed consent of each shareholder, member or authorized agent',
          'Use prescribed consent format',
          'Verify written authority for any signing agent',
        ],
        outputs: [
          { key: 'shareholder_consents', name: 'Signed consent forms (shareholders/members)', required: true, category: 'Documents' },
          { key: 'agent_authority', name: 'Written authority of agent (if applicable)', required: false, category: 'Documents' },
        ],
        legalBasis: [{ text: 'Law No. 007/2021, Art. 19(3) (Consent of shareholders/members)' }],
        fee: { type: 'included', text: 'Included in incorporation fee' },
        sla: { unit: 'days', min: 1, max: 2, text: 'Send within 24 hours; complete within 24-48 hours' },
      },
      {
        key: 'BUS_11_BENEFICIAL_OWNERSHIP',
        order: 11,
        stageKey: 'documents',
        title: 'Beneficial Ownership Information',
        actions: [
          'Collect and prepare beneficial ownership information where applicable',
          'Identify ultimate beneficial owners of the company',
          'Submit details as required by the Registrar General',
        ],
        outputs: [
          { key: 'bo_declaration', name: 'Beneficial ownership declaration form', required: false, category: 'Compliance' },
          { key: 'bo_ids', name: 'Supporting identification documents', required: false, category: 'Compliance' },
        ],
        legalBasis: [{ text: 'Law No. 007/2021, Art. 19(6) (Beneficial ownership information)' }],
        fee: { type: 'included', text: 'Included in incorporation fee' },
        sla: { unit: 'days', min: 1, max: 2, text: 'Follow-up every 48 hours; complete within 24-48 hours' },
      },
      {
        key: 'BUS_12_APPLICATION',
        order: 12,
        stageKey: 'filing',
        title: 'Submit Application to Registrar General',
        actions: [
          'File all incorporation documents with the Registrar General',
          'Submit incorporation documents, consents, memorandum, articles if applicable, and beneficial ownership information',
          'Submit in person or via online portal (RDB)',
        ],
        outputs: [
          { key: 'application_file', name: 'Complete incorporation application file', required: true, category: 'Filing' },
          { key: 'submission_proof', name: 'Proof of submission to Registrar General', required: true, category: 'Filing' },
        ],
        legalBasis: [{ text: 'Law No. 007/2021, Art. 19 (Application for incorporation of a company)' }],
        fee: { type: 'range', currency: 'RWF', min: 300000, max: 1000000, text: 'Art. 26 RBA Regulation' },
        sla: { unit: 'days', min: 1, max: 2, text: 'Notify same day; file within 24-48 hours' },
      },
      {
        key: 'BUS_13_REGISTRAR_REVIEW',
        order: 13,
        stageKey: 'filing',
        title: 'Registrar General Review',
        actions: [
          'Monitor review of application by Registrar General',
          'Verify submitted documents are complete and compliant',
          'Respond to queries or deficiencies raised by Registrar General',
        ],
        outputs: [
          { key: 'registrar_queries', name: 'Response to Registrar General queries (if any)', required: false, category: 'Filing' },
          { key: 'compliance_confirmation', name: 'Confirmation of compliance', required: false, category: 'Filing' },
        ],
        legalBasis: [{ text: 'Law No. 007/2021, Art. 22 (Duties of the Registrar General)' }],
        fee: { type: 'included', text: 'Included in filing fee' },
        sla: { unit: 'days', min: 1, max: 5, text: 'Update every 2-5 days; respond within 24 hours' },
      },
      {
        key: 'BUS_14_CERTIFICATE',
        order: 14,
        stageKey: 'certificate',
        title: 'Certificate of Incorporation Issued',
        actions: [
          'Receive Certificate of Incorporation issued by Registrar General',
          'Confirm certificate states registered name, unique code, company type and date of incorporation',
          'Confirm certificate is conclusive evidence of valid incorporation',
        ],
        outputs: [{ key: 'certificate', name: 'Certificate of Incorporation', required: true, category: 'Registration' }],
        legalBasis: [{ text: 'Law No. 007/2021, Art. 23 (Certificate of incorporation)' }],
        fee: { type: 'text', text: 'Government fee paid to RDB/Registrar General - not advocate fee' },
        sla: { unit: 'days', min: 0, max: 1, text: 'Share immediately upon receipt' },
      },
      {
        key: 'BUS_15_LEGAL_PERSONALITY',
        order: 15,
        stageKey: 'certificate',
        title: 'Legal Personality Acquired',
        actions: [
          'Advise client that company becomes a distinct legal entity separate from shareholders',
          'Confirm automatic effect upon certificate issuance',
          'Advise company can sue and be sued, own property and enter contracts in its own name',
        ],
        outputs: [
          { key: 'legal_personality_note', name: 'Advisory note on legal personality', required: false, category: 'Advice' },
          { key: 'post_incorp_checklist', name: 'Post incorporation checklist for client', required: false, category: 'Advice' },
        ],
        legalBasis: [{ text: 'Law No. 007/2021, Art. 24 (Company as a distinct legal entity)' }],
        fee: { type: 'included', text: 'Included in incorporation fee' },
        sla: { unit: 'days', min: 0, max: 1, text: 'Deliver within 24 hours of certificate' },
      },
      {
        key: 'BUS_16_AMENDMENT',
        order: 16,
        stageKey: 'certificate',
        title: 'Amendment of Certificate',
        actions: [
          'Apply to amend certificate where company details change, including name change',
          'Prepare application and supporting documents justifying the change',
          'File with Registrar General',
        ],
        outputs: [
          { key: 'amendment_application', name: 'Application for amendment', required: false, category: 'Registration' },
          { key: 'amendment_support', name: 'Supporting justification documents', required: false, category: 'Registration' },
          { key: 'amended_certificate', name: 'Amended Certificate of Incorporation', required: false, category: 'Registration' },
        ],
        legalBasis: [
          { text: 'Law No. 007/2021, Art. 25 (Amendment to the certificate of incorporation)' },
          { text: 'Law No. 007/2021, Art. 41 (Instruction to change name)' },
        ],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 300000, text: 'Art. 22(1) RBA Regulation' },
        sla: { unit: 'days', min: 2, max: 5, text: '1-2 hours; complete within 2-5 days' },
      },
      {
        key: 'BUS_17_REGISTERED_OFFICE',
        order: 17,
        stageKey: 'post_incorp',
        title: 'Registered Office & Address',
        actions: [
          'Ensure company maintains registered office and registered address in Rwanda',
          'Keep address updated with Registrar General',
        ],
        outputs: [
          { key: 'registered_office_confirmation', name: 'Registered office confirmation letter', required: false, category: 'Compliance' },
          { key: 'address_update', name: 'Address update notification (if changed)', required: false, category: 'Compliance' },
        ],
        legalBasis: [{ text: 'Law No. 007/2021, Art. 30 (Registered office and registered address)' }],
        fee: { type: 'range', currency: 'RWF', min: 50000, max: 100000, text: 'Per update - Art. 22(2)' },
        sla: { unit: 'days', min: 0, max: 1, text: 'Immediate confirmation; update within 24 hours' },
      },
      {
        key: 'BUS_18_SHARE_STRUCTURE',
        order: 18,
        stageKey: 'post_incorp',
        title: 'Share Structure Setup',
        actions: ['Advise on and establish share structure after incorporation', 'Issue share certificates', 'Maintain share register'],
        outputs: [
          { key: 'share_certificates', name: 'Share certificates', required: false, category: 'Compliance' },
          { key: 'share_register', name: 'Share register', required: false, category: 'Compliance' },
        ],
        legalBasis: [
          { text: 'Law No. 007/2021, Art. 52 (Characteristics of shares)' },
          { text: 'Law No. 007/2021, Art. 53 (Types of shares)' },
        ],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 300000, text: 'Art. 22(1)' },
        sla: { unit: 'days', min: 2, max: 5, text: 'Update every 2-5 days; complete within 2-5 days' },
      },
      {
        key: 'BUS_19_BOARD',
        order: 19,
        stageKey: 'post_incorp',
        title: 'Board of Directors Establishment',
        actions: [
          'Ensure Board of Directors is properly constituted and functioning',
          'Confirm at least one director ordinarily resident in Rwanda',
          'Obtain director consent forms',
          'Prepare board resolution records',
        ],
        outputs: [
          { key: 'director_consents_post', name: 'Director consent forms', required: false, category: 'Compliance' },
          { key: 'board_resolutions', name: 'Board resolution records', required: false, category: 'Compliance' },
          { key: 'director_register', name: 'Register of directors', required: false, category: 'Compliance' },
        ],
        legalBasis: [
          { text: 'Law No. 007/2021, Art. 144 (Management of a company)' },
          { text: 'Law No. 007/2021, Art. 146 (Delegation of powers)' },
          { text: 'Law No. 007/2021, Art. 153 (Number of directors)' },
        ],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 300000, text: 'Art. 22(1)' },
        sla: { unit: 'days', min: 2, max: 5, text: 'Update every 2-5 days; complete within 2-5 days' },
      },
      {
        key: 'BUS_20_ANNUAL_RETURNS',
        order: 20,
        stageKey: 'post_incorp',
        title: 'Annual Returns Filing',
        actions: [
          'File annual returns with Registrar General every year',
          'Submit annual declaration in prescribed form',
          'Include updated company information and financial statements where required',
          'Warn client that failure to file may result in penalties',
        ],
        outputs: [
          { key: 'annual_declaration', name: 'Annual declaration form (filed)', required: false, category: 'Compliance' },
          { key: 'updated_company_info', name: 'Updated company information', required: false, category: 'Compliance' },
          { key: 'financial_statements', name: 'Financial statements (where required)', required: false, category: 'Compliance' },
        ],
        legalBasis: [{ text: 'Law No. 007/2021, Art. 143 (Annual declaration)' }],
        fee: { type: 'range', currency: 'RWF', min: 100000, max: 200000, text: 'Per year - Art. 24(3)' },
        sla: { unit: 'days', min: 0, max: 7, text: 'Reminders at 7 and 2 days prior; file within deadline' },
      },
      {
        key: 'BUS_21_AUDIT',
        order: 21,
        stageKey: 'post_incorp',
        title: 'Audit Requirements',
        actions: [
          'Comply with audit obligations applicable to company type and size',
          'Appoint a qualified auditor',
          'Prepare auditor report and financial statements',
        ],
        outputs: [
          { key: 'auditor_appointment', name: 'Auditor appointment letter', required: false, category: 'Compliance' },
          { key: 'auditor_report', name: "Auditor's report", required: false, category: 'Compliance' },
          { key: 'audited_financials', name: 'Audited financial statements', required: false, category: 'Compliance' },
        ],
        legalBasis: [
          { text: 'Law No. 007/2021, Art. 131 (Instruction to conduct audit)' },
          { text: 'Law No. 007/2021, Art. 132 (Appointment of auditor)' },
          { text: 'Law No. 007/2021, Art. 133 (Qualifications of auditor)' },
          { text: 'Law No. 007/2021, Art. 135 (Auditor report)' },
        ],
        fee: { type: 'range', currency: 'RWF', min: 200000, max: 500000, text: 'Art. 22(1)' },
        sla: { unit: 'days', min: 0, max: 30, text: 'Monthly updates; complete within 30 days of year-end' },
      },
      {
        key: 'BUS_22_DIRECTOR_INTERESTS',
        order: 22,
        stageKey: 'post_incorp',
        title: "Disclosure of Directors' Interests",
        actions: [
          'Directors declare conflicts of interest or interests in company transactions',
          'Prepare written declaration of interest',
          'Prepare board resolution addressing the conflict',
        ],
        outputs: [
          { key: 'interest_declaration', name: 'Written declaration of interest', required: false, category: 'Compliance' },
          { key: 'conflict_resolution', name: 'Board resolution on conflict', required: false, category: 'Compliance' },
        ],
        legalBasis: [
          { text: 'Law No. 007/2021, Art. 167 (Declaration of interest)' },
          { text: 'Law No. 007/2021, Art. 168 (Voidable transactions)' },
        ],
        fee: { type: 'range', currency: 'RWF', min: 50000, max: 150000, text: 'Per declaration - Art. 22(2)' },
        sla: { unit: 'days', min: 0, max: 1, text: 'Immediate notification and action' },
      },
    ],
  };

  await WorkflowTemplate.updateMany(
    { name, version: { $lt: version } },
    { $set: { active: false } }
  );

  return WorkflowTemplate.findOneAndUpdate(
    { name, version },
    { $set: template },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  );
};
