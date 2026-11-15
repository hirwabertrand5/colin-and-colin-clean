import mongoose, { Schema } from 'mongoose';

// One durable record per email and recipient; a reminder email can cover several
// notifications. Sent records are retained as the long-term send ledger.
const EmailDeliverySchema = new Schema({
  key: { type: String, required: true, unique: true },
  notificationId: { type: Schema.Types.ObjectId, ref: 'Notification', index: true },
  notificationIds: { type: [Schema.Types.ObjectId], ref: 'Notification', default: undefined },
  preparedNotificationIds: { type: [Schema.Types.ObjectId], ref: 'Notification', default: undefined },
  reminderGroup: { caseId: { type: Schema.Types.ObjectId, ref: 'Case' }, deadlineAt: String, batch: String },
  intakeLinkId: { type: Schema.Types.ObjectId, ref: 'ClientIntakeLink', index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  to: { type: String, required: true },
  category: { type: String, required: true },
  subject: { type: String, required: true },
  html: { type: String, required: true },
  status: { type: String, enum: ['pending', 'processing', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'suppressed'], required: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  firstAttemptAt: Date,
  leaseUntil: Date,
  claimId: String,
  providerId: { type: String, index: true },
  lastError: String,
  lastCode: String,
  providerEventAt: Date,
}, { timestamps: true });
EmailDeliverySchema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
export default mongoose.model('EmailDelivery', EmailDeliverySchema);
