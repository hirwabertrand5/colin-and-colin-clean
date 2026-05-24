import cron from 'node-cron';
import mongoose from 'mongoose';
import Task from '../models/taskModel';
import Event from '../models/eventModel';
import Case from '../models/caseModel';
import User from '../models/userModel';
import NotificationPreferences from '../models/notificationPreferencesModel';
import { notifyRoles, notifyUsersById, findUserByAssigneeString } from '../services/notifyService';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const parseEventDateTime = (dateStr: string, timeStr: string) => {
  // date: YYYY-MM-DD, time: HH:mm
  // Treat as local time.
  const [rawY, rawM, rawD] = dateStr.split('-').map(Number);
  const [rawH, rawMin] = timeStr.split(':').map(Number);
  const toSafeNumber = (value: number | undefined, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const y = toSafeNumber(rawY, 1970);
  const m = toSafeNumber(rawM, 1);
  const d = toSafeNumber(rawD, 1);
  const hh = toSafeNumber(rawH, 0);
  const mm = toSafeNumber(rawMin, 0);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
};

const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / (1000 * 60 * 60);

const uniq = <T>(arr: T[]) => Array.from(new Set(arr));

/**
 * Runs reminder scans and creates notifications/emails.
 * Safe to call repeatedly because notifyService uses dedupeKey.
 */
export const runReminderScan = async () => {
  const now = new Date();

  // -----------------------------
  // Task due reminders (24h before due date)
  // Task.dueDate is YYYY-MM-DD
  // -----------------------------
  const tomorrowISO = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

  // Only remind not completed
  const tasksDueTomorrow = await Task.find({
    status: { $ne: 'Completed' },
    dueDate: tomorrowISO,
  })
    .select('_id title dueDate assignee caseId')
    .lean();

  for (const t of tasksDueTomorrow as any[]) {
    const assignee = String(t.assignee || '').trim();
    if (!assignee) continue;

    const user = await findUserByAssigneeString(assignee);
    if (!user?._id || user.isActive === false) continue;

    const dedupeKey = `TASK_DUE_24H:${String(t._id)}:${String(user._id)}:${tomorrowISO}`;

    await notifyUsersById({
      userIds: [String(user._id)],
      category: 'deadlines',
      notification: {
        type: 'TASK_DUE_REMINDER',
        title: 'Task due tomorrow',
        message: `${t.title || 'Task'} is due on ${t.dueDate}.`,
        severity: 'warning',
        caseId: String(t.caseId),
        taskId: String(t._id),
        link: `/tasks/${t._id}`,
        dedupeKey,
      },
      email: {
        subject: `Reminder: Task due tomorrow — ${t.title || 'Task'}`,
        html: `<div style="font-family: Arial, sans-serif">
                <p>This is a reminder that a task is due tomorrow.</p>
                <p><b>${t.title || 'Task'}</b></p>
                <p>Due date: ${t.dueDate}</p>
              </div>`,
      },
    });
  }

  // -----------------------------
  // Event reminders (24h + 2h) for:
  //  C) both A and B:
  //   - Case.assignedTo user (by name/email mapping)
  //   - MD + Executive Assistant (roles)
  // -----------------------------
  // We look ahead 25h to include slight cron jitter, and dedupe.
  const eventsUpcoming = await Event.find({
    // naive range: today -> tomorrow + 1 day
    date: { $gte: isoDate(now), $lte: isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)) },
  })
    .select('_id caseId title type date time')
    .lean();

  // Pull preferences for “eventReminderHours” is per user, but you requested fixed 24h + 2h.
  // We’ll still honor per-user prefs when sending email (deadlinesEnabled).
  const reminderHours = [24, 2];

  for (const e of eventsUpcoming as any[]) {
    const eventAt = parseEventDateTime(String(e.date), String(e.time));
    const hoursTo = hoursBetween(now, eventAt);

    // Only trigger near those windows (±0.25h)
    for (const h of reminderHours) {
      if (hoursTo < h - 0.25 || hoursTo > h + 0.25) continue;

      // Get case to find assignedTo
      const c: any = await Case.findById(e.caseId).select('assignedTo caseNo parties').lean();
      const caseLabel = c?.caseNo || c?.parties || '';

      // A) Case assignedTo
      const assignedTo = String(c?.assignedTo || '').trim();
      if (assignedTo) {
        const u = await findUserByAssigneeString(assignedTo);
        if (u?._id && u.isActive !== false) {
          const dedupeKey = `EVENT_${h}H:${String(e._id)}:${String(u._id)}`;

          await notifyUsersById({
            userIds: [String(u._id)],
            category: 'deadlines',
            notification: {
              type: 'EVENT_REMINDER',
              title: `Event reminder (${h}h)`,
              message: `${e.title || 'Event'} — ${caseLabel} at ${e.date} ${e.time}`,
              severity: h <= 2 ? 'critical' : 'warning',
              caseId: String(e.caseId),
              eventId: String(e._id),
              link: `/cases/${e.caseId}`, // you can adjust to a dedicated event view later
              dedupeKey,
            },
            email: {
              subject: `Reminder: ${e.title || 'Event'} in ${h} hours`,
              html: `<div style="font-family: Arial, sans-serif">
                      <p>Reminder: <b>${e.title || 'Event'}</b> is scheduled in ${h} hours.</p>
                      <p><b>Case:</b> ${caseLabel}</p>
                      <p><b>When:</b> ${e.date} ${e.time}</p>
                    </div>`,
            },
          });
        }
      }

      // B) MD + Exec assistant roles
      const dedupeRoleKey = `EVENT_${h}H:ROLE:${String(e._id)}:${String(e.caseId)}`;

      await notifyRoles({
        roles: ['managing_director', 'executive_assistant'],
        category: 'deadlines',
        notification: {
          type: 'EVENT_REMINDER',
          title: `Event reminder (${h}h)`,
          message: `${e.title || 'Event'} — ${caseLabel} at ${e.date} ${e.time}`,
          severity: h <= 2 ? 'critical' : 'warning',
          caseId: String(e.caseId),
          eventId: String(e._id),
          link: `/cases/${e.caseId}`,
          dedupeKey: dedupeRoleKey,
        },
        email: {
          subject: `Reminder: ${e.title || 'Event'} in ${h} hours`,
          html: `<div style="font-family: Arial, sans-serif">
                  <p>Reminder: <b>${e.title || 'Event'}</b> is scheduled in ${h} hours.</p>
                  <p><b>Case:</b> ${caseLabel}</p>
                  <p><b>When:</b> ${e.date} ${e.time}</p>
                </div>`,
        },
      });
    }
  }
};

/**
 * Starts the cron job.
 * Schedule: every 10 minutes.
 */
export const startReminderScheduler = () => {
  // every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    try {
      // If DB disconnected, skip
      if (mongoose.connection.readyState !== 1) return;
      await runReminderScan();
    } catch (e: any) {
      console.error('[reminderScheduler] error:', e?.message || e);
    }
  });

  console.log('[reminderScheduler] started (every 10 minutes)');
};
