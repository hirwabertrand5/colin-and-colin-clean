import { randomUUID } from 'node:crypto';
import EmailDelivery from '../models/emailDeliveryModel';
import User from '../models/userModel';
import NotificationPreferences from '../models/notificationPreferencesModel';
import Notification from '../models/notificationModel';
import EmailWebhook from '../models/emailWebhookModel';
import { reminderIsCurrent } from './reminderValidityService';
import { sendEmailResend, validEmail } from './emailResendService';
import { categoryForType, prefAllows, notificationEmailEnabled, emailAllowedInRollout } from './notificationPolicy';
import { buildNotificationEmail } from './notificationTemplateService';

export const queueNotificationEmail = async (notification: any) => {
  const category = categoryForType(notification.type);
  if (!category) return;
  const users = await User.find({ isActive: { $ne: false }, $or: [
    { _id: { $in: notification.audienceUserIds || [] } }, { role: { $in: notification.audienceRoles || [] } },
  ] }).select('_id email').lean();
  const prefs = await NotificationPreferences.find({ userId: { $in: users.map(user => user._id) } }).lean();
  const prefMap = new Map(prefs.map(pref => [String(pref.userId), pref]));
  const recipients = new Map<string, { userId?: any; prefs?: any }>();
  for (const user of users) recipients.set(String(user.email || '').trim().toLowerCase(), { userId: user._id, prefs: prefMap.get(String(user._id)) });
  // Finance copy is restricted to financial events and never exposes legal matter contents.
  const finance = String(process.env.FINANCE_ALERT_EMAIL || '').trim().toLowerCase();
  if (finance && ['PETTY_CASH_LOW', 'PETTY_CASH_CREATED', 'PETTY_CASH_DIGEST'].includes(notification.type) && !recipients.has(finance)) {
    const account = await User.findOne({ email: finance }).select('_id isActive').lean();
    if (!account || account.isActive !== false) recipients.set(finance, account ? { userId: account._id, prefs: await NotificationPreferences.findOne({ userId: account._id }).lean() } : {});
  }
  for (const [to, recipient] of recipients) {
    let reason = '';
    if (!prefAllows(recipient.prefs, category, notification.type)) reason = 'PREFERENCES_DISABLED';
    else if (!notificationEmailEnabled()) reason = 'ROLLOUT_DISABLED';
    else if (!emailAllowedInRollout(to)) reason = 'ROLLOUT_ALLOWLIST';
    const invalid = !validEmail(to);
    const key = `${notification._id}:${to || String(recipient.userId)}`;
    await EmailDelivery.updateOne({ key }, { $setOnInsert: {
      key, notificationId: notification._id, ...(recipient.userId ? { userId: recipient.userId } : {}), to: to || '(missing)', category,
      subject: notification.title, html: buildNotificationEmail(notification),
      nextAttemptAt: notification.createdAt || new Date(),
      status: invalid ? 'failed' : reason ? 'suppressed' : 'pending',
      lastCode: invalid ? 'EMAIL_RECIPIENT_INVALID' : reason,
      lastError: invalid ? 'The recipient has no valid email address.' : '',
    } }, { upsert: true }).catch((error: any) => { if (error.code !== 11000) throw error; });
  }
};

