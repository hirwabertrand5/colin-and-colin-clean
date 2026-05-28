import { Response } from 'express';
import mongoose from 'mongoose';
import Prospect from '../models/prospectModel';
import Case from '../models/caseModel';
import User from '../models/userModel';
import { AuthRequest } from '../middleware/authMiddleware';
import { buildYearlySequence } from '../utils/counter';

const isAdminRole = (role?: string) =>
  role === 'managing_director' ||
  role === 'managing_partner' ||
  role === 'senior_partner' ||
  role === 'partner' ||
  role === 'associate_partner';

const canManageProspects = (role?: string) =>
  isAdminRole(role) ||
  role === 'executive_assistant' ||
  role === 'senior_associate' ||
  role === 'associate' ||
  role === 'trainee_associate' ||
  role === 'intern';

const validStages = ['Inquiry', 'Consultation', 'Conflict Check', 'Quotation', 'Engagement', 'Converted', 'Non-Converted'];

const cleanString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const getRouteId = (value: unknown) => (typeof value === 'string' ? value : '');

const getProspectPayload = (body: any, fallbackUserId?: string) => {
  const assignedTo = cleanString(body.assignedTo) || fallbackUserId || '';
  const clientName = cleanString(body.clientName);
  return {
    clientName,
    contact: {
      name: cleanString(body.contact?.name) || clientName,
      email: cleanString(body.contact?.email),
      phone: cleanString(body.contact?.phone),
      ...(cleanString(body.contact?.position) ? { position: cleanString(body.contact.position) } : {}),
    },
    legalServicePath: Array.isArray(body.legalServicePath)
      ? body.legalServicePath
          .map((item: any) => ({
            id: cleanString(item?.id),
            label: cleanString(item?.label),
          }))
          .filter((item: any) => item.id && item.label)
      : [],
    inquiryDescription: cleanString(body.inquiryDescription),
    stage: validStages.includes(body.stage) ? body.stage : 'Inquiry',
    engagementNotes: cleanString(body.engagementNotes),
    assignedTo,
  };
};

const validateProspectPayload = async (payload: ReturnType<typeof getProspectPayload>) => {
  if (!payload.clientName) return 'Client name is required.';
  if (!payload.contact.email) return 'Contact email is required.';
  if (!payload.contact.phone) return 'Contact phone is required.';
  if (!payload.inquiryDescription) return 'Inquiry description is required.';
  
  if (!payload.assignedTo) {
    return 'Please select a staff member to assign this prospect to.';
  }
  
  if (!mongoose.Types.ObjectId.isValid(payload.assignedTo)) {
    return 'Invalid staff member ID. Please select a valid staff member.';
  }

  const assigneeExists = await User.exists({ _id: payload.assignedTo, isActive: true });
  if (!assigneeExists) return 'The selected staff member was not found or is inactive. Please select another staff member.';

  return null;
};

const generateProspectNo = () => buildYearlySequence('prospect', 'PROS');

export const getAllProspects = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageProspects(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const { stage, assignedTo, isActive } = req.query;
    const filter: any = {};

    if (stage) filter.stage = stage;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const prospects = await Prospect.find(filter)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .sort({ dateReceived: -1 });

    return res.json(prospects);
  } catch (error) {
    console.error('getAllProspects error:', error);
    return res.status(500).json({ message: 'Failed to fetch prospects.' });
  }
};

export const getProspectById = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageProspects(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const prospectId = getRouteId(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }

    const prospect = await Prospect.findById(prospectId)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .populate('convertedToMatters', 'caseNo');

    if (!prospect) {
      return res.status(404).json({ message: 'Prospect not found.' });
    }

    return res.json(prospect);
  } catch (error) {
    console.error('getProspectById error:', error);
    return res.status(500).json({ message: 'Failed to fetch prospect.' });
  }
};

export const createProspect = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageProspects(req.user?.role)) {
      return res.status(403).json({ message: 'You do not have permission to create prospects.' });
    }

    const payload = getProspectPayload(req.body, req.user?.id);
    const validationMessage = await validateProspectPayload(payload);
    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const prospectNo = await generateProspectNo();
    const prospect = new Prospect({
      ...payload,
      prospectNo,
      createdBy: req.user?.id,
      dateReceived: new Date(),
      isActive: true,
    });

    const saved = await prospect.save();
    const populated = await Prospect.findById(saved._id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email');

    return res.status(201).json(populated);
  } catch (error: any) {
    console.error('createProspect error:', error);
    if (error?.name === 'ValidationError') {
      const messages = Object.values(error.errors)
        .map((e: any) => e.message)
        .join('; ');
      return res.status(400).json({ message: `Validation error: ${messages}` });
    }
    if (error?.code === 11000) {
      return res.status(400).json({ message: 'A prospect with this information already exists.' });
    }
    return res.status(500).json({ message: error?.message || 'Failed to create prospect.' });
  }
};

