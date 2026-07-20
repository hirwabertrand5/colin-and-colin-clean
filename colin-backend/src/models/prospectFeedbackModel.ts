import mongoose, { Schema, Document } from 'mongoose';

export type ProspectFeedbackReasonCategory = 'Commercial' | 'Matter' | 'Service Experience' | 'Other';
export type ProspectFeedbackCompletedByRole = 'Executive Administrator' | 'Responsible Associate' | 'Responsible Partner';
export type ProspectFeedbackApprovalStatus = 'Pending' | 'Approved';

export interface IProspectFeedback extends Document {
  prospectId: mongoose.Types.ObjectId;
  primaryReasonCategory?: ProspectFeedbackReasonCategory;
  primaryReasonDetail?: string;
  clientComment?: string;
  completedByRole?: ProspectFeedbackCompletedByRole;
  internalCategory?: string;
  wasAvoidable?: boolean;
  estimatedConversionProbability?: string;
  firmImprovementNotes?: string;
  partnerApprovalStatus?: ProspectFeedbackApprovalStatus;
  feedbackEmailSentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ProspectFeedbackSchema = new Schema<IProspectFeedback>(
  {
    prospectId: {
      type: Schema.Types.ObjectId,
      ref: 'Prospect',
      required: true,
      unique: true,
      index: true,
    },
    primaryReasonCategory: {
      type: String,
      enum: ['Commercial', 'Matter', 'Service Experience', 'Other'],
      trim: true,
    },
    primaryReasonDetail: {
      type: String,
      trim: true,
    },
    clientComment: {
      type: String,
      trim: true,
    },
    completedByRole: {
      type: String,
      enum: ['Executive Administrator', 'Responsible Associate', 'Responsible Partner'],
      trim: true,
    },
    internalCategory: {
      type: String,
      trim: true,
    },
    wasAvoidable: {
      type: Boolean,
      default: undefined,
    },
    estimatedConversionProbability: {
      type: String,
      trim: true,
    },
    firmImprovementNotes: {
      type: String,
      trim: true,
    },
    partnerApprovalStatus: {
      type: String,
      enum: ['Pending', 'Approved'],
      default: 'Pending',
      trim: true,
    },
    feedbackEmailSentAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IProspectFeedback>('ProspectFeedback', ProspectFeedbackSchema);
