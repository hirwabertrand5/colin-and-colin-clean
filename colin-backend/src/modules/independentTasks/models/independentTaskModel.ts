import mongoose, { Schema, Document } from 'mongoose';

export type IndependentTaskPriority = 'Low' | 'Medium' | 'High' | 'Critical';
export type IndependentTaskStatus =
  | 'Created'
  | 'Assigned'
  | 'Acknowledged'
  | 'In Progress'
  | 'Awaiting Review'
  | 'Awaiting External Action'
  | 'Completed'
  | 'Closed';

export interface IIndependentTask extends Document {
  taskNumber: string;
  title: string;
  description?: string;

  relatedMatterId?: mongoose.Types.ObjectId | null;
  relatedMatterLabel?: string;
  relatedClient?: string;

  assignee: string;
  supervisor: string;
  priority: IndependentTaskPriority;
  status: IndependentTaskStatus;
  startDate: string;
  dueDate: string;
  completedAt?: Date;
  closedAt?: Date;

  createdBy?: string;
  createdByUserId?: mongoose.Types.ObjectId;
  assignedBy?: string;
  assignedByUserId?: mongoose.Types.ObjectId;
  lastActionBy?: string;
  lastActionByUserId?: mongoose.Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const IndependentTaskSchema = new Schema<IIndependentTask>(
  {
    taskNumber: { type: String, required: true, unique: true, index: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String },

    relatedMatterId: { type: Schema.Types.ObjectId, ref: 'Case', default: null, index: true },
    relatedMatterLabel: { type: String, trim: true },
    relatedClient: { type: String, trim: true },

    assignee: { type: String, required: true, trim: true, index: true },
    supervisor: { type: String, required: true, trim: true, index: true },
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical'],
      default: 'Medium',
      index: true,
    },
    status: {
      type: String,
      enum: [
        'Created',
        'Assigned',
        'Acknowledged',
        'In Progress',
        'Awaiting Review',
        'Awaiting External Action',
        'Completed',
        'Closed',
      ],
      default: 'Assigned',
      index: true,
    },
    startDate: { type: String, required: true, trim: true },
    dueDate: { type: String, required: true, trim: true, index: true },
    completedAt: { type: Date },
    closedAt: { type: Date },

    createdBy: { type: String, trim: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedBy: { type: String, trim: true },
    assignedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    lastActionBy: { type: String, trim: true },
    lastActionByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'independent_tasks' }
);

IndependentTaskSchema.index({ status: 1, dueDate: 1 });
IndependentTaskSchema.index({ assignee: 1, dueDate: 1 });

export default mongoose.model<IIndependentTask>('IndependentTask', IndependentTaskSchema);
