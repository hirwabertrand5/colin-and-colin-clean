import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { getMyPerformance, getTeamPerformance } from '../controllers/performanceController';

const router = express.Router();

router.get('/performance/me', authenticate, getMyPerformance);
router.get('/performance/team', authenticate, authorize(['managing_director']), getTeamPerformance);

export default router;