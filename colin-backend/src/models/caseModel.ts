import mongoose, { Schema, Document } from 'mongoose';

export type CaseType = 'Transactional Cases' | 'Litigation Cases' | 'Labor Cases';

export interface IClientContact {
  name?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
}

export interface ILegalServicePathItem {
  id: string;
  label: string;
}

export interface ICaseReportingSettings {
  weeklyEnabled?: boolean;
  monthlyEnabled?: boolean;
  onUpdateEnabled?: boolean;
  lastGeneratedAt?: Date;
  lastSentAt?: Date;
}

export interface ICase extends Document {
  caseNo: string;
  parties: string;
  caseType: CaseType;

  status: string;
  priority: string;
  assignedTo: string;

  description?: string;
  legalServicePath?: ILegalServicePathItem[];
  workflow?: string;
  estimatedDuration?: string;
  budget?: string;

  // ✅ SOP workflow linkage
  matterType?: string;
  workflowTemplateId?: mongoose.Types.ObjectId;
  workflowInstanceId?: mongoose.Types.ObjectId;
  workflowStartDate?: Date;

  onboarding?: {
    engagementLetterSignedAt?: Date;
    conflictCheckStatus?: 'Pending' | 'Cleared' | 'Flagged';
    conflictCheckedAt?: Date;
  };

  workflowProgress?: {
    status?: 'Not Started' | 'In Progress' | 'Completed';
    currentStepKey?: string;
    currentStepTitle?: string;
    currentStepStartAt?: Date;
    currentStepDueAt?: Date;
    percent?: number;
    nextDueAt?: Date;
    plannedValue?: {
      amount?: number;
      currency?: string;
    };
    completedValue?: {
      amount?: number;
      currency?: string;
    };
  };

  billingSettings?: {
    paymentMode?: 'prepaid' | 'postpaid';
    currency?: string;
    prepaidTotal?: number;
    prepaidRemaining?: number;
    accruedUnbilled?: number;
  };

  clientContacts: IClientContact[];
  reporting?: ICaseReportingSettings;

  createdAt: Date;
  updatedAt: Date;
}

const ClientContactSchema = new Schema<IClientContact>(
  {
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false }
);

const LegalServicePathItemSchema = new Schema<ILegalServicePathItem>(
  {
    id: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const CaseSchema = new Schema<ICase>(
  {
    caseNo: { type: String, required: true, trim: true },
    parties: { type: String, required: true, trim: true },

    caseType: {
      type: String,
      enum: ['Transactional Cases', 'Litigation Cases', 'Labor Cases'],
      required: true,
      trim: true,
    },

    status: { type: String, default: 'On Boarding', trim: true },
    priority: { type: String, default: 'Medium', trim: true },

    assignedTo: { type: String, required: true, trim: true },

    description: { type: String },
    legalServicePath: { type: [LegalServicePathItemSchema], default: [] },
    workflow: { type: String },
    estimatedDuration: { type: String },
    budget: { type: String },

    // ✅ SOP linkage
    matterType: { type: String, trim: true },
    workflowTemplateId: { type: Schema.Types.ObjectId, ref: 'WorkflowTemplate' },
    workflowInstanceId: { type: Schema.Types.ObjectId, ref: 'WorkflowInstance' },
    workflowStartDate: { type: Date },

    onboarding: {
      type: {
        engagementLetterSignedAt: { type: Date },
        conflictCheckStatus: {
          type: String,
          enum: ['Pending', 'Cleared', 'Flagged'],
          default: 'Pending',
        },
        conflictCheckedAt: { type: Date },
      },
      default: {},
    },

    workflowProgress: {
      type: {
        status: {
          type: String,
          enum: ['Not Started', 'In Progress', 'Completed'],
          default: 'Not Started',
        },
        currentStepKey: { type: String },
        currentStepTitle: { type: String, trim: true },
        currentStepStartAt: { type: Date },
        currentStepDueAt: { type: Date },
        percent: { type: Number, min: 0, max: 100, default: 0 },
        nextDueAt: { type: Date },
        plannedValue: {
          type: {
            amount: { type: Number, min: 0 },
            currency: { type: String, trim: true },
          },
          default: {},
        },
        completedValue: {
          type: {
            amount: { type: Number, min: 0 },
            currency: { type: String, trim: true },
          },
          default: {},
        },
      },
      default: {},
    },

    billingSettings: {
      type: {
        paymentMode: { type: String, enum: ['prepaid', 'postpaid'], default: 'postpaid' },
        currency: { type: String, trim: true, default: 'RWF' },
        prepaidTotal: { type: Number, min: 0, default: 0 },
        prepaidRemaining: { type: Number, min: 0, default: 0 },
        accruedUnbilled: { type: Number, min: 0, default: 0 },
      },
      default: {},
    },

    clientContacts: { type: [ClientContactSchema], default: [] },

    reporting: {
      type: {
        weeklyEnabled: { type: Boolean, default: false },
        monthlyEnabled: { type: Boolean, default: true },
        onUpdateEnabled: { type: Boolean, default: true },
        lastGeneratedAt: { type: Date },
        lastSentAt: { type: Date },
      },
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.model<ICase>('Case', CaseSchema);
