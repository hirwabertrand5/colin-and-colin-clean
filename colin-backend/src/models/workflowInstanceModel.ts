import mongoose, { Schema, Document } from 'mongoose';

/**
 * Lifecycle of a Key Action.
 *
 *  Not Started -> In Progress -> Done -> Awaiting Review -> Awaiting Approval -> Completed
 *
 * 'Done' means the assigned member has ticked the work as finished. It is
 * deliberately distinct from 'Completed' (which means APPROVED) and from
 * 'Awaiting Review' (which means the Initiator has submitted it). Without that
 * middle state a tick either jumped straight past the review chain - leaving
 * nothing for the Reviewer to do - or could not be sent to the Reviewer at all.
 *
 * Ticking never waits for review: as soon as a Key Action is 'Done' the next
 * one in sequence unlocks, so the team keeps moving while the Reviewer and
 * Signer/Approver work through the queue in their own time.
 */
export type StepStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Done'
  | 'Awaiting Review'
  | 'Awaiting Approval'
  | 'Completed';

/**
 * Whether the work itself has been ticked as done by the assigned member.
 *
 * This is deliberately separate from approval: a Key Action counts as "work
 * done" as soon as it is ticked, and that is what unlocks the next Key Action
 * in sequence. A Key Action waits for nobody - the Reviewer and Approver can
 * work through the queue independently, in their own time.
 *
 * Only 'Not Started' / 'In Progress' mean the work itself is not done yet.
 */
export const isStepWorkDone = (step: { status?: string } | null | undefined): boolean => {
  const status = String(step?.status || '');
  return (
    status === 'Done' ||
    status === 'Awaiting Review' ||
    status === 'Awaiting Approval' ||
    status === 'Completed'
  );
};

export interface IInstanceOutput {
  key: string;
  name: string;
  required: boolean;
  category?: string;

  documentId?: mongoose.Types.ObjectId;
  uploadedAt?: Date;
}

export interface IInstanceStep {
  stepKey: string;
  title: string;
  stageKey: string;
  order: number;

  status: StepStatus;
  startAt?: Date;
  dueAt?: Date;
  completedAt?: Date;
  /** Case Management: when the Case Initiator submitted the completed work for review. */
  submittedAt?: Date;
  /** Case Management: when the Reviewer reviewed the work and requested approval. */
  reviewedAt?: Date;
  extensionHistory?: Array<{
    previousDueAt?: Date;
    newDueAt?: Date;
    days: number;
    reason?: string;
    grantedBy?: string;
    grantedAt?: Date;
  }>;

  actions: Array<{
    text: string;
    done: boolean;
    doneAt?: Date;
  }>;

  feeAmount?: number;
  feeCurrency?: string;
  feeText?: string;
  feeRangeMin?: number;
  feeRangeMax?: number;
  feeInputRequired?: boolean;
  feeSetByUser?: boolean;

  slaMinutes?: number;
  slaText?: string;

  responsibleRole?: string;

  /** Title of the stage this step belongs to (snapshotted from the template). */
  stageTitle?: string;
  /** Weight of the stage this step belongs to (0–100). */
  stagePercentage?: number;
  /** Step-level weight (0–100) applied to this step when it is completed. */
  percentage?: number;

  outputs: IInstanceOutput[];
}

export interface IInstanceArchivedAction {
  /** The template step the removed checklist item belonged to. */
  stepKey: string;
  stepTitle?: string;
  text: string;
  done: boolean;
  doneAt?: Date;
  reason: string;
  archivedAt?: Date;
}

export interface IWorkflowInstance extends Document {
  caseId: mongoose.Types.ObjectId;
  templateId: mongoose.Types.ObjectId;

  status: 'Active' | 'Completed';
  currentStepKey?: string;

  steps: IInstanceStep[];

  /**
   * Steps that belonged to a superseded workflow template. They are removed from
   * the active checklist (so the Case Workspace, Case Management and the earned
   * fees only ever reflect the current template) but kept here read-only so the
   * historical work, its ticks and its completion stamps are never destroyed.
   */
  archivedSteps: IInstanceStep[];

  /**
   * Ticked Key Actions (checklist items) that were removed from the active
   * checklist because the current template does not define them — for example
   * items left behind by an older template or added directly on the matter.
   * Their tick, wording and timestamp are preserved here even though the item
   * no longer appears in the Case Workspace / Case Management checklist.
   */
  archivedActions: IInstanceArchivedAction[];

  createdAt: Date;
  updatedAt: Date;
}

const InstanceOutputSchema = new Schema<IInstanceOutput>(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    required: { type: Boolean, default: true },
    category: { type: String },

    documentId: { type: Schema.Types.ObjectId, ref: 'Document' },
    uploadedAt: { type: Date },
  },
  { _id: false }
);

const InstanceStepSchema = new Schema<IInstanceStep>(
  {
    stepKey: { type: String, required: true },
    title: { type: String, required: true },
    stageKey: { type: String, required: true },
    order: { type: Number, required: true },

    // 'Done' is the ticked-but-not-submitted state. It must be in the enum or
    // Mongoose rejects the write and the tick fails to save.
    status: {
      type: String,
      enum: ['Not Started', 'In Progress', 'Done', 'Awaiting Review', 'Awaiting Approval', 'Completed'],
      default: 'Not Started',
    },
    startAt: { type: Date },
    dueAt: { type: Date },
    completedAt: { type: Date },
    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    extensionHistory: {
      type: [
        new Schema(
          {
            previousDueAt: { type: Date },
            newDueAt: { type: Date },
            days: { type: Number, required: true },
            reason: { type: String, trim: true },
            grantedBy: { type: String, trim: true },
            grantedAt: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    actions: {
      type: [
        new Schema(
          {
            text: { type: String, required: true },
            done: { type: Boolean, default: false },
            doneAt: { type: Date },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    feeAmount: { type: Number, min: 0 },
    feeCurrency: { type: String, trim: true },
    feeText: { type: String },
    feeRangeMin: { type: Number, min: 0 },
    feeRangeMax: { type: Number, min: 0 },
    feeInputRequired: { type: Boolean, default: false },
    feeSetByUser: { type: Boolean, default: false },

    slaMinutes: { type: Number, min: 0 },
    slaText: { type: String },

    responsibleRole: { type: String, trim: true },

    stageTitle: { type: String, trim: true },
    stagePercentage: { type: Number, min: 0, max: 100 },
    percentage: { type: Number, min: 0, max: 100 },

    outputs: { type: [InstanceOutputSchema], default: [] },
  },
  { _id: false }
);

const InstanceArchivedActionSchema = new Schema<IInstanceArchivedAction>(
  {
    stepKey: { type: String, required: true },
    stepTitle: { type: String },
    text: { type: String, required: true },
    done: { type: Boolean, default: true },
    doneAt: { type: Date },
    reason: { type: String, default: 'not-in-template' },
    archivedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const WorkflowInstanceSchema = new Schema<IWorkflowInstance>(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true, unique: true, index: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'WorkflowTemplate', required: true, index: true },

    status: { type: String, enum: ['Active', 'Completed'], default: 'Active' },
    currentStepKey: { type: String },

    steps: { type: [InstanceStepSchema], default: [] },

    archivedSteps: { type: [InstanceStepSchema], default: [] },

    archivedActions: { type: [InstanceArchivedActionSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model<IWorkflowInstance>('WorkflowInstance', WorkflowInstanceSchema);
