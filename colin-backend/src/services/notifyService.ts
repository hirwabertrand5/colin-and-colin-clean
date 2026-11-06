import mongoose from 'mongoose';
import Notification from '../models/notificationModel';
import User from '../models/userModel';
import type { PrefCategory } from './notificationPolicy';
import { queueNotificationEmail } from './emailDeliveryService';

export const createNotification = async (payload: {
  type: string;
  title: string;
  message: string;
  severity?: 'info' | 'warning' | 'critical';

  audienceUserIds?: string[];
  audienceRoles?: string[];

  link?: string;
  dedupeKey?: string;
  deliveryContext?: { kind: string; entityId: string; deadlineAt: string; stepKey?: string; ownerIdentity?: string; expiresAt?: string };

  caseId?: string;
  taskId?: string;
  eventId?: string;

  fundId?: string;
  expenseId?: string;
}, options?: { session?: mongoose.ClientSession }) => {
  if (payload.dedupeKey) {
    const existing = await Notification.findOne({ dedupeKey: payload.dedupeKey }).session(options?.session || null).lean();
    if (existing) {
      if (!options?.session) await queueNotificationEmail(existing).catch(error => console.error('[notifications] queue failed', String(existing._id), error?.name));
      return existing;
    }
  }

  const notificationPayload: any = {
    type: payload.type,
    title: payload.title,
    message: payload.message,
    severity: payload.severity || 'info',
    emailQueueState: 'pending',
    ...(payload.deliveryContext ? { deliveryContext: payload.deliveryContext } : {}),

    audienceUserIds: (payload.audienceUserIds || []).map((id) => new mongoose.Types.ObjectId(id)),
    audienceRoles: payload.audienceRoles || [],
  };
  if (payload.link) notificationPayload.link = payload.link;
  if (payload.dedupeKey) notificationPayload.dedupeKey = payload.dedupeKey;
  if (payload.dedupeKey) notificationPayload.eventKey = payload.dedupeKey;
  if (payload.caseId) notificationPayload.caseId = new mongoose.Types.ObjectId(payload.caseId);
  if (payload.taskId) notificationPayload.taskId = new mongoose.Types.ObjectId(payload.taskId);
  if (payload.eventId) notificationPayload.eventId = new mongoose.Types.ObjectId(payload.eventId);
  if (payload.fundId) notificationPayload.fundId = new mongoose.Types.ObjectId(payload.fundId);
  if (payload.expenseId) notificationPayload.expenseId = new mongoose.Types.ObjectId(payload.expenseId);

  let doc: any;
  try { doc = await new Notification(notificationPayload).save(options?.session ? { session: options.session } : {}); }
  catch (error: any) {
    if (error.code !== 11000 || !payload.dedupeKey) throw error;
    doc = await Notification.findOne({ eventKey: payload.dedupeKey });
  }
  const notification = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
  if (options?.session) return notification; // Worker sees this only after transaction commit.
  // Provider outages must never undo a successful business action or in-app alert.
  try {
    await queueNotificationEmail(notification);
    await Notification.updateOne({ _id: notification._id }, { $set: { emailQueueState: 'complete' } });
  } catch (error: any) {
    await Notification.updateOne({ _id: notification._id }, { $set: { emailQueueState: 'failed' } }).catch(() => {});
    console.error('[notifications] queue failed', String(notification._id), error?.name);
  }
  return notification;
};

// Lightweight SMS logger / placeholder for SMS provider integration.
// Records SMS attempts as notifications so they are auditable. Replace with provider integration if needed.
export const sendSms = async (phones: string[], message: string, caseId?: string) => {
  if (!Array.isArray(phones) || phones.length === 0) return null;
  const title = 'Workflow SMS';
  const payload: any = {
    type: 'WORKFLOW_SMS',
    title,
    message: `${message}\nRecipients: ${phones.join(', ')}`,
    severity: 'info',
  };
  if (caseId) payload.caseId = new mongoose.Types.ObjectId(caseId);
  const doc: any = await Notification.create(payload);
  return typeof doc?.toObject === 'function' ? doc.toObject() : doc;
};

export const notifyUsersById = async (opts: {
  session?: mongoose.ClientSession;
  userIds: string[];
  category: PrefCategory;

  notification: Omit<Parameters<typeof createNotification>[0], 'audienceUserIds' | 'audienceRoles'>;

  email?: { subject: string; html: string };
}) => {
  const ids = Array.from(new Set(opts.userIds.filter(Boolean).map(String)));
  if (!ids.length) return;

  await createNotification({
    ...opts.notification,
    audienceUserIds: ids,
  }, opts.session ? { session: opts.session } : {});

};

export const notifyRoles = async (opts: {
  session?: mongoose.ClientSession;
  roles: string[];
  category: PrefCategory;

  notification: Omit<Parameters<typeof createNotification>[0], 'audienceUserIds' | 'audienceRoles'>;

  email?: { subject: string; html: string };
}) => {
  const roles = Array.from(new Set(opts.roles.filter(Boolean)));
  if (!roles.length) return;

  // broadcast notification
  await createNotification({
    ...opts.notification,
    audienceRoles: roles,
  }, opts.session ? { session: opts.session } : {});

};

// helper: resolve user by assignee string (name or email)
export const findUserByAssigneeString = async (assignee: string) => {
  const v = String(assignee || '').trim();
  if (!v) return null;

  // if looks like email
  if (v.includes('@')) {
    return User.findOne({ email: v.toLowerCase() }).select('_id name email role isActive').lean();
  }

  // else by exact name
  return User.findOne({ name: v }).select('_id name email role isActive').lean();
};
