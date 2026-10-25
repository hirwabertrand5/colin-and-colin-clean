import mongoose from 'mongoose';
import AuditLog, { AuditAction } from '../models/auditLogModel';

export const writeAudit = async (params: {
  caseId: string;
  independentTaskId?: string;
  actorUserId?: string;
  actorName: string;
  action: AuditAction;
  message: string;
  detail?: string;
}) => {
  const doc: any = {
    caseId: new mongoose.Types.ObjectId(params.caseId),
    actorName: params.actorName,
    action: params.action,
    message: params.message,
  };

  if (params.detail) doc.detail = params.detail;

  if (params.independentTaskId) {
    doc.independentTaskId = new mongoose.Types.ObjectId(params.independentTaskId);
  }

  if (params.actorUserId) {
    doc.actorUserId = new mongoose.Types.ObjectId(params.actorUserId);
  }

  await AuditLog.create(doc);
};
