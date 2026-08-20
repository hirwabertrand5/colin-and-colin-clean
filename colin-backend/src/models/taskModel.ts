import mongoose, { Schema, Document } from 'mongoose';

export type TaskApprovalStatus = 'Not Required' | 'Draft' | 'Pending' | 'Approved' | 'Rejected';
export type TaskStatus = 'Not Started' | 'In Progress' | 'Completed';
export type TaskWorkflowMode = 'LEGACY' | 'STAGED';
export type TaskWorkflowStage =
  | 'Created'
  | 'Assigned'
  | 'Acknowledged'
  | 'In Progress'
  | 'Awaiting Review'
  | 'Awaiting External Action'
  | 'Completed'
  | 'Closed';
export type TaskStageStatus = 'Assigned' | 'In Progress' | 'Completed' | 'Cancelled';
export type TaskStageRole =
  | 'Initiator'
  | 'Reviewer'
  | 'Signer'
  | 'Approver'
  | 'Signer/Approver'
  | 'Preparer'
  | 'Researcher';

export interface ITaskChecklistItem {
  _id?: mongoose.Types.ObjectId;
  item: string;
  completed: boolean;
}

export interface ITaskStage {
  _id?: mongoose.Types.ObjectId;
  taskId?: mongoose.Types.ObjectId;
  role: TaskStageRole;
  staffMember: string;
  sequence: number;
  required: boolean;
  assignedAt?: Date;
  dueAt?: Date;
  status: TaskStageStatus;
  completedAt?: Date;
  timelinessScore?: number | null;
  qualityScore?: number | null;
  qualityApplicable?: boolean;
  supervisorReviewer?: string;
  tpaUsed?: number | null;
  potentialAllocation?: number | null;
  earnedRevenue?: number | null;
  notes?: string;
}

export interface ITask extends Document {
  caseId: mongoose.Types.ObjectId;
  taskNo: string;

  title: string;
  priority: 'High' | 'Medium' | 'Low';
  status: TaskStatus;
  workflowStage: TaskWorkflowStage;
  workflowMode?: TaskWorkflowMode;

  assignee: string;
  supervisor: string;
  relatedClient?: string;
  startDate?: string;
  dueDate: string; // YYYY-MM-DD
  description?: string;
  taskStages?: ITaskStage[];

  requiresApproval: boolean;
  approvalStatus: TaskApprovalStatus;
  submittedAt?: Date;

  acknowledgedAt?: Date;
  approvedAt?: Date;   // decision time for Approved
  rejectedAt?: Date;   // decision time for Rejected
  completedAt?: Date;  // actual completion time (important for on-time KPI)
  closedAt?: Date;

  approvedBy?: string;
  approvalComment?: string;
  qualityScore?: number;

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

const TaskStageSchema = new Schema<ITaskStage>(
  {
    role: {
      type: String,
      enum: ['Initiator', 'Reviewer', 'Signer', 'Approver', 'Signer/Approver', 'Preparer', 'Researcher'],
      required: true,
      trim: true,
    },
    staffMember: { type: String, trim: true, default: '' },
    sequence: { type: Number, required: true, default: 1 },
    required: { type: Boolean, default: true },
    assignedAt: { type: Date },
    dueAt: { type: Date },
    status: {
      type: String,
      enum: ['Assigned', 'In Progress', 'Completed', 'Cancelled'],
      default: 'Assigned',
    },
    completedAt: { type: Date },
    timelinessScore: { type: Number, min: 0, max: 100, default: null },
    qualityScore: { type: Number, min: 0, max: 100, default: null },
    qualityApplicable: { type: Boolean, default: true },
    supervisorReviewer: { type: String, trim: true, default: '' },
    tpaUsed: { type: Number, min: 0, default: null },
    potentialAllocation: { type: Number, min: 0, default: null },
    earnedRevenue: { type: Number, min: 0, default: null },
    notes: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const TaskSchema = new Schema<ITask>(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
    taskNo: { type: String, required: true, trim: true, unique: true, index: true },

    title: { type: String, required: true, trim: true },
    workflowMode: { type: String, enum: ['LEGACY', 'STAGED'], default: 'LEGACY', index: true },

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

    workflowStage: {
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

    assignee: { type: String, required: true, trim: true },
    supervisor: { type: String, required: true, trim: true },
    relatedClient: { type: String, trim: true },
    startDate: { type: String, trim: true },
    dueDate: { type: String, required: true },
    description: { type: String },
    taskStages: { type: [TaskStageSchema], default: [] },

    requiresApproval: { type: Boolean, default: false },
    approvalStatus: {
      type: String,
      enum: ['Not Required', 'Draft', 'Pending', 'Approved', 'Rejected'],
      default: 'Not Required',
      index: true,
    },

    submittedAt: { type: Date },

    acknowledgedAt: { type: Date },
    approvedAt: { type: Date },
    rejectedAt: { type: Date },
    completedAt: { type: Date },
    closedAt: { type: Date },

    approvedBy: { type: String },
    approvalComment: { type: String },
    qualityScore: { type: Number, min: 0, max: 100, default: null },

    estimatedHours: { type: Number, min: 0 },

    checklist: { type: [TaskChecklistItemSchema], default: [] },

    assignedBy: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<ITask>('Task', TaskSchema);
