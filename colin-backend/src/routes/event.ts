import express from 'express';
import {
  getEventsForCase,
  addEventToCase,
  getEventById,
  updateEvent,
  deleteEvent,
} from '../controllers/eventController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

// Events for a case
router.get('/cases/:caseId/events', authenticate, getEventsForCase);
router.post('/cases/:caseId/events', authenticate, addEventToCase);

// Single event
router.get('/events/:eventId', authenticate, getEventById);
router.put('/events/:eventId', authenticate, updateEvent);
router.delete('/events/:eventId', authenticate, deleteEvent);

export default router;