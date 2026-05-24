import mongoose, { Schema, Document } from 'mongoose';

export type ClientReportStatus = 'Draft' | 'Sent' | 'Failed';
export type ClientReportTrigger = 'manual' | 'weekly' | 'monthly' | 'update';

export interface IClientReportRecipient {
  name?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
}

export interface IClientReport extends Document {
  caseId: mongoose.Types.ObjectId;

  trigger: ClientReportTrigger;
  status: ClientReportStatus;

  periodStart: Date;
  periodEnd: Date;

  subject: string;
  recipients: IClientReportRecipient[];

  contentHtml: string;

  generatedBy?: string;
  generatedByUserId?: mongoose.Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const RecipientSchema = new Schema<IClientReportRecipient>(
  {
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false }
);

const ClientReportSchema = new Schema<IClientReport>(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true, index: true },

    trigger: { type: String, enum: ['manual', 'weekly', 'monthly', 'update'], default: 'manual' },
    status: { type: String, enum: ['Draft', 'Sent', 'Failed'], default: 'Draft', index: true },

    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    subject: { type: String, required: true, trim: true },
    recipients: { type: [RecipientSchema], default: [] },

    contentHtml: { type: String, required: true },

    generatedBy: { type: String, trim: true },
    generatedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default mongoose.model<IClientReport>('ClientReport', ClientReportSchema);