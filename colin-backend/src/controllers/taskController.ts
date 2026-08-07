// colin-backend/src/controllers/taskController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import Task from '../models/taskModel';
import Case from '../models/caseModel';
import User from '../models/userModel';
import { AuthRequest } from '../middleware/authMiddleware';
import { writeAudit } from '../services/auditService';
import TaskTimeLog from '../models/taskTimeLogModel';
import { notifyRoles, notifyUsersById, findUserByAssigneeString } from '../services/notifyService';
import { buildYearlySequence } from '../utils/counter';
import { isPublicYellowCase } from '../utils/caseVisibility';

const isAssociateLikeRole = (role?: string) =>
  role === 'associate' || role === 'trainee_associate' || role === 'senior_associate' || role === 'intern';
const isAssociateAssignableRole = (role?: string) => role === 'trainee_associate' || role === 'intern';
const isTaskSupervisorRole = (role?: string) =>
  role === 'associate' || role === 'executive_assistant' || role === 'managing_partner';
const actorFromReq = (req: AuthRequest) => ({
  actorName: req.user?.name || 'System',
  actorUserId: req.user?.id as string | undefined,
});

const withActor = (req: AuthRequest) => {
  const actor = actorFromReq(req);
  return {
    actorName: actor.actorName,
    ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
  };
};

const isAdminCaseRole = (role?: string) =>
  role === 'managing_director' || role === 'executive_assistant';

const TASK_WORKFLOW_STAGES = [
  'Created',
  'Assigned',
  'Acknowledged',
  'In Progress',
  'Awaiting Review',
  'Awaiting External Action',
  'Completed',
  'Closed',
] as const;

type TaskWorkflowStage = (typeof TASK_WORKFLOW_STAGES)[number];

const normalizeWorkflowStage = (value: unknown): TaskWorkflowStage | null => {
  const stage = String(value || '').trim();
  return (TASK_WORKFLOW_STAGES as readonly string[]).includes(stage) ? (stage as TaskWorkflowStage) : null;
};

const stageToStatus = (stage?: TaskWorkflowStage | null) => {
  if (stage === 'Completed' || stage === 'Closed') return 'Completed';
  if (stage === 'Acknowledged' || stage === 'In Progress' || stage === 'Awaiting Review' || stage === 'Awaiting External Action')
    return 'In Progress';
  return 'Not Started';
};

const stageRequiresAcknowledgement = (stage?: TaskWorkflowStage | null) =>
  stage === 'Acknowledged' || stage === 'In Progress' || stage === 'Awaiting Review' || stage === 'Awaiting External Action';

const stageNeedsCompletionConfirmation = (stage?: TaskWorkflowStage | null) => stage === 'Closed';

const generateTaskNo = () => buildYearlySequence('task', 'TASK');

const normalizeTaskStartDate = (value: unknown) => {
  if (!value) return new Date().toISOString().slice(0, 10);
  const asString = String(value).trim();
  return asString || new Date().toISOString().slice(0, 10);
};

const normalizeTaskDueDate = (value: unknown) => String(value || '').trim();

const parseTaskDateOnly = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const assertTaskDateRange = (startDate: unknown, dueDate: unknown) => {
  const start = parseTaskDateOnly(startDate);
  const due = parseTaskDateOnly(dueDate);
  if (!start || !due) {
    throw new Error('Start date and due date must be valid.');
  }
  if (due.getTime() < start.getTime()) {
    throw new Error('Due date cannot be earlier than start date.');
  }
};

const canCoordinateTasksForCase = async (req: AuthRequest, caseId: string) => {
  if (isAdminCaseRole(req.user?.role)) return true;
  if (req.user?.role === 'associate') return canAccessCaseId(req, caseId);
  return false;
};

const canManageTask = async (req: AuthRequest, task: any) => {
  if (isAdminCaseRole(req.user?.role)) return true;
  if (req.user?.role === 'associate') return canAccessCaseId(req, String(task.caseId));
  return false;
};

const canAccessTask = async (req: AuthRequest, task: any) => {
  if (await canManageTask(req, task)) return true;
  const me = String(req.user?.name || '').trim();
  return task.assignee === me || task.supervisor === me;
};

