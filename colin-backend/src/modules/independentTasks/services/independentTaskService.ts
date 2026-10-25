import mongoose from 'mongoose';
import Case from '../../../models/caseModel';
import Document from '../../../models/documentModel';
import Invoice from '../../../models/invoiceModel';
import Task from '../../../models/taskModel';
import User from '../../../models/userModel';
import WorkflowInstance from '../../../models/workflowInstanceModel';
import WorkflowTemplate from '../../../models/workflowTemplateModel';
import { AuthRequest } from '../../../middleware/authMiddleware';
import { writeAudit } from '../../../services/auditService';
import { findUserByAssigneeString, notifyRoles, notifyUsersById } from '../../../services/notifyService';
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
import { storeUploadedFile } from '../../../services/fileStorageService';
import { completeStepForCase } from '../../../controllers/workflowController';
import { computeCaseEarnedFees, computeStepTimelinessAt, normalizeEffectiveWorkflowSteps } from '../../../utils/caseEarnedFees';
import { allocateCollectedValueAcrossKeyActions, calculateCollectedKeyActionEarnings } from '../../../utils/keyActionEarnings';
import { buildRoleByName, computeEarnedFee } from '../../../utils/workflowPercentages';

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
};

const CASE_TASK_ROLES: IndependentTaskCaseRole[] = ['Initiator', 'Reviewer', 'Signer/Approver'];

