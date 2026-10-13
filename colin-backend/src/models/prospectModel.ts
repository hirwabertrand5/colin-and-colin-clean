import mongoose, { Schema, Document } from 'mongoose';

export type ProspectStage =
  | 'Inquiry'
  | 'Consultation'
  | 'Conflict Check'
  | 'Quotation'
  | 'Quotation Preparation'
  | 'Conversion Assessment'
  | 'Quotation Issued'
  | 'Awaiting Client Decision'
  | 'Final Follow-Up'
  | 'Engagement'
  | 'Converted'
  | 'Non-Converted';

export interface IProspectContact {
  name: string;
  email?: string;
  phone?: string;
  position?: string;
}

export interface IProspect extends Document {
  prospectNo: string;
  clientName: string;
  parties?: string;
  enquiryNature?: string;
  priorityLevel?: 'High' | 'Medium' | 'Low';
  enquirySource?: string;
  referralSource?: string;
  estimatedMatterValue?: number;
  estimatedMatterCurrency?: 'RWF';
  estimatedFeeValue?: number;
  completedStages?: ProspectStage[];
  practiceArea?: 'Converted' | 'Non Converted';
  subPracticeActions?: string[];
  paymentArrangement?: 'Full Payment' | 'Installments' | 'Quotation Accepted' | 'Agreed Billing Date Reached' | 'Legal Opinion Delivered' | 'Matter Milestone Completed' | 'Matter Completed' | 'Monthly Retainer Due';
  paymentMethod?: 'Bank Transfer' | 'Cash' | 'Mobile Money' | 'Cheque' | 'Card' | 'Mixed';
  installmentCount?: number;
  depositAmount?: number;
  
  // Contact Information
  contact: IProspectContact;
  responsiblePartner?: mongoose.Types.ObjectId;
  responsibleAssociate?: mongoose.Types.ObjectId;
  
  // Legal Service Category
  legalServicePath?: {
    id: string;
    label: string;
  }[];
  
  // Prospect Tracking
  inquiryDescription: string;
  dateReceived: Date;
  stage: ProspectStage;
  
  // Assessment
  conflictCheckStatus?: 'Pending' | 'Cleared' | 'Flagged';
  conflictCheckDate?: Date;
  conflictCheckNotes?: string;
  
  // Quotation
  quotationAmount?: number;
  quotationDate?: Date;
  
  // Engagement
  engagementDate?: Date;
  engagementNotes?: string;
  conversionReason?: string; // For non-converted prospects
  conversionOutcome?: string;

  // ── Workflow-control layer (onboarding document) ──────────────────────────
  // The prospect's active stage carries its own status, timing, ownership and
  // follow-up controls so it can be monitored from first enquiry through
  // conversion/closure, mirroring the Case Workspace overview.
  stageStatus?: 'Not Started' | 'In Progress' | 'Completed' | 'Blocked';
  stageStartedAt?: Date;      // When the current stage began (drives the due date)
  stageDueAt?: Date;          // Auto-calculated = stageStartedAt + stage SLA
  stageCompletedAt?: Date;    // When the current stage was completed
  stageCompletedBy?: string;  // Who completed the current stage
  delayReason?: string;       // Mandatory where an SLA is missed
  waitingOn?: 'Firm' | 'Client' | 'Third Party' | 'None';
  outstandingRequirement?: string; // What is still needed to clear the stage-gate
  // Per-stage mandatory checklist ticks (Key Actions) for the current stage.
  stageChecklist?: Array<{
    key: string;
    label: string;
    done: boolean;
    doneBy?: string;
    doneAt?: Date;
  }>;
  // Follow-up control (client / third-party dependent next action).
  lastContactDate?: Date;
  lastFollowUpDate?: Date;
  nextFollowUpDate?: Date;
  followUpCount?: number;
  followUpStatus?: string;
  escalationRequiredAt?: Date;
  clientResponseReceived?: boolean;
  followUpOutcome?: string;
  // Immutable stage-history audit trail (each transition appends an entry).
  stageHistory?: Array<{
    stage: string;
    status: string;
    startedAt?: Date;
    completedAt?: Date;
    completedBy?: string;
    dueAt?: Date;
    delayReason?: string;
    waitingOn?: string;
    outstandingRequirement?: string;
    recordedAt: Date;
  }>;
  // Legal Opinion / Diagnostic as a billable mini-matter (optional sub-service).
  legalOpinion?: {
    referenceNo?: string;
    scope?: string;
    fee?: number;
    paymentStatus?: 'Unpaid' | 'Part Paid' | 'Paid';
    outcome?: string;
    openedAt?: Date;
    completedAt?: Date;
    closedAt?: Date;
  };
  
  // Assignment & Management
  assignedTo: mongoose.Types.ObjectId; // User ID
  createdBy: mongoose.Types.ObjectId; // User ID
  
