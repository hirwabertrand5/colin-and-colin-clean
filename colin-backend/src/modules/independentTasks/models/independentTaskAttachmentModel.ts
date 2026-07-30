import mongoose, { Schema, Document } from 'mongoose';

export interface IIndependentTaskAttachment extends Document {
  taskId: mongoose.Types.ObjectId;
  fileName: string;
  originalName: string;
  fileSize: string;
  uploadedBy: string;
  uploadedByUserId?: mongoose.Types.ObjectId;
  uploadedDate: string;
  url: string;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const IndependentTaskAttachmentSchema = new Schema<IIndependentTaskAttachment>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'IndependentTask', required: true, index: true },
    fileName: { type: String, required: true, trim: true },
    originalName: { type: String, required: true, trim: true },
    fileSize: { type: String, required: true },
    uploadedBy: { type: String, required: true, trim: true },
    uploadedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    uploadedDate: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    note: { type: String },
  },
  { timestamps: true, collection: 'independent_task_attachments' }
);

IndependentTaskAttachmentSchema.index({ taskId: 1, createdAt: -1 });

export default mongoose.model<IIndependentTaskAttachment>('IndependentTaskAttachment', IndependentTaskAttachmentSchema);
