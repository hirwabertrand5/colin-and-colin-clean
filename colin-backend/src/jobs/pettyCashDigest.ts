import Notification from '../models/notificationModel';
import PettyCashFund from '../models/pettyCashFundModel';
import { createNotification } from '../services/notifyService';
import { localDateKey, localHour } from '../utils/notificationTime';

/** Summarize committed financial notifications rather than recomputing balances
 * from mutable expenses. Every row captures the actual balance after that action. */
export const runPettyCashDigest = async (now = new Date()) => {
  const hour = Number(process.env.PETTY_CASH_DIGEST_HOUR || 8);
  if (localHour(now) < hour) return;
  const day = localDateKey(now);
  // Send the previous complete calendar day, even after a restart later today.
  const yesterday = localDateKey(new Date(now.getTime() - 86400000));
  const rows = await Notification.find({ type: { $in: ['PETTY_CASH_EXPENSE', 'PETTY_CASH_REFUND'] }, createdAt: { $gte: new Date(now.getTime() - 72 * 3600000), $lte: now } }).sort({ createdAt: 1 }).lean();
  const yesterdayRows = rows.filter(row => localDateKey(row.createdAt) === yesterday);
  if (!yesterdayRows.length) return;
  const funds = await PettyCashFund.find({ _id: { $in: [...new Set(yesterdayRows.filter(row => row.fundId).map(row => String(row.fundId)))] } }).lean();
  const lines = yesterdayRows.map(row => `${row.title}: ${row.message}`);
  // Current balances are explicitly labelled, not presented as yesterday's close.
  const balances = funds.map(fund => `${fund.name} — current balance RWF ${Number(fund.remainingAmount).toLocaleString('en-GB')}`);
  await createNotification({ type: 'PETTY_CASH_DIGEST', title: `Petty cash daily summary — ${yesterday}`,
    message: `${yesterdayRows.length} recorded activity item(s) for ${yesterday}.\n\n${lines.join('\n\n')}\n\n${balances.join('\n')}`,
    audienceRoles: ['managing_director', 'executive_assistant'], link: '/petty-cash', dedupeKey: `PETTY_CASH_DIGEST:${day}:${yesterday}` });
};
