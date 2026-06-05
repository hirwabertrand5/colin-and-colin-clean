import WorkflowTemplate from '../models/workflowTemplateModel';

export const seedVehicleOwnershipTransferTemplate = async () => {
  const name = 'Vehicle Ownership Transfer';
  const version = 1;

  const template = {
    name,
    matterType: 'Vehicle Ownership Transfer',
    caseType: 'Transactional Cases',
    version,
    active: true,

    stages: [
      { key: 'initial_intake', order: 1, title: 'Initial Client Intake & Preliminary Assessment' },
      { key: 'preparation', order: 2, title: 'Preparation & Documentation' },
      { key: 'online_submission', order: 3, title: 'Online Submission' },
      { key: 'inspection', order: 4, title: 'Physical Verification & Inspection' },
      { key: 'payment_completion', order: 5, title: 'Payment & Completion of Transfer' },
      { key: 'post_transfer', order: 6, title: 'Post-Transfer Obligations & Compliance' },
    ],

    steps: [
      // Stage 1
      {
        key: 'VOT_1_CLIENT_INTAKE',
        order: 1,
        stageKey: 'initial_intake',
        title: 'First Contact & Client Identification',
        actions: [
          'Record inquiry source',
          'Identify client role (buyer or seller)',
          'Verify Rwanda phone numbers for buyer & seller',
          'Collect basic vehicle details',
          'Schedule consultation meeting',
        ],
        outputs: [
          { key: 'buyer_id', name: 'Buyer ID / Passport', required: true, category: 'Identity' },
          { key: 'seller_id', name: 'Seller ID / Passport', required: true, category: 'Identity' },
          { key: 'buyer_phone', name: 'Buyer Rwanda phone number', required: true, category: 'Contact' },
          { key: 'seller_phone', name: 'Seller Rwanda phone number', required: true, category: 'Contact' },
          { key: 'vehicle_info', name: 'Vehicle plate, make & model', required: true, category: 'Vehicle' },
        ],
        legalBasis: [{ text: 'N/A' }],
        fee: { type: 'text', text: 'Consultation fee (varies)' },
        sla: { unit: 'days', min: 0, max: 1, text: 'Same day / 24 hours' },
      },

      {
        key: 'VOT_2_OWNERSHIP_VERIFICATION',
        order: 2,
        stageKey: 'initial_intake',
        title: 'Verification of Vehicle Ownership',
        actions: [
          "Verify registered owner via RRA / registry",
          'Confirm seller matches registered owner',
          'Check encumbrances, liens and disputes',
          'Verify chassis and plate numbers against Yellow Card',
        ],
        outputs: [
          { key: 'yellow_card', name: 'Yellow Card (copy)', required: true, category: 'Vehicle' },
          { key: 'ownership_report', name: 'Ownership verification report', required: true, category: 'Due Diligence' },
        ],
        legalBasis: [{ text: 'RRA vehicle registry checks' }],
        fee: { type: 'text', text: 'Verification fee (included)' },
        sla: { unit: 'days', min: 1, max: 3, text: '1–3 days' },
      },

      {
        key: 'VOT_3_POWEROFA',
        order: 3,
        stageKey: 'initial_intake',
        title: 'Power of Attorney (If client outside Rwanda)',
        actions: ['Request notarized POA', 'Request legalization / apostille', 'Obtain certified passport copy'],
        outputs: [
          { key: 'poa_original', name: 'Original notarized POA', required: true, category: 'Compliance' },
        ],
        legalBasis: [{ text: 'Notarization & legalization requirements' }],
        fee: { type: 'text', text: 'POA handling fee' },
        sla: { unit: 'days', min: 1, max: 5, text: '1–5 days' },
      },

      // Stage 2
      {
        key: 'VOT_4_SALE_CONTRACT',
        order: 4,
        stageKey: 'preparation',
        title: 'Sale Contract & Notarization',
        actions: ['Draft sale agreement', 'Capture vehicle identifiers & sale terms', 'Obtain signatures and notarize'],
        outputs: [
          { key: 'sale_contract', name: 'Notarized sale agreement', required: true, category: 'Contract' },
        ],
        legalBasis: [{ text: 'Sale contract & notarial requirements' }],
        fee: { type: 'text', text: 'Contract drafting fee' },
        sla: { unit: 'days', min: 0, max: 2, text: 'Same day - 2 days' },
      },

      {
        key: 'VOT_5_TIN_VERIFICATION',
        order: 5,
        stageKey: 'preparation',
        title: 'TIN & Identity Documents',
        actions: ['Verify buyer TIN', 'Register buyer TIN if missing', 'Verify IDs & passport validity'],
        outputs: [
          { key: 'buyer_tin', name: 'Buyer TIN (verified)', required: true, category: 'Tax' },
        ],
        legalBasis: [{ text: 'Tax registration requirements' }],
        fee: { type: 'text', text: 'TIN verification fee' },
        sla: { unit: 'days', min: 0, max: 1, text: '24 hours' },
      },

      {
        key: 'VOT_6_VEHICLE_CLEARANCES',
        order: 6,
        stageKey: 'preparation',
        title: 'Vehicle Documents & Clearances',
        actions: ['Obtain Yellow Card', 'Verify fines clearance & tax clearance', 'Check insurance & roadworthiness'],
        outputs: [
          { key: 'traffic_clearance', name: 'Traffic fines clearance', required: true, category: 'Compliance' },
          { key: 'tax_clearance', name: 'Tax clearance certificate', required: true, category: 'Compliance' },
          { key: 'insurance_certificate', name: 'Insurance certificate', required: true, category: 'Insurance' },
          { key: 'roadworthiness', name: 'Roadworthiness certificate', required: true, category: 'Compliance' },
        ],
        legalBasis: [{ text: 'Traffic and tax clearance checks' }],
        fee: { type: 'text', text: 'Clearance verification fee' },
        sla: { unit: 'days', min: 1, max: 5, text: '1–5 days' },
      },

      // Stage 3
      {
        key: 'VOT_7_ONLINE_APPLICATION',
        order: 7,
        stageKey: 'online_submission',
        title: 'Application Initiation (Online Submission)',
        actions: ['Create / login account', 'Initiate transfer application', 'Enter vehicle & party identifiers', 'Submit application'],
        outputs: [
          { key: 'submission_ref', name: 'Submission reference / receipt', required: true, category: 'Submission' },
        ],
        legalBasis: [{ text: 'RRA / online portal submission' }],
        fee: { type: 'text', text: 'Portal submission fee (if any)' },
        sla: { unit: 'hours', min: 1, max: 24, text: 'Up to 24 hours' },
      },

      {
        key: 'VOT_8_DOCUMENT_UPLOAD',
        order: 8,
        stageKey: 'online_submission',
        title: 'Document Upload',
        actions: ['Upload notarized contract', 'Upload IDs, Yellow Card, Insurance, Tax & Fine clearances'],
        outputs: [
          { key: 'uploaded_contract', name: 'Notarized contract upload', required: true, category: 'Contract' },
          { key: 'uploaded_yellow_card', name: 'Yellow Card (upload)', required: true, category: 'Vehicle' },
        ],
        legalBasis: [{ text: 'Document submission requirements' }],
        fee: { type: 'text', text: 'Document handling' },
        sla: { unit: 'hours', min: 1, max: 24, text: '24 hours' },
      },

      // Stage 4
      {
        key: 'VOT_9_INSPECTION_SCHEDULING',
        order: 9,
        stageKey: 'inspection',
        title: 'Inspection Appointment',
        actions: ['Receive inspection appointment', 'Notify buyer & seller of date/time/location'],
        outputs: [
          { key: 'inspection_appointment', name: 'Confirmed inspection appointment', required: true, category: 'Logistics' },
        ],
        legalBasis: [{ text: 'Inspection scheduling' }],
        fee: { type: 'text', text: 'Inspection scheduling fee' },
        sla: { unit: 'days', min: 0, max: 3, text: 'Within 3 days' },
      },

      {
        key: 'VOT_10_VEHICLE_INSPECTION',
        order: 10,
        stageKey: 'inspection',
        title: 'Physical Vehicle Inspection',
        actions: ['Verify chassis, VIN & engine numbers', 'Inspect vehicle condition', 'Compare with registration records'],
        outputs: [
          { key: 'inspection_report', name: 'Inspection report & clearance certificate', required: true, category: 'Inspection' },
        ],
        legalBasis: [{ text: 'Physical inspection records' }],
        fee: { type: 'text', text: 'Inspection fee' },
        sla: { unit: 'days', min: 0, max: 2, text: 'Same day - 2 days' },
      },

      // Stage 5
      {
        key: 'VOT_11_TRANSFER_PAYMENT',
        order: 11,
        stageKey: 'payment_completion',
        title: 'Transfer Fee Payment',
        actions: ['Generate invoice', 'Accept payment', 'Store receipt', 'Verify payment status'],
        outputs: [
          { key: 'payment_receipt', name: 'Payment receipt', required: true, category: 'Payment' },
        ],
        legalBasis: [{ text: 'Payment & receipt handling' }],
        fee: { type: 'text', text: 'Vehicle: 60000 RWF; Motorcycle: 30000 RWF' },
        sla: { unit: 'days', min: 0, max: 7, text: 'Up to 7 days' },
      },

      {
        key: 'VOT_12_OWNERSHIP_TRANSFER_APPROVAL',
        order: 12,
        stageKey: 'payment_completion',
        title: 'Ownership Transfer Approval & Registry Update',
        actions: ['Process ownership change', 'Update vehicle registry', 'Generate new Yellow Card', 'Invalidate old ownership record'],
        outputs: [
          { key: 'transfer_approval', name: 'Transfer approval notice', required: true, category: 'Registry' },
          { key: 'new_yellow_card', name: 'New Yellow Card (issued)', required: false, category: 'Registry' },
        ],
        legalBasis: [{ text: 'Registry update & issuance' }],
        fee: { type: 'text', text: 'Registry processing fee' },
        sla: { unit: 'days', min: 0, max: 7, text: 'Up to 7 days' },
      },

      // Stage 6
      {
        key: 'VOT_13_INSURANCE_UPDATE',
        order: 13,
        stageKey: 'post_transfer',
        title: 'Insurance Update & Road Tax',
        actions: ['Update insurance ownership', 'Verify road tax & roadworthiness'],
        outputs: [
          { key: 'insurance_updated', name: 'Insurance records updated', required: true, category: 'Insurance' },
          { key: 'road_tax_clearance', name: 'Road tax clearance', required: true, category: 'Tax' },
        ],
        legalBasis: [{ text: 'Insurance and tax update' }],
        fee: { type: 'text', text: 'Insurance update / tax handling fee' },
        sla: { unit: 'days', min: 0, max: 7, text: 'Up to 7 days' },
      },

      {
        key: 'VOT_14_NUMBER_PLATE',
        order: 14,
        stageKey: 'post_transfer',
        title: 'Number Plate Retention / Change',
        actions: ['Retain existing plates by default', 'Process new plate request if requested', 'Collect additional fee if requested'],
        outputs: [
          { key: 'plate_decision', name: 'Plate retained or new plate issued', required: true, category: 'Registry' },
        ],
        legalBasis: [{ text: 'Plate management rules' }],
        fee: { type: 'text', text: 'Optional plate fee: 10000–20000 RWF' },
        sla: { unit: 'days', min: 0, max: 7, text: 'Up to 7 days' },
      },

      {
        key: 'VOT_15_DISPUTE_RESOLUTION',
        order: 15,
        stageKey: 'post_transfer',
        title: 'Dispute Resolution & Error Correction',
        actions: ['Capture rejection reason', 'Correct issues & resubmit', 'Escalate legal disputes where required'],
        outputs: [
          { key: 'dispute_reference', name: 'Dispute / complaint reference', required: false, category: 'Dispute' },
        ],
        legalBasis: [{ text: 'Dispute logging & escalation' }],
        fee: { type: 'text', text: 'Dispute handling fee (varies)' },
        sla: { unit: 'days', min: 1, max: 14, text: '1–14 days' },
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
