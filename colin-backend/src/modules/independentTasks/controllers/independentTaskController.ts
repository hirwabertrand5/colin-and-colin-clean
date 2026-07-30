import { Response } from 'express';
import multer, { StorageEngine } from 'multer';
import path from 'path';
import fs from 'fs';
import { AuthRequest } from '../../../middleware/authMiddleware';
import { independentTaskService } from '../services/independentTaskService';

const storage: StorageEngine = multer.diskStorage({
  destination: function (_req, _file, cb) {
    const uploadDir = path.join(process.cwd(), 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: function (_req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

export const upload = multer({ storage });

const getParam = (value: any) => (Array.isArray(value) ? value[0] : value);

export const dashboard = async (req: AuthRequest, res: Response) => {
  try {
    const data = await independentTaskService.getDashboard(req);
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Failed to load dashboard.' });
  }
};

export const listTasks = async (req: AuthRequest, res: Response) => {
  try {
    const data = await independentTaskService.listTasks(req.query as any, req);
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Failed to load tasks.' });
  }
};

export const createTask = async (req: AuthRequest, res: Response) => {
  try {
    const task = await independentTaskService.createTask(req.body, req);
    return res.status(201).json(task);
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Failed to create task.' });
  }
};

export const getTask = async (req: AuthRequest, res: Response) => {
  try {
    const taskId = getParam(req.params.taskId);
    if (!taskId) return res.status(400).json({ message: 'Task id is required.' });
    const task = await independentTaskService.getTaskById(taskId, req);
    return res.json(task);
  } catch (error: any) {
    const message = error?.message || 'Failed to load task.';
    return res.status(message === 'Forbidden.' ? 403 : 404).json({ message });
  }
};

export const updateTask = async (req: AuthRequest, res: Response) => {
  try {
    const taskId = getParam(req.params.taskId);
    if (!taskId) return res.status(400).json({ message: 'Task id is required.' });
    const task = await independentTaskService.updateTask(taskId, req.body, req);
    return res.json(task);
  } catch (error: any) {
    const message = error?.message || 'Failed to update task.';
    return res.status(message === 'Forbidden.' ? 403 : 400).json({ message });
  }
};

export const transitionTask = async (req: AuthRequest, res: Response) => {
  try {
    const taskId = getParam(req.params.taskId);
    if (!taskId) return res.status(400).json({ message: 'Task id is required.' });
    const { status } = req.body || {};
    const task = await independentTaskService.transitionTask(taskId, status, req);
    return res.json(task);
  } catch (error: any) {
    const message = error?.message || 'Failed to update workflow.';
    const status = message === 'Forbidden.' ? 403 : 400;
    return res.status(status).json({ message });
  }
};

export const deleteTask = async (req: AuthRequest, res: Response) => {
  try {
    const taskId = getParam(req.params.taskId);
    if (!taskId) return res.status(400).json({ message: 'Task id is required.' });
    const result = await independentTaskService.deleteTask(taskId, req);
    return res.json(result);
  } catch (error: any) {
    const message = error?.message || 'Failed to delete task.';
    const status = message === 'Forbidden.' ? 403 : 400;
    return res.status(status).json({ message });
  }
};

export const listHistory = async (req: AuthRequest, res: Response) => {
  try {
    const taskId = getParam(req.params.taskId);
    if (!taskId) return res.status(400).json({ message: 'Task id is required.' });
    const items = await independentTaskService.listHistory(taskId, req);
    return res.json(items);
  } catch (error: any) {
    const message = error?.message || 'Failed to load history.';
    return res.status(message === 'Forbidden.' ? 403 : 400).json({ message });
  }
};

export const listComments = async (req: AuthRequest, res: Response) => {
  try {
    const taskId = getParam(req.params.taskId);
    if (!taskId) return res.status(400).json({ message: 'Task id is required.' });
    const items = await independentTaskService.listComments(taskId, req);
    return res.json(items);
  } catch (error: any) {
    const message = error?.message || 'Failed to load comments.';
    return res.status(message === 'Forbidden.' ? 403 : 400).json({ message });
  }
};

export const addComment = async (req: AuthRequest, res: Response) => {
  try {
    const taskId = getParam(req.params.taskId);
    if (!taskId) return res.status(400).json({ message: 'Task id is required.' });
    const comment = await independentTaskService.addComment(taskId, req.body, req);
    return res.status(201).json(comment);
  } catch (error: any) {
    const message = error?.message || 'Failed to add comment.';
    return res.status(message === 'Forbidden.' ? 403 : 400).json({ message });
  }
};

export const listAttachments = async (req: AuthRequest, res: Response) => {
  try {
    const taskId = getParam(req.params.taskId);
    if (!taskId) return res.status(400).json({ message: 'Task id is required.' });
    const items = await independentTaskService.listAttachments(taskId, req);
    return res.json(items);
  } catch (error: any) {
    const message = error?.message || 'Failed to load attachments.';
    return res.status(message === 'Forbidden.' ? 403 : 400).json({ message });
  }
};

export const addAttachment = async (req: AuthRequest, res: Response) => {
  try {
    const taskId = getParam(req.params.taskId);
    if (!taskId) return res.status(400).json({ message: 'Task id is required.' });
    const item = await independentTaskService.addAttachment(taskId, req.file, req.body, req);
    return res.status(201).json(item);
  } catch (error: any) {
    const message = error?.message || 'Failed to upload attachment.';
    return res.status(message === 'Forbidden.' ? 403 : 400).json({ message });
  }
};

export const deleteAttachment = async (req: AuthRequest, res: Response) => {
  try {
    const attachmentId = getParam(req.params.attachmentId);
    if (!attachmentId) return res.status(400).json({ message: 'Attachment id is required.' });
    const result = await independentTaskService.deleteAttachment(attachmentId, req);
    return res.json(result);
  } catch (error: any) {
    const message = error?.message || 'Failed to delete attachment.';
    return res.status(message === 'Forbidden.' ? 403 : 400).json({ message });
  }
};
