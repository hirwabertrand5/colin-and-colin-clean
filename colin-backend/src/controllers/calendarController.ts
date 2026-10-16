import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import Event from '../models/eventModel';
import Case from '../models/caseModel';
import Task from '../models/taskModel';
import Prospect from '../models/prospectModel';
import IndependentTask from '../modules/independentTasks/models/independentTaskModel';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isAdmin = (role?: string) =>
  role === 'managing_director' ||
  role === 'managing_partner' ||
  role === 'senior_partner' ||
  role === 'partner' ||
  role === 'associate_partner' ||
  role === 'executive_assistant';

export const getFirmEvents = async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, type = 'all', q = '', source = 'all' } = req.query as any;

    if (!from || !to) {
      return res.status(400).json({ message: 'from and to are required (YYYY-MM-DD)' });
    }

    // Calendar source filter: active matters (workflow deadlines), intake +
    // prospects (stage + follow-up due dates), independent tasks, firm events.
    // STRICT: selecting one source returns ONLY that source's rows. `type`
    // narrows stored firm events; auto-generated Deadline rows always pass
    // the type gate only when type is all/Deadline.
    const includeSource = (name: 'events' | 'matters' | 'intake' | 'prospects' | 'independent') =>
      !source || source === 'all' || source === name;
    const includeMatters = includeSource('matters');
    const includeIntake = includeSource('intake');
    const includeProspects = includeSource('prospects');
    const includeIndependent = includeSource('independent');
    const includeEvents = includeSource('events');

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

      const userRegex = new RegExp(escapeRegExp(String(userName).trim()), 'i');
      const allowedCases = includeEvents
        ? await Case.find({
            $or: [
              { assignedTo: userRegex },
              { 'caseAssignments.initiator': userRegex },
              { 'caseAssignments.reviewer': userRegex },
              { 'caseAssignments.signerApprover': userRegex },
            ],
          }).select('_id')
        : [];
      const allowedIds = allowedCases.map((c: any) => c._id);
      eventFilter.caseId = { $in: allowedIds };
    }

    const events = includeEvents ? await Event.find(eventFilter).sort({ date: 1, time: 1 }) : [];

    const caseIds = Array.from(new Set(events.map((e: any) => String(e.caseId))));
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);
    const dueConditions: any[] = [
      { 'workflowProgress.currentStepDueAt': { $gte: fromDate, $lte: toDate } },
      { 'workflowProgress.nextDueAt': { $gte: fromDate, $lte: toDate } },
    ];
    // NOTE: keep visibility and dates combined with $and. The earlier code
    // overwrote workflowCaseFilter.$or here, which dropped the date conditions
    // for non-admins (every assigned matter leaked in regardless of range).
    const workflowCaseFilter: any = { $or: dueConditions };
    if (!isAdmin(role)) {
      const userRegex = new RegExp(escapeRegExp(String(userName || '').trim()), 'i');
      workflowCaseFilter.$and = [
        { $or: dueConditions },
        {
          $or: [
            { assignedTo: userRegex },
            { 'caseAssignments.initiator': userRegex },
            { 'caseAssignments.reviewer': userRegex },
            { 'caseAssignments.signerApprover': userRegex },
          ],
        },
      ];
      delete workflowCaseFilter.$or;
    }
    // Active matters only: skip closed / temporarily-closed / completed workflows.
    workflowCaseFilter.status = { $nin: ['Closed', 'Temporarily Closed'] };
    workflowCaseFilter['workflowProgress.status'] = { $ne: 'Completed' };
    const workflowCases = includeMatters
      ? await Case.find(workflowCaseFilter).select('_id caseNo parties assignedTo workflowProgress')
      : [];

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

    // STRICT source isolation: a filtered view shows ONLY that source's rows.
    // (Source-gated queries above already skip unselected sources; the tag
    // check below is the second gate so a Deadline+source combination can
    // never leak rows from another pipeline.)
    const sourceAllows = (rowSource: string) =>
      !source || source === 'all' || rowSource === source ||
      ((source === 'intake' || source === 'prospects') && rowSource === 'prospects');
    // STRICT type isolation for auto-generated rows: when the user picks a
    // Deadline filter, only Deadline rows show; when they pick any other
    // type (Court/Meeting/...), auto-generated Deadline rows are hidden so
    // the view contains ONLY stored events of that type.
    const typeAllowsAuto = !type || type === 'all' || type === 'Deadline';
    const qText = String(q || '').trim().toLowerCase();
    const workflowEvents = (!sourceAllows('matters') || !typeAllowsAuto ? [] : workflowCases)
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
          source: 'matters',
          case: { _id: String(c._id), caseNo: c.caseNo, parties: c.parties },
        };
      })
      .filter(Boolean);

    // ── Prospect / intake deadlines (stage due + next follow-up) ─────────────
    // Same pipeline source drives both the `intake` and `prospects` filters.
    const showPipeline = includeIntake || includeProspects;
    let prospectEvents: any[] = [];
    if (showPipeline && typeAllowsAuto) {
      const prospectDateOr: any[] = [
        { stageDueAt: { $gte: fromDate, $lte: toDate } },
        { nextFollowUpDate: { $gte: fromDate, $lte: toDate } },
        { escalationRequiredAt: { $gte: fromDate, $lte: toDate } },
      ];
      const prospectFilter: any = { $or: prospectDateOr, stage: { $nin: ['Converted', 'Non-Converted'] } };
      if (!isAdmin(role)) {
        const meId = req.user?.id && mongoose.Types.ObjectId.isValid(req.user.id)
          ? new mongoose.Types.ObjectId(req.user.id)
          : null;
        const userRegex = new RegExp(escapeRegExp(String(userName || '').trim()), 'i');
        const visibilityOr: any[] = [{ assignedTo: userRegex }];
        if (meId) {
          visibilityOr.push(
            { assignedTo: meId },
            { responsiblePartner: meId },
            { responsibleAssociate: meId },
            { createdBy: meId }
          );
        }
        prospectFilter.$and = [{ $or: prospectDateOr }, { $or: visibilityOr }];
        delete prospectFilter.$or;
      }
      const prospects = await Prospect.find(prospectFilter)
        .select('prospectNo clientName parties stage stageDueAt nextFollowUpDate escalationRequiredAt')
        .limit(1000)
        .lean();
      const toDay = (value: any): string | null => {
        const d = value ? new Date(value) : null;
        return d && Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
      };
      const toTime = (value: any): string => {
        const d = value ? new Date(value) : null;
        return d && Number.isFinite(d.getTime())
          ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          : '09:00';
      };
      for (const p of prospects) {
        const label = `${(p as any).prospectNo || 'Prospect'} • ${(p as any).clientName || (p as any).parties || 'Prospect'}`;
        const entries = [
          {
            date: toDay((p as any).stageDueAt),
            time: toTime((p as any).stageDueAt),
            title: `Prospect stage due: ${(p as any).stage || 'stage'} — ${label}`,
            description: `Intake/prospect stage deadline for ${label}.`,
          },
          {
            date: toDay((p as any).nextFollowUpDate),
            time: toTime((p as any).nextFollowUpDate),
            title: `Prospect follow-up: ${label}`,
            description: `Scheduled follow-up for ${label}.`,
          },
        ];
        for (const entry of entries) {
          if (!entry.date) continue;
          if (type && type !== 'all' && type !== 'Deadline') continue;
          if (qText) {
            const haystack = `${entry.title} ${entry.description} ${label}`.toLowerCase();
            if (!haystack.includes(qText)) continue;
          }
          const kind = entry.title.startsWith('Prospect stage') ? 'stage' : 'followup';
          prospectEvents.push({
            _id: `prospect-${String((p as any)._id)}-${kind}-${entry.date}`,
            caseId: null,
            prospectId: String((p as any)._id),
            title: entry.title,
            type: 'Deadline',
            date: entry.date,
            time: entry.time,
            description: entry.description,
            automated: true,
            source: 'prospects',
            case: null,
          });
        }
      }
    }

    // ── Independent-task deadlines ───────────────────────────────────────────
    let independentEvents: any[] = [];
    if (includeIndependent && typeAllowsAuto) {
      const independentTasks = await IndependentTask.find({ dueDate: { $gte: String(from), $lte: String(to) } })
        .select('taskNumber title dueDate assignee supervisor status')
        .limit(1000)
        .lean();
      const me = String(userName || '').trim().toLowerCase();
      const visibleTasks = isAdmin(role)
        ? independentTasks
        : (independentTasks as any[]).filter((t) => {
            const names = [t.assignee, t.supervisor].map((v) => String(v || '').trim().toLowerCase());
            return Boolean(me) && names.includes(me);
          });
      for (const t of visibleTasks as any[]) {
        const title = `Independent task due: ${t.taskNumber || ''} ${t.title || ''}`.trim();
        if (type && type !== 'all' && type !== 'Deadline') continue;
        if (qText) {
          const haystack = `${title} ${t.assignee || ''} ${t.supervisor || ''}`.toLowerCase();
          if (!haystack.includes(qText)) continue;
        }
        independentEvents.push({
          _id: `independent-${String(t._id)}`,
          caseId: null,
          taskId: String(t._id),
          title,
          type: 'Deadline',
          date: String(t.dueDate).slice(0, 10),
          time: '09:00',
          description: `Independent task ${t.taskNumber || ''} supervised by ${t.supervisor || '—'}.`.trim(),
          automated: true,
          source: 'independent',
          case: null,
        });
      }
    }

    res.json(
      [...result, ...workflowEvents, ...prospectEvents, ...independentEvents].sort((a: any, b: any) =>
        `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
      )
    );
  } catch {
    res.status(500).json({ message: 'Failed to fetch firm calendar events.' });
  }
};

// Task due overlay: returns tasks due in date range (same role rules)
export const getCalendarTasks = async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, q = '', type = 'all', source = 'all' } = req.query as any;

    if (!from || !to) {
      return res.status(400).json({ message: 'from and to are required (YYYY-MM-DD)' });
    }

    // The task overlay belongs to matter views only. When the calendar is
    // filtered to intake / prospects / independent, this feed must return
    // nothing so those views show ONLY their own deadlines. A Deadline-only
    // type filter keeps the task overlay (tasks ARE due-date rows), while any
    // non-deadline type (Court/Meeting/...) excludes it.
    const taskGateAllows = (rowSource: string) =>
      (!source || source === 'all' || rowSource === source) &&
      (!type || type === 'all' || type === 'Deadline');
    if (!taskGateAllows('matters')) return res.json([]);

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

      const userRegex = new RegExp(escapeRegExp(String(userName).trim()), 'i');
      const allowedCases = await Case.find({
        $or: [
          { assignedTo: userRegex },
          { 'caseAssignments.initiator': userRegex },
          { 'caseAssignments.reviewer': userRegex },
          { 'caseAssignments.signerApprover': userRegex },
        ],
      }).select('_id');
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
