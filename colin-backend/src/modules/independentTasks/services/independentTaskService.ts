import mongoose from 'mongoose';
import AuditLog from '../../../models/auditLogModel';
import Case from '../../../models/caseModel';
import Document from '../../../models/documentModel';
import Invoice from '../../../models/invoiceModel';
import Notification from '../../../models/notificationModel';
import Task from '../../../models/taskModel';
import User from '../../../models/userModel';
import WorkflowInstance from '../../../models/workflowInstanceModel';
import WorkflowTemplate from '../../../models/workflowTemplateModel';
import { AuthRequest } from '../../../middleware/authMiddleware';
import { writeAudit } from '../../../services/auditService';
import { notifyRoles, notifyUsersById } from '../../../services/notifyService';
import { buildYearlySequence } from '../../../utils/counter';
import IndependentTask, {
  IndependentTaskCaseRole,
  IndependentTaskPriority,
  IndependentTaskStatus,
} from '../models/independentTaskModel';
import IndependentTaskAttachment from '../models/independentTaskAttachmentModel';
import IndependentTaskComment from '../models/independentTaskCommentModel';
import IndependentTaskHistory, {
  IndependentTaskHistoryAction,
} from '../models/independentTaskHistoryModel';
import { caseMatchesAssignee } from '../../../utils/caseAssignments';
import { deleteStoredFile, storeUploadedFile } from '../../../services/fileStorageService';
import { completeStepForCase } from '../../../controllers/workflowController';
import { computeCaseEarnedFees, computeStepTimelinessAt, normalizeEffectiveWorkflowSteps } from '../../../utils/caseEarnedFees';
import { allocateCollectedValueAcrossKeyActions, calculateCollectedKeyActionEarnings } from '../../../utils/keyActionEarnings';
import { buildRoleByName, computeEarnedFee } from '../../../utils/workflowPercentages';
import { returnCaseWorkForCorrections } from '../../../services/caseWorkCorrectionService';

export type IndependentTaskListQuery = {
  q?: string;
  status?: IndependentTaskStatus | 'all';
  priority?: IndependentTaskPriority | 'all';
  assignee?: string;
  supervisor?: string;
  matterId?: string;
  page?: number;
  limit?: number;
  sortBy?: 'dueDate' | 'createdAt' | 'priority' | 'status' | 'taskNumber';
  sortDir?: 'asc' | 'desc';
};

const ADMIN_ROLES = new Set([
  'managing_director',
  'managing_partner',
  'executive_managing_partner',
  'senior_partner',
  'partner',
  'executive_partner',
  'associate_partner',
  'executive_associate_partner',
  'senior_executive_assistant',
  'executive_assistant',
  'originating_attorney',
]);

const MANAGE_ROLES = new Set([
  ...Array.from(ADMIN_ROLES),
  'associate',
  'senior_associate',
]);

// Creating initiator work is available to all staff, without granting
// management, review or approval privileges to junior contributors.
const DELEGATION_ROLES = new Set([...Array.from(MANAGE_ROLES), 'trainee_associate', 'intern']);
const canDelegateRole = (role?: string) => DELEGATION_ROLES.has(role || '');

// Task deletion is available to the creator and senior oversight roles.
// This does not grant general workflow administration privileges.
const DELETE_ROLES = new Set([...Array.from(ADMIN_ROLES), 'senior_associate']);

const REVIEW_ROLES = new Set([
  ...Array.from(ADMIN_ROLES),
  'associate',
  'senior_associate',
]);

const STATUS_ORDER: IndependentTaskStatus[] = [
  'Created',
  'Assigned',
  'Acknowledged',
  'In Progress',
  'Awaiting Review',
  'Awaiting External Action',
  'Completed',
  'Closed',
  'Cancelled',
];

const STATUS_FLOW: Record<IndependentTaskStatus, IndependentTaskStatus[]> = {
  Created: ['Assigned'],
  Assigned: ['Acknowledged'],
  Acknowledged: ['In Progress'],
  'In Progress': ['Awaiting Review', 'Awaiting External Action'],
  'Awaiting Review': ['Completed'],
  'Awaiting External Action': ['In Progress'],
  Completed: ['Closed'],
  Closed: [],
  Cancelled: [],
};

const CASE_TASK_ROLES: IndependentTaskCaseRole[] = ['Initiator', 'Reviewer', 'Signer/Approver'];

const samePerson = (left: unknown, right: unknown) => {
  const normalizedLeft = cleanString(left).toLocaleLowerCase();
  const normalizedRight = cleanString(right).toLocaleLowerCase();
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

// Saved identity is authoritative; names are only a fallback for legacy tasks.
const isTaskCreator = (req: AuthRequest, task: any) => task.createdByUserId
  ? Boolean(req.user?.id && String(task.createdByUserId) === String(req.user.id))
  : samePerson(task.createdBy, req.user?.name);
const hasTaskDeleteRole = (role?: string) => DELETE_ROLES.has(role || '');
const canDeleteTask = (req: AuthRequest, task: any) => hasTaskDeleteRole(req.user?.role) || isTaskCreator(req, task);

const keyActionKeysFrom = (value: unknown) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((key) => cleanString(key))
        .filter(Boolean)
    )
  );

const isCaseTaskRole = (value: unknown): value is IndependentTaskCaseRole =>
  CASE_TASK_ROLES.includes(cleanString(value) as IndependentTaskCaseRole);

const actor = (req: AuthRequest) => ({
  actorName: req.user?.name || 'System',
  actorUserId: req.user?.id,
});

const isAdminRole = (role?: string) => (role ? ADMIN_ROLES.has(role) : false);
const canManageRole = (role?: string) => (role ? MANAGE_ROLES.has(role) : false);
const canReviewRole = (role?: string) => (role ? REVIEW_ROLES.has(role) : false);

const cleanString = (value: unknown) => String(value || '').trim();
const findUserByAssigneeString = async (value: string) => {
  const input = cleanString(value);
  if (!input) return null;
  if (mongoose.Types.ObjectId.isValid(input)) return User.findById(input).select('_id name email role isActive').lean();
  if (input.includes('@')) return User.findOne({ email: input.toLowerCase() }).select('_id name email role isActive').lean();
  const escaped = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = await User.find({ name: new RegExp(`^\\s*${escaped}\\s*$`, 'i'), isActive: { $ne: false } })
    .select('_id name email role isActive').limit(2).lean();
  return matches.length === 1 ? matches[0] : null;
};
const toDateMs = (value?: string) => {
  if (!value) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
};
const todayISO = () => new Date().toISOString().slice(0, 10);

const loadCaseTaskContext = async (caseId: string) => {
  const caseDoc: any = await Case.findById(caseId);
  if (!caseDoc) throw new Error('Selected matter was not found.');
  const inst: any = await WorkflowInstance.findOne({ caseId: caseDoc._id });
  if (!inst) throw new Error('This matter does not have an active Key Action workflow.');
  const template: any = await WorkflowTemplate.findById(inst.templateId).lean();
  if (!template) throw new Error('The workflow template for this matter was not found.');
  return { caseDoc, inst, template };
};

const publicKeyActions = (inst: any, template: any) => {
  const steps = normalizeEffectiveWorkflowSteps(inst, template);
  return steps.map((step: any) => ({
    key: cleanString(step?.stepKey),
    title: cleanString(step?.title) || cleanString(step?.stepKey) || 'Key Action',
    stageTitle: cleanString(step?.stageTitle) || cleanString(step?.stageKey) || 'Workflow stage',
    status: cleanString(step?.status) || 'Not Started',
    dueAt: step?.dueAt || null,
    percentage: Number(step?.percentage) || 0,
  })).filter((step) => Boolean(step.key));
};

const keyActionIsReadyForRole = (role: IndependentTaskCaseRole, status: string) => {
  // Initiators can reserve only untouched work. In Progress and Done signal
  // work already begun in the case workflow and must never be claimed anew.
  if (role === 'Initiator') return status === 'Not Started';
  if (role === 'Reviewer') return status === 'Awaiting Review';
  return status === 'Awaiting Approval';
};

const delegatedKeyActionOptions = (inst: any, template: any) => {
  const steps = normalizeEffectiveWorkflowSteps(inst, template);
  return steps
    .map((step: any) => {
      const status = cleanString(step?.status) || 'Not Started';
      const claim = step?.delegatedClaim;
      const claimed = Boolean(claim?.taskId);
      const eligibleRoles = {
        Initiator: keyActionIsReadyForRole('Initiator', status) && !claimed,
        Reviewer: keyActionIsReadyForRole('Reviewer', status) && !claimed,
        'Signer/Approver': keyActionIsReadyForRole('Signer/Approver', status) && !claimed,
      };
      const unavailableReason = claimed
        ? 'Reserved by another active delegated task.'
        : undefined;
      return {
        key: cleanString(step?.stepKey),
        title: cleanString(step?.title) || cleanString(step?.stepKey) || 'Key Action',
        stageTitle: cleanString(step?.stageTitle) || cleanString(step?.stageKey) || 'Workflow stage',
        status,
        dueAt: step?.dueAt || null,
        percentage: Number(step?.percentage) || 0,
        originalResponsibleRole: cleanString(step?.responsibleRole) || undefined,
        claimed,
        eligibility: eligibleRoles,
        unavailableReason,
      };
    })
    .filter((step) => Boolean(step.key));
};

