import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { getFirmReports, getMyProductivityEarningsReport } from '../controllers/firmReportsController';

const router = express.Router();

const STAFF_REPORT_ROLES = [
  'managing_director',
  'managing_partner',
  'executive_managing_partner',
  'senior_partner',
  'partner',
  'executive_partner',
  'associate_partner',
  'executive_associate_partner',
  'senior_associate',
  'senior_executive_assistant',
  'associate',
  'trainee_associate',
  'executive_assistant',
  'originating_attorney',
  'intern',
];

const MANAGEMENT_REPORT_ROLES = [
  'managing_director',
  'managing_partner',
  'executive_managing_partner',
  'executive_assistant',
];

router.get(
  '/reports/my-productivity',
  authenticate,
  authorize(STAFF_REPORT_ROLES),
  getMyProductivityEarningsReport
);

router.get(
  '/reports/firm',
  authenticate,
  authorize(MANAGEMENT_REPORT_ROLES),
  getFirmReports
);

export default router;
