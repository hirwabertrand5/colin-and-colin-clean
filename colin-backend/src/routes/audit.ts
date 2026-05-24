import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { getAuditForCase } from '../controllers/auditController';
import { getRecentAuditFeed } from '../controllers/auditFeedController';

const router = express.Router();

router.get('/cases/:caseId/audit', authenticate, getAuditForCase);

// MD-only activity feed
router.get(
  '/audit/recent',
  authenticate,
  authorize(['managing_director']),
  getRecentAuditFeed
);

export default router;