const releaseDelegatedClaims = async (taskId: unknown, session?: mongoose.ClientSession) => {
  const instances: any[] = await WorkflowInstance.find({
    'steps.delegatedClaim.taskId': taskId,
  }).session(session || null);
  await Promise.all(instances.map(async (instance) => {
    let changed = false;
    for (const step of instance.steps || []) {
      if (String(step?.delegatedClaim?.taskId || '') === String(taskId)) {
        if (step.delegatedClaim.role === 'Initiator' && step.status === 'In Progress' && !step.doneAt) {
          step.status = 'Not Started';
        }
        step.delegatedClaim = undefined;
        changed = true;
      }
    }
    if (changed) {
      if (session) await instance.save({ session });
      else await instance.save();
    }
  }));
};

const reserveDelegatedKeyActions = async (args: {
  instanceId: unknown;
  task: any;
  role: IndependentTaskCaseRole;
  keyActionKeys: string[];
  session?: mongoose.ClientSession;
}) => {
  const reserved: string[] = [];
  try {
    for (const key of args.keyActionKeys) {
      const expectedStatus = args.role === 'Initiator'
        ? 'Not Started'
        : args.role === 'Reviewer'
          ? 'Awaiting Review'
          : 'Awaiting Approval';
      const updated = await (WorkflowInstance as any).findOneAndUpdate(
        {
          _id: args.instanceId,
          steps: {
            $elemMatch: {
              stepKey: key,
              status: expectedStatus,
              'delegatedClaim.taskId': { $exists: false },
            },
          },
        },
        {
          $set: {
            'steps.$.delegatedClaim': {
              taskId: args.task._id,
              role: args.role,
              claimantName: args.task.assignee,
              claimedAt: new Date(),
            },
          },
        },
        { new: true, ...(args.session ? { session: args.session } : {}) }
      );
      if (!updated) {
        throw new Error('One or more Key Actions are no longer available. Refresh the matter workflow and try again.');
      }
      reserved.push(key);
    }
  } catch (error) {
    if (reserved.length) await releaseDelegatedClaims(args.task._id, args.session);
    throw error;
  }
};

/**
 * The task table/workspace needs task-specific money, not the total earned by
 * the person elsewhere on the same matter.  We therefore derive the amount
 * from only the task's selected Key Actions and only the lifecycle events that
 * this task recorded. The common case calculation remains the source for
 * collection caps, Quality Score and TPA.
 */
const buildCaseTaskMetrics = async (task: any, knownMatter?: any) => {
  const role = task?.caseRole as IndependentTaskCaseRole | undefined;
  const taskKeys = keyActionKeysFrom(task?.keyActionKeys);
  if (!task?.relatedMatterId || !role || !taskKeys.length) return null;

  try {
    const { caseDoc, inst, template } = await loadCaseTaskContext(String(task.relatedMatterId));
    const [tasks, paidInvoices, users] = await Promise.all([
      Task.find({ caseId: caseDoc._id }).lean(),
      Invoice.find({ caseId: caseDoc._id, status: 'Paid' }).select('amount').lean(),
      User.find({ isActive: { $ne: false } }).select('name role').lean(),
    ]);
    const collectedAmount = (paidInvoices || []).reduce((sum: number, invoice: any) => sum + Math.max(0, Number(invoice?.amount) || 0), 0);
    const effectiveSteps = normalizeEffectiveWorkflowSteps(inst, template);
    const workflowInstance = { ...(typeof inst.toObject === 'function' ? inst.toObject() : inst), steps: effectiveSteps };
    const roleByName = buildRoleByName(users as any[]);
    const earned = computeCaseEarnedFees({
      caseDoc,
      template,
      workflowInstance,
      tasks,
      collectedAmount,
      roleByName,
    });
    const keyActionEarnings = calculateCollectedKeyActionEarnings({
      matter: caseDoc,
      template,
      workflowInstance,
      tasks,
      collectedAmount,
    });
    const collectedByKey = allocateCollectedValueAcrossKeyActions(keyActionEarnings);
    const selectedSteps = effectiveSteps.filter((step: any) => taskKeys.includes(cleanString(step?.stepKey)));
    const contributedSteps = selectedSteps.filter((step: any) =>
      (Array.isArray(step?.independentContributors) ? step.independentContributors : []).some(
        (entry: any) => String(entry?.taskId || '') === String(task._id) && entry?.role === role && samePerson(entry?.name, task.assignee)
      )
    );
    const completedSteps = contributedSteps.filter((step: any) => cleanString(step?.status) === 'Completed');
    const timelinessSamples = contributedSteps
      .map((step: any) => {
        const contribution = (Array.isArray(step?.independentContributors) ? step.independentContributors : []).find(
          (entry: any) => String(entry?.taskId || '') === String(task._id) && entry?.role === role && samePerson(entry?.name, task.assignee)
        );
        return computeStepTimelinessAt(step, contribution?.actedAt);
      })
      .filter((score: number | null): score is number => score !== null);
    const timelinessScore = timelinessSamples.length
      ? Math.round((timelinessSamples.reduce((sum, score) => sum + score, 0) / timelinessSamples.length) * 10) / 10
      : null;
    const teamMember = earned.team.find((member) => member.role === role && samePerson(member.name, task.assignee));
    const collectedBase = completedSteps.reduce(
      (sum: number, step: any) => sum + (Number(collectedByKey.get(cleanString(step?.stepKey))) || 0),
      0
    );
    const tpaPercent = Number(teamMember?.tpaPercent) || 0;
    const qualityScore = earned.qualityScore;
    const earnedFee = computeEarnedFee(collectedBase, tpaPercent, timelinessScore, qualityScore);

    return {
      role,
      currency: earned.currency,
      lifecycleStatus: task.status === 'Cancelled'
        ? 'Cancelled'
        : task.status === 'Closed' ? 'Closed'
        : selectedSteps.length && selectedSteps.every((step: any) => step.status === 'Completed')
          ? 'Completed'
          : selectedSteps.some((step: any) => step.correctionRequest && !step.correctionRequest.resolvedAt)
            ? 'Changes Requested'
          : selectedSteps.some((step: any) => step.status === 'Awaiting Review')
            ? 'Awaiting Review'
            : selectedSteps.some((step: any) => step.status === 'Awaiting Approval')
              ? 'Awaiting Approval'
              : task.status === 'In Progress' ? 'In Progress' : 'Ready',
      selectedKeyActions: selectedSteps.map((step: any) => ({
        key: cleanString(step?.stepKey),
        title: cleanString(step?.title) || cleanString(step?.stepKey),
        stageTitle: cleanString(step?.stageTitle) || cleanString(step?.stageKey),
        status: cleanString(step?.status) || 'Not Started',
        dueAt: step?.dueAt || null,
        percentage: Number(step?.percentage) || 0,
        originalResponsibleRole: cleanString(step?.responsibleRole) || undefined,
        completed: cleanString(step?.status) === 'Completed',
        contributedByTask: contributedSteps.includes(step),
        correctionRequest: step.correctionRequest,
        reviewHistory: step.reviewHistory || [],
        instructions: (step.actions || []).map((action: any) => typeof action === 'string' ? action : cleanString(action.text)).filter(Boolean),
        requirements: (step.outputs || []).map((output: any) => ({ name: cleanString(output.name), required: Boolean(output.required) })),
      })),
      performedKeyActions: contributedSteps.length,
      completedKeyActions: completedSteps.length,
      tpaPercent,
      timelinessScore,
      qualityScore,
      collectedBase: Math.round(collectedBase * 100) / 100,
      earnedFee,
      caseNo: knownMatter?.caseNo || caseDoc.caseNo,
    };
  } catch {
    // A missing/deleted workflow must never hide the independent task. Its
    // normal metadata remains available and the UI can show earnings as pending.
    return null;
  }
};

const requireDateString = (value: unknown, message: string) => {
  const str = cleanString(value);
  if (!str) throw new Error(message);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) throw new Error(message);
  return str;
};

const requireString = (value: unknown, message: string) => {
  const str = cleanString(value);
  if (!str) throw new Error(message);
  return str;
};

const generateTaskNumber = async () => buildYearlySequence('independent-task', 'ITK');

const buildActorRef = (req: AuthRequest) => ({
  actorName: req.user?.name || 'System',
  ...(req.user?.id ? { actorUserId: req.user.id } : {}),
});

const buildHistory = async (
  taskId: string,
  action: IndependentTaskHistoryAction,
  message: string,
  req: AuthRequest,
  detail?: string,
  metadata?: Record<string, unknown>
) => {
  const historyDoc: any = {
    taskId: new mongoose.Types.ObjectId(taskId),
    action,
    message,
    ...actor(req),
  };
  if (detail !== undefined) historyDoc.detail = detail;
  if (metadata !== undefined) historyDoc.metadata = metadata;
  if (req.user?.id) historyDoc.actorUserId = new mongoose.Types.ObjectId(req.user.id);
  await IndependentTaskHistory.create(historyDoc);
};

