import Task from '../models/taskModel';
import Event from '../models/eventModel';
import Case from '../models/caseModel';
import Workflow from '../models/workflowInstanceModel';
import IndependentTask from '../modules/independentTasks/models/independentTaskModel';
import Retainer from '../models/retainerModel';
import Prospect from '../models/prospectModel';
import { resolveDeadlineDateTime } from '../utils/deadlineUtils';
import { eventDateTime } from '../utils/notificationTime';

export const reminderIsCurrent = async (notification: any, now = new Date()) => {
  const context = notification.deliveryContext;
  if (!context) return true;
  if (context.expiresAt && new Date(context.expiresAt).getTime() <= now.getTime()) return false;
  const matter: any = notification.caseId ? await Case.findById(notification.caseId).select('status assignedTo caseAssignments').lean() : null;
  if (notification.caseId && (!matter || ['closed', 'temporarily closed', 'paused', 'returned to intake', 'completed', 'cancelled', 'archived'].includes(String(matter.status).toLowerCase()))) return false;
  let due: Date | undefined;
  if (context.kind === 'retainer') {
    const retainer = await Retainer.findById(context.entityId).lean();
    if (!retainer || retainer.status !== 'Active') return false;
    due = resolveDeadlineDateTime(retainer.renewalDate || retainer.endDate);
  } else if (context.kind === 'prospect') {
    const prospect = await Prospect.findById(context.entityId).lean();
    if (!prospect || !prospect.isActive || prospect.isTemporarilyClosed || ['Converted', 'Non-Converted'].includes(prospect.stage)) return false;
    due = context.stepKey === 'follow-up' ? prospect.nextFollowUpDate : prospect.stageStatus !== 'Completed' ? prospect.stageDueAt : undefined;
  } else if (context.kind === 'event') {
    const event = await Event.findById(context.entityId).lean();
    due = event ? eventDateTime(event.date, event.time) : undefined;
  } else if (context.kind === 'workflow') {
    const workflow: any = await Workflow.findById(context.entityId).lean();
    const step = workflow?.steps?.find((item: any) => item.stepKey === context.stepKey);
    if (!step || ['Completed', 'Done', 'Skipped', 'Cancelled', 'Awaiting Review', 'Awaiting Approval'].includes(step.status) || step.delegatedClaim?.taskId) return false;
    if (context.ownerIdentity && context.ownerIdentity !== (matter?.caseAssignments?.initiator || matter?.assignedTo)) return false;
    due = resolveDeadlineDateTime(step.dueAt);
  } else {
    const task: any = context.kind === 'independent' ? await IndependentTask.findById(context.entityId).lean() : await Task.findById(context.entityId).lean();
    if (!task || ['Completed', 'Closed', 'Cancelled', 'Awaiting Review'].includes(task.status) || ['Awaiting Review', 'Completed', 'Closed'].includes(task.workflowStage) || task.approvalStatus === 'Pending') return false;
    if (context.ownerIdentity && task.assignee !== context.ownerIdentity) return false;
    due = resolveDeadlineDateTime(task.dueDate);
  }
  return Boolean(due && due.toISOString() === context.deadlineAt);
};