const assertAssigneeAllowed = async (req: AuthRequest, assigneeValue: unknown) => {
  const assignee = String(assigneeValue || '').trim();
  if (!assignee) throw new Error('Assignee is required.');

  if (req.user?.role !== 'associate') return;

  const assigneeUser: any = await User.findOne({
    isActive: true,
    $or: [{ name: assignee }, { email: assignee.toLowerCase() }],
  })
    .select('role isActive')
    .lean();

  if (!assigneeUser) {
    throw new Error('Selected assignee was not found.');
  }

  if (!isAssociateAssignableRole(assigneeUser.role)) {
    throw new Error('Associates can assign tasks only to junior associates and interns.');
  }
};

const assertSupervisorAllowed = async (supervisorValue: unknown) => {
  const supervisor = String(supervisorValue || '').trim();
  if (!supervisor) throw new Error('Supervisor is required.');

  const supervisorUser: any = await findUserByAssigneeString(supervisor);
  if (!supervisorUser || supervisorUser.isActive === false) {
    throw new Error('Selected supervisor was not found.');
  }

  if (!isTaskSupervisorRole(supervisorUser.role)) {
    throw new Error('Supervisor must be an Associate, Executive Assistant, or Managing Partner.');
  }
};

// Approved or closed tasks become read-only for everyone
const isApprovedLocked = (task: any) =>
  task?.workflowStage === 'Closed' || (task?.requiresApproval && String(task.approvalStatus) === 'Approved');

/**
 * Professional case access:
 * - MD/Exec: access any case
 * - Associate: access case if:
 *    a) Case.assignedTo === req.user.name
 *    OR
 *    b) Associate has at least one task in this case
 */
const canAccessCaseId = async (req: AuthRequest, caseId: string) => {
  const role = req.user?.role;

  if (isAdminCaseRole(role)) return true;

  const c: any = await Case.findById(caseId).select('assignedTo status workflowProgress workflowStartDate createdAt');
  if (!c) return false;

  if (isPublicYellowCase(c)) return true;

  if (isAssociateLikeRole(role)) {
    const me = (req.user?.name || '').trim();
    if (!me) return false;

    // rule 1: case assigned to associate
    if (String(c.assignedTo || '').trim() === me) return true;

    // rule 2: associate has at least one task in this case
    const hasTask = await Task.exists({ caseId, assignee: me });
    return Boolean(hasTask);
  }

  return false;
};

// --------------------
// Case Tasks
// --------------------

// Get all tasks for a case
export const getTasksForCase = async (req: AuthRequest, res: Response) => {
  try {
    let caseId: any = req.params.caseId;
    if (Array.isArray(caseId)) caseId = caseId[0];
    if (!caseId) return res.status(400).json({ message: 'Missing caseId' });

    // ✅ Guard
    if (!(await canAccessCaseId(req, String(caseId)))) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const tasks = await Task.find({
      caseId: new mongoose.Types.ObjectId(caseId),
    }).sort({ dueDate: 1 });

    res.json(tasks);
  } catch {
    res.status(500).json({ message: 'Failed to fetch tasks.' });
  }
};

