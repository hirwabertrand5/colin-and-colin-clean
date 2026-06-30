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
  estimatedFeeValue?: number;
  
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
    estimatedFeeValue: Number,
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