  // Status flags
  isActive: boolean;
  convertedToMatters?: mongoose.Types.ObjectId; // Reference to Case if converted
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

const ProspectContactSchema = new Schema<IProspectContact>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    position: { type: String, trim: true },
  },
  { _id: false }
);

const ProspectSchema = new Schema<IProspect>(
  {
    prospectNo: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    clientName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    parties: {
      type: String,
      trim: true,
      default: '',
    },
    enquiryNature: {
      type: String,
      trim: true,
    },
    priorityLevel: {
      type: String,
      enum: ['High', 'Medium', 'Low'],
      default: 'Medium',
      trim: true,
    },
    enquirySource: {
      type: String,
      trim: true,
    },
    referralSource: {
      type: String,
      trim: true,
    },
    estimatedMatterValue: Number,
    estimatedMatterCurrency: {
      type: String,
      enum: ['RWF'],
      default: 'RWF',
      trim: true,
    },
    estimatedFeeValue: Number,
    completedStages: {
      type: [String],
      default: [],
    },
    practiceArea: {
      type: String,
      enum: ['Converted', 'Non Converted'],
      trim: true,
    },
    subPracticeActions: {
      type: [String],
      default: [],
    },
    paymentArrangement: {
      type: String,
      enum: [
        'Full Payment',
        'Installments',
        'Quotation Accepted',
        'Agreed Billing Date Reached',
        'Legal Opinion Delivered',
        'Matter Milestone Completed',
        'Matter Completed',
        'Monthly Retainer Due',
      ],
      trim: true,
    },
    paymentMethod: {
      type: String,
      enum: ['Bank Transfer', 'Cash', 'Mobile Money', 'Cheque', 'Card', 'Mixed'],
      trim: true,
    },
    installmentCount: Number,
    depositAmount: Number,
    contact: {
      type: ProspectContactSchema,
      required: true,
    },
    responsiblePartner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    responsibleAssociate: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    legalServicePath: [
      {
        id: { type: String, required: true, trim: true },
        label: { type: String, required: true, trim: true },
      },
    ],
    inquiryDescription: {
      type: String,
      required: true,
      trim: true,
    },
    dateReceived: {
      type: Date,
      required: true,
      default: Date.now,
    },
    stage: {
      type: String,
      enum: [
        'Inquiry',
        'Consultation',
        'Conflict Check',
        'Quotation',
        'Quotation Preparation',
        'Conversion Assessment',
        'Quotation Issued',
        'Awaiting Client Decision',
        'Final Follow-Up',
        'Engagement',
        'Converted',
        'Non-Converted',
      ],
      default: 'Inquiry',
      index: true,
    },
    conflictCheckStatus: {
      type: String,
      enum: ['Pending', 'Cleared', 'Flagged'],
      default: 'Pending',
    },
    conflictCheckDate: Date,
    conflictCheckNotes: String,
    quotationAmount: Number,
    quotationDate: Date,
    engagementDate: Date,
    engagementNotes: String,
    conversionReason: String,
    conversionOutcome: {
      type: String,
      trim: true,
    },
    // ── Workflow-control layer (onboarding document) ──────────────────────────
    stageStatus: {
      type: String,
      enum: ['Not Started', 'In Progress', 'Completed', 'Blocked'],
    },
    stageStartedAt: Date,
    stageDueAt: Date,
    stageCompletedAt: Date,
    stageCompletedBy: String,
    delayReason: String,
    waitingOn: {
      type: String,
      enum: ['Firm', 'Client', 'Third Party', 'None'],
    },
    outstandingRequirement: String,
    stageChecklist: {
      type: [
        {
          key: { type: String, required: true, trim: true },
          label: { type: String, required: true, trim: true },
          done: { type: Boolean, default: false },
          doneBy: String,
          doneAt: Date,
        },
      ],
      default: [],
    },
    lastContactDate: Date,
    lastFollowUpDate: Date,
    nextFollowUpDate: Date,
    followUpCount: { type: Number, default: 0 },
    followUpStatus: String,
    escalationRequiredAt: Date,
    clientResponseReceived: { type: Boolean, default: false },
    followUpOutcome: String,
    stageHistory: {
      type: [
        {
          stage: { type: String, required: true, trim: true },
          status: { type: String, trim: true },
          startedAt: Date,
          completedAt: Date,
          completedBy: String,
          dueAt: Date,
          delayReason: String,
          waitingOn: String,
          outstandingRequirement: String,
          recordedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    legalOpinion: {
      referenceNo: String,
      scope: String,
      fee: Number,
      paymentStatus: {
        type: String,
        enum: ['Unpaid', 'Part Paid', 'Paid'],
      },
      outcome: String,
      openedAt: Date,
      completedAt: Date,
      closedAt: Date,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    convertedToMatters: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Case',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for common queries
ProspectSchema.index({ stage: 1, isActive: 1 });
ProspectSchema.index({ assignedTo: 1, isActive: 1 });
ProspectSchema.index({ dateReceived: -1 });

export default mongoose.model<IProspect>('Prospect', ProspectSchema);
