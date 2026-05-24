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

  actions: string[];
  outputs: IOutputRequirement[];

  legalBasis: ILegalBasisRef[];
  fee?: IFeeSpec;
  sla?: ISlaSpec;
}

export interface IWorkflowStageTemplate {
  key: string;
  order: number;
  title: string;
  description?: string;
}

export interface IWorkflowTemplate extends Document {
  name: string;
  matterType: string;
  caseType: 'Transactional Cases' | 'Litigation Cases' | 'Labor Cases';
  version: number;
  active: boolean;

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
    unit: { type: String, enum: ['hours', 'days', 'weeks'], required: true },
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
    key: { type: String, required: true },
    order: { type: Number, required: true },
    title: { type: String, required: true },
    stageKey: { type: String, required: true },

    actions: { type: [String], default: [] },
    outputs: { type: [OutputReqSchema], default: [] },

    legalBasis: { type: [LegalBasisSchema], default: [] },
    fee: { type: FeeSpecSchema, required: false },
    sla: { type: SlaSpecSchema, required: false },
  },
  { _id: false }
);

const StageSchema = new Schema<IWorkflowStageTemplate>(
  {
    key: { type: String, required: true },
    order: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String },
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

    stages: { type: [StageSchema], default: [] },
    steps: { type: [StepSchema], default: [] },
  },
  { timestamps: true }
);

WorkflowTemplateSchema.index({ active: 1, matterType: 1 });
WorkflowTemplateSchema.index({ name: 1, version: 1 }, { unique: true });

export default mongoose.model<IWorkflowTemplate>('WorkflowTemplate', WorkflowTemplateSchema);