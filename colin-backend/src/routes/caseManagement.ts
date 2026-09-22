import express from 'express';
import { authenticate } from '../middleware/authMiddleware';
import {
  getCaseManagement,
  requestReview,
  requestApproval,
  approveStep,
  setQualityScore,
} from '../controllers/caseManagementController';

const router = express.Router();

// Case Management — driven by the case's three assigned members
// (Case Initiator, Reviewer, Signer/Approver) and the workflow template's
// Key Actions. Lifecycle: work → request review → review → request approval →
// approve → Key Action completed.
router.get('/cases/:caseId', authenticate, getCaseManagement);
router.post('/cases/:caseId/request-review', authenticate, requestReview);
router.post('/cases/:caseId/request-approval', authenticate, requestApproval);
router.post('/cases/:caseId/approve', authenticate, approveStep);
router.put('/cases/:caseId/quality-score', authenticate, setQualityScore);

export default router;