import mongoose from 'mongoose';
import Case from '../models/caseModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import AuditLog from '../models/auditLogModel';
import IndependentTask from '../modules/independentTasks/models/independentTaskModel';
import IndependentTaskHistory from '../modules/independentTasks/models/independentTaskHistoryModel';
import { AuthRequest } from '../middleware/authMiddleware';
import { identityMatches } from '../utils/caseAssignments';
import { findUserByAssigneeString, notifyUsersById } from './notifyService';

const administrators = new Set([
  'managing_director', 'managing_partner', 'executive_managing_partner', 'senior_partner',
  'partner', 'executive_partner', 'associate_partner', 'executive_associate_partner',
  'senior_executive_assistant', 'executive_assistant', 'originating_attorney',
]);
const matchesUser = (name: unknown, req: AuthRequest) => Boolean(name) && (
  identityMatches(String(name), req.user?.name || '') || identityMatches(String(name), req.user?.email || '')
);

/** Both interfaces return the same live Key Action, with the same authorization. */
export async function returnCaseWorkForCorrections(args: {
  caseId: string; stepKey: string; reason: string; req: AuthRequest; delegatedTaskId?: string;
}) {
  const reason = String(args.reason || '').trim();
  if (!reason) throw new Error('Explain the corrections required before returning this work.');
  if (reason.length > 5000) throw new Error('Correction feedback must be 5,000 characters or fewer.');
  const session = await mongoose.startSession();
  let recipient = '';
  let contributorTaskId = '';
  try {
    await session.withTransaction(async () => {
      const matter: any = await Case.findById(args.caseId).session(session);
      const instance: any = await WorkflowInstance.findOne({ caseId: args.caseId }).session(session);
      if (!matter || !instance) throw new Error('Matter workflow not found.');
      if (['Closed', 'Temporarily Closed', 'Returned to Intake'].includes(matter.status)) throw new Error('This matter is not open for review.');
      const step: any = instance.steps.find((item: any) => item.stepKey === args.stepKey);
      if (!step || !['Awaiting Review', 'Awaiting Approval'].includes(step.status)) {
        throw new Error('Only work awaiting review or approval can be returned. Refresh the workflow.');
      }
      if (args.delegatedTaskId) {
        const reviewer: any = await IndependentTask.findById(args.delegatedTaskId).session(session);
        const requiredRole = step.status === 'Awaiting Review' ? 'Reviewer' : 'Signer/Approver';
        if (!reviewer || String(reviewer.relatedMatterId) !== args.caseId || reviewer.caseRole !== requiredRole ||
          !reviewer.keyActionKeys.includes(args.stepKey) || !matchesUser(reviewer.assignee, args.req) ||
          !['In Progress', 'Awaiting Review'].includes(reviewer.status) ||
          (step.delegatedClaim?.taskId && String(step.delegatedClaim.taskId) !== String(reviewer._id))) {
          throw new Error('Forbidden.');
        }
      } else {
        const holder = step.status === 'Awaiting Review' ? matter.caseAssignments?.reviewer : matter.caseAssignments?.signerApprover;
        if (!administrators.has(args.req.user?.role || '') && !matchesUser(holder, args.req)) throw new Error('Forbidden.');
      }
      const contribution = [...(step.independentContributors || [])].reverse().find((entry: any) => entry.role === 'Initiator');
      recipient = contribution?.name || matter.caseAssignments?.initiator || matter.assignedTo;
      if (matchesUser(recipient, args.req)) throw new Error('You cannot review or return your own work.');
      const task: any = contribution?.taskId ? await IndependentTask.findById(contribution.taskId).session(session) : null;
      if (task && ['Closed', 'Cancelled'].includes(task.status)) {
        throw new Error('The contributor task is archived. An administrator must arrange a replacement delegation.');
      }
      const now = new Date();
      contributorTaskId = task ? String(task._id) : '';
      step.correctionRequest = {
        reason, requestedBy: args.req.user?.name || 'System', requestedAt: now,
        ...(task ? { contributorTaskId: task._id } : {}),
      };
      step.reviewHistory.push({ action: 'Returned', actorName: args.req.user?.name || 'System', reason, at: now });
      // Reuse the canonical reopened-work status. No parallel approval state.
      step.status = 'In Progress';
      step.doneAt = undefined;
      step.completedAt = undefined;
      step.reviewedAt = undefined;
      step.delegatedClaim = task ? { taskId: task._id, role: 'Initiator', claimantName: task.assignee, claimedAt: now } : undefined;
      instance.status = 'Active';
      instance.currentStepKey = step.stepKey;
      await instance.save({ session });
      if (task) {
        task.status = 'In Progress';
        task.completedAt = undefined;
        await task.save({ session });
        await IndependentTaskHistory.create([{
          taskId: task._id, action: 'TASK_CASE_LIFECYCLE_UPDATED', message: 'Changes requested',
          detail: reason, actorName: args.req.user?.name || 'System',
          metadata: { stepKey: args.stepKey, decision: 'Returned' },
        }], { session });
      }
      await AuditLog.create([{
        caseId: matter._id, ...(task ? { independentTaskId: task._id } : {}),
        actorName: args.req.user?.name || 'System', ...(args.req.user?.id ? { actorUserId: args.req.user.id } : {}),
        action: 'CASE_MANAGEMENT_RETURNED_FOR_CORRECTIONS', message: 'Returned Key Action for corrections',
        detail: `${args.stepKey}: ${reason}`,
      }], { session });
    });
  } finally {
    await session.endSession();
  }
  const user = await findUserByAssigneeString(recipient);
  if (user) await notifyUsersById({
    userIds: [String(user._id)], category: 'approvals', notification: {
      type: 'CASE_MANAGEMENT_CHANGES_REQUESTED', title: 'Changes requested', message: reason,
      caseId: args.caseId, ...(contributorTaskId ? { taskId: contributorTaskId } : {}),
      link: contributorTaskId ? `/matters/independent-tasks/${contributorTaskId}` : `/cases/${args.caseId}`,
    },
  });
}
