import mongoose from 'mongoose';
import Notification from '../models/notificationModel';
import User from '../models/userModel';
import NotificationPreferences from '../models/notificationPreferencesModel';
import { sendEmailResend } from './emailResendService';

type PrefCategory = 'deadlines' | 'taskAssignments' | 'approvals' | 'pettyCashLow';

const prefAllows = (prefs: any, category: PrefCategory) => {
  if (!prefs) return false;
  if (!prefs.emailEnabled) return false;

  if (category === 'deadlines') return Boolean(prefs.deadlinesEnabled);
  if (category === 'taskAssignments') return Boolean(prefs.taskAssignmentsEnabled);
  if (category === 'approvals') return Boolean(prefs.approvalsEnabled);
  if (category === 'pettyCashLow') return Boolean(prefs.pettyCashLowEnabled);
  return false;
};

export const createNotification = async (payload: {
  type: string;
  title: string;
  message: string;
  severity?: 'info' | 'warning' | 'critical';

  audienceUserIds?: string[];
  audienceRoles?: string[];

  link?: string;
  dedupeKey?: string;

  caseId?: string;
  taskId?: string;
  eventId?: string;

  fundId?: string;
  expenseId?: string;
}) => {
  if (payload.dedupeKey) {
    const exists = await Notification.exists({ dedupeKey: payload.dedupeKey });
    if (exists) return null;
  }

  const notificationPayload: any = {
    type: payload.type,
    title: payload.title,
    message: payload.message,
    severity: payload.severity || 'info',

    audienceUserIds: (payload.audienceUserIds || []).map((id) => new mongoose.Types.ObjectId(id)),
    audienceRoles: payload.audienceRoles || [],
  };
  if (payload.link) notificationPayload.link = payload.link;
  if (payload.dedupeKey) notificationPayload.dedupeKey = payload.dedupeKey;
  if (payload.caseId) notificationPayload.caseId = new mongoose.Types.ObjectId(payload.caseId);
  if (payload.taskId) notificationPayload.taskId = new mongoose.Types.ObjectId(payload.taskId);
  if (payload.eventId) notificationPayload.eventId = new mongoose.Types.ObjectId(payload.eventId);
  if (payload.fundId) notificationPayload.fundId = new mongoose.Types.ObjectId(payload.fundId);
  if (payload.expenseId) notificationPayload.expenseId = new mongoose.Types.ObjectId(payload.expenseId);

  const doc: any = await Notification.create(notificationPayload);
  return typeof doc?.toObject === 'function' ? doc.toObject() : doc;
};

const ensurePrefsExist = async (userIds: string[]) => {
  const unique = Array.from(new Set(userIds.map(String)));
  const existing = await NotificationPreferences.find({ userId: { $in: unique } }).select('userId').lean();

  const existingSet = new Set(existing.map((d: any) => String(d.userId)));
  const missing = unique.filter((id) => !existingSet.has(String(id)));

  if (missing.length) {
    await NotificationPreferences.insertMany(
      missing.map((id) => ({ userId: new mongoose.Types.ObjectId(id) })),
      { ordered: false }
    ).catch(() => {});
  }
};

export const notifyUsersById = async (opts: {
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
  });

  if (!opts.email) return;

  await ensurePrefsExist(ids);

  const users = await User.find({ _id: { $in: ids }, isActive: { $ne: false } }).select('_id email').lean();
  const prefs = await NotificationPreferences.find({ userId: { $in: ids } }).lean();
  const prefMap = new Map(prefs.map((p: any) => [String(p.userId), p]));

  const recipients = users
    .filter((u: any) => prefAllows(prefMap.get(String(u._id)), opts.category))
    .map((u: any) => u.email)
    .filter(Boolean);

  if (!recipients.length) return;

  await sendEmailResend(recipients, opts.email.subject, opts.email.html);
};

export const notifyRoles = async (opts: {
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
  });

  // email to all users in those roles (respect prefs)
  if (!opts.email) return;

  const users = await User.find({ role: { $in: roles }, isActive: { $ne: false } }).select('_id email').lean();
  const userIds = users.map((u: any) => String(u._id));
  if (!userIds.length) return;

  await ensurePrefsExist(userIds);

  const prefs = await NotificationPreferences.find({ userId: { $in: userIds } }).lean();
  const prefMap = new Map(prefs.map((p: any) => [String(p.userId), p]));

  const recipients = users
    .filter((u: any) => prefAllows(prefMap.get(String(u._id)), opts.category))
    .map((u: any) => u.email)
    .filter(Boolean);

  if (!recipients.length) return;

  await sendEmailResend(recipients, opts.email.subject, opts.email.html);
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
