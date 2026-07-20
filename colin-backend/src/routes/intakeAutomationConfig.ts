import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import {
  getIntakeAutomationConfigController,
  updateIntakeAutomationConfigController,
} from '../controllers/intakeAutomationConfigController';

const router = express.Router();

router.get('/intake-automation-config', authenticate, authorize(['managing_director', 'managing_partner', 'executive_managing_partner', 'executive_assistant']), getIntakeAutomationConfigController);
router.put('/intake-automation-config', authenticate, authorize(['managing_director', 'managing_partner', 'executive_managing_partner', 'executive_assistant']), updateIntakeAutomationConfigController);

export default router;