// Atomic leases coordinate multiple servers. The same provider idempotency key
// is reused if a process crashes between sending and recording the response.
export const processEmailDeliveries = async (now = new Date(), limit = 25) => {
  for (const notification of await Notification.find({ emailQueueState: { $in: ['pending', 'failed'] } }).limit(25).lean()) {
    try { await queueNotificationEmail(notification); await Notification.updateOne({ _id: notification._id }, { $set: { emailQueueState: 'complete' } }); }
    catch { await Notification.updateOne({ _id: notification._id }, { $set: { emailQueueState: 'failed' } }); }
  }
  await applyEmailWebhooks();
  if (!notificationEmailEnabled()) return 0;
  let processed = 0;
  for (; processed < limit; processed++) {
    const claimId = randomUUID();
    const delivery = await EmailDelivery.findOneAndUpdate({ $or: [
      { status: 'pending', nextAttemptAt: { $lte: now } },
      { status: 'processing', leaseUntil: { $lte: now } },
    ] }, { $set: { status: 'processing', claimId, leaseUntil: new Date(now.getTime() + 120000) }, $inc: { attempts: 1 } }, { returnDocument: 'after', sort: { nextAttemptAt: 1 } });
    if (!delivery) break;
    const filter = { _id: delivery._id, status: 'processing', claimId };
    // Never repeat an ambiguous send after Resend's 24-hour idempotency window.
    if (delivery.firstAttemptAt && now.getTime() - delivery.firstAttemptAt.getTime() > 23 * 3600000) {
      await EmailDelivery.updateOne(filter, { $set: { status: 'failed', lastCode: 'RETRY_WINDOW_EXPIRED', lastError: 'Review provider logs before any manual resend.' } });
      continue;
    }
    const notification = await Notification.findById(delivery.notificationId).lean();
    const user = delivery.userId ? await User.findById(delivery.userId).select('isActive email').lean() : null;
    const prefs = delivery.userId ? await NotificationPreferences.findOne({ userId: delivery.userId }).lean() : null;
    if (!notification || !(await reminderIsCurrent(notification, now)) || (delivery.userId && (!user || user.isActive === false || user.email !== delivery.to)) || !prefAllows(prefs, delivery.category, notification?.type) || !emailAllowedInRollout(delivery.to)) {
      await EmailDelivery.updateOne(filter, { $set: { status: 'suppressed', lastCode: 'RECIPIENT_OR_PREFERENCES_CHANGED' } });
      continue;
    }
    await EmailDelivery.updateOne(filter, { $set: { firstAttemptAt: delivery.firstAttemptAt || now } });
    const result = await sendEmailResend([delivery.to], delivery.subject, delivery.html, { idempotencyKey: `notification/${delivery._id}` });
    if (result.ok) await EmailDelivery.updateOne(filter, { $set: { status: 'sent', providerId: result.id, lastCode: '', lastError: '' }, $unset: { leaseUntil: 1, claimId: 1 } });
    else {
      const retry = result.retryable && delivery.attempts < 5;
      const minutes = [1, 5, 15, 60][Math.min(delivery.attempts - 1, 3)]!;
      await EmailDelivery.updateOne(filter, { $set: { status: retry ? 'pending' : 'failed', lastCode: result.code, lastError: result.error, nextAttemptAt: new Date(now.getTime() + minutes * 60000) }, $unset: { leaseUntil: 1, claimId: 1 } });
    }
  }
  return processed;
};

export const applyEmailWebhooks = async () => {
  for (const event of await EmailWebhook.find({ applied: false }).sort({ occurredAt: 1 }).limit(100).lean()) {
    const delivery = await EmailDelivery.findOne({ providerId: event.providerId }).lean();
    if (!delivery) continue; // Provider can call back before the send result is saved.
    if (!['bounced', 'complained'].includes(delivery.status) && (!delivery.providerEventAt || delivery.providerEventAt <= event.occurredAt)) {
      await EmailDelivery.updateOne({ _id: delivery._id, status: { $nin: ['bounced', 'complained'] }, $or: [{ providerEventAt: { $exists: false } }, { providerEventAt: { $lte: event.occurredAt } }] }, { $set: {
        status: event.status, providerEventAt: event.occurredAt,
        ...(['bounced', 'complained', 'failed'].includes(event.status) ? { lastCode: `PROVIDER_${event.status.toUpperCase()}`, lastError: 'Resend reported a delivery failure. Review provider logs.' } : {}),
      } });
    }
    await EmailWebhook.updateOne({ _id: event._id }, { $set: { applied: true } });
  }
};
