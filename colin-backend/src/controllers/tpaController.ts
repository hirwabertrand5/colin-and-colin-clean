import { Response } from 'express';
import mongoose from 'mongoose';
import User from '../models/userModel';
import AuditLog from '../models/auditLogModel';
import { AuthRequest } from '../middleware/authMiddleware';
import { getTpaPercent } from '../utils/workflowPercentages';
import { previewTpaImpact } from '../services/tpaImpactService';
import { resolveTpaRate, proposeTpaHistory } from '../utils/tpaRates';

export const TPA_ADMIN_ROLES = ['managing_partner', 'managing_director', 'executive_assistant'];

export const manageTpa = async (req: AuthRequest, res: Response) => {
  if (!req.user || !TPA_ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ message: 'TPA management permission required.' });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid user.' });
  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const user = await User.findById(req.params.id).session(session);
      if (!user) throw new Error('User not found.');
      const now = new Date();
      const history: any[] = JSON.parse(JSON.stringify(user.tpaHistory || []));
      if (req.method === 'GET') {
        const applicable = history.filter(r => +new Date(r.from) <= +now && (!r.until || +now < +new Date(r.until)));
        result = { history, revision: user.tpaRevision || 0, currentRate: resolveTpaRate(history, now, getTpaPercent(user.role)), defaultRate: getTpaPercent(user.role),
          normal: applicable.find(r => r.kind === 'normal') || null, special: applicable.find(r => r.kind === 'special') || null,
          timeZone: 'Africa/Kigali', serverNow: now.toISOString() };
        return;
      }
      const proposed = proposeTpaHistory(history, req.body, getTpaPercent(user.role), req.user!.id, now);
      const impact = await previewTpaImpact(user, proposed.history, session);
      if (req.body.preview) { result = impact; return; }
      if (impact.savedEarningsAffected) throw new Error('Backdated change overlaps saved earnings. An explicit financial correction is required.');
      if (req.body.revision !== (user.tpaRevision || 0)) throw new Error('TPA changed concurrently. Reload and review again.');
      const nextHistory = proposed.history;
      const updated = await User.updateOne({ _id: user._id, tpaRevision: user.tpaRevision ? user.tpaRevision : { $in: [0, null] } }, { $set: { tpaHistory: nextHistory }, $inc: { tpaRevision: 1 } }, { session, runValidators: true });
      if (!updated.modifiedCount) throw new Error('Concurrent TPA update. Reload and retry.');
      await AuditLog.create([{ caseId: new mongoose.Types.ObjectId('000000000000000000000000'), actorUserId: req.user!.id, actorName: req.user!.name, action: 'USER_TPA_CHANGED', message: `TPA ${req.body.kind} for ${user.name}`, detail: JSON.stringify({ userId: user.id, before: user.tpaHistory, after: nextHistory, reason: req.body.reason }) }], { session });
      result = { message: 'TPA updated; history preserved.' };
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ message: error.message || 'TPA update failed.' });
  } finally { await session.endSession(); }
};
