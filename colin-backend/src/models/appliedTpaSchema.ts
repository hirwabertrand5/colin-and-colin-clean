import { Schema } from 'mongoose';

export const AppliedTpaSchema = new Schema({
  staffKey: { type: String, required: true },
  staffName: { type: String, required: true },
  assignmentRole: { type: String, required: true },
  activityAt: { type: Date, required: true },
  rate: { type: Number, required: true, min: 0, max: 100 },
  recordedAt: { type: Date, required: true },
}, { _id: false });