// Add a task to a case
export const addTaskToCase = async (req: AuthRequest, res: Response) => {
  try {
    let caseId: any = req.params.caseId;
    if (Array.isArray(caseId)) caseId = caseId[0];
    if (!caseId) return res.status(400).json({ message: 'Missing caseId' });

    if (!(await canCoordinateTasksForCase(req, String(caseId)))) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const assignee = String(req.body?.assignee || '').trim();
    const supervisor = String(req.body?.supervisor || '').trim();
    const dueDate = normalizeTaskDueDate(req.body?.dueDate);
    const startDate = normalizeTaskStartDate(req.body?.startDate);
    const relatedStage = normalizeWorkflowStage(req.body?.workflowStage) || 'Assigned';

    if (!assignee) return res.status(400).json({ message: 'Assignee is required.' });
    if (!supervisor) return res.status(400).json({ message: 'Supervisor is required.' });
    if (!dueDate) return res.status(400).json({ message: 'Due date is required.' });
    try {
      assertTaskDateRange(startDate, dueDate);
    } catch (err: any) {
      return res.status(400).json({ message: err?.message || 'Invalid task date range.' });
    }
    if (relatedStage === 'Closed') {
      return res.status(400).json({ message: 'A task cannot be created directly as Closed.' });
    }

    await assertAssigneeAllowed(req, assignee);
    await assertSupervisorAllowed(supervisor);

    const caseRecord: any = await Case.findById(caseId).select('parties caseNo').lean();
    const taskNo = String(req.body?.taskNo || '').trim() || (await generateTaskNo());
    const relatedClient = String(req.body?.relatedClient || caseRecord?.parties || '').trim();

    const requiresApproval = Boolean(req.body.requiresApproval);
    const approvalStatus = requiresApproval ? 'Draft' : 'Not Required';

    const newTask = new Task({
      ...req.body,
      taskNo,
      caseId: new mongoose.Types.ObjectId(caseId),
      requiresApproval,
      approvalStatus,
      assignee,
      supervisor,
      relatedClient: relatedClient || undefined,
      startDate,
      dueDate,
      workflowStage: relatedStage,
      status: stageToStatus(relatedStage),
      acknowledgedAt: stageRequiresAcknowledgement(relatedStage) ? new Date() : undefined,
      completedAt: relatedStage === 'Completed' ? new Date() : undefined,
      closedAt: undefined,
      assignedBy: req.user?.name || 'System',
      submittedAt: undefined,
      approvedAt: undefined,
      rejectedAt: undefined,
    });

    await newTask.save();

    await writeAudit({
      caseId,
      ...withActor(req),
      action: 'TASK_CREATED',
      message: 'Created task',
      detail: `${newTask.taskNo || 'Task'} • ${newTask.title || 'Untitled'} • Assignee: ${
        newTask.assignee || '-'
      } • Due: ${newTask.dueDate || '-'}`,
    });

    // ✅ Notify assignee (customized per-user)
    const assigneeValue = String(newTask.assignee || '').trim();
    if (assigneeValue) {
      const assigneeUser: any = await findUserByAssigneeString(assigneeValue);

      if (assigneeUser?._id && assigneeUser.isActive !== false) {
        await notifyUsersById({
          userIds: [String(assigneeUser._id)],
          category: 'taskAssignments',
            notification: {
              type: 'TASK_ASSIGNED',
              title: 'New task assigned',
              message: `${newTask.taskNo || 'Task'} • ${newTask.title || 'Task'} (Due: ${newTask.dueDate || '-'})`,
              severity: 'info',
              caseId: String(caseId),
              taskId: String(newTask._id),
              link: `/tasks/${newTask._id}`,
            },
            email: {
            subject: `Task assigned: ${newTask.taskNo || 'Task'}`,
            html: `<div style="font-family: Arial, sans-serif">
                    <p>A new task has been assigned to you.</p>
                    <p><b>${newTask.taskNo || 'Task'} - ${newTask.title || 'Task'}</b></p>
                    <p>Due: ${newTask.dueDate || '-'}</p>
                  </div>`,
          },
        });
      } else {
        // Helpful server-side hint for misconfigured assignee strings
        console.warn('Task created but no matching active user found for assignee:', assigneeValue);
      }
    }

    res.status(201).json(newTask);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to create task.' });
  }
};

// --------------------
// Global Tasks
// --------------------

export const getAllTasks = async (req: AuthRequest, res: Response) => {
  try {
    const { q, status, priority, approvalStatus, workflowStage } = req.query as any;

    const filter: any = {};
    const andFilters: any[] = [];

    // Visibility: non-MD sees own tasks and tasks they supervise
    if (req.user?.role !== 'managing_director') {
      const me = String(req.user?.name || '').trim();
      if (!me) {
        return res.json([]);
      }

      const visibility: any = { $or: [{ assignee: me }, { supervisor: me }] };
      if (req.user?.role === 'associate') {
        const ownedCaseIds = await Case.find({ assignedTo: me }).distinct('_id');
        const caseIdsFromTasks = await Task.distinct('caseId', { $or: [{ assignee: me }, { supervisor: me }] });
        const visibleCaseIds = [...new Set([...ownedCaseIds, ...caseIdsFromTasks].map(String))];
        visibility.caseId = { $in: visibleCaseIds.map((value) => new mongoose.Types.ObjectId(value)) };
      }
      andFilters.push(visibility);
    }

    if (status && status !== 'all') filter.status = status;
    if (priority && priority !== 'all') filter.priority = priority;
    if (approvalStatus && approvalStatus !== 'all') filter.approvalStatus = approvalStatus;
    if (workflowStage && workflowStage !== 'all') filter.workflowStage = workflowStage;

    if (q && String(q).trim()) {
      const regex = new RegExp(String(q).trim(), 'i');
      andFilters.push({ $or: [{ title: regex }, { assignee: regex }, { supervisor: regex }, { taskNo: regex }, { relatedClient: regex }] });
    }

    if (andFilters.length) filter.$and = andFilters;

    const tasks = await Task.find(filter).sort({ dueDate: 1, createdAt: -1 });
    res.json(tasks);
  } catch {
    res.status(500).json({ message: 'Failed to fetch tasks.' });
  }
};

