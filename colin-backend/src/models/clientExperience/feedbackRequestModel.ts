import mongoose, { Schema, Document } from 'mongoose';

export type FeedbackRequestStatus = 'Draft' | 'Pending' | 'Sending' | 'Sent' | 'Opened' | 'Completed' | 'Closed' | 'Expired' | 'Cancelled' | 'Email Failed';
export type FeedbackResponseSource = 'Google Forms' | 'Future Native Survey' | 'API';

export interface IFeedbackRequest extends Document {
  requestNumber: string;
  clientId?: mongoose.Types.ObjectId;
  clientType?: 'prospect' | 'matter' | 'client';
  prospectId?: mongoose.Types.ObjectId;
  matterId?: mongoose.Types.ObjectId;
  templateId?: mongoose.Types.ObjectId;
  feedbackType: string;
  clientEmail?: string;
  googleFormUrl?: string;
  uniqueToken?: string;
  status: FeedbackRequestStatus;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  sentAt?: Date;
  openedAt?: Date;
  completedAt?: Date;
  expiresAt?: Date;
  resendCount?: number;
  lastResentAt?: Date;
  reminderState?: 'No Reminder' | 'First Reminder' | 'Second Reminder' | 'Final Reminder';
  reminderSentAt?: Date;
  updatedAt: Date;
}

const FeedbackRequestSchema = new Schema<IFeedbackRequest>(
  {
    requestNumber: { type: String, required: true, trim: true, unique: true, index: true },
    clientId: { type: Schema.Types.ObjectId, default: null, index: true },
    clientType: { type: String, enum: ['prospect', 'matter', 'client'], default: 'prospect', trim: true },
    prospectId: { type: Schema.Types.ObjectId, ref: 'Prospect', default: null, index: true },
    matterId: { type: Schema.Types.ObjectId, ref: 'Case', default: null, index: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'FeedbackTemplate', default: null, index: true },
    feedbackType: { type: String, required: true, trim: true, index: true },
    clientEmail: { type: String, trim: true, lowercase: true },
    googleFormUrl: { type: String, trim: true },
    uniqueToken: { type: String, trim: true, index: true },
    status: { type: String, enum: ['Draft', 'Pending', 'Sending', 'Sent', 'Opened', 'Completed', 'Closed', 'Expired', 'Cancelled', 'Email Failed'], default: 'Draft', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    sentAt: { type: Date },
    openedAt: { type: Date },
    completedAt: { type: Date },
    expiresAt: { type: Date },
    resendCount: { type: Number, default: 0 },
    lastResentAt: { type: Date },
    reminderState: { type: String, enum: ['No Reminder', 'First Reminder', 'Second Reminder', 'Final Reminder'], default: 'No Reminder' },
    reminderSentAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model<IFeedbackRequest>('FeedbackRequest', FeedbackRequestSchema);
