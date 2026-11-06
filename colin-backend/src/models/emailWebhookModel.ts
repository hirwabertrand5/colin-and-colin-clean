import mongoose, { Schema } from 'mongoose';
const schema = new Schema({
  eventId: { type: String, unique: true, required: true },
  providerId: { type: String, index: true, required: true },
  status: { type: String, required: true },
  occurredAt: { type: Date, required: true },
  applied: { type: Boolean, default: false, index: true },
}, { timestamps: true });
export default mongoose.model('EmailWebhook', schema);
