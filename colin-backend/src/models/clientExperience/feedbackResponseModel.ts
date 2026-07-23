import mongoose, { Schema, Document } from 'mongoose';
import type { FeedbackResponseSource } from './feedbackRequestModel';

export interface IFeedbackResponse extends Document {
  feedbackRequestId: mongoose.Types.ObjectId;
  submittedAt?: Date;
  overallRating?: number;
  wouldRecommend?: boolean;
  wouldInstructAgain?: boolean;
  comments?: string;
  rawResponse?: string;
  responseSource?: FeedbackResponseSource;
  createdAt: Date;
  updatedAt: Date;
}

const FeedbackResponseSchema = new Schema<IFeedbackResponse>(
  {
    feedbackRequestId: { type: Schema.Types.ObjectId, ref: 'FeedbackRequest', required: true, unique: true, index: true },
    submittedAt: { type: Date },
    overallRating: { type: Number },
    wouldRecommend: { type: Boolean },
    wouldInstructAgain: { type: Boolean },
    comments: { type: String, trim: true },
    rawResponse: { type: String },
    responseSource: { type: String, enum: ['Google Forms', 'Future Native Survey', 'API'], default: 'API', trim: true },
  },
  { timestamps: true }
);

export default mongoose.model<IFeedbackResponse>('FeedbackResponse', FeedbackResponseSchema);
