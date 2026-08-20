// colin-backend/src/controllers/taskController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import Task from '../models/taskModel';
import Case from '../models/caseModel';
import User from '../models/userModel';
import { AuthRequest } from '../middleware/authMiddleware';
import { writeAudit } from '../services/auditService';
import { notifyRoles, notifyUsersById, findUserByAssigneeString } from '../services/notifyService';
import { buildYearlySequence } from '../utils/counter';
import { isPublicYellowCase } from '../utils/caseVisibility';
import { caseMatchesAssignee } from '../utils/caseAssignments';

const isAssociateLikeRole = (role?: string) =>
  role === 'associate' || role === 'trainee_associate' || role === 'senior_associate' || role === 'intern';
const isAssociateAssignableRole = (role?: string) => role === 'trainee_associate' || role === 'intern';
const isTaskSupervisorRole = (role?: string) =>
  role === 'associate' || role === 'executive_assistant' || role === 'managing_partner' || role === 'managing_director';
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

const normalizeIdentity = (value: unknown) => String(value || '').trim().toLowerCase();

const TASK_WORKFLOW_MODES = ['LEGACY', 'STAGED'] as const;
type TaskWorkflowMode = (typeof TASK_WORKFLOW_MODES)[number];
const TASK_STAGE_STATUSES = ['Assigned', 'In Progress', 'Completed', 'Cancelled'] as const;
type TaskStageStatus = (typeof TASK_STAGE_STATUSES)[number];
const TASK_STAGE_ROLES = ['Initiator', 'Reviewer', 'Signer', 'Approver', 'Signer/Approver', 'Preparer', 'Researcher'] as const;
type TaskStageRole = (typeof TASK_STAGE_ROLES)[number];

const normalizeWorkflowMode = (value: unknown): TaskWorkflowMode => {
  const raw = String(value || '').trim();
  return (TASK_WORKFLOW_MODES as readonly string[]).includes(raw) ? (raw as TaskWorkflowMode) : 'LEGACY';
};

const normalizeTaskStageRole = (value: unknown): TaskStageRole | null => {
  const raw = String(value || '').trim();
  return (TASK_STAGE_ROLES as readonly string[]).includes(raw) ? (raw as TaskStageRole) : null;
};

const normalizeTaskStageStatus = (value: unknown): TaskStageStatus => {
  const raw = String(value || '').trim();
  return (TASK_STAGE_STATUSES as readonly string[]).includes(raw) ? (raw as TaskStageStatus) : 'Assigned';
};

const normalizeTaskStagesPayload = (value: unknown, fallback: any[] = []) => {
  const stages = Array.isArray(value) ? value : [];
  if (!stages.length) return fallback;
  return stages
    .map((stage, index) => {
      const role = normalizeTaskStageRole(stage?.role);
      if (!role) return null;
      return {
        role,
        staffMember: String(stage?.staffMember || '').trim(),
        sequence: Number.isFinite(Number(stage?.sequence)) ? Number(stage?.sequence) : index + 1,
        required: stage?.required !== false,
        assignedAt: stage?.assignedAt ? new Date(stage.assignedAt) : undefined,
        dueAt: stage?.dueAt ? new Date(stage.dueAt) : undefined,
        status: normalizeTaskStageStatus(stage?.status),
        completedAt: stage?.completedAt ? new Date(stage.completedAt) : undefined,
        timelinessScore:
          stage?.timelinessScore === null || stage?.timelinessScore === undefined || stage?.timelinessScore === ''
            ? null
            : Number(stage.timelinessScore),
        qualityScore:
          stage?.qualityScore === null || stage?.qualityScore === undefined || stage?.qualityScore === ''
            ? null
            : Number(stage.qualityScore),
        qualityApplicable: stage?.qualityApplicable !== false,
        supervisorReviewer: String(stage?.supervisorReviewer || '').trim(),
        tpaUsed:
          stage?.tpaUsed === null || stage?.tpaUsed === undefined || stage?.tpaUsed === '' ? null : Number(stage.tpaUsed),
        potentialAllocation:
          stage?.potentialAllocation === null ||
          stage?.potentialAllocation === undefined ||
          stage?.potentialAllocation === ''
            ? null
            : Number(stage.potentialAllocation),
        earnedRevenue:
          stage?.earnedRevenue === null || stage?.earnedRevenue === undefined || stage?.earnedRevenue === ''
            ? null
            : Number(stage.earnedRevenue),
        notes: String(stage?.notes || '').trim(),
      };
    })
    .filter(Boolean);
};

