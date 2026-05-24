import express from 'express';
import {
  getAllProspects,
  getProspectById,
  createProspect,
  updateProspect,
  deleteProspect,
  getProspectStats,
  convertProspectToMatter,
} from '../controllers/prospectController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * Prospect endpoints
 * - GET /prospects - list all prospects (with filters)
 * - GET /prospects/:id - get specific prospect
 * - POST /prospects - create new prospect
 * - PUT /prospects/:id - update prospect
 * - DELETE /prospects/:id - delete prospect
 * - GET /prospects/stats - get prospect stats by stage
 * - POST /prospects/:id/convert - convert prospect to active matter
 */

router.get('/stats', authenticate, getProspectStats);
router.get('/', authenticate, getAllProspects);
router.get('/:id', authenticate, getProspectById);
router.post('/', authenticate, createProspect);
router.put('/:id', authenticate, updateProspect);
router.delete('/:id', authenticate, deleteProspect);
router.post('/:id/convert', authenticate, convertProspectToMatter);

export default router;
