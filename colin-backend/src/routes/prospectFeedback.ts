import express from 'express';
import {
  getProspectFeedback,
  upsertProspectFeedback,
  triggerProspectFeedbackEmail,
  publicSubmitProspectFeedback,
  googleFormWebhook,
} from '../controllers/prospectFeedbackController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/:prospectId', authenticate, getProspectFeedback);
router.put('/:prospectId', authenticate, upsertProspectFeedback);
router.post('/:prospectId/send-email', authenticate, triggerProspectFeedbackEmail);
router.post('/public/:prospectId', publicSubmitProspectFeedback as any);
router.post('/google-webhook', googleFormWebhook as any);

export default router;
