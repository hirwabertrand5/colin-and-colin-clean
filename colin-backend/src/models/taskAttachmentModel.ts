import mongoose, { Schema, Document } from 'mongoose';

export interface ITaskAttachment extends Document {
  taskId: mongoose.Types.ObjectId;
  caseId: mongoose.Types.ObjectId;

  name: string;          // display name
  originalName: string;  // original filename
  uploadedBy: string;
  uploadedDate: string;  // YYYY-MM-DD
  size: string;          // "1.20 MB"
  url: string;           // /uploads/...

  note?: string;

  createdAt: Date;
  updatedAt: Date;
}

const TaskAttachmentSchema = new Schema<ITaskAttachment>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true, index: true },

    name: { type: String, required: true, trim: true },
    originalName: { type: String, required: true },
    uploadedBy: { type: String, required: true },
    uploadedDate: { type: String, required: true },
    size: { type: String, required: true },
    url: { type: String, required: true },

    note: { type: String },
  },
  { timestamps: true }
);

TaskAttachmentSchema.index({ taskId: 1, createdAt: -1 });

export default mongoose.model<ITaskAttachment>('TaskAttachment', TaskAttachmentSchema);