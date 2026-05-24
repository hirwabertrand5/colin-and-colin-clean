import mongoose, { Schema, Document } from 'mongoose';

export type NotificationType =
  | 'PETTY_CASH_LOW'
  | 'PETTY_CASH_CREATED'
  | 'PETTY_CASH_EXPENSE'
  | 'TASK_ASSIGNED'
  | 'TASK_APPROVAL_REQUESTED'
  | 'TASK_DUE_REMINDER'
  | 'EVENT_REMINDER';

export interface INotification extends Document {
  type: NotificationType;
  title: string;
  message: string;

  severity: 'info' | 'warning' | 'critical';

  // audience targeting
  audienceUserIds: mongoose.Types.ObjectId[]; // primary (customized)
  audienceRoles: string[]; // optional broadcast

  // linking / entities
  link?: string;
  dedupeKey?: string;

  caseId?: mongoose.Types.ObjectId;
  taskId?: mongoose.Types.ObjectId;
  eventId?: mongoose.Types.ObjectId;

  fundId?: mongoose.Types.ObjectId;
  expenseId?: mongoose.Types.ObjectId;

  isReadBy: mongoose.Types.ObjectId[];

  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    type: { type: String, required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },

    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },

    audienceUserIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [], index: true },
    audienceRoles: { type: [String], default: [], index: true },

    link: { type: String },
    dedupeKey: { type: String, index: true },

    caseId: { type: Schema.Types.ObjectId, ref: 'Case' },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event' },

    fundId: { type: Schema.Types.ObjectId, ref: 'PettyCashFund' },
    expenseId: { type: Schema.Types.ObjectId, ref: 'PettyCashExpense' },

    isReadBy: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
  },
  { timestamps: true }
);

NotificationSchema.index({ createdAt: -1 });
NotificationSchema.index({ type: 1, createdAt: -1 });

export default mongoose.model<INotification>('Notification', NotificationSchema);