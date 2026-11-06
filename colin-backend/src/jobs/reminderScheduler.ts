import cron from 'node-cron';
import mongoose from 'mongoose';
import Task from '../models/taskModel';
import Event from '../models/eventModel';
import Case from '../models/caseModel';
import Workflow from '../models/workflowInstanceModel';
import User from '../models/userModel';
import NotificationPreferences from '../models/notificationPreferencesModel';
import IndependentTask from '../modules/independentTasks/models/independentTaskModel';
import { createNotification, findUserByAssigneeString } from '../services/notifyService';
import { processEmailDeliveries } from '../services/emailDeliveryService';
import { resolveDeadlineDateTime } from '../utils/deadlineUtils';
import { dueReminderThreshold, eventDateTime, formatNotificationTime, reminderHoursFor, appTimezone } from '../utils/notificationTime';
import { runPettyCashDigest } from './pettyCashDigest';
import { runBusinessReminders } from './businessReminders';

export const matterIsOpen = (matter: any) => Boolean(matter) && !['closed', 'temporarily closed', 'returned to intake', 'paused', 'cancelled', 'archived', 'completed'].includes(String(matter.status || '').toLowerCase());
const taskIsOpen = (task: any) => !['Completed', 'Closed', 'Cancelled', 'Awaiting Review'].includes(task.status) && !['Completed', 'Closed', 'Awaiting Review'].includes(task.workflowStage) && task.approvalStatus !== 'Pending';

