import mongoose, { Schema, Document } from 'mongoose';

export type TaskApprovalStatus = 'Not Required' | 'Draft' | 'Pending' | 'Approved' | 'Rejected';
export type TaskStatus = 'Not Started' | 'In Progress' | 'Completed';

export interface ITaskChecklistItem {
  _id?: mongoose.Types.ObjectId;
  item: string;
  completed: boolean;
}

export interface ITask extends Document {
  caseId: mongoose.Types.ObjectId;

  title: string;
  priority: 'High' | 'Medium' | 'Low';
  status: TaskStatus;

  assignee: string;
  dueDate: string; // YYYY-MM-DD
  description?: string;

  requiresApproval: boolean;
  approvalStatus: TaskApprovalStatus;
  submittedAt?: Date;

  approvedAt?: Date;   // decision time for Approved
  rejectedAt?: Date;   // decision time for Rejected
  completedAt?: Date;  // actual completion time (important for on-time KPI)

  approvedBy?: string;
  approvalComment?: string;

  estimatedHours?: number;

  checklist: ITaskChecklistItem[];

  assignedBy?: string;

  createdAt: Date;
  updatedAt: Date;
}

const TaskChecklistItemSchema = new Schema<ITaskChecklistItem>(
  {
    item: { type: String, required: true, trim: true },
    completed: { type: Boolean, default: false },
  },
  { _id: true }
);

const TaskSchema = new Schema<ITask>(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true, index: true },

    title: { type: String, required: true, trim: true },

    priority: {
      type: String,
      enum: ['High', 'Medium', 'Low'],
      default: 'Medium',
    },

    status: {
      type: String,
      enum: ['Not Started', 'In Progress', 'Completed'],
      default: 'Not Started',
      index: true,
    },

    assignee: { type: String, required: true, trim: true },
    dueDate: { type: String, required: true },
    description: { type: String },

    requiresApproval: { type: Boolean, default: false },
    approvalStatus: {
      type: String,
      enum: ['Not Required', 'Draft', 'Pending', 'Approved', 'Rejected'],
      default: 'Not Required',
      index: true,
    },

    submittedAt: { type: Date },

    approvedAt: { type: Date },
    rejectedAt: { type: Date },
    completedAt: { type: Date },

    approvedBy: { type: String },
    approvalComment: { type: String },

    estimatedHours: { type: Number, min: 0 },

    checklist: { type: [TaskChecklistItemSchema], default: [] },

    assignedBy: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<ITask>('Task', TaskSchema);