const buildDefaultTaskStagesFromCase = (caseRecord: any, dueDate: string, assignedAt = new Date()) => {
  const caseAssignments = caseRecord?.caseAssignments || {};
  const initiator = String(caseAssignments?.initiator || caseRecord?.assignedTo || '').trim();
  const reviewer = String(caseAssignments?.reviewer || '').trim();
  const signer = String(caseAssignments?.signerApprover || '').trim();
  const dueAt = dueDate ? new Date(`${dueDate}T17:00:00.000Z`) : undefined;

  return [
    {
      role: 'Initiator',
      staffMember: initiator,
      sequence: 1,
      required: true,
      assignedAt,
      dueAt,
      status: 'Assigned' as TaskStageStatus,
      completedAt: undefined,
      timelinessScore: null,
      qualityScore: null,
      qualityApplicable: true,
      supervisorReviewer: reviewer || signer || '',
      tpaUsed: null,
      potentialAllocation: null,
      earnedRevenue: null,
      notes: '',
    },
    {
      role: 'Reviewer',
      staffMember: reviewer,
      sequence: 2,
      required: true,
      assignedAt,
      dueAt,
      status: 'Assigned' as TaskStageStatus,
      completedAt: undefined,
      timelinessScore: null,
      qualityScore: null,
      qualityApplicable: true,
      supervisorReviewer: signer || initiator || '',
      tpaUsed: null,
      potentialAllocation: null,
      earnedRevenue: null,
      notes: '',
    },
    {
      role: 'Signer/Approver',
      staffMember: signer,
      sequence: 3,
      required: true,
      assignedAt,
      dueAt,
      status: 'Assigned' as TaskStageStatus,
      completedAt: undefined,
      timelinessScore: null,
      qualityScore: null,
      qualityApplicable: true,
      supervisorReviewer: reviewer || initiator || '',
      tpaUsed: null,
      potentialAllocation: null,
      earnedRevenue: null,
      notes: '',
    },
  ];
};

const ensureMatterAssignmentTask = async (caseId: string) => {
  const caseRecord: any = await Case.findById(caseId)
    .select('caseNo parties assignedTo caseAssignments workflowStartDate createdAt')
    .lean();
  if (!caseRecord) return;

  const caseAssignments = caseRecord.caseAssignments || {};
  const hasMatterAssignments = Boolean(caseAssignments?.initiator && caseAssignments?.reviewer && caseAssignments?.signerApprover);
  if (!hasMatterAssignments) return;

  const existingTask = await Task.findOne({
    caseId: new mongoose.Types.ObjectId(caseId),
    workflowMode: 'STAGED',
  }).lean();
  if (existingTask) return;

  const autoTaskNo = await buildYearlySequence('task', 'TASK');
  const autoDueDate = new Date();
  autoDueDate.setDate(autoDueDate.getDate() + 7);
  const autoDueDateString = autoDueDate.toISOString().slice(0, 10);
  const stagedTask = new Task({
    caseId: new mongoose.Types.ObjectId(caseId),
    taskNo: autoTaskNo,
    title: `Matter Assignment - ${caseRecord.caseNo || 'Case'}`,
    workflowMode: 'STAGED',
    workflowStage: 'Assigned',
    priority: 'Medium',
    status: 'Not Started',
    assignee: String(caseAssignments.initiator || caseRecord.assignedTo || '').trim(),
    supervisor: String(caseAssignments.reviewer || caseAssignments.signerApprover || '').trim(),
    relatedClient: String(caseRecord.parties || '').trim(),
    startDate:
      caseRecord.workflowStartDate?.toISOString?.().slice(0, 10) ||
      caseRecord.createdAt?.toISOString?.().slice(0, 10) ||
      new Date().toISOString().slice(0, 10),
    dueDate: autoDueDateString,
    description: 'Auto-created from matter assignment.',
    taskStages: buildDefaultTaskStagesFromCase(caseRecord, autoDueDateString),
    requiresApproval: false,
    approvalStatus: 'Not Required',
    assignedBy: 'System',
  });

  await stagedTask.save();
};

