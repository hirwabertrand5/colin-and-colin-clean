import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { getExecutiveAssistantDashboard, getStaffDashboardSummary } from '../controllers/dashboardController';

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

// Staff member dashboard — every metric comes from the matters the signed-in
// user is assigned to (Initiator / Reviewer / Signer-Approver).
router.get('/dashboard/staff-summary', authenticate, getStaffDashboardSummary);

export default router;