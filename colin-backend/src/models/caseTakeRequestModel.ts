import mongoose, { Schema, Document } from 'mongoose';

export type CaseTakeRequestStatus = 'Pending' | 'Approved' | 'Denied' | 'Cancelled' | 'Expired';

export interface ICaseTakeRequest extends Document {
  caseId: mongoose.Types.ObjectId;
  requestNo: string;

  requestedByUserId: mongoose.Types.ObjectId;
  requestedByName: string;
  requestedByRole?: string;
  requestedByEmail?: string;

  currentAssignee?: string;
  currentAssigneeUserId?: mongoose.Types.ObjectId;

  status: CaseTakeRequestStatus;
  requestedAt: Date;
  decidedAt?: Date;
  decidedByUserId?: mongoose.Types.ObjectId;
  decidedByName?: string;
  decisionReason?: string;

  requestSnapshot?: {
    caseNo?: string;
    parties?: string;
    workflowLabel?: string;
    currentStepTitle?: string;
    currentStepDueAt?: Date;
    urgencyColor?: string;
  };

  createdAt: Date;
  updatedAt: Date;
}

const CaseTakeRequestSchema = new Schema<ICaseTakeRequest>(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
    requestNo: { type: String, required: true, trim: true, unique: true, index: true },

    requestedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    requestedByName: { type: String, required: true, trim: true },
    requestedByRole: { type: String, trim: true },
    requestedByEmail: { type: String, trim: true, lowercase: true },

    currentAssignee: { type: String, trim: true },
    currentAssigneeUserId: { type: Schema.Types.ObjectId, ref: 'User' },

    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Denied', 'Cancelled', 'Expired'],
      default: 'Pending',
      index: true,
    },
    requestedAt: { type: Date, default: Date.now, index: true },
    decidedAt: { type: Date },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedByName: { type: String, trim: true },
    decisionReason: { type: String, trim: true },

    requestSnapshot: {
      type: {
        caseNo: { type: String, trim: true },
        parties: { type: String, trim: true },
        workflowLabel: { type: String, trim: true },
        currentStepTitle: { type: String, trim: true },
        currentStepDueAt: { type: Date },
        urgencyColor: { type: String, trim: true },
      },
      default: {},
    },
  },
  { timestamps: true }
);

CaseTakeRequestSchema.index({ caseId: 1, status: 1, requestedAt: -1 });
CaseTakeRequestSchema.index(
  { caseId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'Pending' },
  }
);

export default mongoose.model<ICaseTakeRequest>('CaseTakeRequest', CaseTakeRequestSchema);
