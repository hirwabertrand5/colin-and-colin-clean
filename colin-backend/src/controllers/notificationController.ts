import { Response } from 'express';
import mongoose from 'mongoose';
import Notification from '../models/notificationModel';
import { AuthRequest } from '../middleware/authMiddleware';

export const listMyNotifications = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized.' });

    const { filter = 'all' } = req.query as any;
    const me = new mongoose.Types.ObjectId(req.user.id);

    const q: any = {
      $or: [{ audienceUserIds: me }, { audienceRoles: req.user.role }],
    };

    if (filter === 'unread') {
      q.isReadBy = { $ne: me };
    }

    if (filter && filter !== 'all' && filter !== 'unread') {
      q.type = String(filter);
    }

    const items = await Notification.find(q).sort({ createdAt: -1 }).limit(200).lean();
    res.json(items);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to fetch notifications.' });
  }
};

export const markAllAsRead = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized.' });

    const me = new mongoose.Types.ObjectId(req.user.id);

    await Notification.updateMany(
      {
        $or: [{ audienceUserIds: me }, { audienceRoles: req.user.role }],
        isReadBy: { $ne: me },
      },
      { $addToSet: { isReadBy: me } }
    );

    res.json({ message: 'Marked all as read.' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to mark all as read.' });
  }
};

export const markOneAsRead = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized.' });

    const { id } = req.params;
    const me = new mongoose.Types.ObjectId(req.user.id);

    const updated = await Notification.findByIdAndUpdate(
      id,
      { $addToSet: { isReadBy: me } },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ message: 'Notification not found.' });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to mark notification as read.' });
  }
};