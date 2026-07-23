import mongoose, { Schema, Document } from 'mongoose';

export interface IRedFlag extends Document {
  clientId?: mongoose.Types.ObjectId;
  matterId?: mongoose.Types.ObjectId;
  feedbackRequestId?: mongoose.Types.ObjectId;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  reason?: string;
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  assignedPartner?: string;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolution?: string;
  updatedAt: Date;
}

const RedFlagSchema = new Schema<IRedFlag>(
  {
    clientId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    matterId: { type: Schema.Types.ObjectId, ref: 'Case', default: null, index: true },
    feedbackRequestId: { type: Schema.Types.ObjectId, ref: 'FeedbackRequest', default: null, index: true },
    severity: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium', index: true },
    reason: { type: String, trim: true },
    status: { type: String, enum: ['Open', 'In Progress', 'Resolved', 'Closed'], default: 'Open', index: true },
    assignedPartner: { type: String, trim: true },
    resolvedAt: { type: Date },
    resolvedBy: { type: String, trim: true },
    resolution: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model<IRedFlag>('RedFlag', RedFlagSchema);