const samePerson = (left: unknown, right: unknown) =>
  cleanString(left).toLocaleLowerCase() === cleanString(right).toLocaleLowerCase();

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
  if (role === 'Initiator') return ['Not Started', 'In Progress', 'Done'].includes(status);
  if (role === 'Reviewer') return status === 'Awaiting Review';
  return status === 'Awaiting Approval';
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
      lifecycleStatus: task.caseLifecycleStatus || 'Ready',
      selectedKeyActions: selectedSteps.map((step: any) => ({
        key: cleanString(step?.stepKey),
        title: cleanString(step?.title) || cleanString(step?.stepKey),
        stageTitle: cleanString(step?.stageTitle) || cleanString(step?.stageKey),
        status: cleanString(step?.status) || 'Not Started',
        dueAt: step?.dueAt || null,
        completed: cleanString(step?.status) === 'Completed',
        contributedByTask: contributedSteps.includes(step),
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

const buildAudit = (req: AuthRequest, action: any, message: string, detail?: string) => ({
  caseId: '000000000000000000000000',
  actorName: req.user?.name || 'System',
  ...(req.user?.id ? { actorUserId: req.user.id } : {}),
  action,
  message,
  ...(detail ? { detail } : {}),
});

const isVisibleToUser = async (req: AuthRequest, task: any) => {
  if (isAdminRole(req.user?.role)) return true;
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
  if (task.status === 'Closed') return false;
  if (isAdminRole(req.user?.role)) return true;
  const me = cleanString(req.user?.name);
  if (!me) return false;
  return cleanString(task.createdBy) === me || cleanString(task.supervisor) === me;
};

const canActAsAssignee = (req: AuthRequest, task: any) => {
  if (!req.user?.name) return false;
  return cleanString(task.assignee) === cleanString(req.user.name);
};

const hydrateTask = async (task: any) => {
  const matter = task.relatedMatterId
    ? await Case.findById(task.relatedMatterId).select('caseNo parties status assignedTo caseAssignments').lean()
    : null;
  const taskObj = typeof task.toObject === 'function' ? task.toObject() : task;
  const caseWork = await buildCaseTaskMetrics(taskObj, matter);
  return {
    ...taskObj,
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
  if (!isAdminRole(req.user?.role)) throw new Error('Forbidden.');
  if (task.status === 'Closed') throw new Error('Closed tasks cannot be deleted.');
};

const assertCanTransition = async (req: AuthRequest, task: any, nextStatus: IndependentTaskStatus) => {
  if (task.status === 'Closed') throw new Error('Closed tasks cannot be changed.');
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
  await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_ASSIGNED', 'Independent task assigned', task.title));
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
  async getCaseKeyActions(caseId: string) {
    if (!mongoose.Types.ObjectId.isValid(caseId)) throw new Error('Invalid matter id.');
    const { caseDoc, inst, template } = await loadCaseTaskContext(caseId);
    return {
      caseId: String(caseDoc._id),
      caseNo: String(caseDoc.caseNo || ''),
      parties: String(caseDoc.parties || ''),
      assignments: {
        initiator: cleanString(caseDoc.caseAssignments?.initiator || caseDoc.assignedTo),
        reviewer: cleanString(caseDoc.caseAssignments?.reviewer),
        approver: cleanString(caseDoc.caseAssignments?.signerApprover),
      },
      // An action remains selectable until final approval. This enables a
      // reviewer/approver delegation to be created after the initiator has
      // already submitted the work, while finalised Key Actions never appear.
      keyActions: publicKeyActions(inst, template).filter((step) => step.status !== 'Completed'),
    };
  },

  async createTask(payload: any, req: AuthRequest) {
    const title = requireString(payload.title, 'Title is required.');
    const assignee = requireString(payload.assignee, 'Assignee is required.');
    const supervisor = requireString(payload.supervisor, 'Supervisor is required.');
    // Supervisors may be any team member except interns — enforced server-side
    // so direct API calls cannot bypass the dropdown rule.
    const supervisorUser = await findUserByAssigneeString(supervisor);
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
      if (!relatedMatterId) throw new Error('Select a matter before delegating case work.');
      if (!isCaseTaskRole(requestedCaseRole)) {
        throw new Error('Select whether the task assignee is acting as Initiator, Reviewer or Signer/Approver.');
      }
      if (!keyActionKeys.length) throw new Error('Select at least one open Key Action for this case delegation.');
      const { inst, template } = await loadCaseTaskContext(relatedMatterId);
      const selectable = new Map(
        publicKeyActions(inst, template)
          .filter((step) => step.status !== 'Completed')
          .map((step) => [step.key, step])
      );
      const invalid = keyActionKeys.find((key) => !selectable.has(key));
      if (invalid) throw new Error('One or more selected Key Actions are already completed or no longer available. Refresh the matter selection and try again.');
      const incompatible = keyActionKeys.find((key) => !keyActionIsReadyForRole(requestedCaseRole as IndependentTaskCaseRole, selectable.get(key)?.status || ''));
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
      await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_CREATED', 'Independent task created', `${taskNumber} • ${title}`));
      await notifyAssigned(created, req);
      return this.getTaskById(String(created._id), req);
    } finally {
      session.endSession();
    }
  },

  async getTaskById(taskId: string, req: AuthRequest) {
    const task = await assertTaskExists(taskId);
    await assertCanView(req, task);
    return hydrateTask(task);
  },

  async listTasks(query: IndependentTaskListQuery, req: AuthRequest) {
    const filter: any = {};
    if (!isAdminRole(req.user?.role)) {
      const me = cleanString(req.user?.name);
      filter.$or = [
        { assignee: me },
        { supervisor: me },
        { createdBy: me },
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
      hydrated.push(await hydrateTask(item));
    }

    return { items: hydrated, total, page, limit };
  },

  async getDashboard(req: AuthRequest) {
    const filter: any = {};
    if (!isAdminRole(req.user?.role)) {
      const me = cleanString(req.user?.name);
      filter.$or = [
        { assignee: me },
        { supervisor: me },
        { createdBy: me },
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
      .filter((t) => t.status !== 'Closed' && t.status !== 'Completed')
      .sort((a, b) => toDateMs(a.dueDate) - toDateMs(b.dueDate))
      .slice(0, 5);

    const recentActivities = await IndependentTaskHistory.find({
      taskId: { $in: visible.map((t) => t._id) },
    })
      .sort({ createdAt: -1 })
      .limit(8)
      .lean();

    const delegatedToMeRaw = visible.filter(
      (task) => cleanString(task.assignee) === cleanString(req.user?.name) && Boolean(task.caseRole)
    );
    const hydratedDelegatedToMe = await Promise.all(delegatedToMeRaw.map((task) => hydrateTask(task)));
    const assignedToMeRaw = visible.filter((task) => cleanString(task.assignee) === cleanString(req.user?.name)).slice(0, 5);
    const assignedToMe = await Promise.all(assignedToMeRaw.map((task) => hydrateTask(task)));
    const knownIndependentEarnedFees = hydratedDelegatedToMe
      .map((task: any) => task?.caseWork?.earnedFee)
      .filter((fee: unknown): fee is number => typeof fee === 'number' && Number.isFinite(fee));

    return {
      summary: {
        totalTasks: visible.length,
        openTasks: visible.filter((t) => !['Completed', 'Closed'].includes(t.status)).length,
        inProgress: visible.filter((t) => t.status === 'In Progress').length,
        awaitingReview: visible.filter((t) => t.status === 'Awaiting Review').length,
        awaitingExternalAction: visible.filter((t) => t.status === 'Awaiting External Action').length,
        completed: visible.filter((t) => t.status === 'Completed').length,
        closed: visible.filter((t) => t.status === 'Closed').length,
        overdueTasks: visible.filter((t) => t.status !== 'Closed' && t.status !== 'Completed' && toDateMs(t.dueDate) < now.getTime()).length,
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
      tasksDueToday: visible.filter((t) => t.dueDate === today && !['Closed', 'Completed'].includes(t.status)),
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
    if (payload.assignee !== undefined) updates.assignee = requireString(payload.assignee, 'Assignee is required.');
    if (payload.supervisor !== undefined) {
      const nextSupervisor = requireString(payload.supervisor, 'Supervisor is required.');
      const supervisorUser = await findUserByAssigneeString(nextSupervisor);
      if (supervisorUser && String((supervisorUser as any).role || '').toLowerCase() === 'intern') {
        throw new Error('Interns cannot supervise independent tasks.');
      }
      updates.supervisor = nextSupervisor;
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
    if (changingDelegation) {
      if (requestedCaseRole || keyActionKeys.length) {
        if (!matterId || !isCaseTaskRole(requestedCaseRole) || !keyActionKeys.length) {
          throw new Error('A case delegation needs a linked matter, role and at least one open Key Action.');
        }
        const { inst, template } = await loadCaseTaskContext(matterId);
        const selectable = new Map(
          publicKeyActions(inst, template)
            .filter((step) => step.status !== 'Completed')
            .map((step) => [step.key, step])
        );
        if (keyActionKeys.some((key) => !selectable.has(key))) {
          throw new Error('One or more selected Key Actions are already completed or unavailable.');
        }
        if (keyActionKeys.some((key) => !keyActionIsReadyForRole(requestedCaseRole as IndependentTaskCaseRole, selectable.get(key)?.status || ''))) {
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
      await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_UPDATED', 'Independent task updated', task.title));
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
      await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_STATUS_CHANGED', 'Independent task status changed', `${task.title} • ${nextStatus}`));
      return this.getTaskById(taskId, req);
    } finally {
      session.endSession();
    }
  },

  async performCaseLifecycle(taskId: string, req: AuthRequest) {
    const task: any = await assertTaskExists(taskId);
    await assertCanView(req, task);
    if (!canActAsAssignee(req, task)) throw new Error('Only the assigned independent-task contributor can perform this case action.');
    if (task.status !== 'In Progress') throw new Error('Acknowledge and start this independent task before submitting its case work.');
    if (!task.relatedMatterId || !isCaseTaskRole(task.caseRole) || !keyActionKeysFrom(task.keyActionKeys).length) {
      throw new Error('This independent task is not configured as a case-work delegation.');
    }

    const { caseDoc, inst } = await loadCaseTaskContext(String(task.relatedMatterId));
    const keys = keyActionKeysFrom(task.keyActionKeys);
    const selected = keys.map((key) => (inst.steps || []).find((step: any) => cleanString(step?.stepKey) === key));
    if (selected.some((step: any) => !step)) throw new Error('A selected Key Action is no longer available.');
    if (selected.some((step: any) => cleanString(step.status) === 'Completed')) {
      throw new Error('One or more selected Key Actions are already completed.');
    }

    const role = task.caseRole as IndependentTaskCaseRole;
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
      }
      step.independentContributors = contributions;
    }

    await inst.save();
    task.status = 'Completed';
    task.completedAt = task.completedAt || now;
    task.caseLifecycleStatus = lifecycleLabel;
    task.caseLifecycleCompletedAt = now;
    task.lastActionBy = req.user?.name || task.assignee || 'System';
    if (req.user?.id) task.lastActionByUserId = new mongoose.Types.ObjectId(req.user.id);
    await task.save();

    const actionTitles = selected.map((step: any) => step.title || step.stepKey).join(', ');
    await buildHistory(String(task._id), 'TASK_CASE_LIFECYCLE_UPDATED', lifecycleLabel, req, actionTitles, { role, keyActionKeys: keys });
    await buildHistory(String(task._id), 'TASK_COMPLETED', 'Task completed through case lifecycle', req, lifecycleLabel);
    await writeAudit({
      caseId: String(caseDoc._id),
      actorName: req.user?.name || task.assignee || 'System',
      ...(req.user?.id ? { actorUserId: req.user.id } : {}),
      action: 'INDEPENDENT_TASK_CASE_LIFECYCLE_UPDATED',
      message: `${role} completed delegated case work`,
      detail: `${task.taskNumber} â€¢ ${lifecycleLabel} â€¢ ${actionTitles}`,
    });
    return this.getTaskById(String(task._id), req);
  },

  async deleteTask(taskId: string, req: AuthRequest) {
    const task = await assertTaskExists(taskId);
    await assertCanDelete(req, task);
    await IndependentTaskComment.deleteMany({ taskId: task._id });
    await IndependentTaskAttachment.deleteMany({ taskId: task._id });
    await IndependentTaskHistory.deleteMany({ taskId: task._id });
    await IndependentTask.findByIdAndDelete(taskId);
    await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_DELETED', 'Independent task deleted', task.title));
    return { message: 'Task deleted.' };
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
    if (task.status === 'Closed') throw new Error('Closed tasks cannot be edited.');

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
      await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_COMMENTED', 'Independent task commented', body.slice(0, 120)));
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
    if (task.status === 'Closed') throw new Error('Closed tasks cannot be edited.');
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
    if (task.relatedMatterId) {
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
    await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_ATTACHMENT_UPLOADED', 'Independent task attachment uploaded', attachment.fileName));
    return attachment;
  },

  async deleteAttachment(attachmentId: string, req: AuthRequest) {
    const attachment = await IndependentTaskAttachment.findById(attachmentId);
    if (!attachment) throw new Error('Attachment not found.');
    const task = await assertTaskExists(String(attachment.taskId));
    await assertCanEdit(req, task);

    await IndependentTaskAttachment.findByIdAndDelete(attachmentId);
    if ((attachment as any).caseDocumentId) {
      await Document.findByIdAndDelete((attachment as any).caseDocumentId);
    }

    await buildHistory(String(task._id), 'TASK_ATTACHMENT_DELETED', 'Attachment deleted', req, attachment.fileName);
    await writeAudit(buildAudit(req, 'INDEPENDENT_TASK_ATTACHMENT_DELETED', 'Independent task attachment deleted', attachment.fileName));
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
