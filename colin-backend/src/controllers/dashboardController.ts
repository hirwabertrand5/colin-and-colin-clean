import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';

import Case from '../models/caseModel';
import Task from '../models/taskModel';
import Event from '../models/eventModel';
import Document from '../models/documentModel';

const isAdmin = (role?: string) =>
  role === 'managing_director' ||
  role === 'managing_partner' ||
  role === 'senior_partner' ||
  role === 'partner' ||
  role === 'associate_partner' ||
  role === 'executive_assistant';

const isoToday = () => new Date().toISOString().slice(0, 10);

const startOfMonthISO = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

const startOfMonthDate = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const toISODate = (d: Date) => d.toISOString().slice(0, 10);

export const getExecutiveAssistantDashboard = async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    if (!isAdmin(role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const todayISO = isoToday();
    const monthStartISO = startOfMonthISO();
    const monthStartDate = startOfMonthDate();

    // ----------------------------
    // Stats (MTD)
    // ----------------------------
    const [casesCreatedMTD, documentsUploadedMTD, scheduledEventsMTD, tasksCoordinatedMTD] =
      await Promise.all([
        Case.countDocuments({ createdAt: { $gte: monthStartDate } }),
        Document.countDocuments({ createdAt: { $gte: monthStartDate } }),
        Event.countDocuments({ date: { $gte: monthStartISO, $lte: todayISO } }),
        Task.countDocuments({ createdAt: { $gte: monthStartDate } }),
      ]);

    // ----------------------------
    // Today schedule (events today)
    // ----------------------------
    const todayEvents = await Event.find({ date: todayISO })
      .sort({ time: 1 })
      .limit(20)
      .lean();

    // Attach case labels to events
    const todayCaseIds = Array.from(new Set(todayEvents.map((e: any) => String(e.caseId)).filter(Boolean)));
    const todayCases = await Case.find({ _id: { $in: todayCaseIds } }).select('_id caseNo parties').lean();
    const caseMap = new Map(todayCases.map((c: any) => [String(c._id), c]));

    const todaySchedule = todayEvents.map((e: any) => {
      const c = caseMap.get(String(e.caseId));
      const caseLabel = c ? c.caseNo || c.parties : '';
      return {
        id: String(e._id),
        time: e.time || '—',
        title: caseLabel ? `${e.title} — ${caseLabel}` : e.title,
        type: e.type,
        description: e.description || '',
      };
    });

    // ----------------------------
    // Pending follow-up (tasks)
    // - show tasks not completed, soonest due first
    // ----------------------------
    const pendingTasks = await Task.find({ status: { $ne: 'Completed' } })
      .sort({ dueDate: 1, priority: 1 })
      .limit(10)
      .lean();

    // attach case labels to tasks
    const pendingCaseIds = Array.from(new Set(pendingTasks.map((t: any) => String(t.caseId)).filter(Boolean)));
    const pendingCases = await Case.find({ _id: { $in: pendingCaseIds } }).select('_id caseNo parties').lean();
    const pendingCaseMap = new Map(pendingCases.map((c: any) => [String(c._id), c]));

    const pendingFollowUp = pendingTasks.map((t: any) => {
      const c = pendingCaseMap.get(String(t.caseId));
      const caseLabel = c ? c.caseNo || c.parties : '';
      return {
        id: String(t._id),
        type: t.requiresApproval && t.approvalStatus === 'Pending' ? 'Approval' : 'Task',
        title: caseLabel ? `${t.title} — ${caseLabel}` : t.title,
        assignedTo: t.assignee || '—',
        status: t.status,
        dueDate: t.dueDate || '—',
        priority: t.priority || 'Medium',
      };
    });

    // ----------------------------
    // Recent cases (last 5)
    // ----------------------------
    const recent = await Case.find().sort({ createdAt: -1 }).limit(5).lean();

    const recentCases = recent.map((c: any) => ({
      id: String(c._id),
      name: c.caseNo || c.parties || '—',
      status: c.status || '—',
      client: c.parties || '—',
      createdDate: c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '',
    }));

    // ----------------------------
    // Response
    // ----------------------------
    res.json({
      stats: {
        casesCreatedMTD,
        documentsUploadedMTD,
        scheduledEventsMTD,
        tasksCoordinatedMTD,
      },
      today: {
        dateISO: todayISO,
        label: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      },
      todaySchedule,
      pendingFollowUp,
      recentCases,
    });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to load executive assistant dashboard.' });
  }
};