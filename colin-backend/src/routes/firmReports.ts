import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { getFirmReports } from '../controllers/firmReportsController';

const router = express.Router();

router.get(
  '/reports/firm',
  authenticate,
  authorize(['managing_director', 'executive_assistant']),
  getFirmReports
);

export default router;