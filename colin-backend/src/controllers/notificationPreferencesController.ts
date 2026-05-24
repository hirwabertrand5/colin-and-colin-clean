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
  role === 'intern';

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
      'taskDueReminderHours',
      'eventReminderHours',
    ] as const;

    const updates: any = {};
    for (const k of allowedFields) {
      if (k in req.body) updates[k] = (req.body as any)[k];
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
      { new: true, upsert: true }
    ).lean();

    res.json(pref);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to save notification preferences.' });
  }
};