export const getTaskById = async (req: AuthRequest, res: Response) => {
  try {
    let taskId: any = req.params.taskId;
    if (Array.isArray(taskId)) taskId = taskId[0];
    if (!taskId) return res.status(400).json({ message: 'Missing taskId' });

    const task: any = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: 'Task not found.' });

    if (!(await canAccessTask(req, task))) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    res.json(task);
  } catch {
    res.status(500).json({ message: 'Failed to fetch task.' });
  }
};

// Update task (normal edits)
export const updateTask = async (req: AuthRequest, res: Response) => {
  try {
    let taskId: any = req.params.taskId;
    if (Array.isArray(taskId)) taskId = taskId[0];
    if (!taskId) return res.status(400).json({ message: 'Missing taskId' });

    const before: any = await Task.findById(taskId);
    if (!before) return res.status(404).json({ message: 'Task not found.' });

    const canManage = await canManageTask(req, before);
    const isAssignee = before.assignee === req.user?.name;
    const isSupervisor = String(before.supervisor || '').trim() === String(req.user?.name || '').trim();
    const attemptedKeys = Object.keys(req.body || {}).filter((key) => req.body?.[key] !== undefined);
    const qualityOnlyUpdate = attemptedKeys.length > 0 && attemptedKeys.every((key) => key === 'qualityScore');

    if (!canManage && !isAssignee && !isSupervisor) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    if (!canManage) {
      const allowedSelfServiceKeys = isSupervisor ? ['qualityScore'] : ['status', 'workflowStage'];
      if (attemptedKeys.some((key) => !allowedSelfServiceKeys.includes(key))) {
        return res.status(403).json({ message: isSupervisor ? 'Supervisors can only update quality score.' : 'You can only update task status.' });
      }
    }

    if (isApprovedLocked(before) && !qualityOnlyUpdate) {
      return res.status(403).json({ message: 'This task is approved and locked (read-only).' });
    }

    const updates: any = { ...(req.body || {}) };
    delete updates.caseId;
    delete updates.taskNo;

    if (canManage && Object.prototype.hasOwnProperty.call(req.body || {}, 'assignee')) {
      await assertAssigneeAllowed(req, updates?.assignee);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'supervisor') && !String(updates.supervisor || '').trim()) {
      return res.status(400).json({ message: 'Supervisor is required.' });
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'supervisor')) {
      await assertSupervisorAllowed(updates.supervisor);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'qualityScore')) {
      if (updates.qualityScore === null || updates.qualityScore === undefined || updates.qualityScore === '') {
        updates.qualityScore = null;
      } else {
      const score = Number(updates.qualityScore);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        return res.status(400).json({ message: 'Quality score must be between 0 and 100.' });
      }
      updates.qualityScore = Math.round(score);
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'dueDate')) {
      updates.dueDate = normalizeTaskDueDate(updates.dueDate);
      if (!updates.dueDate) {
        return res.status(400).json({ message: 'Due date is required.' });
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'startDate')) {
      updates.startDate = normalizeTaskStartDate(updates.startDate);
    }

    try {
      assertTaskDateRange(
        Object.prototype.hasOwnProperty.call(updates, 'startDate') ? updates.startDate : before.startDate,
        Object.prototype.hasOwnProperty.call(updates, 'dueDate') ? updates.dueDate : before.dueDate
      );
    } catch (err: any) {
      return res.status(400).json({ message: err?.message || 'Invalid task date range.' });
    }

    const hasWorkflowStage = Object.prototype.hasOwnProperty.call(updates, 'workflowStage');
    const hasStatus = Object.prototype.hasOwnProperty.call(updates, 'status');
    const hasApprovalStatus = Object.prototype.hasOwnProperty.call(updates, 'approvalStatus');
    const confirmCompletion = Boolean((updates.confirmCompletion || updates.completionConfirmed));
    delete updates.confirmCompletion;
    delete updates.completionConfirmed;

    const nextStage = hasWorkflowStage ? normalizeWorkflowStage(updates.workflowStage) : null;
    if (hasWorkflowStage && !nextStage) {
      return res.status(400).json({ message: 'Invalid workflow stage.' });
    }

    if (hasWorkflowStage) {
      updates.workflowStage = nextStage;
      updates.status = stageToStatus(nextStage);

      if (stageRequiresAcknowledgement(nextStage) && !before.acknowledgedAt) {
        updates.acknowledgedAt = new Date();
      }

      if (nextStage === 'Completed') {
        updates.completedAt = before.completedAt || new Date();
        updates.closedAt = undefined;
      }

      if (nextStage === 'Closed') {
        if (!confirmCompletion) {
          return res.status(400).json({ message: 'Confirm completion before closing the task.' });
        }
        updates.status = 'Completed';
        updates.completedAt = before.completedAt || new Date();
        updates.closedAt = new Date();
      }
    } else if (hasStatus) {
      const nextStatus = String(updates.status || '').trim();
      if (!['Not Started', 'In Progress', 'Completed'].includes(nextStatus)) {
        return res.status(400).json({ message: 'Invalid status.' });
      }

      if (nextStatus === 'Completed') {
        updates.workflowStage = 'Completed';
        updates.completedAt = before.completedAt || new Date();
        updates.closedAt = undefined;
      } else if (nextStatus === 'In Progress') {
        updates.workflowStage = before.workflowStage === 'Closed' ? 'In Progress' : 'In Progress';
        if (!before.acknowledgedAt) {
          updates.acknowledgedAt = new Date();
        }
        if (before.status === 'Completed') {
          updates.completedAt = undefined;
        }
      } else if (nextStatus === 'Not Started') {
        updates.workflowStage = before.workflowStage === 'Closed' ? 'Assigned' : 'Assigned';
        if (before.status === 'Completed') {
          updates.completedAt = undefined;
        }
      }
    }

    if (hasApprovalStatus) {
      const nextApprovalStatus = String(updates.approvalStatus || '').trim();
      if (nextApprovalStatus === 'Rejected') {
        updates.rejectedAt = new Date();
        updates.approvedAt = undefined;
        updates.completedAt = undefined;
        if (!hasWorkflowStage) updates.workflowStage = 'In Progress';
        if (!hasStatus) updates.status = 'In Progress';
        updates.closedAt = undefined;
      }

      if (nextApprovalStatus === 'Approved') {
        const now = new Date();
        updates.approvedAt = now;
        updates.rejectedAt = undefined;
        updates.status = 'Completed';
        updates.workflowStage = 'Completed';
        updates.completedAt = now;
        updates.closedAt = undefined;
      }
    }

    const updated: any = await Task.findByIdAndUpdate(taskId, updates, { new: true });
    if (!updated) return res.status(404).json({ message: 'Task not found.' });

    const changes: string[] = [];
    if (req.body.status && req.body.status !== before.status)
      changes.push(`Status: ${before.status} → ${req.body.status}`);
    if (req.body.workflowStage && req.body.workflowStage !== before.workflowStage)
      changes.push(`Workflow: ${before.workflowStage || '-'} → ${req.body.workflowStage}`);
    if (req.body.assignee && req.body.assignee !== before.assignee)
      changes.push(`Assignee: ${before.assignee || '-'} → ${req.body.assignee}`);
    if (req.body.supervisor && req.body.supervisor !== before.supervisor)
      changes.push(`Supervisor: ${before.supervisor || '-'} → ${req.body.supervisor}`);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'qualityScore') && req.body.qualityScore !== before.qualityScore)
      changes.push(`Quality: ${before.qualityScore ?? '-'} → ${req.body.qualityScore}`);
    if (req.body.dueDate && req.body.dueDate !== before.dueDate)
      changes.push(`Due: ${before.dueDate || '-'} → ${req.body.dueDate}`);
    if (req.body.startDate && req.body.startDate !== before.startDate)
      changes.push(`Start: ${before.startDate || '-'} → ${req.body.startDate}`);
    if (req.body.title && req.body.title !== before.title) changes.push(`Title changed`);
    if (req.body.relatedClient && req.body.relatedClient !== before.relatedClient)
      changes.push(`Related client updated`);

    await writeAudit({
      caseId: String(updated.caseId),
      ...withActor(req),
      action: 'TASK_UPDATED',
      message: 'Updated task',
      detail: `${updated.title || 'Untitled'}${changes.length ? ' • ' + changes.join(' • ') : ''}`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ message: 'Failed to update task.' });
  }
};