const taskStagesToOverallStatus = (taskStages: any[] = []) => {
  if (!taskStages.length) return null;
  return taskStagesAreComplete(taskStages) ? 'Completed' : 'In Progress';
};

const taskStageMatchesUser = (stage: any, meName: string, meEmail: string) => {
  const staffMember = normalizeIdentity(stage?.staffMember);
  return Boolean(staffMember && [meName, meEmail].includes(staffMember));
};

const taskStagesAreComplete = (taskStages: any[] = []) =>
  taskStages.length > 0 && taskStages.every((stage) => !stage?.required || String(stage?.status || '') === 'Completed');

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
  const meName = normalizeIdentity(req.user?.name);
  const meEmail = normalizeIdentity(req.user?.email);
  const assignee = normalizeIdentity(task.assignee);
  const supervisor = normalizeIdentity(task.supervisor);
  const stageMatch = (task?.taskStages || []).some((stage: any) => taskStageMatchesUser(stage, meName, meEmail));
  return [assignee, supervisor].some((value) => value && (value === meName || value === meEmail)) || stageMatch;
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
    throw new Error('Supervisor must be an Associate, Executive Assistant, Managing Partner, or Managing Director.');
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

  const c: any = await Case.findById(caseId).select('assignedTo caseAssignments status workflowProgress workflowStartDate createdAt');
  if (!c) return false;

  if (isPublicYellowCase(c)) return true;

  const meName = normalizeIdentity(req.user?.name);
  const meEmail = normalizeIdentity(req.user?.email);
  if (!meName && !meEmail) return false;

  if (caseMatchesAssignee(c, meName) || caseMatchesAssignee(c, meEmail)) return true;

  const tasks = await Task.find({ caseId }).select('assignee supervisor taskStages').lean();
  return tasks.some((task: any) => {
    const assignee = normalizeIdentity(task?.assignee);
    const supervisor = normalizeIdentity(task?.supervisor);
    const stageMatch = (task?.taskStages || []).some((stage: any) => taskStageMatchesUser(stage, meName, meEmail));
    return [assignee, supervisor].some((value) => value && (value === meName || value === meEmail)) || stageMatch;
  });
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

    await ensureMatterAssignmentTask(String(caseId));
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
    const workflowMode = normalizeWorkflowMode(req.body?.workflowMode);
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

    const caseRecord: any = await Case.findById(caseId).select('parties caseNo assignedTo caseAssignments').lean();
    const taskNo = String(req.body?.taskNo || '').trim() || (await generateTaskNo());
    const relatedClient = String(req.body?.relatedClient || caseRecord?.parties || '').trim();
    const providedTaskStages = normalizeTaskStagesPayload(req.body?.taskStages, []);
    const taskStages =
      workflowMode === 'STAGED'
        ? providedTaskStages.length
          ? providedTaskStages
          : buildDefaultTaskStagesFromCase(caseRecord, dueDate)
        : [];

    const requiresApproval = Boolean(req.body.requiresApproval);
    const approvalStatus = requiresApproval ? 'Draft' : 'Not Required';

    const newTask = new Task({
      ...req.body,
      taskNo,
      caseId: new mongoose.Types.ObjectId(caseId),
      workflowMode,
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
      taskStages,
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

      const visibility: any = { $or: [{ assignee: me }, { supervisor: me }, { 'taskStages.staffMember': me }] };
      if (req.user?.role === 'associate') {
        const ownedCaseIds = await Case.find({
          $or: [
            { assignedTo: new RegExp(me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
            { 'caseAssignments.initiator': new RegExp(me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
            { 'caseAssignments.reviewer': new RegExp(me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
            { 'caseAssignments.signerApprover': new RegExp(me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          ],
        }).distinct('_id');
        const caseIdsFromTasks = await Task.distinct('caseId', {
          $or: [{ assignee: me }, { supervisor: me }, { 'taskStages.staffMember': me }],
        });
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
      andFilters.push({
        $or: [
          { title: regex },
          { assignee: regex },
          { supervisor: regex },
          { 'taskStages.staffMember': regex },
          { taskNo: regex },
          { relatedClient: regex },
        ],
      });
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
    const caseRecord: any = await Case.findById(before.caseId).select('parties caseNo assignedTo caseAssignments').lean();

    const canManage = await canManageTask(req, before);
    const meName = normalizeIdentity(req.user?.name);
    const meEmail = normalizeIdentity(req.user?.email);
    const isAssignee = normalizeIdentity(before.assignee) === meName || normalizeIdentity(before.assignee) === meEmail;
    const isSupervisor = normalizeIdentity(before.supervisor) === meName || normalizeIdentity(before.supervisor) === meEmail;
    const isStageParticipant = (before.taskStages || []).some((stage: any) => taskStageMatchesUser(stage, meName, meEmail));
    const attemptedKeys = Object.keys(req.body || {}).filter((key) => req.body?.[key] !== undefined);
    const qualityOnlyUpdate = attemptedKeys.length > 0 && attemptedKeys.every((key) => key === 'qualityScore');

    if (!canManage && !isAssignee && !isSupervisor && !isStageParticipant) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    if (!canManage) {
      const allowedSelfServiceKeys = isStageParticipant
        ? ['status', 'workflowStage', 'taskStages', 'workflowMode', 'qualityScore']
        : isSupervisor
          ? ['qualityScore']
          : ['status', 'workflowStage'];
      if (attemptedKeys.some((key) => !allowedSelfServiceKeys.includes(key))) {
        return res.status(403).json({
          message: isStageParticipant
            ? 'You can only update your assigned stage.'
            : isSupervisor
              ? 'Supervisors can only update quality score.'
              : 'You can only update task status.',
        });
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

    if (Object.prototype.hasOwnProperty.call(updates, 'workflowMode')) {
      updates.workflowMode = normalizeWorkflowMode(updates.workflowMode);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'taskStages')) {
      updates.taskStages = normalizeTaskStagesPayload(updates.taskStages, before.taskStages || []);
      if (!Object.prototype.hasOwnProperty.call(updates, 'workflowMode') && updates.taskStages.length) {
        updates.workflowMode = 'STAGED';
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'workflowMode') && updates.workflowMode === 'STAGED') {
      if (!Object.prototype.hasOwnProperty.call(updates, 'taskStages') || !updates.taskStages.length) {
        updates.taskStages = normalizeTaskStagesPayload(
          buildDefaultTaskStagesFromCase(caseRecord, Object.prototype.hasOwnProperty.call(updates, 'dueDate') ? updates.dueDate : before.dueDate),
          []
        );
      }
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
    const hasTaskStages = Object.prototype.hasOwnProperty.call(updates, 'taskStages');
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

    if (hasTaskStages) {
      const nextStatus = taskStagesAreComplete(updates.taskStages) ? 'Completed' : 'In Progress';
      updates.status = nextStatus;
      if (!hasWorkflowStage) updates.workflowStage = nextStatus === 'Completed' ? 'Completed' : 'In Progress';
      if (nextStatus === 'Completed') {
        updates.completedAt = before.completedAt || new Date();
      } else if (!before.completedAt) {
        updates.completedAt = undefined;
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

    if (!(await canAccessTask(req, task))) {
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

    if (!(await canAccessTask(req, task))) {
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

    if (!(await canAccessTask(req, task))) {
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

