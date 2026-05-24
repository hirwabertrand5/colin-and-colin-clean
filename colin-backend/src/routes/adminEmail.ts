import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { sendTestEmail } from '../controllers/adminEmailController';

const router = express.Router();

router.post('/admin/email/test', authenticate, authorize(['managing_director']), sendTestEmail);

export default router;