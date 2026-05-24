import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import Event from '../models/eventModel';
import Case from '../models/caseModel';
import Task from '../models/taskModel';

const isAdmin = (role?: string) =>
  role === 'managing_director' ||
  role === 'managing_partner' ||
  role === 'senior_partner' ||
  role === 'partner' ||
  role === 'associate_partner' ||
  role === 'executive_assistant';

export const getFirmEvents = async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, type = 'all', q = '' } = req.query as any;

    if (!from || !to) {
      return res.status(400).json({ message: 'from and to are required (YYYY-MM-DD)' });
    }

    const eventFilter: any = {
      date: { $gte: String(from), $lte: String(to) },
    };

    if (type && type !== 'all') eventFilter.type = type;

    if (q && String(q).trim()) {
      const regex = new RegExp(String(q).trim(), 'i');
      eventFilter.$or = [{ title: regex }, { description: regex }];
    }

    const role = req.user?.role;
    const userName = req.user?.name;

    if (!isAdmin(role)) {
      if (!userName) return res.status(401).json({ message: 'Unauthorized (missing user name).' });

      const allowedCases = await Case.find({ assignedTo: userName }).select('_id');
      const allowedIds = allowedCases.map((c: any) => c._id);
      eventFilter.caseId = { $in: allowedIds };
    }

    const events = await Event.find(eventFilter).sort({ date: 1, time: 1 });

    const caseIds = Array.from(new Set(events.map((e: any) => String(e.caseId))));
    const workflowCaseFilter: any = {
      $or: [
        { 'workflowProgress.currentStepDueAt': { $gte: new Date(`${from}T00:00:00.000Z`), $lte: new Date(`${to}T23:59:59.999Z`) } },
        { 'workflowProgress.nextDueAt': { $gte: new Date(`${from}T00:00:00.000Z`), $lte: new Date(`${to}T23:59:59.999Z`) } },
      ],
    };
    if (!isAdmin(role)) {
      workflowCaseFilter.assignedTo = userName;
    }
    const workflowCases = await Case.find(workflowCaseFilter).select(
      '_id caseNo parties assignedTo workflowProgress'
    );

    const cases = await Case.find({
      _id: { $in: Array.from(new Set([...caseIds, ...workflowCases.map((c: any) => String(c._id))])) },
    }).select('_id caseNo parties');
    const caseMap = new Map(cases.map((c: any) => [String(c._id), c]));

    const result = events.map((e: any) => {
      const c = caseMap.get(String(e.caseId));
      return {
        ...e.toObject(),
        case: c ? { _id: String(c._id), caseNo: c.caseNo, parties: c.parties } : null,
      };
    });

    const qText = String(q || '').trim().toLowerCase();
    const workflowEvents = workflowCases
      .map((c: any) => {
        const dueRaw = c.workflowProgress?.currentStepDueAt || c.workflowProgress?.nextDueAt;
        if (!dueRaw) return null;
        const due = new Date(dueRaw);
        if (!Number.isFinite(due.getTime())) return null;
        const title = `Next case step: ${c.workflowProgress?.currentStepTitle || 'Workflow step'}`;
        const description = `Auto-generated from case workflow progress for ${c.caseNo || c.parties || 'case'}.`;
        if (type && type !== 'all' && type !== 'Deadline') return null;
        if (qText) {
          const haystack = `${title} ${description} ${c.caseNo || ''} ${c.parties || ''}`.toLowerCase();
          if (!haystack.includes(qText)) return null;
        }
        return {
          _id: `workflow-${String(c._id)}`,
          caseId: String(c._id),
          title,
          type: 'Deadline',
          date: due.toISOString().slice(0, 10),
          time: `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`,
          description,
          automated: true,
          case: { _id: String(c._id), caseNo: c.caseNo, parties: c.parties },
        };
      })
      .filter(Boolean);

    res.json([...result, ...workflowEvents].sort((a: any, b: any) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)));
  } catch {
    res.status(500).json({ message: 'Failed to fetch firm calendar events.' });
  }
};

// Task due overlay: returns tasks due in date range (same role rules)
export const getCalendarTasks = async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, q = '' } = req.query as any;

    if (!from || !to) {
      return res.status(400).json({ message: 'from and to are required (YYYY-MM-DD)' });
    }

    const taskFilter: any = {
      dueDate: { $gte: String(from), $lte: String(to) },
    };

    if (q && String(q).trim()) {
      const regex = new RegExp(String(q).trim(), 'i');
      taskFilter.$or = [{ title: regex }, { assignee: regex }];
    }

    const role = req.user?.role;
    const userName = req.user?.name;

    if (!isAdmin(role)) {
      if (!userName) return res.status(401).json({ message: 'Unauthorized (missing user name).' });

      const allowedCases = await Case.find({ assignedTo: userName }).select('_id');
      const allowedIds = allowedCases.map((c: any) => c._id);
      taskFilter.caseId = { $in: allowedIds };
    }

    const tasks = await Task.find(taskFilter).sort({ dueDate: 1 });

    // attach case info
    const caseIds = Array.from(new Set(tasks.map((t: any) => String(t.caseId))));
    const cases = await Case.find({ _id: { $in: caseIds } }).select('_id caseNo parties');
    const caseMap = new Map(cases.map((c: any) => [String(c._id), c]));

    const result = tasks.map((t: any) => {
      const c = caseMap.get(String(t.caseId));
      return {
        ...t.toObject(),
        case: c ? { _id: String(c._id), caseNo: c.caseNo, parties: c.parties } : null,
      };
    });

    res.json(result);
  } catch {
    res.status(500).json({ message: 'Failed to fetch calendar tasks.' });
  }
};
