import mongoose, { Schema, Document } from 'mongoose';

export type NotificationType =
  | 'PETTY_CASH_LOW'
  | 'PETTY_CASH_CREATED'
  | 'PETTY_CASH_EXPENSE'
  | 'TASK_ASSIGNED'
  | 'TASK_APPROVAL_REQUESTED'
  | 'TASK_DUE_REMINDER'
  | 'EVENT_REMINDER';

// Extend NotificationType with workflow-related values
export type ExtendedNotificationType = NotificationType | 'WORKFLOW_NOTIFICATION' | 'WORKFLOW_SMS' | 'WORKFLOW_EMAIL';



export interface INotification extends Document {
  type: ExtendedNotificationType;
  title: string;
  message: string;

  severity: 'info' | 'warning' | 'critical';

  // audience targeting
  audienceUserIds: mongoose.Types.ObjectId[]; // primary (customized)
  audienceRoles: string[]; // optional broadcast

  // linking / entities
  link?: string;
  dedupeKey?: string;
  eventKey?: string;
  emailQueueState?: 'pending' | 'complete' | 'failed';
  deliveryContext?: any;

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
    // New records only: legacy dedupe keys can contain duplicates. Preserve them.
    eventKey: { type: String },
    emailQueueState: { type: String, enum: ['pending', 'complete', 'failed'], index: true },
    deliveryContext: { type: Schema.Types.Mixed },

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
NotificationSchema.index({ eventKey: 1 }, { unique: true, partialFilterExpression: { eventKey: { $type: 'string' } } });

export default mongoose.model<INotification>('Notification', NotificationSchema);
