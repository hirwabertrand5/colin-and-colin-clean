import mongoose, { Schema, Document } from 'mongoose';

export interface ITaskTimeLog extends Document {
  taskId: mongoose.Types.ObjectId;
  caseId: mongoose.Types.ObjectId;

  userId?: mongoose.Types.ObjectId;
  userName: string;

  hours: number;
  note?: string;

  loggedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

const TaskTimeLogSchema = new Schema<ITaskTimeLog>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true, index: true },

    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    userName: { type: String, required: true },

    hours: { type: Number, required: true, min: 0.1 },
    note: { type: String },

    loggedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

TaskTimeLogSchema.index({ taskId: 1, loggedAt: -1 });

export default mongoose.model<ITaskTimeLog>('TaskTimeLog', TaskTimeLogSchema);