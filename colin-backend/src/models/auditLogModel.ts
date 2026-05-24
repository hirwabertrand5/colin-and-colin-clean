import mongoose, { Schema, Document } from 'mongoose';

export type AuditAction =
  | 'CASE_CREATED'
  | 'CASE_UPDATED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_DELETED'
  | 'EVENT_CREATED'
  | 'EVENT_UPDATED'
  | 'EVENT_DELETED'
  | 'DOCUMENT_UPLOADED'
  | 'DOCUMENT_DELETED'
  | 'INVOICE_CREATED'
  | 'INVOICE_PAID'
  | 'INVOICE_UPDATED'
  | 'INVOICE_DELETED'
  // ✅ Workflow
  | 'WORKFLOW_TEMPLATE_CREATED'
  | 'WORKFLOW_TEMPLATE_UPDATED'
  | 'WORKFLOW_TEMPLATE_DELETED'
  | 'WORKFLOW_INSTANCE_CREATED'
  | 'WORKFLOW_OUTPUT_UPLOADED'
  | 'WORKFLOW_STEP_COMPLETED'
  | 'WORKFLOW_STEP_REOPENED'
  | 'WORKFLOW_STEP_ACTION_TOGGLED'
  | 'WORKFLOW_STEP_FEE_SET'
  | 'WORKFLOW_STEP_DEADLINE_EXTENDED';

export interface IAuditLog extends Document {
  caseId: mongoose.Types.ObjectId;
  actorUserId?: mongoose.Types.ObjectId;
  actorName: string;
  action: AuditAction;
  message: string;
  detail?: string;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String, required: true },
    action: { type: String, required: true, index: true },
    message: { type: String, required: true },
    detail: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditLogSchema.index({ caseId: 1, createdAt: -1 });

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
