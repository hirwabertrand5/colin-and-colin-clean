import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import {
  listReportsForCase,
  generateReportForCase,
  getReportById,
  downloadReportPdf,
} from '../controllers/clientReportController';

const router = express.Router();

const ROLES = ['managing_director', 'executive_assistant'];

router.get('/cases/:caseId/reports', authenticate, authorize(ROLES), listReportsForCase);
router.post('/cases/:caseId/reports/generate', authenticate, authorize(ROLES), generateReportForCase);

router.get('/reports/:reportId', authenticate, authorize(ROLES), getReportById);

// ✅ NEW: PDF download
router.get('/reports/:reportId/pdf', authenticate, authorize(ROLES), downloadReportPdf);

export default router;