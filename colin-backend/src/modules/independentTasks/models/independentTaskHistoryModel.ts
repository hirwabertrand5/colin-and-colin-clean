import mongoose, { Schema, Document } from 'mongoose';

export type IndependentTaskHistoryAction =
  | 'TASK_CREATED'
  | 'TASK_ASSIGNED'
  | 'TASK_STATUS_CHANGED'
  | 'TASK_COMMENTED'
  | 'TASK_ATTACHMENT_UPLOADED'
  | 'TASK_ATTACHMENT_DELETED'
  | 'TASK_DUE_DATE_CHANGED'
  | 'TASK_PRIORITY_CHANGED'
  | 'TASK_EDITED'
  | 'TASK_COMPLETED'
  | 'TASK_CLOSED'
  | 'TASK_REVIEW_REQUESTED'
  | 'TASK_EXTERNAL_ACTION_REQUESTED'
  | 'TASK_REOPENED';

export interface IIndependentTaskHistory extends Document {
  taskId: mongoose.Types.ObjectId;
  action: IndependentTaskHistoryAction;
  message: string;
  detail?: string;
  actorName: string;
  actorUserId?: mongoose.Types.ObjectId;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const IndependentTaskHistorySchema = new Schema<IIndependentTaskHistory>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'IndependentTask', required: true, index: true },
    action: { type: String, required: true, index: true },
    message: { type: String, required: true, trim: true },
    detail: { type: String },
    actorName: { type: String, required: true, trim: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'independent_task_history' }
);

IndependentTaskHistorySchema.index({ taskId: 1, createdAt: -1 });

export default mongoose.model<IIndependentTaskHistory>('IndependentTaskHistory', IndependentTaskHistorySchema);