export const updateProspect = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageProspects(req.user?.role)) {
      return res.status(403).json({ message: 'You do not have permission to update prospects.' });
    }

    const prospectId = getRouteId(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }

    const prospect = await Prospect.findById(prospectId);
    if (!prospect) {
      return res.status(404).json({ message: 'Prospect not found.' });
    }

    const updates = getProspectPayload(req.body, String(prospect.assignedTo));
    const validationMessage = await validateProspectPayload(updates);
    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    // Update fields
    (Object.keys(updates) as Array<keyof typeof updates>).forEach((key) => {
      (prospect as any)[key] = updates[key];
    });

    const saved = await prospect.save();
    const populated = await Prospect.findById(saved._id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .populate('convertedToMatters', 'caseNo');

    return res.json(populated);
  } catch (error: any) {
    console.error('updateProspect error:', error);
    if (error?.name === 'ValidationError') {
      const messages = Object.values(error.errors)
        .map((e: any) => e.message)
        .join('; ');
      return res.status(400).json({ message: `Validation error: ${messages}` });
    }
    return res.status(500).json({ message: error?.message || 'Failed to update prospect.' });
  }
};

export const deleteProspect = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const prospectId = getRouteId(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }

    const prospect = await Prospect.findByIdAndDelete(prospectId);
    if (!prospect) {
      return res.status(404).json({ message: 'Prospect not found.' });
    }

    return res.json({ message: 'Prospect deleted successfully.' });
  } catch (error) {
    console.error('deleteProspect error:', error);
    return res.status(500).json({ message: 'Failed to delete prospect.' });
  }
};

export const getProspectStats = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageProspects(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const stats = await Prospect.aggregate([
      {
        $match: { isActive: true },
      },
      {
        $group: {
          _id: '$stage',
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    const result = {
      Inquiry: 0,
      Consultation: 0,
      'Conflict Check': 0,
      Quotation: 0,
      Engagement: 0,
      Converted: 0,
      'Non-Converted': 0,
    };

    stats.forEach((stat: any) => {
      result[stat._id as keyof typeof result] = stat.count;
    });

    return res.json(result);
  } catch (error) {
    console.error('getProspectStats error:', error);
    return res.status(500).json({ message: 'Failed to fetch prospect stats.' });
  }
};

/**
 * Convert prospect to active matter
 * - Creates a new Case from prospect data
 * - Links prospect to case via convertedToMatters
 * - Updates prospect stage to 'Converted'
 */
export const convertProspectToMatter = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const prospectId = getRouteId(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }

    const prospect = await Prospect.findById(prospectId);
    if (!prospect) {
      return res.status(404).json({ message: 'Prospect not found.' });
    }

    if (prospect.convertedToMatters) {
      return res.status(400).json({ message: 'Prospect already converted to matter.' });
    }

    const assignee = await User.findById(prospect.assignedTo).select('name').lean();

    // Create new case from prospect
    const caseNo = await generateCaseNo();
    const newCase = new Case({
      caseNo,
      parties: prospect.clientName,
      description: prospect.inquiryDescription,
      legalServicePath: prospect.legalServicePath || [],
      clientContacts: [
        {
          name: prospect.contact.name,
          email: prospect.contact.email,
          phone: prospect.contact.phone,
          isPrimary: true,
        },
      ],
      assignedTo: assignee?.name || req.user?.name || 'Unassigned',
      status: 'Active',
      priority: 'Medium',
      caseType: 'Transactional Cases',
      billingSettings: {
        paymentMode: 'postpaid',
        currency: 'USD',
      },
      onboarding: {
        conflictCheckStatus: prospect.conflictCheckStatus || 'Pending',
        conflictCheckedAt: prospect.conflictCheckDate,
      },
    });

    const savedCase = await newCase.save();

    // Link prospect to case
    prospect.convertedToMatters = savedCase._id;
    prospect.stage = 'Converted';
    prospect.engagementDate = new Date();
    await prospect.save();

    return res.json({
      message: 'Prospect converted to matter successfully.',
      prospect,
      matter: savedCase,
    });
  } catch (error) {
    console.error('convertProspectToMatter error:', error);
    return res.status(500).json({ message: 'Failed to convert prospect to matter.' });
  }
};

// Helper function to generate case number
const generateCaseNo = () => buildYearlySequence('case', 'CASE');