// Delete task
export const deleteTask = async (req: AuthRequest, res: Response) => {
  try {
    let taskId: any = req.params.taskId;
    if (Array.isArray(taskId)) taskId = taskId[0];
    if (!taskId) return res.status(400).json({ message: 'Missing taskId' });

    const existing: any = await Task.findById(taskId);
    if (!existing) return res.status(404).json({ message: 'Task not found.' });

    if (!(await canManageTask(req, existing))) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const deleted = await Task.findByIdAndDelete(taskId);
    if (!deleted) return res.status(404).json({ message: 'Task not found.' });

    await writeAudit({
      caseId: String((deleted as any).caseId),
      ...withActor(req),
      action: 'TASK_DELETED',
      message: 'Deleted task',
      detail: (deleted as any).title || 'Untitled',
    });

    res.json({ message: 'Task deleted.' });
  } catch {
    res.status(500).json({ message: 'Failed to delete task.' });
  }
};

// --------------------
// Approval workflow
// --------------------

export const submitTaskForApproval = async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params as any;
    if (!taskId) return res.status(400).json({ message: 'Missing taskId' });

    const task: any = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: 'Task not found.' });

    if (isApprovedLocked(task)) {
      return res.status(400).json({ message: 'This task is locked and cannot be submitted.' });
    }

    if (!task.requiresApproval) {
      return res.status(400).json({ message: 'This task does not require approval.' });
    }

    if (!['Draft', 'Rejected'].includes(String(task.approvalStatus))) {
      return res.status(400).json({ message: `Cannot submit when status is ${task.approvalStatus}.` });
    }

    task.approvalStatus = 'Pending';
    task.submittedAt = new Date();
    task.workflowStage = 'Awaiting Review';
    task.status = 'In Progress';
    task.acknowledgedAt = task.acknowledgedAt || new Date();
    await task.save();

    await writeAudit({
      caseId: String(task.caseId),
      ...withActor(req),
      action: 'TASK_UPDATED',
      message: 'Submitted task for approval',
      detail: task.title || 'Untitled',
    });

    const assignedByUser: any = await findUserByAssigneeString(task.assignedBy);
    const directReviewerIds = assignedByUser?._id ? [String(assignedByUser._id)] : [];

    // Notify task coordinators for approvals.
    await notifyRoles({
      roles: ['managing_director', 'executive_assistant'],
      category: 'approvals',
      notification: {
        type: 'TASK_APPROVAL_REQUESTED',
        title: 'Task approval requested',
        message: `${task.title || 'Task'} is pending approval.`,
        severity: 'warning',
        caseId: String(task.caseId),
        taskId: String(task._id),
        link: `/tasks/${task._id}`,
      },
      email: {
        subject: `Approval needed: ${task.title || 'Task'}`,
        html: `<div style="font-family: Arial, sans-serif">
                <p>A task has been submitted for approval.</p>
                <p><b>${task.title || 'Task'}</b></p>
              </div>`,
      },
    });

    if (directReviewerIds.length) {
      await notifyUsersById({
        userIds: directReviewerIds,
        category: 'approvals',
        notification: {
          type: 'TASK_APPROVAL_REQUESTED',
          title: 'Task approval requested',
          message: `${task.title || 'Task'} is pending approval.`,
          severity: 'warning',
          caseId: String(task.caseId),
          taskId: String(task._id),
          link: `/tasks/${task._id}`,
        },
      });
    }

    res.json(task);
  } catch {
    res.status(500).json({ message: 'Failed to submit task for approval.' });
  }
};

