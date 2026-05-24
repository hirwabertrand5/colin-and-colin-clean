import express from 'express';
import { authenticate } from '../middleware/authMiddleware';
import { getMyTimeLogSummary } from '../controllers/timeLogController';

const router = express.Router();

router.get('/summary', authenticate, getMyTimeLogSummary);

export default router;