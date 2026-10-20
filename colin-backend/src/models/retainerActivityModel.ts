import mongoose, { Document, Schema } from 'mongoose';

export type RetainerActivityType =
  | 'CONTRACT_VALUE_SET'
  | 'CONTRACT_VALUE_ADJUSTED'
  | 'CASE_LINKED'
  | 'CASE_UNLINKED'
  // Legacy values remain readable so historical activity is never lost.
  | 'OPENING_BALANCE'
  | 'TOP_UP'
  | 'CASE_RESERVED'
  | 'CASE_RELEASED'
  | 'ADJUSTMENT';

export interface IRetainerActivity extends Document {
  retainerId: mongoose.Types.ObjectId;
  caseId?: mongoose.Types.ObjectId;
  type: RetainerActivityType;
  amount: number;
  balanceAfter: number;
  note?: string;
  createdBy?: string;
  createdByUserId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const RetainerActivitySchema = new Schema<IRetainerActivity>(
  {
    retainerId: { type: Schema.Types.ObjectId, ref: 'Retainer', required: true, index: true },
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', index: true },
    type: {
      type: String,
      enum: ['CONTRACT_VALUE_SET', 'CONTRACT_VALUE_ADJUSTED', 'CASE_LINKED', 'CASE_UNLINKED', 'OPENING_BALANCE', 'TOP_UP', 'CASE_RESERVED', 'CASE_RELEASED', 'ADJUSTMENT'],
      required: true,
    },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true },
    createdBy: { type: String, trim: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

RetainerActivitySchema.index({ retainerId: 1, createdAt: -1 });

export default mongoose.model<IRetainerActivity>('RetainerActivity', RetainerActivitySchema);
