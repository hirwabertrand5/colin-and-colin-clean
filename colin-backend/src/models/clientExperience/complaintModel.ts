import mongoose, { Schema, Document } from 'mongoose';

export interface IComplaint extends Document {
  clientId?: mongoose.Types.ObjectId;
  matterId?: mongoose.Types.ObjectId;
  category?: string;
  description?: string;
  priority?: string;
  status?: string;
  assignedTo?: string;
  resolution?: string;
  createdAt: Date;
  closedAt?: Date;
  updatedAt: Date;
}

const ComplaintSchema = new Schema<IComplaint>(
  {
    clientId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    matterId: { type: Schema.Types.ObjectId, ref: 'Case', default: null, index: true },
    category: { type: String, trim: true },
    description: { type: String, trim: true },
    priority: { type: String, trim: true },
    status: { type: String, trim: true, default: 'Open', index: true },
    assignedTo: { type: String, trim: true },
    resolution: { type: String, trim: true },
    closedAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model<IComplaint>('Complaint', ComplaintSchema);
