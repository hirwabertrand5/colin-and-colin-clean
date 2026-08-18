import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import Case from '../../../models/caseModel';
import { AuthRequest } from '../../../middleware/authMiddleware';
import { writeAudit } from '../../../services/auditService';
import { findUserByAssigneeString, notifyRoles, notifyUsersById } from '../../../services/notifyService';
import { buildYearlySequence } from '../../../utils/counter';
import IndependentTask, {
  IndependentTaskPriority,
  IndependentTaskStatus,
} from '../models/independentTaskModel';
import IndependentTaskAttachment from '../models/independentTaskAttachmentModel';
import IndependentTaskComment from '../models/independentTaskCommentModel';
import IndependentTaskHistory, {
  IndependentTaskHistoryAction,
} from '../models/independentTaskHistoryModel';
import { caseMatchesAssignee } from '../../../utils/caseAssignments';

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
  async createTask(payload: any, req: AuthRequest) {
    const title = requireString(payload.title, 'Title is required.');
    const assignee = requireString(payload.assignee, 'Assignee is required.');
    const supervisor = requireString(payload.supervisor, 'Supervisor is required.');
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
          { relatedClient: regex },
          { relatedMatterLabel: regex },
        ],
      });
    }

    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
    const sortBy = query.sortBy || 'dueDate';
    const sortDir = query.sortDir === 'desc' ? -1 : 1;

    const [items, total] = await Promise.all([
      IndependentTask.find(filter)
        .sort(sortBy === 'priority' ? { priority: sortDir, dueDate: 1 } : { [sortBy]: sortDir })
        .skip((page - 1) * limit)
        .limit(limit),
      IndependentTask.countDocuments(filter),
    ]);

    const hydrated = [];
    for (const item of items) {
      if (await isVisibleToUser(req, item)) hydrated.push(await hydrateTask(item));
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
      assignedToMe: visible.filter((t) => cleanString(t.assignee) === cleanString(req.user?.name)).slice(0, 5),
      tasksDueToday: visible.filter((t) => t.dueDate === today && !['Closed', 'Completed'].includes(t.status)),
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
    if (payload.supervisor !== undefined) updates.supervisor = requireString(payload.supervisor, 'Supervisor is required.');
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
        Object.assign(task, updates, {
          lastActionBy: req.user?.name || 'System',
          ...(req.user?.id ? { lastActionByUserId: new mongoose.Types.ObjectId(req.user.id) } : {}),
        });
        await task.save({ session });

        if (updates.priority && updates.priority !== beforePriority) {
          await buildHistory(String(task._id), 'TASK_PRIORITY_CHANGED', 'Priority changed', req, `${beforePriority} → ${updates.priority}`);
        }
        if (updates.dueDate && updates.dueDate !== beforeDue) {
          await buildHistory(String(task._id), 'TASK_DUE_DATE_CHANGED', 'Due date changed', req, `${beforeDue} → ${updates.dueDate}`);
        }
        if (updates.assignee && updates.assignee !== beforeAssignee) {
          await buildHistory(String(task._id), 'TASK_ASSIGNED', 'Assignee changed', req, `${beforeAssignee} → ${updates.assignee}`);
          await notifyAssigned(task, req);
        }
        if (updates.supervisor && updates.supervisor !== beforeSupervisor) {
          await buildHistory(String(task._id), 'TASK_EDITED', 'Supervisor changed', req, `${beforeSupervisor} → ${updates.supervisor}`);
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

    const attachmentDoc: any = {
      taskId: task._id,
      fileName: cleanString(payload.fileName) || file.originalname,
      originalName: file.originalname,
      fileSize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
      uploadedBy: req.user?.name || 'System',
      uploadedDate: todayISO(),
      url: `/uploads/${file.filename}`,
    };
    const note = cleanString(payload.note);
    if (note) attachmentDoc.note = note;
    if (req.user?.id) attachmentDoc.uploadedByUserId = new mongoose.Types.ObjectId(req.user.id);

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

    const filePath = path.join(process.cwd(), attachment.url.replace(/^\/+/, ''));
    await fs.unlink(filePath).catch(() => {});
    await IndependentTaskAttachment.findByIdAndDelete(attachmentId);

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
