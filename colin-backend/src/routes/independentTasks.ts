import express from 'express';
import { authenticate } from '../middleware/authMiddleware';
import {
  addAttachment,
  addComment,
  createTask,
  dashboard,
  deleteAttachment,
  deleteTask,
  getTask,
  listAttachments,
  listComments,
  listHistory,
  listTasks,
  transitionTask,
  updateTask,
  upload,
} from '../modules/independentTasks/controllers/independentTaskController';

const router = express.Router();

router.get('/independent-tasks/dashboard', authenticate, dashboard);
router.get('/independent-tasks', authenticate, listTasks);
router.post('/independent-tasks', authenticate, createTask);
router.get('/independent-tasks/:taskId', authenticate, getTask);
router.put('/independent-tasks/:taskId', authenticate, updateTask);
router.delete('/independent-tasks/:taskId', authenticate, deleteTask);
router.post('/independent-tasks/:taskId/transition', authenticate, transitionTask);

router.get('/independent-tasks/:taskId/history', authenticate, listHistory);
router.get('/independent-tasks/:taskId/comments', authenticate, listComments);
router.post('/independent-tasks/:taskId/comments', authenticate, addComment);

router.get('/independent-tasks/:taskId/attachments', authenticate, listAttachments);
router.post('/independent-tasks/:taskId/attachments', authenticate, upload.single('file'), addAttachment);
router.delete('/independent-task-attachments/:attachmentId', authenticate, deleteAttachment);

export default router;
