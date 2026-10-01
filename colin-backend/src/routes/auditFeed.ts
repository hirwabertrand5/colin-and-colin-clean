import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { getMyAuditTrail, getRecentAuditFeed } from '../controllers/auditFeedController';

const router = express.Router();

router.get(
  '/audit/recent',
  authenticate,
  authorize(['managing_director']),
  getRecentAuditFeed
);

// Every authenticated member's own activity trail (staff dashboards).
router.get('/audit/mine', authenticate, getMyAuditTrail);

export default router;