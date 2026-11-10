import mongoose, { Schema } from 'mongoose';

const contribution = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true }, role: { type: String, required: true },
  share: { type: Number, min: 0, max: 100, required: true },
  tpaPercent: { type: Number, min: 0, max: 100, required: true },
  tpaSource: String,
}, { _id: false });
const service = new Schema({
  caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true },
  matterNo: String, title: { type: String, required: true },
  actionKey: { type: String, required: true },
  performedOn: { type: String, required: true },
  ordinaryFee: { type: Number, min: 1, required: true },
  department: { type: String, enum: ['Dispute Resolution', 'Transaction & Advisory'], required: true },
  contributors: { type: [contribution], required: true },
  approvedBy: { type: String, required: true }, approvedAt: { type: Date, required: true },
  scopeApproval: String,
  voidedAt: Date, voidReason: String, voidedBy: String,
});
const schema = new Schema({
  retainerId: { type: Schema.Types.ObjectId, ref: 'Retainer', required: true },
  month: { type: String, required: true },
  clientName: { type: String, required: true }, retainerNo: String,
  fixedFee: { type: Number, min: 1, required: true },
  dueDate: { type: String, required: true },
  utilisationThreshold: { type: Number, default: 150 },
  status: { type: String, enum: ['Open', 'Closed'], default: 'Open' },
  services: { type: [service], default: [] },
  closedAt: Date, closedBy: String,
  history: { type: [new Schema({ action: String, reason: String, actor: String, at: Date }, { _id: false })], default: [] },
  createdBy: String,
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ retainerId: 1, month: 1 }, { unique: true });
schema.index({ 'services.caseId': 1, 'services.actionKey': 1 });
export default mongoose.model('RetainerPeriod', schema);
