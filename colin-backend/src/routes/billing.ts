import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { getBillingSummary } from '../controllers/billingController';

const router = express.Router();

router.get(
  '/billing/summary',
  authenticate,
  authorize(['managing_director', 'executive_assistant']),
  getBillingSummary
);

export default router;