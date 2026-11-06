import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import NotificationPreferences from '../models/notificationPreferencesModel';

const isAllowed = (role?: string) =>
  role === 'managing_director' ||
  role === 'managing_partner' ||
  role === 'senior_partner' ||
  role === 'partner' ||
  role === 'associate_partner' ||
  role === 'executive_assistant' ||
  role === 'senior_associate' ||
  role === 'associate' ||
  role === 'trainee_associate' ||
  role === 'intern' ||
  role === 'executive_managing_partner' || role === 'executive_partner' ||
  role === 'executive_associate_partner' || role === 'senior_executive_assistant' || role === 'originating_attorney';

export const getMyNotificationPreferences = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id || !isAllowed(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const userId = new mongoose.Types.ObjectId(req.user.id);

    const pref =
      (await NotificationPreferences.findOne({ userId }).lean()) ||
      (await NotificationPreferences.create({ userId })).toObject();

    res.json(pref);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to load notification preferences.' });
  }
};

export const updateMyNotificationPreferences = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id || !isAllowed(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const userId = new mongoose.Types.ObjectId(req.user.id);

    const allowedFields = [
      'emailEnabled',
      'deadlinesEnabled',
      'taskAssignmentsEnabled',
      'approvalsEnabled',
      'pettyCashLowEnabled',
      'mattersEnabled', 'pettyCashCreatedEnabled', 'pettyCashExpensesEnabled', 'pettyCashExpenseMode', 'overdueEscalationHours',
      'taskDueReminderHours',
      'eventReminderHours',
    ] as const;

    const updates: any = {};
    for (const k of allowedFields) {
      if (!(k in req.body)) continue;
      const value = req.body[k];
      if (k.endsWith('Enabled') && typeof value !== 'boolean') return res.status(400).json({ message: `${k} must be a boolean.` });
      if (['taskDueReminderHours', 'overdueEscalationHours'].includes(k) && (!Number.isInteger(value) || value < 1 || value > 168)) return res.status(400).json({ message: `${k} must be between 1 and 168 hours.` });
      if (k === 'pettyCashExpenseMode' && !['daily', 'immediate', 'off'].includes(value)) return res.status(400).json({ message: 'Choose daily, immediate or off for petty cash expenses.' });
      if (k === 'eventReminderHours' && (!Array.isArray(value) || !value.length || value.length > 10 || value.some((n: any) => typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 168))) return res.status(400).json({ message: 'Provide 1 to 10 event reminder hours between 0 and 168.' });
      updates[k] = value;
    }

    // normalize
    if (Array.isArray(updates.eventReminderHours)) {
      updates.eventReminderHours = updates.eventReminderHours
        .map((n: any) => Number(n))
        .filter((n: number) => Number.isFinite(n) && n > 0 && n <= 168);
      if (updates.eventReminderHours.length === 0) updates.eventReminderHours = [24, 2];
    }

    const pref = await NotificationPreferences.findOneAndUpdate(
      { userId },
      { $set: updates },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    res.json(pref);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to save notification preferences.' });
  }
};
