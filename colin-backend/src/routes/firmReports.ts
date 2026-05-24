import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { getFirmReports } from '../controllers/firmReportsController';

const router = express.Router();

router.get(
  '/reports/firm',
  authenticate,
  authorize(['managing_director']),
  getFirmReports
);

export default router;