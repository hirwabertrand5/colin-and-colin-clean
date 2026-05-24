import mongoose, { Schema, Document } from 'mongoose';
import type { ICase } from './caseModel';

export interface IPettyCashExpense extends Document {
  fundId: mongoose.Types.ObjectId;

  date: string; // YYYY-MM-DD (consistent with your app)
  title: string;
  category?: string;
  vendor?: string;

  chargeType?: 'internal' | 'client';
  caseId?: mongoose.Types.ObjectId | ICase;
  caseNoSnapshot?: string;
  partiesSnapshot?: string;

  amount: number;
  note?: string;

  receiptRef?: string;
  receiptUrl?: string; // optional single upload (deprecated, kept for compatibility)
  receiptUrls?: string[]; // multiple receipt uploads

  refundAmount?: number;
  refundedBy?: string;
  refundDate?: string; // YYYY-MM-DD
  refundNote?: string;

  createdByUserId?: mongoose.Types.ObjectId;
  createdByName: string;

  createdAt: Date;
  updatedAt: Date;
}

const PettyCashExpenseSchema = new Schema<IPettyCashExpense>(
  {
    fundId: { type: Schema.Types.ObjectId, ref: 'PettyCashFund', required: true, index: true },

    date: { type: String, required: true },
    title: { type: String, required: true, trim: true },

    category: { type: String },
    vendor: { type: String },

    chargeType: { type: String, enum: ['internal', 'client'], default: 'internal' },
    caseId: { type: Schema.Types.ObjectId, ref: 'Case' },
    caseNoSnapshot: { type: String, trim: true },
    partiesSnapshot: { type: String, trim: true },

    amount: { type: Number, required: true, min: 0.01 },
    note: { type: String },

    receiptRef: { type: String, trim: true },
    receiptUrl: { type: String }, // deprecated
    receiptUrls: [{ type: String }], // multiple receipts

    refundAmount: { type: Number, min: 0 },
    refundedBy: { type: String, trim: true },
    refundDate: { type: String },
    refundNote: { type: String, trim: true },

    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, required: true },
  },
  { timestamps: true }
);

PettyCashExpenseSchema.index({ fundId: 1, date: -1, createdAt: -1 });
PettyCashExpenseSchema.index({ chargeType: 1, caseId: 1, date: -1 });

export default mongoose.model<IPettyCashExpense>('PettyCashExpense', PettyCashExpenseSchema);
