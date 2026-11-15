import { createHash } from 'node:crypto';
import EmailDelivery from '../models/emailDeliveryModel';
import Notification from '../models/notificationModel';
import Case from '../models/caseModel';
import { reminderIsCurrent } from './reminderValidityService';
import { brandedEmail, emailAction, emailParagraph, escapeEmailText } from './emailBranding';
import { absoluteAppLink } from './notificationTemplateService';
import { formatNotificationTime } from '../utils/notificationTime';

export const CASE_REMINDER_SETTLE_MS = 20000;
export const isGroupedCaseReminder = (notification: any) => notification.type === 'TASK_DUE_REMINDER'
  && notification.caseId && notification.deliveryContext?.emailBatch
  && ['workflow', 'task', 'independent'].includes(notification.deliveryContext.kind);

export const queueCaseReminderEmail = async (notification: any, recipient: { to: string; userId?: any }, html: string) => {
  const context = notification.deliveryContext;
  const group = { caseId: notification.caseId, deadlineAt: context.deadlineAt, batch: context.emailBatch };
  const digest = createHash('sha256').update(JSON.stringify([String(group.caseId), group.deadlineAt, group.batch, recipient.to])).digest('hex');
  // Once a send starts, its membership and provider payload stay immutable. A
  // genuinely late action starts a new batch instead of being lost or changing a retry.
  for (let generation = 0; generation < 100; generation++) {
    const key = `case-reminder:${digest}:${generation}`;
    const existing = await EmailDelivery.findOne({ key }).select('status notificationIds firstAttemptAt').lean();
    if (existing?.notificationIds?.some(id => String(id) === String(notification._id))) return;
    if (existing && (existing.status !== 'pending' || existing.firstAttemptAt)) continue;
    try {
      await EmailDelivery.updateOne({ key, status: 'pending', firstAttemptAt: { $exists: false }, notificationIds: { $ne: notification._id } }, {
        $setOnInsert: { key, notificationId: notification._id, ...recipient, category: 'deadlines', subject: notification.title, html, status: 'pending', reminderGroup: group },
        $addToSet: { notificationIds: notification._id },
        // Wait for the scan's other actions, including when several workers queue them.
        $max: { nextAttemptAt: new Date(Date.now() + CASE_REMINDER_SETTLE_MS) },
      }, { upsert: true });
      return;
    } catch (error: any) { if (error.code !== 11000) throw error; generation--; }
  }
  throw new Error('Unable to queue a case reminder batch.');
};

export const currentCaseReminderNotifications = async (delivery: any, now: Date) => {
  const ids = delivery.firstAttemptAt ? delivery.preparedNotificationIds || delivery.notificationIds : delivery.notificationIds;
  const notifications = await Notification.find({ _id: { $in: ids || [] } }).sort({ createdAt: 1, _id: 1 }).lean();
  const current: any[] = [];
  for (let index = 0; index < notifications.length; index += 20) {
    const batch = notifications.slice(index, index + 20);
    const checks = await Promise.all(batch.map(notification => reminderIsCurrent(notification, now)));
    current.push(...batch.filter((_notification, offset) => checks[offset]));
  }
  const unique = new Map<string, any>();
  for (const notification of current) {
    const context = notification.deliveryContext;
    unique.set(JSON.stringify([context.kind, context.entityId, context.stepKey || '']), notification);
  }
  return [...unique.values()];
};

export const buildCaseReminderEmail = async (delivery: any, notifications: any[], now: Date) => {
  const matter = await Case.findById(delivery.reminderGroup.caseId).select('caseNo').lean();
  const caseNo = matter?.caseNo || 'Matter';
  const deadline = formatNotificationTime(new Date(delivery.reminderGroup.deadlineAt));
  const overdue = new Date(delivery.reminderGroup.deadlineAt).getTime() <= now.getTime();
  const subject = `${caseNo}: ${notifications.length} key action${notifications.length === 1 ? '' : 's'} ${overdue ? 'overdue' : 'due'}`;
  const items = notifications.map(notification => {
    let title = String(notification.title).replace(/ — (?:overdue|\d+h reminder)$/, '');
    if (title.startsWith(`${caseNo}: `)) title = title.slice(String(caseNo).length + 2);
    const url = absoluteAppLink(notification.link);
    return `<li style="margin:0 0 14px;padding-left:4px;line-height:1.7;overflow-wrap:anywhere">${url ? `<a href="${escapeEmailText(url)}" style="color:#16254a">${escapeEmailText(title)}</a>` : escapeEmailText(title)}</li>`;
  }).join('');
  const url = absoluteAppLink(`/cases/${delivery.reminderGroup.caseId}`);
  const html = brandedEmail({ title: `${caseNo} · Key action reminders`, eyebrow: 'CASE DEADLINE', preheader: `${notifications.length} key actions · ${deadline}`,
    bodyHtml: emailParagraph(`The following key actions for ${caseNo} share the same deadline.`)
      + `<div style="padding:16px 18px;background:#f7f5f0;border-left:3px solid #bea580;margin:22px 0;font-size:14px;line-height:1.8"><strong>Deadline</strong><br>${escapeEmailText(deadline)}</div>`
      + `<ol style="padding-left:22px;font-size:14px;color:#334155">${items}</ol>`
      + (url ? emailAction('Open case workspace', url) : ''),
    note: 'This email combines your key action reminders for this case and deadline. Individual reminders remain available in your Notification Center.',
  });
  return { subject, html };
};