const buildAudit = (
  req: AuthRequest,
  action: any,
  message: string,
  detail?: string,
  independentTaskId?: string
) => ({
  caseId: '000000000000000000000000',
  ...(independentTaskId ? { independentTaskId } : {}),
  actorName: req.user?.name || 'System',
  ...(req.user?.id ? { actorUserId: req.user.id } : {}),
  action,
  message,
  ...(detail ? { detail } : {}),
});

const isVisibleToUser = async (req: AuthRequest, task: any) => {
  if (hasTaskDeleteRole(req.user?.role)) return true;
  if (isTaskCreator(req, task)) return true;
  if (req.user?.id && [task.assigneeUserId, task.supervisorUserId].some((id) => id && String(id) === req.user!.id)) return true;
  const me = cleanString(req.user?.name);
  if (!me) return false;
  if ([task.assignee, task.supervisor, task.createdBy, task.assignedBy, task.lastActionBy].some((v) => cleanString(v) === me))
    return true;
  if (task.relatedMatterId) {
    const matter = await Case.findById(task.relatedMatterId).select('assignedTo caseAssignments').lean();
    if (matter && (caseMatchesAssignee(matter, me) || caseMatchesAssignee(matter, req.user?.email))) return true;
  }
  return false;
};

const isEditableByUser = async (req: AuthRequest, task: any) => {
  if (['Closed', 'Cancelled'].includes(task.status)) return false;
  if (isAdminRole(req.user?.role)) return true;
  const me = cleanString(req.user?.name);
  if (!me) return false;
  return isTaskCreator(req, task) || cleanString(task.supervisor) === me;
};

const canActAsAssignee = (req: AuthRequest, task: any) => {
  if (task.assigneeUserId) return String(task.assigneeUserId) === req.user?.id;
  if (!req.user?.name) return false;
  return cleanString(task.assignee) === cleanString(req.user.name);
};

const hydrateTask = async (task: any, req?: AuthRequest) => {
  const matter = task.relatedMatterId
    ? await Case.findById(task.relatedMatterId).select('caseNo parties status assignedTo caseAssignments').lean()
    : null;
  const taskObj = typeof task.toObject === 'function' ? task.toObject() : task;
  const caseWork = await buildCaseTaskMetrics(taskObj, matter);
  return {
    ...taskObj,
    ...(req ? { canDelete: canDeleteTask(req, taskObj) } : {}),
    relatedMatter: matter
        ? {
          _id: String((matter as any)._id),
          caseNo: (matter as any).caseNo,
          parties: (matter as any).parties,
          status: (matter as any).status,
          assignedTo: (matter as any).assignedTo,
          caseAssignments: (matter as any).caseAssignments,
        }
      : null,
    ...(caseWork ? { caseWork } : {}),
  };
};

const assertValidDates = (startDate: string, dueDate: string) => {
  const startMs = toDateMs(startDate);
  const dueMs = toDateMs(dueDate);
  if (!Number.isFinite(startMs)) throw new Error('Start date is required.');
  if (!Number.isFinite(dueMs)) throw new Error('Due date is required.');
  if (dueMs < startMs) throw new Error('Due date cannot be earlier than start date.');
};

const assertTaskExists = async (taskId: string) => {
  const task = await IndependentTask.findById(taskId);
  if (!task) throw new Error('Independent task not found.');
  return task;
};

const assertCanView = async (req: AuthRequest, task: any) => {
  if (!(await isVisibleToUser(req, task))) throw new Error('Forbidden.');
};

const assertCanEdit = async (req: AuthRequest, task: any) => {
  if (!(await isEditableByUser(req, task))) throw new Error('Forbidden.');
};

const assertCanDelete = async (req: AuthRequest, task: any) => {
  if (!canDeleteTask(req, task)) {
    const error = new Error('Only the task creator or an authorized senior member can delete this task.') as Error & { statusCode: number };
    error.statusCode = 403;
    throw error;
  }
};

const assertCanTransition = async (req: AuthRequest, task: any, nextStatus: IndependentTaskStatus) => {
  if (['Closed', 'Cancelled'].includes(task.status)) throw new Error('Closed or cancelled tasks cannot be changed.');
  if (task.caseRole) {
    if (
      nextStatus === 'In Progress' &&
      ['Assigned', 'Acknowledged'].includes(task.status) &&
      canActAsAssignee(req, task)
    ) return;
    throw new Error('Delegated case work must progress through its Key Action lifecycle in this workspace.');
  }
  if (!STATUS_FLOW[task.status as IndependentTaskStatus]?.includes(nextStatus) && !isAdminRole(req.user?.role)) {
    throw new Error('Invalid workflow transition.');
  }
  if (!isAdminRole(req.user?.role) && !canActAsAssignee(req, task) && cleanString(task.supervisor) !== cleanString(req.user?.name)) {
    throw new Error('Forbidden.');
  }
  if (nextStatus === 'Closed' && task.status !== 'Completed') {
    throw new Error('A task cannot be closed unless it has already been completed.');
  }
};

const notifyAssigned = async (task: any, req: AuthRequest) => {
  const assigneeUser = await findUserByAssigneeString(task.assignee);
  if (!assigneeUser?._id || assigneeUser.isActive === false) return;

  await notifyUsersById({
    userIds: [String(assigneeUser._id)],
    category: 'taskAssignments',
    notification: {
      type: 'TASK_ASSIGNED',
      title: 'Independent task assigned',
      message: `${task.taskNumber} • ${task.title}`,
      severity: 'info',
      taskId: String(task._id),
      link: `/matters/independent-tasks/${task._id}`,
    },
    email: {
      subject: `Task assigned: ${task.taskNumber}`,
      html: `<div style="font-family: Arial, sans-serif"><p>An independent task has been assigned to you.</p><p><b>${task.taskNumber}</b> - ${task.title}</p><p>Due: ${task.dueDate}</p></div>`,
    },
  });
  await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_ASSIGNED', 'Independent task assigned', task.title, String(task._id)));
};

const notifyReview = async (task: any, req: AuthRequest) => {
  const supervisor = await findUserByAssigneeString(task.supervisor);
  if (supervisor?._id && supervisor.isActive !== false) {
    await notifyUsersById({
      userIds: [String(supervisor._id)],
      category: 'approvals',
      notification: {
        type: 'TASK_APPROVAL_REQUESTED',
        title: 'Independent task awaiting review',
        message: `${task.taskNumber} • ${task.title}`,
        severity: 'warning',
        taskId: String(task._id),
        link: `/matters/independent-tasks/${task._id}`,
      },
      email: {
        subject: `Review needed: ${task.taskNumber}`,
        html: `<div style="font-family: Arial, sans-serif"><p>An independent task is awaiting review.</p><p><b>${task.taskNumber}</b> - ${task.title}</p></div>`,
      },
    });
  }
  await buildHistory(String(task._id), 'TASK_REVIEW_REQUESTED', 'Task awaiting review', req, task.title);
};

const notifyCompleted = async (task: any, req: AuthRequest) => {
  const assignee = await findUserByAssigneeString(task.assignee);
  const supervisor = await findUserByAssigneeString(task.supervisor);
  const userIds = [assignee?._id, supervisor?._id].filter(Boolean).map(String);
  if (userIds.length) {
    await notifyUsersById({
      userIds,
      category: 'approvals',
      notification: {
        type: 'TASK_APPROVAL_REQUESTED',
        title: 'Independent task completed',
        message: `${task.taskNumber} • ${task.title}`,
        severity: 'info',
        taskId: String(task._id),
        link: `/matters/independent-tasks/${task._id}`,
      },
    });
  }
  await buildHistory(String(task._id), 'TASK_COMPLETED', 'Task completed', req, task.title);
};

const applyWorkflowTransition = async (task: any, nextStatus: IndependentTaskStatus, req: AuthRequest) => {
  const current = task.status as IndependentTaskStatus;
  const now = new Date();
  task.status = nextStatus;
  task.lastActionBy = req.user?.name || 'System';
  if (req.user?.id) task.lastActionByUserId = new mongoose.Types.ObjectId(req.user.id);

  if (nextStatus === 'Completed') {
    task.completedAt = task.completedAt || now;
  }
  if (nextStatus === 'Closed') {
    task.closedAt = now;
  }

  if (nextStatus === 'Awaiting Review') {
    await notifyReview(task, req);
  }

  if (nextStatus === 'Completed') {
    await notifyCompleted(task, req);
  }

  await buildHistory(
    String(task._id),
    'TASK_STATUS_CHANGED',
    'Task status changed',
    req,
    `${current} → ${nextStatus}`,
    { from: current, to: nextStatus }
  );

  if (nextStatus === 'Closed') {
    await buildHistory(String(task._id), 'TASK_CLOSED', 'Task closed', req, task.title);
  }

  return task.save();
};

