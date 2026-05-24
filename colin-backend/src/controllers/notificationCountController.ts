import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import Notification from '../models/notificationModel';

export const getUnreadNotificationCount = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized.' });

    const me = new mongoose.Types.ObjectId(req.user.id);

    const count = await Notification.countDocuments({
      $or: [{ audienceUserIds: me }, { audienceRoles: req.user.role }],
      isReadBy: { $ne: me },
    });

    res.json({ unread: count });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to load unread count.' });
  }
};