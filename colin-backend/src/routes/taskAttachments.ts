import express from 'express';
import { authenticate } from '../middleware/authMiddleware';
import { upload } from '../controllers/documentController';
import {
  listAttachmentsForTask,
  uploadAttachmentToTask,
  deleteTaskAttachment,
} from '../controllers/taskAttachmentController';

const router = express.Router();

router.get('/tasks/:taskId/attachments', authenticate, listAttachmentsForTask);
router.post('/tasks/:taskId/attachments', authenticate, upload.single('file'), uploadAttachmentToTask);
router.delete('/task-attachments/:attachmentId', authenticate, deleteTaskAttachment);

export default router;