import express from 'express';
import { authenticate } from '../middleware/authMiddleware';
import { getFirmEvents, getCalendarTasks } from '../controllers/calendarController';

const router = express.Router();

router.get('/calendar/events', authenticate, getFirmEvents);
router.get('/calendar/tasks', authenticate, getCalendarTasks);

export default router;