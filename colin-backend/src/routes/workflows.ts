import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import {
  listActiveTemplates,
  listAllTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getWorkflowForCase,
  initWorkflowForCase,
  attachOutputDocument,
  completeStep,
  reopenStep,
  extendStepDeadline,
  toggleStepAction,
  setStepFeeAmount,
} from '../controllers/workflowController';

const router = express.Router();
const ADMIN_ROLES = ['managing_director', 'executive_assistant'];

// Templates
router.get('/templates/active', authenticate, listActiveTemplates);
router.get('/templates', authenticate, authorize(ADMIN_ROLES), listAllTemplates);
router.get('/templates/:templateId', authenticate, getTemplateById);
router.post('/templates', authenticate, authorize(ADMIN_ROLES), createTemplate);
router.put('/templates/:templateId', authenticate, authorize(ADMIN_ROLES), updateTemplate);
router.delete('/templates/:templateId', authenticate, authorize(ADMIN_ROLES), deleteTemplate);

// Instances
router.get('/cases/:caseId', authenticate, getWorkflowForCase);
router.post('/cases/:caseId/init', authenticate, authorize(ADMIN_ROLES), initWorkflowForCase);

// Outputs
router.post(
  '/cases/:caseId/steps/:stepKey/outputs/:outputKey/attach',
  authenticate,
  attachOutputDocument
);

// Step completion (admin only)
router.post(
  '/cases/:caseId/steps/:stepKey/complete',
  authenticate,
  authorize(ADMIN_ROLES),
  completeStep
);

// Step reopening (admin only)
router.post(
  '/cases/:caseId/steps/:stepKey/reopen',
  authenticate,
  authorize(ADMIN_ROLES),
  reopenStep
);

// Deadline extension (admin only)
router.post(
  '/cases/:caseId/steps/:stepKey/extend-deadline',
  authenticate,
  authorize(ADMIN_ROLES),
  extendStepDeadline
);

// Key actions (admin only)
router.patch(
  '/cases/:caseId/steps/:stepKey/actions/:index/toggle',
  authenticate,
  authorize(ADMIN_ROLES),
  toggleStepAction
);

// Fee overrides (admin only)
router.put(
  '/cases/:caseId/steps/:stepKey/fee',
  authenticate,
  authorize(ADMIN_ROLES),
  setStepFeeAmount
);

export default router;