// Approve (case coordinators only)
export const approveTask = async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params as any;
    const { comment } = req.body || {};
    if (!taskId) return res.status(400).json({ message: 'Missing taskId' });

    const task: any = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: 'Task not found.' });

    if (!(await canManageTask(req, task))) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    if (isApprovedLocked(task)) {
      return res.status(400).json({ message: 'This task is locked.' });
    }

    if (!task.requiresApproval) {
      return res.status(400).json({ message: 'This task does not require approval.' });
    }

    if (task.approvalStatus !== 'Pending') {
      return res.status(400).json({ message: 'Task is not pending approval.' });
    }

    const now = new Date();

    task.approvalStatus = 'Approved';
    task.status = 'Completed';
    task.workflowStage = 'Completed';

    task.approvedAt = now;
    task.rejectedAt = undefined;

    task.completedAt = now;
    task.closedAt = undefined;
    task.acknowledgedAt = task.acknowledgedAt || now;
    task.approvedBy = req.user?.name || 'System';
    task.approvalComment = String(comment || '').trim();

    await task.save();

    await writeAudit({
      caseId: String(task.caseId),
      ...withActor(req),
      action: 'TASK_UPDATED',
      message: 'Approved task',
      detail: `${task.title || 'Untitled'} • Marked Completed`,
    });

    res.json(task);
  } catch {
    res.status(500).json({ message: 'Failed to approve task.' });
  }
};

