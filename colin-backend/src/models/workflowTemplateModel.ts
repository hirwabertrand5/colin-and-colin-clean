import mongoose, { Schema, Document } from 'mongoose';

export type FeeType = 'fixed' | 'range' | 'percentage' | 'text' | 'included';

export interface IFeeSpec {
  type: FeeType;
  currency?: string;
  min?: number;
  max?: number;
  percentage?: number;
  text?: string;
}

export interface ISlaSpec {
  unit: 'hours' | 'days' | 'weeks';
  min?: number;
  max?: number;
  text?: string;
}

export interface ILegalBasisRef {
  text: string;
}

export interface IOutputRequirement {
  key: string;
  name: string;
  required: boolean;
  category?: string;
}

export interface IWorkflowStepTemplate {
  key: string;
  order: number;
  title: string;
  stageKey: string;

  responsibleRole?: string;

  actions: string[];
  outputs: IOutputRequirement[];

  legalBasis: ILegalBasisRef[];
  fee?: IFeeSpec;
  sla?: ISlaSpec;

  /**
   * Optional step-level percentage weight (0–100) of the matter value earned
   * when this step is completed. When omitted, the step inherits an equal
   * share of its stage percentage.
   */
  percentage?: number;
}

export interface IWorkflowStageTemplate {
  key: string;
  order: number;
  title: string;
  description?: string;

  /**
   * Reference-table fields are entered once for the whole section. They are
   * also copied to its steps when a case workflow is initialized, preserving
   * the existing step-based deadline, fee and document behaviour.
   */
  legalBasis?: ILegalBasisRef[];
  outputs?: IOutputRequirement[];
  fee?: IFeeSpec;
  sla?: ISlaSpec;

  /**
   * Percentage weight (0–100) this stage contributes to the matter's earned
   * value. Stage percentages are expected to total 100. When omitted, template
   * percentages are auto-distributed evenly across stages.
   */
  percentage?: number;
}

export interface IWorkflowTemplate extends Document {
  name: string;
  matterType: string;
  caseType: 'Transactional Cases' | 'Litigation Cases' | 'Labor Cases';
  version: number;
  active: boolean;
  /**
   * Drafts use the same template collection and service as published workflows.
   * They remain inactive until the builder publishes them.
   */
  draft?: boolean;

  stages: IWorkflowStageTemplate[];
  steps: IWorkflowStepTemplate[];

  createdAt: Date;
  updatedAt: Date;
}

const FeeSpecSchema = new Schema<IFeeSpec>(
  {
    type: { type: String, enum: ['fixed', 'range', 'percentage', 'text', 'included'], required: true },
    currency: { type: String },
    min: { type: Number },
    max: { type: Number },
    percentage: { type: Number },
    text: { type: String },
  },
  { _id: false }
);

const SlaSpecSchema = new Schema<ISlaSpec>(
  {
    // Unit is optional because some templates may store SLA as free-text only.
    unit: { type: String, enum: ['hours', 'days', 'weeks'] },
    min: { type: Number },
    max: { type: Number },
    text: { type: String },
  },
  { _id: false }
);

const LegalBasisSchema = new Schema<ILegalBasisRef>(
  { text: { type: String, required: true } },
  { _id: false }
);

const OutputReqSchema = new Schema<IOutputRequirement>(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    required: { type: Boolean, default: true },
    category: { type: String },
  },
  { _id: false }
);

const StepSchema = new Schema<IWorkflowStepTemplate>(
  {
    // These fields are validated before publication. Keeping them optional at
    // the schema level lets an administrator save a partially-built draft in
    // this same authoritative template record.
    key: { type: String },
    order: { type: Number },
    title: { type: String },
    stageKey: { type: String },

    responsibleRole: { type: String, trim: true },

    actions: { type: [String], default: [] },
    outputs: { type: [OutputReqSchema], default: [] },

    legalBasis: { type: [LegalBasisSchema], default: [] },
    fee: { type: FeeSpecSchema, required: false },
    sla: { type: SlaSpecSchema, required: false },
    percentage: { type: Number, min: 0, max: 100 },
  },
  { _id: false }
);

const StageSchema = new Schema<IWorkflowStageTemplate>(
  {
    // See StepSchema: incomplete values are valid only while draft is true.
    key: { type: String },
    order: { type: Number },
    title: { type: String },
    description: { type: String },
    legalBasis: { type: [LegalBasisSchema], default: [] },
    outputs: { type: [OutputReqSchema], default: [] },
    fee: { type: FeeSpecSchema, required: false },
    sla: { type: SlaSpecSchema, required: false },
    percentage: { type: Number, min: 0, max: 100 },
  },
  { _id: false }
);

const WorkflowTemplateSchema = new Schema<IWorkflowTemplate>(
  {
    name: { type: String, required: true, trim: true },
    matterType: { type: String, required: true, trim: true },
    caseType: {
      type: String,
      enum: ['Transactional Cases', 'Litigation Cases', 'Labor Cases'],
      required: true,
    },
    version: { type: Number, default: 1 },
    active: { type: Boolean, default: true },
    draft: { type: Boolean, default: false },

    stages: { type: [StageSchema], default: [] },
    steps: { type: [StepSchema], default: [] },
  },
  { timestamps: true }
);

WorkflowTemplateSchema.index({ active: 1, matterType: 1 });
WorkflowTemplateSchema.index({ name: 1, version: 1 }, { unique: true });

export default mongoose.model<IWorkflowTemplate>('WorkflowTemplate', WorkflowTemplateSchema);
