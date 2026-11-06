import Retainer from '../models/retainerModel';
import Prospect from '../models/prospectModel';
import { createNotification } from '../services/notifyService';
import { notifyPeople } from '../services/activityNotificationService';
import { resolveDeadlineDateTime } from '../utils/deadlineUtils';
import { dueReminderThreshold, formatNotificationTime } from '../utils/notificationTime';

// Internal reminders only. Do not infer invoice due dates or chase clients.
export const runBusinessReminders = async (now = new Date()) => {
  for (const retainer of await Retainer.find({ status: 'Active' }).lean()) {
    const due = resolveDeadlineDateTime(retainer.renewalDate || retainer.endDate);
    if (!due) continue;
    const threshold = dueReminderThreshold(due, now, [168, 24]);
    if (threshold === undefined) continue;
    await notifyPeople([retainer.responsiblePartner || retainer.createdBy || ''], { type: 'RETAINER_REMINDER', title: `Retainer ${threshold === 0 ? 'renewal overdue' : 'renewal approaching'}: ${retainer.retainerNo}`,
      message: `${retainer.name}\nRenewal/end date: ${formatNotificationTime(due)}. Review the agreement and arrange the next action.`, link: `/matters/retainers/${retainer._id}`,
      dedupeKey: `RETAINER:${retainer._id}:${due.toISOString()}:${threshold}`, deliveryContext: { kind: 'retainer', entityId: String(retainer._id), deadlineAt: due.toISOString() } });
  }
  for (const prospect of await Prospect.find({ isActive: true, isTemporarilyClosed: { $ne: true }, stage: { $nin: ['Converted', 'Non-Converted'] } }).lean()) {
    const due = prospect.nextFollowUpDate || (prospect.stageStatus !== 'Completed' ? prospect.stageDueAt : undefined);
    if (!due || due.getTime() > now.getTime()) continue;
    const field = prospect.nextFollowUpDate ? 'follow-up' : 'stage';
    await createNotification({ type: 'INTAKE_REMINDER', title: `Prospect ${field} due: ${prospect.prospectNo}`, message: `${prospect.clientName}\n${field === 'stage' ? prospect.stage : 'Follow-up'} due: ${formatNotificationTime(due)}.`,
      audienceUserIds: [...new Set([prospect.assignedTo, prospect.responsibleAssociate, prospect.responsiblePartner].filter(Boolean).map(String))],
      link: `/matters/intake-prospects?prospect=${prospect._id}`, dedupeKey: `PROSPECT:${prospect._id}:${field}:${due.toISOString()}`,
      deliveryContext: { kind: 'prospect', entityId: String(prospect._id), deadlineAt: due.toISOString(), stepKey: field } });
  }
};