export const runReminderScan = async (now = new Date()) => {
  const prefs = await NotificationPreferences.find().lean();
  const prefMap = new Map(prefs.map(pref => [String(pref.userId), pref]));
  const matters = await Case.find().select('_id status assignedTo caseNo caseAssignments').lean();
  const matterMap = new Map(matters.map(matter => [String(matter._id), matter]));
  const coordinators = await User.find({ role: { $in: ['managing_director', 'executive_assistant'] }, isActive: { $ne: false } }).select('_id email').lean();
  const remind = async (args: { key: string; due: Date; priority: string; owner: string; title: string; link: string; caseId?: string; taskId?: string; eventId?: string; event?: boolean }) => {
    const user: any = await findUserByAssigneeString(args.owner);
    if (!user || user.isActive === false) return;
    const userPrefs = prefMap.get(String(user._id));
    const reminderHours = reminderHoursFor(args.priority, userPrefs, args.event);
    const threshold = dueReminderThreshold(args.due, now, reminderHours, args.event);
    if (threshold === undefined) return;
    if (threshold === 0 && args.priority === 'Low') return;
    const overdue = threshold === 0;
    const nextThreshold = reminderHours.filter(hour => hour < threshold).sort((a, b) => b - a)[0] || 0;
    const [sourceKind, entityId, ...stepParts] = args.key.split(':');
    const contextKind = sourceKind === 'LEGAL' ? 'workflow' : sourceKind === 'EVENT' ? 'event' : sourceKind === 'INDEPENDENT' ? 'independent' : 'task';
    const base = { type: args.event ? 'EVENT_REMINDER' : 'TASK_DUE_REMINDER', title: `${args.title} — ${overdue ? 'overdue' : `${threshold}h reminder`}`,
      message: `${args.title}\nDeadline: ${formatNotificationTime(args.due)}${overdue ? '\nPlease act or arrange a revised deadline.' : ''}`,
      severity: overdue ? 'critical' as const : 'warning' as const, link: args.link,
      deliveryContext: { kind: contextKind, entityId: String(entityId), deadlineAt: args.due.toISOString(), ownerIdentity: args.owner,
        ...(!overdue ? { expiresAt: new Date(args.due.getTime() - nextThreshold * 3600000).toISOString() } : {}), ...(stepParts.length ? { stepKey: stepParts.join(':') } : {}) },
      ...(args.caseId ? { caseId: args.caseId } : {}), ...(args.taskId ? { taskId: args.taskId } : {}), ...(args.eventId ? { eventId: args.eventId } : {}) };
    const revisionKey = `${args.key}:${args.due.toISOString()}`;
    await createNotification({ ...base, audienceUserIds: [String(user._id)], dedupeKey: `${revisionKey}:${user._id}:${threshold}` });
    if (overdue && args.priority === 'Critical' && now.getTime() - args.due.getTime() >= (userPrefs?.overdueEscalationHours || 24) * 3600000) {
      const ids = coordinators.map(coordinator => String(coordinator._id)).filter(id => id !== String(user._id));
      if (ids.length) await createNotification({ ...base, title: `Escalation: ${args.title}`, audienceUserIds: ids, dedupeKey: `${revisionKey}:ESCALATION` });
    }
  };
  for (const task of await Task.find({ status: { $ne: 'Completed' } }).lean()) {
    if (!taskIsOpen(task) || !matterIsOpen(matterMap.get(String(task.caseId)))) continue;
    const due = resolveDeadlineDateTime(task.dueDate);
    if (due) await remind({ key: `TASK:${task._id}`, due, priority: task.priority, owner: task.assignee, title: `${task.taskNo}: ${task.title}`, link: `/cases/${task.caseId}?tab=case-management`, caseId: String(task.caseId), taskId: String(task._id) });
  }
  for (const task of await IndependentTask.find({ status: { $nin: ['Completed', 'Closed', 'Cancelled', 'Awaiting Review'] } }).lean()) {
    if (!taskIsOpen(task) || (task.relatedMatterId && !matterIsOpen(matterMap.get(String(task.relatedMatterId))))) continue;
    const due = resolveDeadlineDateTime(task.dueDate);
    if (due) await remind({ key: `INDEPENDENT:${task._id}`, due, priority: task.priority, owner: task.assignee, title: `${task.taskNumber}: ${task.title}`, link: `/matters/independent-tasks/${task._id}`, taskId: String(task._id), ...(task.relatedMatterId ? { caseId: String(task.relatedMatterId) } : {}) });
  }
  for (const workflow of await Workflow.find({ status: { $ne: 'Completed' } }).lean()) {
    const matter: any = matterMap.get(String(workflow.caseId));
    if (!matterIsOpen(matter)) continue;
    const step: any = (workflow.steps || []).find((item: any) => !['Completed', 'Skipped', 'Cancelled'].includes(item.status));
    if (!step || ['Done', 'Awaiting Review', 'Awaiting Approval'].includes(step.status) || step.delegatedClaim?.taskId) continue;
    const due = resolveDeadlineDateTime(step.dueAt);
    if (due) await remind({ key: `LEGAL:${workflow._id}:${step.stepKey}`, due, priority: 'Critical', owner: matter.caseAssignments?.initiator || matter.assignedTo,
      title: `${matter.caseNo}: ${step.title}`, link: `/cases/${matter._id}`, caseId: String(matter._id) });
  }
  for (const event of await Event.find().lean()) {
    const matter: any = matterMap.get(String(event.caseId));
    if (!matterIsOpen(matter)) continue;
    const due = eventDateTime(event.date, event.time);
    if (!due || due.getTime() <= now.getTime()) continue;
    const recipients = new Map<string, any>();
    const owner: any = await findUserByAssigneeString(matter.assignedTo);
    if (owner) recipients.set(String(owner._id), owner);
    for (const coordinator of coordinators) recipients.set(String(coordinator._id), coordinator);
    for (const person of recipients.values()) await remind({ key: `EVENT:${event._id}`, due, priority: 'Medium', owner: person.email, title: `${event.title} (${matter.caseNo})`, event: true,
      link: `/cases/${event.caseId}`, caseId: String(event.caseId), eventId: String(event._id) });
  }
};

export const startReminderScheduler = () => {
  new Intl.DateTimeFormat('en-GB', { timeZone: appTimezone() }).format();
  let scanning = false;
  const scan = async () => {
    if (scanning || mongoose.connection.readyState !== 1) return;
    scanning = true;
    try { await runReminderScan(); await runBusinessReminders(); await runPettyCashDigest(); }
    catch (error: any) { console.error('[reminders] scan failed', error?.message); }
    finally { scanning = false; }
  };
  let delivering = false;
  const deliver = async () => {
    if (delivering || mongoose.connection.readyState !== 1) return;
    delivering = true;
    try { await processEmailDeliveries(); }
    catch (error: any) { console.error('[email delivery] worker failed', error?.name); }
    finally { delivering = false; }
  };
  cron.schedule('* * * * *', scan, { timezone: appTimezone() });
  cron.schedule('*/10 * * * * *', deliver, { timezone: appTimezone() });
  void scan(); void deliver();
  console.log(`[notifications] reminders every minute, delivery every 10 seconds (${appTimezone()})`);
};
