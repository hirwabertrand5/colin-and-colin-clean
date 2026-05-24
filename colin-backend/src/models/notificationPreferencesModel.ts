import mongoose, { Schema, Document } from 'mongoose';

export interface INotificationPreferences extends Document {
  userId: mongoose.Types.ObjectId;

  emailEnabled: boolean;

  // categories
  deadlinesEnabled: boolean;     // task/event deadline reminders
  taskAssignmentsEnabled: boolean;
  approvalsEnabled: boolean;
  pettyCashLowEnabled: boolean;

  // reminder schedule configuration (simple defaults)
  taskDueReminderHours: number;      // default 24
  eventReminderHours: number[];      // default [24, 2]

  createdAt: Date;
  updatedAt: Date;
}

const NotificationPreferencesSchema = new Schema<INotificationPreferences>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', unique: true, index: true, required: true },

    emailEnabled: { type: Boolean, default: true },

    deadlinesEnabled: { type: Boolean, default: true },
    taskAssignmentsEnabled: { type: Boolean, default: true },
    approvalsEnabled: { type: Boolean, default: true },
    pettyCashLowEnabled: { type: Boolean, default: true },

    taskDueReminderHours: { type: Number, default: 24, min: 1, max: 168 },
    eventReminderHours: { type: [Number], default: [24, 2] },
  },
  { timestamps: true }
);

export default mongoose.model<INotificationPreferences>(
  'NotificationPreferences',
  NotificationPreferencesSchema
);