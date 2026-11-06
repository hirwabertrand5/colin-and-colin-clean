import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { sendTestEmail } from '../controllers/adminEmailController';
import { getEmailDeliveryStatus } from '../controllers/emailDeliveryController';

const router = express.Router();

router.post('/admin/email/test', authenticate, authorize(['managing_director']), sendTestEmail);
router.get('/admin/email/status', authenticate, authorize(['managing_director']), getEmailDeliveryStatus);

export default router;
