import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { getRecentAuditFeed } from '../controllers/auditFeedController';

const router = express.Router();

router.get(
  '/audit/recent',
  authenticate,
  authorize(['managing_director']),
  getRecentAuditFeed
);

export default router;