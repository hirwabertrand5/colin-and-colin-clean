import WorkflowTemplate from '../models/workflowTemplateModel';

/**
 * Business Registration Procedure — version 2.
 *
 * Source document: "BUSINESS REGISTRATION WORKFLOW WITH PERCENTAGE".
 * Version 1 (seedBusinessRegistration.ts) carried no Key Action percentages and
 * a different outline (no Client Intake / Power of Attorney sections, plus a
 * Post-Incorporation section the document does not cover). Version 2 follows
 * the document exactly: 7 sections with percentages 8 / 5 / 7 / 8 / 35 / 25 / 12
 * (total 100%) and 27 Key Actions whose percentages also total 100%.
 *
 * Older versions are deactivated. Matters already running on version 1 keep
 * their own workflow snapshot and are never rewritten.
 */
export const seedBusinessRegistrationTemplateV2 = async () => {
  const name = 'Business Registration Procedure';
  const version = 2;

  // Reference data (legal basis, outputs, fees and timelines) is entered once
  // per section — the builder and case initialisation copy it to each Key
  // Action, exactly like the Workflow Procedures editor does.
  const sections = [
    {
      key: 'intake',
      order: 1,
      title: 'Client Intake & Preliminary Legal Assessment',
      percentage: 8,
      legalBasis: [
        { text: 'RBA Code of Conduct (conflict of interest & client due diligence)' },
        { text: 'Firm Client Engagement & KYC Policy' },
      ],
      outputs: [
        { key: 'engagement_letter', name: 'Signed engagement letter / fee agreement', required: true, category: 'Documents' },
        { key: 'conflict_check_record', name: 'Conflict check record; client KYC file', required: true, category: 'Compliance' },
      ],
      fee: { type: 'included', text: 'Included in advisory fee' },
      sla: { unit: 'hours', min: 1, max: 24, text: 'Within 1 hr; complete within 24 hrs' },
    },
    {
      key: 'preincorporation',
      order: 2,
      title: 'Pre-Incorporation - Choosing the Company Type',
      percentage: 5,
      legalBasis: [
        { text: 'Law No. 007/2021, Art. 5 (Categories of companies)' },
        { text: 'Law No. 007/2021, Art. 11 (Types of companies)' },
      ],
      outputs: [
        { key: 'company_type_advisory', name: 'Advisory note on company type selection', required: true, category: 'Advice' },
        { key: 'client_recommendation', name: 'Written recommendation to client', required: true, category: 'Advice' },
      ],
      fee: { type: 'range', currency: 'RWF', min: 100000, max: 300000, text: 'Art. 22(1) RBA Regulation' },
      sla: { unit: 'hours', min: 1, max: 72, text: '1-2 hrs; deliver advice within 24-72 hrs' },
    },
    {
      key: 'poa',
      order: 3,
      title: 'Power of Attorney (POA)',
      percentage: 7,
      legalBasis: [{ text: 'Law No. 007/2021, Art. 19(3) (written authority of agent)' }],
      outputs: [
        { key: 'signed_poa', name: 'Signed Power of Attorney', required: true, category: 'Documents' },
        { key: 'notarized_poa', name: 'Notarized Power of Attorney (if applicable)', required: false, category: 'Documents' },
      ],
      fee: { type: 'range', currency: 'RWF', min: 50000, max: 100000, text: 'RWF 50,000 - 100,000' },
      sla: { unit: 'hours', min: 1, max: 48, text: '1-2 hrs; complete within 24-48 hrs' },
    },
    {
      key: 'name_reservation',
      order: 4,
      title: 'Company Name Reservation & Clearance',
      percentage: 8,
      legalBasis: [
        { text: 'Law No. 007/2021, Art. 7(1) (Name for private company)' },
        { text: 'Law No. 007/2021, Art. 9(1) (Name for public company)' },
      ],
      outputs: [
        { key: 'name_search_result', name: 'Name search result', required: true, category: 'Registration' },
        { key: 'name_clearance_confirmation', name: 'Name clearance confirmation', required: true, category: 'Registration' },
        { key: 'proposed_name_list', name: 'Proposed name list for client', required: false, category: 'Advice' },
      ],
      fee: { type: 'range', currency: 'RWF', min: 50000, max: 100000, text: 'Art. 22(2) RBA Regulation' },
      sla: { unit: 'hours', min: 1, max: 48, text: '1-2 hrs; complete within 24-48 hrs' },
    },
    {
      key: 'documents',
      order: 5,
      title: 'Preparation of Incorporation Documents',
      percentage: 35,
      legalBasis: [
        { text: 'Law No. 007/2021, Art. 20 (Contents of the memorandum of association)' },
        { text: 'Law No. 007/2021, Art. 21 (Articles of association)' },
        { text: 'Law No. 007/2021, Art. 19(2) (Consent of directors and secretary)' },
        { text: 'Law No. 007/2021, Art. 19(3) (Consent of shareholders/members)' },
        { text: 'Law No. 007/2021, Art. 19(6) (Beneficial ownership information)' },
      ],
      outputs: [
        { key: 'memorandum_draft', name: 'Memorandum of Association (draft)', required: true, category: 'Documents' },
        { key: 'memorandum_final', name: 'Final signed Memorandum of Association', required: true, category: 'Documents' },
        { key: 'articles_draft_final', name: 'Articles of Association (draft and final)', required: false, category: 'Documents' },
        { key: 'director_consents', name: 'Signed consent forms (directors and secretary)', required: true, category: 'Documents' },
        { key: 'shareholder_consents', name: 'Signed consent forms (shareholders/members)', required: true, category: 'Documents' },
        { key: 'beneficial_ownership_declaration', name: 'Beneficial ownership declaration form', required: false, category: 'Compliance' },
        { key: 'beneficial_ownership_ids', name: 'Supporting identification documents', required: false, category: 'Compliance' },
      ],
      fee: { type: 'included', text: 'Included in incorporation fee' },
      sla: { unit: 'days', min: 2, max: 5, text: 'Progress update every 2-5 days; draft within 2-5 days' },
    },
    {
      key: 'filing',
      order: 6,
      title: 'Filing the Application for Incorporation',
      percentage: 25,
      legalBasis: [
        { text: 'Law No. 007/2021, Art. 19 (Application for incorporation of a company)' },
        { text: 'Law No. 007/2021, Art. 22 (Duties of the Registrar General)' },
      ],
      outputs: [
        { key: 'incorporation_application_file', name: 'Complete incorporation application file', required: true, category: 'Documents' },
        { key: 'submission_proof', name: 'Proof of submission to Registrar General', required: true, category: 'Registration' },
        { key: 'registrar_queries_response', name: 'Response to Registrar General queries (if any)', required: false, category: 'Registration' },
        { key: 'compliance_confirmation', name: 'Confirmation of compliance', required: false, category: 'Registration' },
      ],
      fee: { type: 'range', currency: 'RWF', min: 300000, max: 1000000, text: 'Art. 26 RBA Regulation' },
      sla: { unit: 'hours', min: 0, max: 48, text: 'Notify same day; file within 24-48 hrs' },
    },
    {
      key: 'certificate',
      order: 7,
      title: 'Issuance of Certificate of Incorporation',
      percentage: 12,
      legalBasis: [{ text: 'Law No. 007/2021, Art. 23 (Certificate of incorporation)' }],
      outputs: [{ key: 'certificate_of_incorporation', name: 'Certificate of Incorporation', required: true, category: 'Registration' }],
      fee: { type: 'text', text: 'Government fee (paid to RDB/Registrar General - not advocate fee)' },
      sla: { unit: 'hours', min: 0, max: 24, text: 'Share immediately upon receipt' },
    },
  ];

  const sectionByKey = new Map(sections.map((section) => [section.key, section]));

  // Each Key Action inherits its section's reference data (outputs, legal basis,
  // fees, timelines) and carries its own manual percentage, matching exactly how
  // the Workflow Procedures editor serialises a published workflow.
  const step = (
    key: string,
    order: number,
    stageKey: string,
    title: string,
    percentage: number,
    actions: string[],
    overrides: any = {}
  ) => {
    const section: any = sectionByKey.get(stageKey) || {};
    return {
      key,
      order,
      stageKey,
      title,
      actions,
      percentage,
      outputs: (section.outputs || []).map((output: any) => ({ ...output })),
      legalBasis: (section.legalBasis || []).map((basis: any) => ({ ...basis })),
      ...(overrides.fee || section.fee ? { fee: { ...(overrides.fee || section.fee) } } : {}),
      ...(overrides.sla || section.sla ? { sla: { ...(overrides.sla || section.sla) } } : {}),
    };
  };

  const template = {
    name,
    matterType: 'Business Registration',
    caseType: 'Transactional Cases',
    version,
    active: true,

    stages: sections,

    steps: [
      // Section 1 - Client Intake & Preliminary Legal Assessment (8%)
      step('BR2_INTAKE_CONFLICT_CHECK', 1, 'intake', 'Conduct conflict of interest check and collect client instructions', 2, [
        'Conduct conflict of interest check and collect client instructions',
      ]),
      step('BR2_INTAKE_KYC', 2, 'intake', 'Collect client identification documents and proof of address', 1.5, [
        'Collect client identification documents and proof of address',
      ]),
      step('BR2_INTAKE_ENGAGEMENT', 3, 'intake', 'Issue and sign engagement letter / fee agreement', 1.5, [
        'Issue and sign engagement letter / fee agreement',
      ]),
      step('BR2_INTAKE_ASSESSMENT', 4, 'intake', 'Carry out preliminary legal assessment of the proposed business', 3, [
        'Carry out preliminary legal assessment of the proposed business',
      ]),

      // Section 2 - Pre-Incorporation - Choosing the Company Type (5%)
      step('BR2_COMPANY_TYPE', 5, 'preincorporation', 'Advise client on the appropriate company type', 5, [
        'Advise client on the appropriate company type based on business objectives and structure',
        'Explain the available options (private, public, subsidiary, holding, limited by guarantee, unlimited)',
      ]),

      // Section 3 - Power of Attorney (POA) (7%)
      step('BR2_POA_DRAFT', 6, 'poa', 'Draft Power of Attorney authorising the firm/agent to act before the Registrar General', 2.5, [
        'Draft Power of Attorney authorising the firm/agent to act before the Registrar General',
      ]),
      step('BR2_POA_SIGN', 7, 'poa', 'Have the Power of Attorney signed by the client / authorised signatories', 1.5, [
        'Have the Power of Attorney signed by the client / authorised signatories',
      ]),
      step('BR2_POA_NOTARIZE', 8, 'poa', 'Notarize the Power of Attorney where required (e.g. foreign clients or representatives)', 2, [
        'Notarize the Power of Attorney where required (e.g. foreign clients or representatives)',
      ]),
      step('BR2_POA_RETAIN', 9, 'poa', 'Retain Power of Attorney copy for the incorporation file', 1, [
        'Retain Power of Attorney copy for the incorporation file',
      ]),

      // Section 4 - Company Name Reservation & Clearance (8%)
      step('BR2_NAME_ADVISE', 10, 'name_reservation', 'Advise client on permissible company names', 1.5, [
        'Advise client on permissible company names',
      ]),
      step('BR2_NAME_SEARCH', 11, 'name_reservation', 'Conduct name search with Registrar General', 2, [
        'Conduct name search with Registrar General',
      ]),
      step('BR2_NAME_VERIFY', 12, 'name_reservation', 'Verify name is not identical or similar to existing registered names', 3, [
        'Verify name is not identical or similar to existing registered names',
      ]),
      step('BR2_NAME_SUFFIX', 13, 'name_reservation', 'Confirm name ends with correct suffix (Ltd / PLC)', 1.5, [
        'Confirm name ends with the correct suffix (Ltd / PLC)',
      ]),

      // Section 5 - Preparation of Incorporation Documents (35%)
      step('BR2_MEMORANDUM', 14, 'documents', 'Draft Memorandum of Association', 9, [
        'Draft Memorandum of Association containing all required information',
        'Include the company name; registered office address in Rwanda; proposed business activity; whether public or private; whether liability is limited or unlimited; type of company; and any other information required by the Registrar General',
      ], {
        fee: { type: 'range', currency: 'RWF', min: 200000, max: 500000, text: 'Art. 22(1) RBA Regulation' },
        sla: { unit: 'days', min: 2, max: 5, text: 'Progress update every 2-5 days; draft within 2-5 days' },
      }),
      step('BR2_ARTICLES', 15, 'documents', 'Draft Articles of Association (Optional)', 6, [
        'Draft Articles of Association if the company chooses to have them',
        'Articles govern the internal management of the company',
        'If no articles are adopted, the default provisions under the Law apply',
      ], {
        fee: { type: 'range', currency: 'RWF', min: 150000, max: 400000, text: 'Art. 22(1) RBA Regulation' },
        sla: { unit: 'days', min: 2, max: 5, text: 'Completion within 2-5 days' },
      }),
      step('BR2_DIRECTOR_CONSENT', 16, 'documents', 'Consent of Directors & Secretary', 6, [
        'Obtain signed consent of all persons named as directors and secretary',
        'Consent form in prescribed format',
        'Signed by each named director and company secretary',
      ], {
        sla: { unit: 'hours', min: 0, max: 48, text: 'Send within 24 hrs; complete within 24-48 hrs' },
      }),
      step('BR2_SHAREHOLDER_CONSENT', 17, 'documents', 'Consent of Shareholders / Members', 6, [
        'Obtain signed consent of each shareholder or member, or their authorized agent',
        'Consent form in prescribed format',
        'Agent must have written authority to sign',
      ], {
        sla: { unit: 'hours', min: 0, max: 48, text: 'Send within 24 hrs; complete within 24-48 hrs' },
      }),
      step('BR2_BENEFICIAL_OWNERSHIP', 18, 'documents', 'Beneficial Ownership Information', 8, [
        'Collect and prepare beneficial ownership information where applicable',
        'Identify ultimate beneficial owner(s) of the company',
        'Submit details as required by the Registrar General',
      ], {
        sla: { unit: 'hours', min: 0, max: 48, text: 'Follow-up every 48 hrs; complete within 24-48 hrs' },
      }),

      // Section 6 - Filing the Application for Incorporation (25%)
      step('BR2_APPLICATION', 19, 'filing', 'Submit Application to Registrar General', 15, [
        'File all incorporation documents with the Registrar General to formally apply for company registration',
        'Documents required: incorporation documents signed by all shareholders or applicants; consent of directors and secretary; consent of shareholders/members; Memorandum of Association; Articles of Association (if applicable); beneficial ownership information',
        'Submission may be in person or via online portal (RDB)',
      ]),
      step('BR2_REGISTRAR_REVIEW', 20, 'filing', 'Registrar General Review', 10, [
        'Monitor review of the application by the Registrar General',
        'Verify that all submitted documents are complete and compliant with the Law',
        'Respond to any queries or deficiencies raised by the Registrar General',
      ], {
        sla: { unit: 'days', min: 0, max: 5, text: 'Update every 2-5 days; respond within 24 hrs' },
      }),

      // Section 7 - Issuance of Certificate of Incorporation (12%)
      step('BR2_CERTIFICATE_RECEIVE', 21, 'certificate', 'Receive Certificate of Incorporation issued by Registrar General', 2, [
        'Receive Certificate of Incorporation issued by Registrar General',
      ]),
      step('BR2_CERTIFICATE_CONTENTS', 22, 'certificate', 'Verify certificate contents (registered name, unique code, company type, date of incorporation)', 2, [
        "Certificate states the company's registered name; the company's unique registered code; the type of company incorporated; the date of incorporation",
      ]),
      step('BR2_CERTIFICATE_EVIDENCE', 23, 'certificate', 'Confirm the certificate is conclusive evidence of valid incorporation', 2, [
        'Certificate is conclusive evidence of valid incorporation',
      ]),
      step('BR2_AMENDMENT_APPLICATION', 24, 'certificate', 'Prepare application for amendment and supporting documents justifying the change', 2, [
        'Prepare application for amendment and supporting documents justifying the change',
      ]),
      step('BR2_AMENDMENT_FILING', 25, 'certificate', 'File the amendment application with Registrar General', 1.5, [
        'File the amendment application with Registrar General',
      ]),
      step('BR2_INTEREST_DECLARATION', 26, 'certificate', 'Prepare written declaration of interest', 1.5, [
        'Prepare written declaration of interest',
      ]),
      step('BR2_INTEREST_RESOLUTION', 27, 'certificate', 'Prepare board resolution addressing the conflict', 1, [
        'Prepare board resolution addressing the conflict',
      ]),
    ],
  };

  await WorkflowTemplate.updateMany(
    { name, version: { $lt: version } },
    { $set: { active: false } }
  );

  // Insert the template only when it does not exist yet. Existing records may
  // contain admin edits (key actions, percentages) and must never be
  // overwritten by a restart or deploy. Bump `version` to ship new seed content.
  return WorkflowTemplate.findOneAndUpdate(
    { name, version },
    { $setOnInsert: template },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  );
};