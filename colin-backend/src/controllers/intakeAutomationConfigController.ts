import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import {
  getIntakeAutomationConfig,
  updateIntakeAutomationConfig,
} from '../services/intakeAutomationConfig';

const cleanString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export const getIntakeAutomationConfigController = async (_req: AuthRequest, res: Response) => {
  try {
    return res.json(getIntakeAutomationConfig());
  } catch (error) {
    console.error('getIntakeAutomationConfigController error:', error);
    return res.status(500).json({ message: 'Failed to load intake automation config.' });
  }
};

export const updateIntakeAutomationConfigController = async (req: AuthRequest, res: Response) => {
  try {
    const nextConfig = updateIntakeAutomationConfig({
      googleFormBaseUrl: cleanString(req.body?.googleFormBaseUrl),
      googleFormEntryId: cleanString(req.body?.googleFormEntryId),
    });

    return res.json(nextConfig);
  } catch (error) {
    console.error('updateIntakeAutomationConfigController error:', error);
    return res.status(500).json({ message: 'Failed to update intake automation config.' });
  }
};