// Reject (case coordinators only)
export const rejectTask = async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params as any;
    const { comment } = req.body || {};
    if (!taskId) return res.status(400).json({ message: 'Missing taskId' });

    const task: any = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: 'Task not found.' });

    if (!(await canManageTask(req, task))) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    if (isApprovedLocked(task)) {
      return res.status(400).json({ message: 'This task is locked.' });
    }

    if (!task.requiresApproval) {
      return res.status(400).json({ message: 'This task does not require approval.' });
    }

    if (task.approvalStatus !== 'Pending') {
      return res.status(400).json({ message: 'Task is not pending approval.' });
    }

    const now = new Date();

    task.approvalStatus = 'Rejected';
    task.rejectedAt = now;
    task.approvedAt = undefined;

    if (task.status === 'Completed') {
      task.status = 'In Progress';
    }
    task.completedAt = undefined;
    task.workflowStage = 'In Progress';
    task.closedAt = undefined;
    task.acknowledgedAt = task.acknowledgedAt || now;

    task.approvedBy = req.user?.name || 'System';
    task.approvalComment = String(comment || '').trim();

    await task.save();

    await writeAudit({
      caseId: String(task.caseId),
      ...withActor(req),
      action: 'TASK_UPDATED',
      message: 'Rejected task',
      detail: `${task.title || 'Untitled'}${task.approvalComment ? ' • ' + task.approvalComment : ''}`,
    });

    res.json(task);
  } catch {
    res.status(500).json({ message: 'Failed to reject task.' });
  }
};

// --------------------
// Checklist (locked after Approved)
// --------------------

export const addChecklistItem = async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params as any;
    const { item } = req.body;

    if (!taskId) return res.status(400).json({ message: 'Missing taskId' });
    if (!item || !String(item).trim()) return res.status(400).json({ message: 'Checklist item is required' });

    const task: any = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: 'Task not found.' });

    if (isApprovedLocked(task)) return res.status(403).json({ message: 'Task is approved and locked.' });

    if (req.user?.role !== 'managing_director' && task.assignee !== req.user?.name && task.supervisor !== req.user?.name) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    task.checklist = task.checklist || [];
    task.checklist.push({ item: String(item).trim(), completed: false } as any);
    await task.save();

    await writeAudit({
      caseId: String(task.caseId),
      ...withActor(req),
      action: 'TASK_UPDATED',
      message: 'Added checklist item',
      detail: `${task.title || 'Task'} • ${String(item).trim()}`,
    });

    res.json(task);
  } catch {
    res.status(500).json({ message: 'Failed to add checklist item.' });
  }
};

