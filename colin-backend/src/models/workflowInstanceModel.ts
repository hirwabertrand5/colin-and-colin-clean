import mongoose, { Schema, Document } from 'mongoose';

export type StepStatus = 'Not Started' | 'In Progress' | 'Completed';

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

export interface IWorkflowInstance extends Document {
  caseId: mongoose.Types.ObjectId;
  templateId: mongoose.Types.ObjectId;

  status: 'Active' | 'Completed';
  currentStepKey?: string;

  steps: IInstanceStep[];

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

    status: { type: String, enum: ['Not Started', 'In Progress', 'Completed'], default: 'Not Started' },
    startAt: { type: Date },
    dueAt: { type: Date },
    completedAt: { type: Date },
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

const WorkflowInstanceSchema = new Schema<IWorkflowInstance>(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true, unique: true, index: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'WorkflowTemplate', required: true, index: true },

    status: { type: String, enum: ['Active', 'Completed'], default: 'Active' },
    currentStepKey: { type: String },

    steps: { type: [InstanceStepSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model<IWorkflowInstance>('WorkflowInstance', WorkflowInstanceSchema);
