import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { getBillingSummary } from '../controllers/billingController';
import { getFinanceWorkspace } from '../controllers/financeWorkspaceController';

const router = express.Router();

router.get('/billing/workspace/:section', authenticate,
  authorize(['managing_director', 'managing_partner', 'executive_managing_partner', 'executive_assistant']), getFinanceWorkspace);

router.get(
  '/billing/summary',
  authenticate,
  authorize(['managing_director', 'executive_assistant']),
  getBillingSummary
);

export default router;
