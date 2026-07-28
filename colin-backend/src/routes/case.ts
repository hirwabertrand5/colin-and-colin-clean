import express from 'express';
import {
  getAllCases,
  createCase,
  getCaseById,
  updateCase,
  deleteCase,
  requestTakeCase,
  approveTakeRequest,
  denyTakeRequest,
  setCaseOperationalStatus,
} from '../controllers/caseController.js';

import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * ✅ Option 2:
 * - MD + Exec: full CRUD
 * - Associate: can GET only their assigned cases (controller enforces)
 */
router.get('/', authenticate, getAllCases);
router.get('/:id', authenticate, getCaseById);
router.post('/:id/take-request', authenticate, requestTakeCase);
router.post('/:id/take-request/:requestId/approve', authenticate, approveTakeRequest);
router.post('/:id/take-request/:requestId/deny', authenticate, denyTakeRequest);
router.post('/:id/operational-status', authenticate, setCaseOperationalStatus);

router.post('/', authenticate, createCase);
router.put('/:id', authenticate, updateCase);
router.delete('/:id', authenticate, deleteCase);

export default router;