export const independentTaskService = {
  async getCaseKeyActions(caseId: string, req: AuthRequest) {
    if (!mongoose.Types.ObjectId.isValid(caseId)) throw new Error('Invalid matter id.');
    if (!canDelegateRole(req.user?.role)) throw new Error('You are not authorized to delegate case Key Actions.');
    const { caseDoc, inst, template } = await loadCaseTaskContext(caseId);
    if (['Closed', 'Temporarily Closed', 'Returned to Intake'].includes(cleanString(caseDoc.status))) {
      throw new Error('Delegated case work is unavailable for this matter status.');
    }
    return {
      caseId: String(caseDoc._id),
      caseNo: String(caseDoc.caseNo || ''),
      parties: String(caseDoc.parties || ''),
      assignments: {
        initiator: cleanString(caseDoc.caseAssignments?.initiator || caseDoc.assignedTo),
        reviewer: cleanString(caseDoc.caseAssignments?.reviewer),
        approver: cleanString(caseDoc.caseAssignments?.signerApprover),
      },
      // Return the live instance actions, including locked or reserved rows,
      // so the form can explain why a future action cannot be selected rather
      // than silently bypassing the established workflow sequence.
      keyActions: delegatedKeyActionOptions(inst, template).filter((step) => step.status !== 'Completed'),
    };
  },

  async createTask(payload: any, req: AuthRequest) {
    const title = requireString(payload.title, 'Title is required.');
    const assigneeInput = requireString(payload.assigneeUserId || payload.assignee, 'Assignee is required.');
    const supervisorInput = requireString(payload.supervisorUserId || payload.supervisor, 'Supervisor is required.');
    const assigneeUser = await findUserByAssigneeString(assigneeInput);
    if (!assigneeUser) throw new Error('Assignee account was not found or its name is ambiguous. Select the staff member again.');
    if (assigneeUser.isActive === false) throw new Error('The selected assignee account is inactive.');
    const assignee = assigneeUser.name;
    const supervisorUser = await findUserByAssigneeString(supervisorInput);
    if (!supervisorUser) throw new Error('Supervisor account was not found. Select the supervisor again.');
    if (supervisorUser.isActive === false) throw new Error('The selected supervisor account is inactive.');
    const supervisor = supervisorUser.name;
    // Supervisors may be any team member except interns — enforced server-side
    // so direct API calls cannot bypass the dropdown rule.
    if (supervisorUser && String((supervisorUser as any).role || '').toLowerCase() === 'intern') {
      throw new Error('Interns cannot supervise independent tasks.');
    }
    const dueDate = requireDateString(payload.dueDate, 'Due date is required.');
    const startDate = requireDateString(payload.startDate || todayISO(), 'Start date is required.');
    assertValidDates(startDate, dueDate);

    const relatedMatterId = cleanString(payload.relatedMatterId);
    let matterLabel = '';
    let relatedClient = cleanString(payload.relatedClient);

    if (relatedMatterId) {
      const matter = await Case.findById(relatedMatterId).select('caseNo parties assignedTo caseAssignments').lean();
      if (!matter) throw new Error('Selected matter was not found.');
      matterLabel = [matter.caseNo, matter.parties].filter(Boolean).join(' • ');
      if (!relatedClient) relatedClient = cleanString((matter as any).parties);
    }

    const requestedCaseRole = cleanString(payload.caseRole);
    const keyActionKeys = keyActionKeysFrom(payload.keyActionKeys);
    if (requestedCaseRole || keyActionKeys.length) {
      if (!canDelegateRole(req.user?.role)) {
        throw new Error('You are not authorized to create delegated case work.');
      }
      if (!relatedMatterId) throw new Error('Select a matter before delegating case work.');
      if (!isCaseTaskRole(requestedCaseRole)) {
        throw new Error('Select whether the task assignee is acting as Initiator, Reviewer or Signer/Approver.');
      }
      if (requestedCaseRole !== 'Initiator' && !canReviewRole(req.user?.role)) {
        throw new Error('You are not authorized to delegate reviewer or approver work.');
      }
      if (!keyActionKeys.length) throw new Error('Select at least one open Key Action for this case delegation.');
      if (requestedCaseRole !== 'Initiator' && !canReviewRole(assigneeUser.role)) {
        throw new Error('Select a staff member authorized to review or approve case work.');
      }
      const { caseDoc, inst, template } = await loadCaseTaskContext(relatedMatterId);
      if (['Closed', 'Temporarily Closed', 'Returned to Intake'].includes(cleanString(caseDoc.status))) {
        throw new Error('Delegated case work is unavailable for this matter status.');
      }
      const selectable = new Map(
        delegatedKeyActionOptions(inst, template)
          .filter((step) => step.status !== 'Completed')
          .map((step) => [step.key, step])
      );
      const invalid = keyActionKeys.find((key) => !selectable.has(key));
      if (invalid) throw new Error('One or more selected Key Actions are already completed or no longer available. Refresh the matter selection and try again.');
      const incompatible = keyActionKeys.find((key) => !selectable.get(key)?.eligibility?.[requestedCaseRole as IndependentTaskCaseRole]);
      if (incompatible) throw new Error('One or more selected Key Actions are not ready for the chosen lifecycle role.');
    }

    const taskNumber = cleanString(payload.taskNumber) || (await generateTaskNumber());
    const priority = (cleanString(payload.priority) || 'Medium') as IndependentTaskPriority;
    const description = cleanString(payload.description) || undefined;

    const session = await mongoose.startSession();
    try {
      let created: any;
      await session.withTransaction(async () => {
        const taskDoc: any = {
          taskNumber,
          title,
          relatedMatterId: relatedMatterId ? new mongoose.Types.ObjectId(relatedMatterId) : null,
          assignee,
          supervisor,
          assigneeUserId: assigneeUser._id,
          supervisorUserId: supervisorUser._id,
          priority,
          status: 'Assigned',
          startDate,
          dueDate,
          createdBy: req.user?.name,
          assignedBy: req.user?.name,
          lastActionBy: req.user?.name,
        };
        if (description) taskDoc.description = description;
        if (matterLabel) taskDoc.relatedMatterLabel = matterLabel;
        if (relatedClient) taskDoc.relatedClient = relatedClient;
        if (requestedCaseRole && keyActionKeys.length) {
          taskDoc.caseRole = requestedCaseRole;
          taskDoc.keyActionKeys = keyActionKeys;
          taskDoc.caseLifecycleStatus = 'Ready';
        }
        if (req.user?.id) {
          const userId = new mongoose.Types.ObjectId(req.user.id);
          taskDoc.createdByUserId = userId;
          taskDoc.assignedByUserId = userId;
          taskDoc.lastActionByUserId = userId;
        }

        created = await new IndependentTask(taskDoc).save({ session });
        if (requestedCaseRole && keyActionKeys.length) {
          const { inst } = await loadCaseTaskContext(relatedMatterId);
          await reserveDelegatedKeyActions({
            instanceId: inst._id,
            task: created,
            role: requestedCaseRole as IndependentTaskCaseRole,
            keyActionKeys,
            session,
          });
        }
        await IndependentTaskHistory.insertMany(
          [
            {
              taskId: created._id,
              action: 'TASK_CREATED',
              message: 'Task created',
              detail: title,
              actorName: req.user?.name || 'System',
              ...(req.user?.id ? { actorUserId: new mongoose.Types.ObjectId(req.user.id) } : {}),
            },
            {
              taskId: created._id,
              action: 'TASK_ASSIGNED',
              message: 'Task assigned',
              detail: assignee,
              actorName: req.user?.name || 'System',
              ...(req.user?.id ? { actorUserId: new mongoose.Types.ObjectId(req.user.id) } : {}),
            },
          ],
          { session, ordered: true }
        );
      });
      await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_CREATED', 'Independent task created', `${taskNumber} • ${title}`, String(created._id)));
      await notifyAssigned(created, req);
      return this.getTaskById(String(created._id), req);
    } finally {
      session.endSession();
    }
  },

  async getTaskById(taskId: string, req: AuthRequest) {
    const task = await assertTaskExists(taskId);
    await assertCanView(req, task);
    return hydrateTask(task, req);
  },

  async listTasks(query: IndependentTaskListQuery, req: AuthRequest) {
    const filter: any = {};
    if (!hasTaskDeleteRole(req.user?.role)) {
      const me = cleanString(req.user?.name);
      filter.$or = [
        { assignee: me },
        { supervisor: me },
        { createdBy: me },
        ...(req.user?.id ? ['createdByUserId', 'assigneeUserId', 'supervisorUserId'].map((field) => ({ [field]: new mongoose.Types.ObjectId(req.user!.id) })) : []),
        { assignedBy: me },
        { lastActionBy: me },
      ];
    }

    if (query.status && query.status !== 'all') filter.status = query.status;
    if (query.priority && query.priority !== 'all') filter.priority = query.priority;
    if (query.assignee) filter.assignee = new RegExp(cleanString(query.assignee), 'i');
    if (query.supervisor) filter.supervisor = new RegExp(cleanString(query.supervisor), 'i');
    if (query.matterId) filter.relatedMatterId = new mongoose.Types.ObjectId(query.matterId);
    if (query.q && cleanString(query.q)) {
      const regex = new RegExp(cleanString(query.q), 'i');
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { title: regex },
          { description: regex },
          { taskNumber: regex },
          { assignee: regex },
          { supervisor: regex },
          { createdBy: regex },
          { relatedClient: regex },
          { relatedMatterLabel: regex },
        ],
      });
    }

    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
    const sortBy = query.sortBy || 'dueDate';
    const sortDir = query.sortDir === 'desc' ? -1 : 1;

    const candidates = await IndependentTask.find(filter)
      .sort(sortBy === 'priority' ? { priority: sortDir, dueDate: 1 } : { [sortBy]: sortDir });

    const visibleCandidates = [];
    for (const item of candidates) {
      if (await isVisibleToUser(req, item)) visibleCandidates.push(item);
    }

    const total = visibleCandidates.length;
    const items = visibleCandidates.slice((page - 1) * limit, page * limit);
    const hydrated = [];
    for (const item of items) {
      hydrated.push(await hydrateTask(item, req));
    }

    return { items: hydrated, total, page, limit };
  },

  async getDashboard(req: AuthRequest) {
    const filter: any = {};
    if (!hasTaskDeleteRole(req.user?.role)) {
      const me = cleanString(req.user?.name);
      filter.$or = [
        { assignee: me },
        { supervisor: me },
        { createdBy: me },
        ...(req.user?.id ? ['createdByUserId', 'assigneeUserId', 'supervisorUserId'].map((field) => ({ [field]: new mongoose.Types.ObjectId(req.user!.id) })) : []),
        { assignedBy: me },
        { lastActionBy: me },
      ];
    }

    const tasks = await IndependentTask.find(filter).sort({ dueDate: 1, createdAt: -1 }).limit(1000);
    const visible: any[] = [];
    for (const task of tasks) {
      if (await isVisibleToUser(req, task)) visible.push(task);
    }

    const now = new Date();
    const today = todayISO();
    const upcoming = visible
      .filter((t) => !['Closed', 'Completed', 'Cancelled'].includes(t.status))
      .sort((a, b) => toDateMs(a.dueDate) - toDateMs(b.dueDate))
      .slice(0, 5);

    const recentActivities = await IndependentTaskHistory.find({
      taskId: { $in: visible.map((t) => t._id) },
    })
      .sort({ createdAt: -1 })
      .limit(8)
      .lean();

    const delegatedToMeRaw = visible.filter(
      (task) => canActAsAssignee(req, task) && Boolean(task.caseRole)
    );
    const hydratedDelegatedToMe = await Promise.all(delegatedToMeRaw.map((task) => hydrateTask(task, req)));
    const assignedToMeRaw = visible.filter((task) => canActAsAssignee(req, task)).slice(0, 5);
    const assignedToMe = await Promise.all(assignedToMeRaw.map((task) => hydrateTask(task, req)));
    const knownIndependentEarnedFees = hydratedDelegatedToMe
      .map((task: any) => task?.caseWork?.earnedFee)
      .filter((fee: unknown): fee is number => typeof fee === 'number' && Number.isFinite(fee));

    return {
      summary: {
        totalTasks: visible.length,
        openTasks: visible.filter((t) => !['Completed', 'Closed', 'Cancelled'].includes(t.status)).length,
        inProgress: visible.filter((t) => t.status === 'In Progress').length,
        awaitingReview: visible.filter((t) => t.status === 'Awaiting Review').length,
        awaitingExternalAction: visible.filter((t) => t.status === 'Awaiting External Action').length,
        completed: visible.filter((t) => t.status === 'Completed').length,
        closed: visible.filter((t) => t.status === 'Closed').length,
        overdueTasks: visible.filter((t) => !['Closed', 'Completed', 'Cancelled'].includes(t.status) && toDateMs(t.dueDate) < now.getTime()).length,
        criticalTasks: visible.filter((t) => t.priority === 'Critical').length,
      },
      priorityDistribution: ['Low', 'Medium', 'High', 'Critical'].map((priority) => ({
        priority,
        count: visible.filter((t) => t.priority === priority).length,
      })),
      recentActivities,
      upcomingDeadlines: upcoming.map((t) => ({
        ...(typeof t.toObject === 'function' ? t.toObject() : t),
        relatedMatter: t.relatedMatterId ? undefined : null,
      })),
      assignedToMe,
      tasksDueToday: visible.filter((t) => t.dueDate === today && !['Closed', 'Completed', 'Cancelled'].includes(t.status)),
      independentTaskEarnings: {
        earnedFee: knownIndependentEarnedFees.length
          ? Math.round(knownIndependentEarnedFees.reduce((sum, fee) => sum + fee, 0) * 100) / 100
          : null,
        taskCount: hydratedDelegatedToMe.length,
      },
    };
  },

  async updateTask(taskId: string, payload: any, req: AuthRequest) {
    const task = await assertTaskExists(taskId);
    await assertCanEdit(req, task);

    const updates: any = {};

    if (payload.title !== undefined) updates.title = requireString(payload.title, 'Title is required.');
    if (payload.description !== undefined) updates.description = cleanString(payload.description) || undefined;
    if (payload.priority !== undefined) updates.priority = requireString(payload.priority, 'Priority is required.') as IndependentTaskPriority;
    if (payload.assignee !== undefined || payload.assigneeUserId !== undefined) {
      const user = await findUserByAssigneeString(requireString(payload.assigneeUserId || payload.assignee, 'Assignee is required.'));
      if (!user) throw new Error('Assignee account was not found or its name is ambiguous. Select the staff member again.');
      if (user.isActive === false) throw new Error('The selected assignee account is inactive.');
      updates.assignee = user.name;
      updates.assigneeUserId = user._id;
    }
    if (task.caseRole && updates.assignee && !samePerson(updates.assignee, task.assignee)) {
      throw new Error('Cancel this delegation and create a new task to change its contributor. Recorded work remains attributed to its performer.');
    }
    if (payload.supervisor !== undefined || payload.supervisorUserId !== undefined) {
      const nextSupervisor = requireString(payload.supervisorUserId || payload.supervisor, 'Supervisor is required.');
      const supervisorUser = await findUserByAssigneeString(nextSupervisor);
      if (!supervisorUser) throw new Error('Supervisor account was not found. Select the supervisor again.');
      if (supervisorUser.isActive === false) throw new Error('The selected supervisor account is inactive.');
      if (supervisorUser && String((supervisorUser as any).role || '').toLowerCase() === 'intern') {
        throw new Error('Interns cannot supervise independent tasks.');
      }
      updates.supervisor = supervisorUser.name;
      updates.supervisorUserId = supervisorUser._id;
    }
    if (payload.relatedClient !== undefined) updates.relatedClient = cleanString(payload.relatedClient) || undefined;
    if (payload.relatedMatterId !== undefined) {
      const matterId = cleanString(payload.relatedMatterId);
      if (matterId) {
        const matter = await Case.findById(matterId).select('caseNo parties').lean();
        if (!matter) throw new Error('Selected matter was not found.');
        updates.relatedMatterId = new mongoose.Types.ObjectId(matterId);
        updates.relatedMatterLabel = [matter.caseNo, matter.parties].filter(Boolean).join(' • ');
        if (!updates.relatedClient) updates.relatedClient = cleanString((matter as any).parties) || undefined;
      } else {
        updates.relatedMatterId = null;
        updates.relatedMatterLabel = undefined;
      }
    }
    const delegationPayloadPresent = payload.caseRole !== undefined || payload.keyActionKeys !== undefined || payload.relatedMatterId !== undefined;
    const rawRequestedMatterId = payload.relatedMatterId !== undefined ? payload.relatedMatterId : task.relatedMatterId;
    const matterId = cleanString(rawRequestedMatterId) || (rawRequestedMatterId ? String(rawRequestedMatterId) : '');
    const requestedCaseRole = cleanString(payload.caseRole !== undefined ? payload.caseRole : task.caseRole);
    const keyActionKeys = keyActionKeysFrom(payload.keyActionKeys !== undefined ? payload.keyActionKeys : task.keyActionKeys);
    const existingMatterId = task.relatedMatterId ? String(task.relatedMatterId) : '';
    const existingCaseRole = cleanString(task.caseRole);
    const existingKeyActionKeys = keyActionKeysFrom(task.keyActionKeys);
    const sameKeyActions =
      keyActionKeys.length === existingKeyActionKeys.length &&
      keyActionKeys.every((key) => existingKeyActionKeys.includes(key));
    const changingDelegation = delegationPayloadPresent && (
      matterId !== existingMatterId ||
      requestedCaseRole !== existingCaseRole ||
      !sameKeyActions
    );
    if (changingDelegation && task.caseLifecycleCompletedAt) {
      throw new Error('Case delegation cannot be changed after lifecycle work has been recorded.');
    }
    if (changingDelegation && task.caseRole) {
      throw new Error('Delegated Key Actions are reserved when the task is created. Cancel this task and create a new delegation instead of changing its selected actions.');
    }
    if (changingDelegation) {
      if (requestedCaseRole || keyActionKeys.length) {
        if (!canDelegateRole(req.user?.role)) throw new Error('You are not authorized to create delegated case work.');
        if (!matterId || !isCaseTaskRole(requestedCaseRole) || !keyActionKeys.length) {
          throw new Error('A case delegation needs a linked matter, role and at least one open Key Action.');
        }
        if (requestedCaseRole !== 'Initiator' && !canReviewRole(req.user?.role)) {
          throw new Error('You are not authorized to delegate reviewer or approver work.');
        }
        const assigneeUser = await findUserByAssigneeString(updates.assignee || task.assignee);
        if (!assigneeUser || assigneeUser.isActive === false || !canDelegateRole(assigneeUser.role)) {
          throw new Error('Select an active staff member authorized to perform delegated case work.');
        }
        if (requestedCaseRole !== 'Initiator' && !canReviewRole(assigneeUser.role)) {
          throw new Error('Select a staff member authorized to review or approve case work.');
        }
        const { inst, template } = await loadCaseTaskContext(matterId);
        const selectable = new Map(
          delegatedKeyActionOptions(inst, template)
            .filter((step) => step.status !== 'Completed')
            .map((step) => [step.key, step])
        );
        if (keyActionKeys.some((key) => !selectable.has(key))) {
          throw new Error('One or more selected Key Actions are already completed or unavailable.');
        }
        if (keyActionKeys.some((key) => !selectable.get(key)?.eligibility?.[requestedCaseRole as IndependentTaskCaseRole])) {
          throw new Error('One or more selected Key Actions are not ready for the chosen lifecycle role.');
        }
        updates.caseRole = requestedCaseRole;
        updates.keyActionKeys = keyActionKeys;
        updates.caseLifecycleStatus = task.caseLifecycleStatus || 'Ready';
      } else {
        updates.caseRole = undefined;
        updates.keyActionKeys = [];
        updates.caseLifecycleStatus = undefined;
      }
    }
    if (payload.startDate !== undefined) updates.startDate = requireDateString(payload.startDate, 'Start date is required.');
    if (payload.dueDate !== undefined) updates.dueDate = requireDateString(payload.dueDate, 'Due date is required.');

    const nextStart = updates.startDate || task.startDate;
    const nextDue = updates.dueDate || task.dueDate;
    assertValidDates(nextStart, nextDue);

    const session = await mongoose.startSession();
    try {
      let hydrated;
      await session.withTransaction(async () => {
        const beforePriority = task.priority;
        const beforeDue = task.dueDate;
        const beforeAssignee = task.assignee;
        const beforeSupervisor = task.supervisor;
        const reassignedAt = new Date();
        const handovers: Array<{
          role: 'Assignee' | 'Supervisor';
          previousAssignee?: string;
          nextAssignee?: string;
          reassignedAt: Date;
          reassignedBy?: string;
        }> = [];
        if (updates.assignee && cleanString(updates.assignee) !== cleanString(beforeAssignee)) {
          handovers.push({
            role: 'Assignee',
            ...(cleanString(beforeAssignee) ? { previousAssignee: cleanString(beforeAssignee) } : {}),
            nextAssignee: cleanString(updates.assignee),
            reassignedAt,
            reassignedBy: req.user?.name || 'System',
          });
        }
        if (updates.supervisor && cleanString(updates.supervisor) !== cleanString(beforeSupervisor)) {
          handovers.push({
            role: 'Supervisor',
            ...(cleanString(beforeSupervisor) ? { previousAssignee: cleanString(beforeSupervisor) } : {}),
            nextAssignee: cleanString(updates.supervisor),
            reassignedAt,
            reassignedBy: req.user?.name || 'System',
          });
        }
        Object.assign(task, updates, {
          lastActionBy: req.user?.name || 'System',
          ...(req.user?.id ? { lastActionByUserId: new mongoose.Types.ObjectId(req.user.id) } : {}),
        });
        if (handovers.length) {
          task.assignmentHistory = [...(Array.isArray(task.assignmentHistory) ? task.assignmentHistory : []), ...handovers];
        }
        await task.save({ session });
        if (changingDelegation && updates.caseRole && keyActionKeys.length) {
          const { inst } = await loadCaseTaskContext(matterId);
          await reserveDelegatedKeyActions({
            instanceId: inst._id,
            task,
            role: updates.caseRole as IndependentTaskCaseRole,
            keyActionKeys,
            session,
          });
        }

        if (updates.priority && updates.priority !== beforePriority) {
          await buildHistory(String(task._id), 'TASK_PRIORITY_CHANGED', 'Priority changed', req, `${beforePriority} → ${updates.priority}`);
        }
        if (updates.dueDate && updates.dueDate !== beforeDue) {
          await buildHistory(String(task._id), 'TASK_DUE_DATE_CHANGED', 'Due date changed', req, `${beforeDue} → ${updates.dueDate}`);
        }
        if (updates.assignee && updates.assignee !== beforeAssignee) {
          await buildHistory(String(task._id), 'TASK_REASSIGNED', 'Assignee reassigned — progress preserved', req, `${beforeAssignee} → ${updates.assignee}`, {
            role: 'Assignee', previousAssignee: beforeAssignee, nextAssignee: updates.assignee,
          });
          await notifyAssigned(task, req);
        }
        if (updates.supervisor && updates.supervisor !== beforeSupervisor) {
          await buildHistory(String(task._id), 'TASK_REASSIGNED', 'Supervisor reassigned — progress preserved', req, `${beforeSupervisor} → ${updates.supervisor}`, {
            role: 'Supervisor', previousAssignee: beforeSupervisor, nextAssignee: updates.supervisor,
          });
        }
      });
      await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_UPDATED', 'Independent task updated', task.title, String(task._id)));
      hydrated = await this.getTaskById(String(task._id), req);
      return hydrated;
    } finally {
      session.endSession();
    }
  },

  async transitionTask(taskId: string, nextStatus: IndependentTaskStatus, req: AuthRequest) {
    const task = await assertTaskExists(taskId);
    await assertCanTransition(req, task, nextStatus);

    if (nextStatus === 'Completed' && task.status === 'Completed') {
      return this.getTaskById(taskId, req);
    }

    if (nextStatus === 'Closed' && task.status !== 'Completed') {
      throw new Error('A task cannot be closed unless it has already been completed.');
    }

    const session = await mongoose.startSession();
    try {
      const previousStatus = task.status as IndependentTaskStatus;
      await session.withTransaction(async () => {
        if (task.caseRole && nextStatus === 'In Progress') {
          if (!task.relatedMatterId) throw new Error('This delegation has no linked matter.');
          const instance: any = await WorkflowInstance.findOne({ caseId: task.relatedMatterId }).session(session);
          if (!instance) throw new Error('The matter workflow is no longer available.');
          for (const key of keyActionKeysFrom(task.keyActionKeys)) {
            const step = instance.steps.find((item: any) => item.stepKey === key);
            if (!step || (step.delegatedClaim?.taskId && String(step.delegatedClaim.taskId) !== String(task._id)) || !keyActionIsReadyForRole(task.caseRole, cleanString(step.status))) {
              throw new Error('A selected Key Action is no longer available for this delegated work.');
            }
            if (task.caseRole === 'Initiator') step.status = 'In Progress';
          }
          await instance.save({ session });
        }
        task.lastActionBy = req.user?.name || 'System';
        if (req.user?.id) task.lastActionByUserId = new mongoose.Types.ObjectId(req.user.id);
        if (nextStatus === 'Completed') {
          task.completedAt = task.completedAt || new Date();
        }
        if (nextStatus === 'Closed') {
          task.closedAt = new Date();
        }
        task.status = nextStatus;
        await task.save({ session });
      });
      await buildHistory(String(task._id), 'TASK_STATUS_CHANGED', 'Task status changed', req, `${previousStatus} → ${nextStatus}`);
      if (nextStatus === 'Completed') await buildHistory(String(task._id), 'TASK_COMPLETED', 'Task completed', req, task.title);
      if (nextStatus === 'Closed') await buildHistory(String(task._id), 'TASK_CLOSED', 'Task closed', req, task.title);
      if (nextStatus === 'Awaiting Review') await notifyReview(task, req);
      await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_STATUS_CHANGED', 'Independent task status changed', `${task.title} • ${nextStatus}`, String(task._id)));
      return this.getTaskById(taskId, req);
    } finally {
      session.endSession();
    }
  },

  async performCaseLifecycle(taskId: string, req: AuthRequest) {
    const task: any = await assertTaskExists(taskId);
    await assertCanView(req, task);
    if (!canActAsAssignee(req, task)) throw new Error('Only the assigned independent-task contributor can perform this case action.');
    if (task.status !== 'In Progress' && !(task.caseRole !== 'Initiator' && task.status === 'Awaiting Review' && task.caseLifecycleCompletedAt)) throw new Error('Start this independent task before submitting its case work.');
    if (!task.relatedMatterId || !isCaseTaskRole(task.caseRole) || !keyActionKeysFrom(task.keyActionKeys).length) {
      throw new Error('This independent task is not configured as a case-work delegation.');
    }

    const { caseDoc, inst } = await loadCaseTaskContext(String(task.relatedMatterId));
    const keys = keyActionKeysFrom(task.keyActionKeys);
    // Follow the matter's workflow order regardless of checkbox click order.
    const allSelected = normalizeEffectiveWorkflowSteps(inst, await WorkflowTemplate.findById(inst.templateId).lean())
      .filter((step: any) => keys.includes(cleanString(step.stepKey)))
      .map((step: any) => (inst.steps || []).find((item: any) => item.stepKey === step.stepKey));
    if (allSelected.length !== keys.length) throw new Error('A selected Key Action is no longer available.');
    if (allSelected.some((step: any) => !step)) throw new Error('A selected Key Action is no longer available.');
    const corrections = allSelected.filter((step: any) => task.caseRole === 'Initiator' && step?.correctionRequest && !step.correctionRequest.resolvedAt && String(step.correctionRequest.contributorTaskId || '') === String(task._id));
    const selected = corrections.length ? corrections : allSelected.filter((step: any) =>
      keyActionIsReadyForRole(task.caseRole, cleanString(step.status)) ||
      (task.caseRole === 'Initiator' && step.status === 'In Progress' && String(step.delegatedClaim?.taskId || '') === String(task._id))
    );
    if (!selected.length) throw new Error('No selected Key Actions are ready for this lifecycle stage. Refresh the workflow.');
    if (selected.some((step: any) => !step)) throw new Error('A selected Key Action is no longer available.');
    if (selected.some((step: any) => cleanString(step.status) === 'Completed')) {
      throw new Error('One or more selected Key Actions are already completed.');
    }

    const role = task.caseRole as IndependentTaskCaseRole;
    if (role !== 'Initiator' && !canReviewRole(req.user?.role)) {
      throw new Error('Your account is not authorized to review or approve case work.');
    }
    if (role !== 'Initiator' && selected.some((step: any) => {
      const initiator = [...(step.independentContributors || [])].reverse().find((entry: any) => entry.role === 'Initiator');
      return samePerson(initiator?.name || caseDoc.caseAssignments?.initiator || caseDoc.assignedTo, req.user?.name);
    })) throw new Error('You cannot review or approve your own work.');
    if (selected.some((step: any) => {
      const claimTaskId = cleanString(step?.delegatedClaim?.taskId);
      return claimTaskId && claimTaskId !== String(task._id);
    })) {
      throw new Error('One or more Key Actions are reserved by another active delegated task.');
    }
    if (selected.some((step: any) => !keyActionIsReadyForRole(role, cleanString(step?.status)) && !(role === 'Initiator' && step.status === 'In Progress' && String(step.delegatedClaim?.taskId || '') === String(task._id)))) {
      throw new Error('One or more Key Actions are no longer at the required case-work lifecycle step. Refresh and try again.');
    }
    const now = new Date();
    const actionActor = {
      actorName: req.user?.name || task.assignee || 'System',
      ...(req.user?.id ? { actorUserId: req.user.id } : {}),
      ...(req.user?.email ? { actorEmail: req.user.email } : {}),
      ...(req.user?.role ? { actorRole: req.user.role } : {}),
    };
    const lifecycleLabel = role === 'Initiator'
      ? 'Submitted to Reviewer'
      : role === 'Reviewer'
        ? 'Submitted to Approver'
        : 'Approved';

    for (const selectedStep of selected as any[]) {
      const currentStatus = cleanString(selectedStep.status);
      if (role === 'Initiator') {
        if (!['Not Started', 'In Progress', 'Done'].includes(currentStatus)) {
          throw new Error(`"${selectedStep.title}" must be ready for initiator work before it can be submitted for review.`);
        }
        if (currentStatus !== 'Done') {
          await completeStepForCase(actionActor, caseDoc, inst, selectedStep.stepKey);
        }
        const step = (inst.steps || []).find((item: any) => item.stepKey === selectedStep.stepKey);
        step.status = 'Awaiting Review';
        step.submittedAt = now;
        if (step.correctionRequest && !step.correctionRequest.resolvedAt) {
          step.correctionRequest.resolvedAt = now;
          step.reviewHistory.push({ action: 'Resubmitted', actorName: req.user?.name || task.assignee, at: now });
        }
      } else if (role === 'Reviewer') {
        if (currentStatus !== 'Awaiting Review') {
          throw new Error(`"${selectedStep.title}" must be awaiting review before it can be submitted to the approver.`);
        }
        selectedStep.status = 'Awaiting Approval';
        selectedStep.reviewedAt = now;
      } else {
        if (currentStatus !== 'Awaiting Approval') {
          throw new Error(`"${selectedStep.title}" must be awaiting approval before it can be completed.`);
        }
        await completeStepForCase(actionActor, caseDoc, inst, selectedStep.stepKey, { finalApproval: true });
      }

      const step = (inst.steps || []).find((item: any) => item.stepKey === selectedStep.stepKey);
      const contributions = Array.isArray(step.independentContributors) ? step.independentContributors : [];
      const exists = contributions.some(
        (entry: any) => String(entry?.taskId || '') === String(task._id) && entry?.role === role && samePerson(entry?.name, task.assignee)
      );
      if (!exists) {
        contributions.push({
          taskId: task._id,
          role,
          name: task.assignee,
          ...(req.user?.id ? { userId: new mongoose.Types.ObjectId(req.user.id) } : {}),
          actedAt: now,
        });
      } else {
        // Revisions replace the earning timestamp for this contribution;
        // the immutable return/resubmission history remains on the Key Action.
        const previous = contributions.find((entry: any) => String(entry.taskId) === String(task._id) && entry.role === role && samePerson(entry.name, task.assignee));
        previous.actedAt = now;
      }
      step.independentContributors = contributions;
      // The exclusive reservation exists only while this task is actively
      // carrying out the current lifecycle stage. Once handed off, the next
      // eligible delegated reviewer/approver may reserve the action.
      if (String(step?.delegatedClaim?.taskId || '') === String(task._id)) {
        step.delegatedClaim = undefined;
      }
    }

    await inst.save();
    // A handoff is not final completion: the same Key Actions still need
    // their normal review and approval before the task can display Completed.
    const allApproved = allSelected.every((step: any) => step.status === 'Completed');
    task.status = allApproved ? 'Completed' : 'Awaiting Review';
    if (allApproved) task.completedAt = task.completedAt || now;
    task.caseLifecycleStatus = lifecycleLabel;
    task.caseLifecycleCompletedAt = now;
    task.lastActionBy = req.user?.name || task.assignee || 'System';
    if (req.user?.id) task.lastActionByUserId = new mongoose.Types.ObjectId(req.user.id);
    await task.save();

    const actionTitles = selected.map((step: any) => step.title || step.stepKey).join(', ');
    await buildHistory(String(task._id), 'TASK_CASE_LIFECYCLE_UPDATED', lifecycleLabel, req, actionTitles, { role, keyActionKeys: keys });
    if (allApproved) {
      await buildHistory(String(task._id), 'TASK_COMPLETED', 'Task completed through case lifecycle', req, lifecycleLabel);
    }
    await writeAudit({
      caseId: String(caseDoc._id),
      independentTaskId: String(task._id),
      actorName: req.user?.name || task.assignee || 'System',
      ...(req.user?.id ? { actorUserId: req.user.id } : {}),
      action: 'INDEPENDENT_TASK_CASE_LIFECYCLE_UPDATED',
      message: `${role} completed delegated case work`,
      detail: `${task.taskNumber} â€¢ ${lifecycleLabel} â€¢ ${actionTitles}`,
    });
    return this.getTaskById(String(task._id), req);
  },

  async returnCaseWork(taskId: string, payload: any, req: AuthRequest) {
    const task = await assertTaskExists(taskId);
    await assertCanView(req, task);
    if (!task.relatedMatterId || !task.caseRole) throw new Error('This task is not delegated case work.');
    await returnCaseWorkForCorrections({
      caseId: String(task.relatedMatterId), stepKey: cleanString(payload.stepKey),
      reason: cleanString(payload.reason), req, delegatedTaskId: taskId,
    });
    return this.getTaskById(taskId, req);
  },

  async deleteTask(taskId: string, req: AuthRequest) {
    const task = await assertTaskExists(taskId);
    await assertCanDelete(req, task);
    const hasRecordedContribution = Boolean(await WorkflowInstance.exists({
      'steps.independentContributors.taskId': task._id,
    }));
    const delegatedWorkHasLegalRecord = Boolean(
      hasRecordedContribution || (task.caseRole && (
        task.caseLifecycleCompletedAt ||
        (task.caseLifecycleStatus && task.caseLifecycleStatus !== 'Ready') ||
        ['Completed', 'Closed'].includes(task.status)
      ))
    );
    if (task.status === 'Cancelled' && delegatedWorkHasLegalRecord) {
      return { message: 'This task contains submitted case work. Its cancellation preserves the matter approvals, audit and financial attribution.', cancelled: true };
    }
    const delegatedWorkHasStarted = Boolean(task.caseRole && task.status === 'In Progress');

    // A submitted/reviewed/approved delegation is part of the matter's legal
    // and financial record. Deletion becomes a controlled cancellation: the
    // task, contributor attribution, documents and audit trail stay intact.
    if (delegatedWorkHasLegalRecord || delegatedWorkHasStarted) {
      {
        task.status = 'Cancelled';
        task.cancelledAt = new Date();
        task.cancelledBy = req.user?.name || 'System';
        task.lastActionBy = req.user?.name || 'System';
        if (req.user?.id) task.lastActionByUserId = new mongoose.Types.ObjectId(req.user.id);
        await task.save();
        // Cancellation ends active reservations, including returned work.
        // Contributor events and legal/financial evidence are separate records.
        await releaseDelegatedClaims(task._id);
        await buildHistory(String(task._id), 'TASK_CANCELLED', 'Delegated task cancelled — matter record preserved', req);
        await writeAudit(buildAudit(
          req,
          'INDEPENDENT_TASK_UPDATED',
          'Independent task cancelled — legal and financial history preserved',
          task.title,
          String(task._id)
        ));
      }
      return {
        message: 'Delegated work was cancelled. Its matter documents, approvals, audit trail and financial attribution were preserved.',
        cancelled: true,
      };
    }

    // An untouched task can be removed completely. Any Key Action reservation
    // is released first so another authorized contributor may claim it.
    const [attachments, history] = await Promise.all([
      IndependentTaskAttachment.find({ taskId: task._id }).lean(),
      IndependentTaskHistory.find({ taskId: task._id }).lean(),
    ]);
    // A caseDocumentId means the upload is already a shared matter document.
    // Keep that legal record and its storage object even if its task-only link
    // is removed. Only private task uploads are physically removed.
    const privateStoredFileUrls = Array.from(new Set(
      attachments
        .filter((attachment: any) => !attachment.caseDocumentId)
        .map((attachment: any) => cleanString(attachment.url))
        .filter(Boolean)
    ));

    const auditActions = [
      'INDEPENDENT_TASK_CREATED',
      'INDEPENDENT_TASK_UPDATED',
      'INDEPENDENT_TASK_STATUS_CHANGED',
      'INDEPENDENT_TASK_ASSIGNED',
      'INDEPENDENT_TASK_COMMENTED',
      'INDEPENDENT_TASK_ATTACHMENT_UPLOADED',
      'INDEPENDENT_TASK_ATTACHMENT_DELETED',
      'INDEPENDENT_TASK_CASE_LIFECYCLE_UPDATED',
    ];
    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Never match legacy audits by shared titles, comments or filenames.
    const legacyReference = new RegExp('\\b' + escapeRegExp(task.taskNumber) + '\\b', 'i');
    const cleanupSession = await mongoose.startSession();
    try {
      await cleanupSession.withTransaction(async () => {
        await releaseDelegatedClaims(task._id, cleanupSession);
        await IndependentTaskComment.deleteMany({ taskId: task._id }, { session: cleanupSession });
        await IndependentTaskAttachment.deleteMany({ taskId: task._id }, { session: cleanupSession });
        await IndependentTaskHistory.deleteMany({ taskId: task._id }, { session: cleanupSession });
        await Notification.deleteMany({ taskId: task._id }, { session: cleanupSession });
        await AuditLog.deleteMany({ $or: [
          { independentTaskId: task._id },
          { independentTaskId: { $exists: false }, action: { $in: auditActions }, detail: legacyReference },
        ] }, { session: cleanupSession });
        await IndependentTask.findByIdAndDelete(task._id, { session: cleanupSession });
      });
    } finally { await cleanupSession.endSession(); }

    // GridFS files are separate from document rows. Remove private task files
    // last; shared matter files remain available from the Case Workspace.
    await Promise.all(privateStoredFileUrls.map((url) => deleteStoredFile(url)));

    return {
      message: 'Task and all related records deleted.',
      removed: {
        attachments: attachments.length,
        history: history.length,
        releasedKeyActionReservations: task.keyActionKeys?.length || 0,
      },
    };
  },

  async listHistory(taskId: string, req: AuthRequest) {
    const task = await assertTaskExists(taskId);
    await assertCanView(req, task);
    return IndependentTaskHistory.find({ taskId }).sort({ createdAt: -1 }).lean();
  },

  async listComments(taskId: string, req: AuthRequest) {
    const task = await assertTaskExists(taskId);
    await assertCanView(req, task);
    return IndependentTaskComment.find({ taskId }).sort({ createdAt: 1 }).lean();
  },

  async addComment(taskId: string, payload: any, req: AuthRequest) {
    const task = await assertTaskExists(taskId);
    await assertCanView(req, task);
    if (['Closed', 'Cancelled'].includes(task.status)) throw new Error('Closed or cancelled tasks cannot be edited.');

    const body = requireString(payload.body, 'Comment is required.');
    const parentCommentId = cleanString(payload.parentCommentId);
    const session = await mongoose.startSession();
    try {
      let comment;
      await session.withTransaction(async () => {
        comment = await IndependentTaskComment.create(
          [
            {
              taskId: task._id,
              parentCommentId: parentCommentId ? new mongoose.Types.ObjectId(parentCommentId) : null,
              authorName: req.user?.name || 'System',
              ...(req.user?.id ? { authorUserId: new mongoose.Types.ObjectId(req.user.id) } : {}),
              body,
            },
          ],
          { session }
        );
        await buildHistory(String(task._id), 'TASK_COMMENTED', 'Comment added', req, body.slice(0, 120));
      });
      await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_COMMENTED', 'Independent task commented', body.slice(0, 120), String(task._id)));
      return comment?.[0];
    } finally {
      session.endSession();
    }
  },

  async listAttachments(taskId: string, req: AuthRequest) {
    const task = await assertTaskExists(taskId);
    await assertCanView(req, task);
    return IndependentTaskAttachment.find({ taskId }).sort({ createdAt: -1 }).lean();
  },

  async addAttachment(taskId: string, file: Express.Multer.File | undefined, payload: any, req: AuthRequest) {
    const task = await assertTaskExists(taskId);
    await assertCanView(req, task);
    if (['Closed', 'Cancelled'].includes(task.status)) throw new Error('Closed or cancelled tasks cannot be edited.');
    if (!file) throw new Error('No file uploaded.');
    const url = await storeUploadedFile(file);

    const attachmentDoc: any = {
      taskId: task._id,
      fileName: cleanString(payload.fileName) || file.originalname,
      originalName: file.originalname,
      fileSize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
      uploadedBy: req.user?.name || 'System',
      uploadedDate: todayISO(),
      url,
    };
    const note = cleanString(payload.note);
    if (note) attachmentDoc.note = note;
    if (req.user?.id) attachmentDoc.uploadedByUserId = new mongoose.Types.ObjectId(req.user.id);

    // A file uploaded while performing delegated case work is one shared file,
    // not a private copy: the attachment keeps the independent-task context
    // while the linked Document makes it immediately visible in the matter's
    // Documents tab and Case Management tab.
    if (task.relatedMatterId && task.caseRole) {
      const caseDocument = await Document.create({
        caseId: task.relatedMatterId,
        name: attachmentDoc.fileName,
        category: 'Independent Task',
        ...(keyActionKeysFrom(task.keyActionKeys).length === 1 ? { stepKey: keyActionKeysFrom(task.keyActionKeys)[0] } : {}),
        uploadedBy: attachmentDoc.uploadedBy,
        uploadedDate: attachmentDoc.uploadedDate,
        size: attachmentDoc.fileSize,
        url,
      });
      attachmentDoc.caseDocumentId = caseDocument._id;
    }

    const attachment = await IndependentTaskAttachment.create(attachmentDoc);

    await buildHistory(String(task._id), 'TASK_ATTACHMENT_UPLOADED', 'Attachment uploaded', req, attachment.fileName);
    await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_ATTACHMENT_UPLOADED', 'Independent task attachment uploaded', attachment.fileName, String(task._id)));
    return attachment;
  },

  async deleteAttachment(attachmentId: string, req: AuthRequest) {
    const attachment = await IndependentTaskAttachment.findById(attachmentId);
    if (!attachment) throw new Error('Attachment not found.');
    const task = await assertTaskExists(String(attachment.taskId));
    await assertCanEdit(req, task);

    await IndependentTaskAttachment.findByIdAndDelete(attachmentId);
    // A mirrored matter document is a shared legal record. Removing the task
    // attachment must not remove it from the matter or delete its file.
    if (!(attachment as any).caseDocumentId) await deleteStoredFile(attachment.url);

    await buildHistory(String(task._id), 'TASK_ATTACHMENT_DELETED', 'Attachment deleted', req, attachment.fileName);
    await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_ATTACHMENT_DELETED', 'Independent task attachment deleted', attachment.fileName, String(task._id)));
    return { message: 'Attachment deleted.' };
  },
};

export const independentTaskWorkflow = {
  STATUS_ORDER,
  STATUS_FLOW,
  isAdminRole,
  canManageRole,
  canReviewRole,
};
