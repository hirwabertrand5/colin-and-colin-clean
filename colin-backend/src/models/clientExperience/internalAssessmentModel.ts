import mongoose, { Schema, Document } from 'mongoose';

export interface IInternalAssessment extends Document {
  feedbackRequestId: mongoose.Types.ObjectId;
  completedBy?: string;
  role?: string;
  category?: string;
  wasLossAvoidable?: boolean;
  estimatedConversionProbability?: string;
  improvementRecommendations?: string;
  partnerApprovalStatus: 'Pending' | 'Approved' | 'Rejected';
  approvedBy?: string;
  approvedAt?: Date;
  comments?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InternalAssessmentSchema = new Schema<IInternalAssessment>(
  {
    feedbackRequestId: { type: Schema.Types.ObjectId, ref: 'FeedbackRequest', required: true, unique: true, index: true },
    completedBy: { type: String, trim: true },
    role: { type: String, trim: true },
    category: { type: String, trim: true },
    wasLossAvoidable: { type: Boolean },
    estimatedConversionProbability: { type: String, trim: true },
    improvementRecommendations: { type: String, trim: true },
    partnerApprovalStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending', index: true },
    approvedBy: { type: String, trim: true },
    approvedAt: { type: Date },
    comments: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model<IInternalAssessment>('InternalAssessment', InternalAssessmentSchema);
