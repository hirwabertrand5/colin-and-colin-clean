import mongoose, { Document, Schema } from 'mongoose';

export type RetainerBillingModel = 'prepaid' | 'monthly' | 'hybrid';
export type RetainerStatus = 'Draft' | 'Active' | 'Paused' | 'Closed';

export interface IRetainer extends Document {
  retainerNo: string;
  name: string;
  clientName: string;
  billingModel: RetainerBillingModel;
  status: RetainerStatus;
  currency: 'RWF';
  startDate: string;
  endDate?: string;
  renewalDate?: string;
  billingDay?: number;
  monthlyFee?: number;
  /** The agreed value of the subscription contract, in RWF. */
  contractValue: number;
  /** @deprecated Kept only to preserve data created before contractValue existed. */
  totalFunded: number;
  availableBalance: number;
  /** @deprecated Retainer subscriptions are shared and no longer reserve amounts per case. */
  reservedAmount: number;
  scope?: string;
  responsiblePartner?: string;
  notes?: string;
  createdBy?: string;
  createdByUserId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RetainerSchema = new Schema<IRetainer>(
  {
    retainerNo: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    clientName: { type: String, required: true, trim: true, index: true },
    billingModel: { type: String, enum: ['prepaid', 'monthly', 'hybrid'], required: true },
    status: { type: String, enum: ['Draft', 'Active', 'Paused', 'Closed'], default: 'Draft', index: true },
    currency: { type: String, enum: ['RWF'], default: 'RWF', required: true },
    startDate: { type: String, required: true },
    endDate: { type: String },
    renewalDate: { type: String },
    billingDay: { type: Number, min: 1, max: 28 },
    monthlyFee: { type: Number, min: 0, default: 0 },
    contractValue: { type: Number, min: 0, default: 0 },
    totalFunded: { type: Number, min: 0, default: 0 },
    availableBalance: { type: Number, min: 0, default: 0 },
    reservedAmount: { type: Number, min: 0, default: 0 },
    scope: { type: String, trim: true },
    responsiblePartner: { type: String, trim: true },
    notes: { type: String, trim: true },
    createdBy: { type: String, trim: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

RetainerSchema.index({ clientName: 1, status: 1, startDate: -1 });
RetainerSchema.index({ status: 1, endDate: 1 });

export default mongoose.model<IRetainer>('Retainer', RetainerSchema);
