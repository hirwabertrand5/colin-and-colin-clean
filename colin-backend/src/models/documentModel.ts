import mongoose, { Schema, Document } from 'mongoose';

export interface ICaseDocument extends Document {
  caseId: mongoose.Types.ObjectId;
  name: string;
  category?: string;

  // ✅ workflow linkage (optional)
  workflowInstanceId?: mongoose.Types.ObjectId;
  stepKey?: string;
  outputKey?: string;

  uploadedBy: string;
  uploadedDate: string;
  size: string;
  url: string;
}

const DocumentSchema = new Schema<ICaseDocument>(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true },
    name: { type: String, required: true },

    category: { type: String, required: false },

    workflowInstanceId: { type: Schema.Types.ObjectId, ref: 'WorkflowInstance', required: false },
    stepKey: { type: String, required: false },
    outputKey: { type: String, required: false },

    uploadedBy: { type: String, required: true },
    uploadedDate: { type: String, required: true },
    size: { type: String, required: true },
    url: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model<ICaseDocument>('Document', DocumentSchema);