import mongoose, { Schema, Document } from 'mongoose';

export interface IInvoice extends Document {
  caseId: mongoose.Types.ObjectId;
  invoiceNo: string;

  year: number;
  seqYear: number; // global sequence for the year
  seqCase: number; // invoice # within the case

  date: string;
  amount: number;
  status: 'Paid' | 'Pending';

  // ✅ Proof of payment (existing)
  proofUrl?: string;

  // ✅ Invoice document file (NEW)
  invoiceFileUrl?: string;

  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceSchema = new Schema<IInvoice>(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true },

    invoiceNo: { type: String, required: true, unique: true, index: true },

    year: { type: Number, required: true, index: true },
    seqYear: { type: Number, required: true, index: true },
    seqCase: { type: Number, required: true },

    date: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['Paid', 'Pending'], default: 'Pending' },

    proofUrl: { type: String },

    // ✅ NEW field
    invoiceFileUrl: { type: String },

    notes: { type: String },
  },
  { timestamps: true }
);

InvoiceSchema.index({ year: 1, seqYear: 1 }, { unique: true });
InvoiceSchema.index({ caseId: 1, seqCase: 1 }, { unique: true });

export default mongoose.model<IInvoice>('Invoice', InvoiceSchema);