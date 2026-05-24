import express from 'express';
import {
  getAllCases,
  createCase,
  getCaseById,
  updateCase,
  deleteCase,
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

router.post('/', authenticate, createCase);
router.put('/:id', authenticate, updateCase);
router.delete('/:id', authenticate, deleteCase);

export default router;