export const toggleChecklistItem = async (req: AuthRequest, res: Response) => {
  try {
    const { taskId, itemId } = req.params as any;

    if (!taskId) return res.status(400).json({ message: 'Missing taskId' });
    if (!itemId) return res.status(400).json({ message: 'Missing itemId' });

    const task: any = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: 'Task not found.' });

    if (isApprovedLocked(task)) return res.status(403).json({ message: 'Task is approved and locked.' });

    if (req.user?.role !== 'managing_director' && task.assignee !== req.user?.name) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const item = task.checklist?.find((i: any) => String(i._id) === String(itemId));
    if (!item) return res.status(404).json({ message: 'Checklist item not found.' });

    item.completed = !item.completed;
    await task.save();

    await writeAudit({
      caseId: String(task.caseId),
      ...withActor(req),
      action: 'TASK_UPDATED',
      message: 'Updated checklist item',
      detail: `${task.title || 'Task'} • ${item.item} • ${item.completed ? 'Completed' : 'Pending'}`,
    });

    res.json(task);
  } catch {
    res.status(500).json({ message: 'Failed to update checklist item.' });
  }
};

export const deleteChecklistItem = async (req: AuthRequest, res: Response) => {
  try {
    const { taskId, itemId } = req.params as any;

    if (!taskId) return res.status(400).json({ message: 'Missing taskId' });
    if (!itemId) return res.status(400).json({ message: 'Missing itemId' });

    const task: any = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: 'Task not found.' });

    if (isApprovedLocked(task)) return res.status(403).json({ message: 'Task is approved and locked.' });

    if (req.user?.role !== 'managing_director' && task.assignee !== req.user?.name) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const item = task.checklist?.find((i: any) => String(i._id) === String(itemId));
    if (!item) return res.status(404).json({ message: 'Checklist item not found.' });

    const deletedText = item.item;

    task.checklist = (task.checklist || []).filter((i: any) => String(i._id) !== String(itemId)) as any;
    await task.save();

    await writeAudit({
      caseId: String(task.caseId),
      ...withActor(req),
      action: 'TASK_UPDATED',
      message: 'Deleted checklist item',
      detail: `${task.title || 'Task'} • ${deletedText}`,
    });

    res.json(task);
  } catch {
    res.status(500).json({ message: 'Failed to delete checklist item.' });
  }
};

// --------------------
// Time Logs (locked after Approved)
// --------------------

export const getTimeLogsForTask = async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params as any;
    if (!taskId) return res.status(400).json({ message: 'Missing taskId' });

    const task: any = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: 'Task not found.' });

    if (req.user?.role !== 'managing_director' && task.assignee !== req.user?.name) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const logs = await TaskTimeLog.find({ taskId: new mongoose.Types.ObjectId(taskId) }).sort({ loggedAt: -1 });
    const totalHours = logs.reduce((sum, l) => sum + (Number((l as any).hours) || 0), 0);

    res.json({ logs, totalHours });
  } catch {
    res.status(500).json({ message: 'Failed to fetch time logs.' });
  }
};

export const addTimeLogToTask = async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params as any;
    const { hours, note, loggedAt } = req.body || {};

    if (!taskId) return res.status(400).json({ message: 'Missing taskId' });

    const numHours = Number(hours);
    if (!Number.isFinite(numHours) || numHours <= 0) {
      return res.status(400).json({ message: 'hours must be a positive number' });
    }

    const task: any = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: 'Task not found.' });

    if (isApprovedLocked(task)) return res.status(403).json({ message: 'Task is approved and locked.' });

    if (req.user?.role !== 'managing_director' && task.assignee !== req.user?.name) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const payload: any = {
      taskId: new mongoose.Types.ObjectId(taskId),
      caseId: task.caseId,
      userName: req.user?.name || 'System',
      hours: numHours,
      loggedAt: loggedAt ? new Date(loggedAt) : new Date(),
    };

    if (req.user?.id) payload.userId = new mongoose.Types.ObjectId(req.user.id);
    if (note && String(note).trim()) payload.note = String(note).trim();

    const log = await TaskTimeLog.create(payload);

    await writeAudit({
      caseId: String(task.caseId),
      ...withActor(req),
      action: 'TASK_UPDATED',
      message: 'Logged hours',
      detail: `${task.title || 'Task'} • ${numHours}h`,
    });

    res.status(201).json(log);
  } catch {
    res.status(500).json({ message: 'Failed to log hours.' });
  }
};
