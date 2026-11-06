import { Response } from 'express';
import mongoose from 'mongoose';
import Event from '../models/eventModel';
import { writeAudit } from '../services/auditService';
import { AuthRequest } from '../middleware/authMiddleware';
import Case from '../models/caseModel';
import { notifyMatterParticipants } from '../services/activityNotificationService';
import { canManageWorkflowStepsOfCase } from '../utils/caseAssignmentPermissions';
import { isPublicYellowCase } from '../utils/caseVisibility';
import { eventDateTime } from '../utils/notificationTime';

const canUseCaseEvents = async (req: AuthRequest, caseId: string, write = false) => {
  if (!mongoose.isValidObjectId(caseId)) return false;
  const matter = await Case.findById(caseId).lean();
  return Boolean(matter && (canManageWorkflowStepsOfCase(matter, req.user) || (!write && isPublicYellowCase(matter))));
};

const notifyEventChange = async (event: any, action: string) => {
  const matter = await Case.findById(event.caseId).lean();
  if (matter) await notifyMatterParticipants(matter, { type: 'EVENT_CHANGED', title: `Event ${action}: ${event.title}`,
    message: `${event.title} has been ${action}.\nScheduled: ${event.date} ${event.time} (${process.env.APP_TIMEZONE || 'Africa/Kigali'}).`,
    eventId: String(event._id), link: `/cases/${event.caseId}`, dedupeKey: `EVENT_${action}:${event._id}:${new Date(event.updatedAt).toISOString()}` });
};

const actorFromReq = (req: AuthRequest) => ({
  actorName: req.user?.name || 'System',
  actorUserId: req.user?.id as string | undefined,
});

// Get all events for a case
export const getEventsForCase = async (req: AuthRequest, res: Response) => {
  try {
    let caseId: any = req.params.caseId;
    if (Array.isArray(caseId)) caseId = caseId[0];
    if (!caseId) return res.status(400).json({ message: 'Missing caseId' });
    if (!(await canUseCaseEvents(req, String(caseId)))) return res.status(403).json({ message: 'Forbidden.' });

    const events = await Event.find({ caseId: new mongoose.Types.ObjectId(caseId) }).sort({ date: 1, time: 1 });
    res.json(events);
  } catch {
    res.status(500).json({ message: 'Failed to fetch events.' });
  }
};

// Add event to a case
export const addEventToCase = async (req: AuthRequest, res: Response) => {
  try {
    let caseId: any = req.params.caseId;
    if (Array.isArray(caseId)) caseId = caseId[0];
    if (!caseId) return res.status(400).json({ message: 'Missing caseId' });
    if (!(await canUseCaseEvents(req, String(caseId), true))) return res.status(403).json({ message: 'Forbidden.' });

    if (!eventDateTime(String(req.body?.date || ''), String(req.body?.time || ''))) return res.status(400).json({ message: 'Provide a valid event date and time.' });
    const newEvent = new Event({ ...req.body, caseId: new mongoose.Types.ObjectId(caseId) });
    await newEvent.save();
    await notifyEventChange(newEvent, 'created');

    const actor = actorFromReq(req);

    await writeAudit({
      caseId,
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'EVENT_CREATED',
      message: 'Created event',
      detail: `${newEvent.type || 'Event'} • ${newEvent.title || 'Untitled'} • ${newEvent.date || '-'} ${newEvent.time || ''}`.trim(),
    });

    res.status(201).json(newEvent);
  } catch {
    res.status(500).json({ message: 'Failed to create event.' });
  }
};

// Get single event
export const getEventById = async (req: AuthRequest, res: Response) => {
  try {
    let eventId: any = req.params.eventId;
    if (Array.isArray(eventId)) eventId = eventId[0];
    if (!eventId) return res.status(400).json({ message: 'Missing eventId' });

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: 'Event not found.' });
    if (!(await canUseCaseEvents(req, String(event.caseId)))) return res.status(403).json({ message: 'Forbidden.' });
    res.json(event);
  } catch {
    res.status(500).json({ message: 'Failed to fetch event.' });
  }
};

// Update event
export const updateEvent = async (req: AuthRequest, res: Response) => {
  try {
    let eventId: any = req.params.eventId;
    if (Array.isArray(eventId)) eventId = eventId[0];
    if (!eventId) return res.status(400).json({ message: 'Missing eventId' });

    const before = await Event.findById(eventId);
    if (!before) return res.status(404).json({ message: 'Event not found.' });
    if (!(await canUseCaseEvents(req, String(before.caseId), true))) return res.status(403).json({ message: 'Forbidden.' });
    // Event ownership cannot be moved to an unrelated matter through this endpoint.
    const { caseId: _caseId, ...eventUpdates } = req.body || {};
    if (!eventDateTime(String(eventUpdates.date ?? before.date), String(eventUpdates.time ?? before.time))) return res.status(400).json({ message: 'Provide a valid event date and time.' });
    const updated = await Event.findByIdAndUpdate(eventId, eventUpdates, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ message: 'Event not found.' });
    if (before && ['date', 'time', 'title', 'type'].some(key => (before as any)[key] !== (updated as any)[key])) await notifyEventChange(updated, 'rescheduled');

    const changes: string[] = [];
    if (before) {
      if (req.body.date && req.body.date !== before.date) changes.push(`Date: ${before.date} → ${req.body.date}`);
      if (req.body.time && req.body.time !== before.time) changes.push(`Time: ${before.time} → ${req.body.time}`);
      if (req.body.type && req.body.type !== before.type) changes.push(`Type: ${before.type} → ${req.body.type}`);
      if (req.body.title && req.body.title !== before.title) changes.push(`Title changed`);
    }

    const actor = actorFromReq(req);

    await writeAudit({
      caseId: String(updated.caseId),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'EVENT_UPDATED',
      message: 'Updated event',
      detail: `${updated.title || 'Untitled'}${changes.length ? ' • ' + changes.join(' • ') : ''}`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ message: 'Failed to update event.' });
  }
};

// Delete event
export const deleteEvent = async (req: AuthRequest, res: Response) => {
  try {
    let eventId: any = req.params.eventId;
    if (Array.isArray(eventId)) eventId = eventId[0];
    if (!eventId) return res.status(400).json({ message: 'Missing eventId' });

    const before = await Event.findById(eventId);
    if (!before) return res.status(404).json({ message: 'Event not found.' });
    if (!(await canUseCaseEvents(req, String(before.caseId), true))) return res.status(403).json({ message: 'Forbidden.' });
    const deleted = await Event.findByIdAndDelete(eventId);
    if (!deleted) return res.status(404).json({ message: 'Event not found.' });
    await notifyEventChange(deleted, 'cancelled');

    const actor = actorFromReq(req);

    await writeAudit({
      caseId: String(deleted.caseId),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'EVENT_DELETED',
      message: 'Deleted event',
      detail: deleted.title || 'Untitled',
    });

    res.json({ message: 'Event deleted.' });
  } catch {
    res.status(500).json({ message: 'Failed to delete event.' });
  }
};
