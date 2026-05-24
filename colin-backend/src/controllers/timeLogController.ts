import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import TaskTimeLog from '../models/taskTimeLogModel';

export const getMyTimeLogSummary = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized.' });

    const { from, to } = req.query as any;

    if (!from || !to) {
      return res.status(400).json({ message: 'from and to are required (YYYY-MM-DD).' });
    }

    const fromDate = new Date(String(from));
    const toDate = new Date(String(to));

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ message: 'Invalid from/to dates.' });
    }

    // make "to" inclusive
    toDate.setHours(23, 59, 59, 999);

    const userObjectId = new mongoose.Types.ObjectId(req.user.id);

    const agg = await TaskTimeLog.aggregate([
      {
        $match: {
          userId: userObjectId,
          loggedAt: { $gte: fromDate, $lte: toDate },
        },
      },
      {
        $group: {
          _id: null,
          totalHours: { $sum: '$hours' },
        },
      },
    ]);

    const totalHours = agg?.[0]?.totalHours ? Number(agg[0].totalHours) : 0;

    res.json({ totalHours: Math.round(totalHours * 10) / 10 });
  } catch {
    res.status(500).json({ message: 'Failed to compute time log summary.' });
  }
};