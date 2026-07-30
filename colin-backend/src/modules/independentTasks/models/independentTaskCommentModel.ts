import mongoose, { Schema, Document } from 'mongoose';

export interface IIndependentTaskComment extends Document {
  taskId: mongoose.Types.ObjectId;
  parentCommentId?: mongoose.Types.ObjectId | null;
  authorName: string;
  authorUserId?: mongoose.Types.ObjectId;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

const IndependentTaskCommentSchema = new Schema<IIndependentTaskComment>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'IndependentTask', required: true, index: true },
    parentCommentId: { type: Schema.Types.ObjectId, ref: 'IndependentTaskComment', default: null, index: true },
    authorName: { type: String, required: true, trim: true },
    authorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    body: { type: String, required: true, trim: true },
  },
  { timestamps: true, collection: 'independent_task_comments' }
);

IndependentTaskCommentSchema.index({ taskId: 1, createdAt: -1 });

export default mongoose.model<IIndependentTaskComment>('IndependentTaskComment', IndependentTaskCommentSchema);
