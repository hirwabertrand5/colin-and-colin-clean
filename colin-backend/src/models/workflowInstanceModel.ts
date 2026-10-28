import { AppliedTpaSchema } from './appliedTpaSchema';
import type { AppliedTpaSnapshot } from '../utils/tpaAttribution';
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

export type DeadlineAmendmentMode = 'standard' | 'fixed';

export interface IInstanceStep {
  tpaSnapshots?: AppliedTpaSnapshot[];
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
  correctionRequest?: {
    reason: string;
    requestedBy: string;
    requestedAt: Date;
    contributorTaskId?: mongoose.Types.ObjectId;
    resolvedAt?: Date;
  };
  reviewHistory?: Array<{
    action: 'Returned' | 'Resubmitted';
    actorName: string;
    reason?: string;
    at: Date;
  }>;
  /**
   * Role-specific work carried out through an Independent Task. These records
   * supplement (never replace) normal case assignments so fee attribution can
   * distinguish a temporary contributor from the standing team.
   */
  independentContributors?: Array<{
    taskId?: mongoose.Types.ObjectId;
    role: 'Initiator' | 'Reviewer' | 'Signer/Approver';
    name: string;
    userId?: mongoose.Types.ObjectId;
    actedAt: Date;
  }>;
  /**
   * Temporary exclusive reservation while delegated work is open. This is
   * separate from completed contributor attribution and prevents two active
   * Independent Tasks from claiming the same Key Action concurrently.
   */
  delegatedClaim?: {
    taskId: mongoose.Types.ObjectId;
    role: 'Initiator' | 'Reviewer' | 'Signer/Approver';
    claimantName: string;
    claimedAt: Date;
  };
  /**
   * Set the moment the assigned member ticked the work as done. This is the
   * instant the Key Action's deadline clock freezes (see
   * `getKeyActionDeadlineClock` on the client): the countdown stops and the
   * urgency color locks at whatever it was when the work was finished.
   */
  doneAt?: Date;
  extensionHistory?: Array<{
    previousDueAt?: Date;
    newDueAt?: Date;
    days: number;
    reason?: string;
    grantedBy?: string;
    grantedAt?: Date;
    /**
     * Amendment mode, persisted per record (never frontend-only state):
     * - `standard` shifts this Key Action AND all downstream deadlines;
     * - `fixed` pins ONLY this Key Action's effective deadline; downstream
     *   deadlines never move because of it.
     * Legacy records predate the field and keep historical behavior
     * (`standard`) — they are never auto-classified as fixed.
     */
    mode?: DeadlineAmendmentMode;
    /** A revoked amendment stays in history but no longer governs the deadline. */
    revoked?: boolean;
    revokedBy?: string;
    revokedAt?: Date;
    revokeReason?: string;
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
  /** Authoritative position of the stage in the template (drives next-deadline order). */
  stageOrder?: number;
  /** Weight of the stage this step belongs to (0–100). */
  stagePercentage?: number;
  /** Step-level weight (0–100) applied to this step when it is completed. */
  percentage?: number;

  /**
   * True when this Key Action was added directly on this case (from the Case
   * Workspace Overview) rather than defined by the workflow template. Custom
   * Key Actions are never written back to the template and are preserved on the
   * case's active checklist across template reconciliation/alignment.
   */
  custom?: boolean;
  /**
   * True when a template-defined Key Action was edited on this case only
   * (title / stage / position / percentage). The template is never touched;
   * the override lives on the instance step and follows the normal lifecycle.
   */
  overridden?: boolean;
  /**
   * Authoritative position of a custom Key Action within its own stage. Custom
   * steps are ordered by this before the template `order`, so a case-specific
   * Key Action can sit at any position among a stage's Key Actions.
   */
  customOrder?: number;

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
   * Template-defined Key Actions removed on this case only. The template is
   * never touched; the case keeps this list so template sync / reconciliation
   * never restores a Key Action the matter's members deleted.
   */
  deletedStepKeys?: string[];

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
    tpaSnapshots: { type: [AppliedTpaSchema], default: [] },
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
    correctionRequest: {
      type: new Schema({
        reason: { type: String, required: true },
        requestedBy: { type: String, required: true },
        requestedAt: { type: Date, required: true },
        contributorTaskId: { type: Schema.Types.ObjectId, ref: 'IndependentTask' },
        resolvedAt: { type: Date },
      }, { _id: false }),
      default: undefined,
    },
    reviewHistory: {
      type: [new Schema({
        action: { type: String, enum: ['Returned', 'Resubmitted'], required: true },
        actorName: { type: String, required: true },
        reason: { type: String },
        at: { type: Date, required: true },
      }, { _id: false })],
      default: [],
    },
    independentContributors: {
      type: [
        new Schema(
          {
            taskId: { type: Schema.Types.ObjectId, ref: 'IndependentTask' },
            role: { type: String, enum: ['Initiator', 'Reviewer', 'Signer/Approver'], required: true },
            name: { type: String, required: true, trim: true },
            userId: { type: Schema.Types.ObjectId, ref: 'User' },
            actedAt: { type: Date, required: true, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    delegatedClaim: {
      type: new Schema(
        {
          taskId: { type: Schema.Types.ObjectId, ref: 'IndependentTask', required: true },
          role: { type: String, enum: ['Initiator', 'Reviewer', 'Signer/Approver'], required: true },
          claimantName: { type: String, required: true, trim: true },
          claimedAt: { type: Date, required: true, default: Date.now },
        },
        { _id: false }
      ),
      default: undefined,
    },
    // Set when the assigned member ticks the work done; freezes the deadline clock.
    doneAt: { type: Date },
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
            mode: { type: String, enum: ['standard', 'fixed'] },
            revoked: { type: Boolean, default: false },
            revokedBy: { type: String, trim: true },
            revokedAt: { type: Date },
            revokeReason: { type: String, trim: true },
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
    feeCurrency: { type: String, enum: ['RWF'], default: 'RWF', trim: true },
    feeText: { type: String },
    feeRangeMin: { type: Number, min: 0 },
    feeRangeMax: { type: Number, min: 0 },
    feeInputRequired: { type: Boolean, default: false },
    feeSetByUser: { type: Boolean, default: false },

    slaMinutes: { type: Number, min: 0 },
    slaText: { type: String },

    responsibleRole: { type: String, trim: true },

    stageTitle: { type: String, trim: true },
    stageOrder: { type: Number },
    stagePercentage: { type: Number, min: 0, max: 100 },
    percentage: { type: Number, min: 0, max: 100 },

    // Case-specific Key Action added on the matter itself (never on the template).
    custom: { type: Boolean, default: false },
    // Template Key Action edited on this case only (title/stage/position/percentage).
    // Never written back to the template; follows the normal lifecycle.
    overridden: { type: Boolean, default: false },
    customOrder: { type: Number },

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

    // Template Key Actions deleted on this case only (template untouched).
    deletedStepKeys: { type: [String], default: [] },

    archivedSteps: { type: [InstanceStepSchema], default: [] },

    archivedActions: { type: [InstanceArchivedActionSchema], default: [] },
  },
  { timestamps: true, optimisticConcurrency: true }
);

WorkflowInstanceSchema.pre('save', async function () {
  if (this.isNew || this.isModified('steps')) await (await import('../services/earningSnapshotService')).captureActivityRates(this, true);
});
WorkflowInstanceSchema.post('save', async function (instance) {
  await (await import('../services/earningSnapshotService')).snapshotCaseEarnings(instance.caseId, instance.$session());
});

// Independent Tasks are views onto these Key Actions. Keep completed handoffs
// synchronized when an authorized reviewer/approver acts in either workspace.
WorkflowInstanceSchema.post('save', async function (instance) {
  const TaskModel = mongoose.models.IndependentTask;
  if (!TaskModel) return;
  const completedKeys = instance.steps
    .filter((step) => step.status === 'Completed')
    .map((step) => step.stepKey);
  const session = instance.$session();
  const options = session ? { session } : {};
  const submitted = {
    relatedMatterId: instance.caseId,
    caseRole: { $exists: true, $ne: null },
    caseLifecycleCompletedAt: { $exists: true, $ne: null },
    'keyActionKeys.0': { $exists: true },
  };
  await TaskModel.updateMany(
    { ...submitted, status: 'Awaiting Review', keyActionKeys: { $not: { $elemMatch: { $nin: completedKeys } } } },
    { $set: { status: 'Completed', completedAt: new Date() } },
    options
  );
  await TaskModel.updateMany(
    { ...submitted, status: 'Completed', keyActionKeys: { $elemMatch: { $nin: completedKeys } } },
    { $set: { status: 'Awaiting Review' }, $unset: { completedAt: 1 } },
    options
  );
});

export default mongoose.model<IWorkflowInstance>('WorkflowInstance', WorkflowInstanceSchema);
