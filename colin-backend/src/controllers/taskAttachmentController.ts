import { Response } from 'express';
import mongoose from 'mongoose';
import Task from '../models/taskModel';
import TaskAttachment from '../models/taskAttachmentModel';
import Document from '../models/documentModel';
import { AuthRequest } from '../middleware/authMiddleware';
import { writeAudit } from '../services/auditService';

const actorFromReq = (req: AuthRequest) => ({
  actorName: req.user?.name || 'System',
  actorUserId: req.user?.id as string | undefined,
});

const canAccessTask = (req: AuthRequest, task: any) => {
  if (req.user?.role === 'managing_director') return true;
  return task.assignee === req.user?.name;
};

export const listAttachmentsForTask = async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params as any;

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: 'Task not found.' });

    if (!canAccessTask(req, task)) return res.status(403).json({ message: 'Forbidden.' });

    const items = await TaskAttachment.find({ taskId: new mongoose.Types.ObjectId(taskId) })
      .sort({ createdAt: -1 })
      .limit(200);

    res.json(items);
  } catch {
    res.status(500).json({ message: 'Failed to fetch task attachments.' });
  }
};

export const uploadAttachmentToTask = async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params as any;
    const { name, note } = req.body || {};

    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: 'Task not found.' });

    if (!canAccessTask(req, task)) return res.status(403).json({ message: 'Forbidden.' });

    const actor = actorFromReq(req);

    const displayName = String(name || req.file.originalname).trim();
    const url = `/uploads/${req.file.filename}`;

    // 1) Save TaskAttachment
    const attachmentPayload: any = {
      taskId: new mongoose.Types.ObjectId(taskId),
      caseId: task.caseId,
      name: displayName,
      originalName: req.file.originalname,
      uploadedBy: actor.actorName,
      uploadedDate: new Date().toISOString().slice(0, 10),
      size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
      url,
    };
    if (note) attachmentPayload.note = String(note).trim();

    const attachment = await TaskAttachment.create(attachmentPayload);

    // 2) Also create Case Document (so visible in Case Documents tab)
    const caseDocName = `Task: ${task.title} — ${displayName}`;
    await Document.create({
      caseId: task.caseId,
      name: caseDocName,
      uploadedBy: actor.actorName,
      uploadedDate: new Date().toISOString().slice(0, 10),
      size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
      url,
    });

    // 3) Audit
    await writeAudit({
      caseId: String(task.caseId),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'TASK_UPDATED',
      message: 'Uploaded task attachment',
      detail: `${task.title} • ${displayName}`,
    });

    res.status(201).json(attachment);
  } catch {
    res.status(500).json({ message: 'Failed to upload task attachment.' });
  }
};

export const deleteTaskAttachment = async (req: AuthRequest, res: Response) => {
  try {
    const { attachmentId } = req.params as any;

    const att = await TaskAttachment.findById(attachmentId);
    if (!att) return res.status(404).json({ message: 'Attachment not found.' });

    const task = await Task.findById(att.taskId);
    if (!task) return res.status(404).json({ message: 'Task not found.' });

    if (!canAccessTask(req, task)) return res.status(403).json({ message: 'Forbidden.' });

    await TaskAttachment.findByIdAndDelete(attachmentId);

    const actor = actorFromReq(req);

    await writeAudit({
      caseId: String(task.caseId),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'TASK_UPDATED',
      message: 'Deleted task attachment',
      detail: `${task.title} • ${att.name}`,
    });

    res.json({ message: 'Attachment deleted.' });
  } catch {
    res.status(500).json({ message: 'Failed to delete attachment.' });
  }
};
