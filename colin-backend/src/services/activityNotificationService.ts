import { createNotification, findUserByAssigneeString } from './notifyService';
import { resolveDeadlineDateTime } from '../utils/deadlineUtils';
import { formatNotificationTime } from '../utils/notificationTime';
import IndependentTask from '../modules/independentTasks/models/independentTaskModel';

export const notifyPeople = async (identities: string[], notification: Omit<Parameters<typeof createNotification>[0], 'audienceUserIds'>) => {
  const ids = new Set<string>();
  for (const identity of new Set(identities.filter(Boolean))) {
    const user: any = await findUserByAssigneeString(identity);
    if (user && user.isActive !== false) ids.add(String(user._id));
  }
  if (ids.size) return createNotification({ ...notification, audienceUserIds: [...ids] });
};

export const notifyTaskChanges = async (before: any, after: any, independent = false) => {
  const revision = new Date(after.updatedAt || new Date()).toISOString();
  const base = { title: after.title, taskId: String(after._id), ...(after.caseId || after.relatedMatterId ? { caseId: String(after.caseId || after.relatedMatterId) } : {}),
    link: independent ? `/matters/independent-tasks/${after._id}` : `/cases/${after.caseId}?tab=case-management` };
  const identities = [after.assignee, after.supervisor, after.assignedBy];
  if (before.dueDate !== after.dueDate) {
    const due = resolveDeadlineDateTime(after.dueDate);
    await notifyPeople(identities, { ...base, type: 'DEADLINE_CHANGED', title: `Deadline changed: ${after.title}`,
      message: `The deadline for ${after.title} changed from ${before.dueDate} to ${due ? formatNotificationTime(due) : after.dueDate}.`, severity: 'warning', dedupeKey: `DEADLINE_CHANGED:${after._id}:${revision}` });
  }
  const changedOwners = [after.assignee !== before.assignee ? after.assignee : '', after.supervisor !== before.supervisor ? after.supervisor : ''];
  for (const stage of after.taskStages || []) {
    const old = (before.taskStages || []).find((item: any) => String(item._id) === String(stage._id));
    if (!old || old.staffMember !== stage.staffMember) changedOwners.push(stage.staffMember);
  }
  if (changedOwners.some(Boolean)) await notifyPeople(changedOwners, { ...base, type: 'TASK_ASSIGNED', title: `Assignment updated: ${after.title}`, message: `You have been assigned responsibility for ${after.title}. Open the task to review its current progress and deadline.`, dedupeKey: `TASK_REASSIGNED:${after._id}:${revision}` });
  const reviewRequested = (after.workflowStage === 'Awaiting Review' && before.workflowStage !== 'Awaiting Review') || (after.approvalStatus === 'Pending' && before.approvalStatus !== 'Pending');
  if (reviewRequested) {
    const reviewers = (after.taskStages || []).filter((stage: any) => stage.role === 'Reviewer' && stage.status !== 'Cancelled').map((stage: any) => stage.staffMember);
    await notifyPeople([after.supervisor || after.assignedBy, ...reviewers], { ...base, type: 'TASK_APPROVAL_REQUESTED', title: `Review requested: ${after.title}`,
      message: `${after.title} has been submitted and is awaiting your review.`, severity: 'warning', dedupeKey: `TASK_REVIEW:${after._id}:${revision}` });
  }
  const decision = after.approvalStatus === 'Approved' && before.approvalStatus !== 'Approved' ? 'approved' : after.approvalStatus === 'Rejected' && before.approvalStatus !== 'Rejected' ? 'returned for correction' : after.status === 'Completed' && before.status !== 'Completed' ? 'completed' : '';
  if (decision) await notifyPeople(identities, { ...base, type: decision === 'returned for correction' ? 'CASE_MANAGEMENT_CHANGES_REQUESTED' : 'APPROVAL_COMPLETED', title: `Task ${decision}: ${after.title}`,
    message: `${after.title} has been ${decision}.${after.approvalComment ? `\nFeedback: ${after.approvalComment}` : ''}`, dedupeKey: `TASK_DECISION:${after._id}:${revision}` });
};

export const notifyMatterParticipants = async (matter: any, notification: Omit<Parameters<typeof createNotification>[0], 'audienceUserIds' | 'caseId'>, contributors: string[] = []) => {
  const identities = [matter.assignedTo, matter.caseAssignments?.initiator, matter.caseAssignments?.reviewer, matter.caseAssignments?.signerApprover, ...contributors];
  if (notification.type === 'DEADLINE_CHANGED') {
    // A deadline amendment can shift downstream work held by temporary contributors.
    const delegates = await IndependentTask.find({ relatedMatterId: matter._id, status: { $nin: ['Closed', 'Completed', 'Cancelled'] } }).select('assignee supervisor').lean();
    for (const delegate of delegates) identities.push(delegate.assignee, delegate.supervisor);
  }
  return notifyPeople(identities, { ...notification, caseId: String(matter._id) });
};

export const notifyWorkflowHandoff = async (matter: any, step: any, role: 'Reviewer' | 'Signer/Approver', at: Date) => {
  const delegates = await IndependentTask.find({ relatedMatterId: matter._id, caseRole: role, keyActionKeys: step.stepKey, status: { $nin: ['Closed', 'Cancelled', 'Completed'] } }).select('assignee').lean();
  const identities = delegates.length ? delegates.map(task => task.assignee) : [role === 'Reviewer' ? matter.caseAssignments?.reviewer : matter.caseAssignments?.signerApprover];
  await notifyPeople(identities, { type: role === 'Reviewer' ? 'CASE_MANAGEMENT_REVIEW_REQUESTED' : 'CASE_MANAGEMENT_APPROVAL_REQUESTED',
    title: `${role === 'Reviewer' ? 'Review' : 'Approval'} requested: ${step.title}`, message: `${step.title} on ${matter.caseNo} is ready for your ${role === 'Reviewer' ? 'review' : 'approval'}.`,
    caseId: String(matter._id), link: `/cases/${matter._id}`, dedupeKey: `CASE_HANDOFF:${matter._id}:${step.stepKey}:${role}:${at.toISOString()}` });
};
