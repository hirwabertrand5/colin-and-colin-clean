import mongoose, { Schema, Document } from 'mongoose';

export interface IFeedbackTemplate extends Document {
  name: string;
  triggerType: string;
  description?: string;
  googleFormId?: string;
  googleFormUrl?: string;
  emailSubject?: string;
  emailBody?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FeedbackTemplateSchema = new Schema<IFeedbackTemplate>(
  {
    name: { type: String, required: true, trim: true, unique: true, index: true },
    triggerType: { type: String, required: true, trim: true, index: true },
    description: { type: String, trim: true },
    googleFormId: { type: String, trim: true },
    googleFormUrl: { type: String, trim: true },
    emailSubject: { type: String, trim: true },
    emailBody: { type: String, trim: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export default mongoose.model<IFeedbackTemplate>('FeedbackTemplate', FeedbackTemplateSchema);
