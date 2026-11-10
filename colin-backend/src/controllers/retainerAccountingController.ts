import type { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Period from '../models/retainerPeriodModel';
import User from '../models/userModel';
import Case from '../models/caseModel';
import Invoice from '../models/invoiceModel';
import { canManage } from './retainerController';
import { changePeriod, createPeriod, getPeriod, addService, recordReceipt, workCandidates, retainerFinancials, fail, validDay } from '../services/retainerAccountingService';

const text = (value: any) => String(value || '').trim();
const handler = (run: (req: AuthRequest) => Promise<any>) => async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req)) return res.status(403).json({ message: 'Forbidden.' });
    return res.json(await run(req));
  } catch (error: any) {
    return res.status(error.code === 11000 ? 409 : error.name === 'VersionError' ? 409 : ['CastError', 'ValidationError'].includes(error.name) ? 400 : error.status || 500)
      .json({ message: error.code === 11000 ? 'This payment reference or monthly record is already recorded.' : error.message || 'Unable to update retainer accounting.' });
  }
};
export const listPeriods = handler(async (req) => {
  const periods = await Period.find({ retainerId: text(req.params.id) }).sort({ month: -1 }).lean();
  const staff = await User.find({ isActive: { $ne: false }, role: { $ne: 'client' } }).select('_id name role').sort({ name: 1 }).lean();
  const matters = await Case.find({ retainerId: text(req.params.id) }).select('_id').lean();
  const invoices = await Invoice.find({ caseId: { $in: matters.map((m) => m._id) }, status: 'Paid', retainerReceiptId: { $exists: false } }).select('_id invoiceNo amount').lean();
  return { periods, staff, invoices };
});
export const openPeriod = handler((req) => createPeriod(text(req.params.id), text(req.body.month), req.user?.name || 'System'));
export const readPeriod = handler((req) => getPeriod(text(req.params.periodId), text(req.params.id)));
export const candidates = handler((req) => workCandidates(text(req.params.id)));
export const saveService = handler(async (req) => {
  await getPeriod(text(req.params.periodId), text(req.params.id));
  await addService(text(req.params.periodId), req.body, req.user?.name || 'System');
  return getPeriod(text(req.params.periodId));
});
export const saveReceipt = handler(async (req) => {
  await getPeriod(text(req.params.periodId), text(req.params.id));
  await recordReceipt(text(req.params.periodId), req.body, req.user?.name || 'System');
  return getPeriod(text(req.params.periodId));
});
export const revisePeriod = handler(async (req) => {
  await getPeriod(text(req.params.periodId), text(req.params.id));
  await changePeriod(text(req.params.periodId), text(req.params.action), req.body, req.user?.name || 'System');
  return getPeriod(text(req.params.periodId));
});
export const performance = handler(async (req) => {
  const from = text(req.query.from) || null, to = text(req.query.to) || null;
  if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && from > to)) fail('Invalid reporting dates.');
  return retainerFinancials(from, to);
});
