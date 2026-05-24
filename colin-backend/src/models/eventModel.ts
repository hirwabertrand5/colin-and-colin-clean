import mongoose, { Schema, Document } from 'mongoose';

export interface IEvent extends Document {
  caseId: mongoose.Types.ObjectId; // <-- not string
  title: string;
  type: string;
  date: string;
  time: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EventSchema = new Schema<IEvent>(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true },
    title: { type: String, required: true },
    type: { type: String, default: 'Deadline' },
    date: { type: String, required: true },
    time: { type: String, required: true },
    description: String,
  },
  { timestamps: true }
);

export default mongoose.model<IEvent>('Event', EventSchema);