import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { getExecutiveAssistantDashboard } from '../controllers/dashboardController';

const router = express.Router();

router.get(
  '/dashboard/executive-assistant',
  authenticate,
  authorize([
    'managing_director',
    'managing_partner',
    'senior_partner',
    'partner',
    'associate_partner',
    'executive_assistant',
  ]),
  getExecutiveAssistantDashboard
);

export default router;