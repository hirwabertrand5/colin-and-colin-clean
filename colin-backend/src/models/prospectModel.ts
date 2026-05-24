import mongoose, { Schema, Document } from 'mongoose';

export type ProspectStage = 'Inquiry' | 'Consultation' | 'Conflict Check' | 'Quotation' | 'Engagement' | 'Converted' | 'Non-Converted';

export interface IProspectContact {
  name: string;
  email: string;
  phone: string;
  position?: string;
}

export interface IProspect extends Document {
  prospectNo: string;
  clientName: string;
  
  // Contact Information
  contact: IProspectContact;
  
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
  estimatedMatterValue?: number;
  quotationAmount?: number;
  quotationDate?: Date;
  
  // Engagement
  engagementDate?: Date;
  engagementNotes?: string;
  conversionReason?: string; // For non-converted prospects
  
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
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
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
    contact: {
      type: ProspectContactSchema,
      required: true,
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
      enum: ['Inquiry', 'Consultation', 'Conflict Check', 'Quotation', 'Engagement', 'Converted', 'Non-Converted'],
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
    estimatedMatterValue: Number,
    quotationAmount: Number,
    quotationDate: Date,
    engagementDate: Date,
    engagementNotes: String,
    conversionReason: String,
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
