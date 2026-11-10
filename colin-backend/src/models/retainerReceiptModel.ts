import mongoose, { Schema } from 'mongoose';
const schema = new Schema({
  periodId: { type: Schema.Types.ObjectId, ref: 'RetainerPeriod', required: true, index: true },
  retainerId: { type: Schema.Types.ObjectId, ref: 'Retainer', required: true, index: true },
  amount: { type: Number, min: 1, required: true },
  receivedOn: { type: String, required: true, index: true },
  reference: { type: String, required: true, trim: true },
  referenceKey: { type: String, required: true, unique: true },
  sourceInvoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  recordedBy: String,
  voidedAt: Date, voidReason: String, voidedBy: String,
}, { timestamps: true });
// An existing invoice may fund exactly one retainer month.
schema.index({ sourceInvoiceId: 1 }, { unique: true, partialFilterExpression: { sourceInvoiceId: { $type: 'objectId' } } });
export default mongoose.model('RetainerReceipt', schema);
