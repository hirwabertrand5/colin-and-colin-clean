import mongoose, { Schema, Document } from 'mongoose';

export type IndependentTaskPriority = 'Low' | 'Medium' | 'High' | 'Critical';
/**
 * A task can temporarily delegate one of the case-delivery roles without
 * changing the case's standing assignment.  The delegation is deliberately
 * scoped to selected Key Actions and remains auditable on the task itself.
 */
export type IndependentTaskCaseRole = 'Initiator' | 'Reviewer' | 'Signer/Approver';
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
  /** Optional case-work delegation metadata. */
  caseRole?: IndependentTaskCaseRole;
  keyActionKeys?: string[];
  /** The last lifecycle hand-off performed from this workspace. */
  caseLifecycleStatus?: 'Ready' | 'Submitted to Reviewer' | 'Submitted to Approver' | 'Approved';
  caseLifecycleCompletedAt?: Date;

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
  /** Ownership handovers retain the completed work context for the incoming owner. */
  assignmentHistory?: Array<{
    role: 'Assignee' | 'Supervisor';
    previousAssignee?: string;
    nextAssignee?: string;
    reassignedAt: Date;
    reassignedBy?: string;
  }>;

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
    caseRole: { type: String, enum: ['Initiator', 'Reviewer', 'Signer/Approver'], index: true },
    keyActionKeys: { type: [String], default: [] },
    caseLifecycleStatus: {
      type: String,
      enum: ['Ready', 'Submitted to Reviewer', 'Submitted to Approver', 'Approved'],
    },
    caseLifecycleCompletedAt: { type: Date },

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
    assignmentHistory: {
      type: [
        {
          role: { type: String, enum: ['Assignee', 'Supervisor'], required: true },
          previousAssignee: { type: String, trim: true },
          nextAssignee: { type: String, trim: true },
          reassignedAt: { type: Date, required: true, default: Date.now },
          reassignedBy: { type: String, trim: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true, collection: 'independent_tasks' }
);

IndependentTaskSchema.index({ status: 1, dueDate: 1 });
IndependentTaskSchema.index({ assignee: 1, dueDate: 1 });

export default mongoose.model<IIndependentTask>('IndependentTask', IndependentTaskSchema);
