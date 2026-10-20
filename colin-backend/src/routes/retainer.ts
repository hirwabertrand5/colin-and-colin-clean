import express from 'express';
import { authenticate } from '../middleware/authMiddleware';
import {
  createRetainer,
  deleteRetainer,
  getRetainer,
  listActiveRetainers,
  listRetainerActivity,
  listRetainerCases,
  listRetainers,
  setCaseRetainer,
  adjustRetainerContractValue,
  updateRetainer,
} from '../controllers/retainerController';

const router = express.Router();

router.get('/active', authenticate, listActiveRetainers);
router.post('/cases/:caseId/link', authenticate, setCaseRetainer);
router.get('/', authenticate, listRetainers);
router.post('/', authenticate, createRetainer);
router.get('/:id', authenticate, getRetainer);
router.put('/:id', authenticate, updateRetainer);
router.delete('/:id', authenticate, deleteRetainer);
router.post('/:id/contract-value-adjustments', authenticate, adjustRetainerContractValue);
// Backward-compatible endpoint for clients deployed during the first retainer release.
router.post('/:id/top-ups', authenticate, adjustRetainerContractValue);
router.get('/:id/cases', authenticate, listRetainerCases);
router.get('/:id/activity', authenticate, listRetainerActivity);

export default router;
