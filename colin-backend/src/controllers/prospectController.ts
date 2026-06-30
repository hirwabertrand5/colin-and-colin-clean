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

const validStages = [
  'Inquiry',
  'Consultation',
  'Conflict Check',
  'Quotation',
  'Quotation Preparation',
  'Conversion Assessment',
  'Quotation Issued',
  'Awaiting Client Decision',
  'Final Follow-Up',
  'Engagement',
  'Converted',
  'Non-Converted',
];
const terminalStages = ['Converted', 'Non-Converted'];
const convertedOutcomes = ['Quick Advisory', 'Legal Opinion', 'Full Engagement', 'Repeat Client', 'Retainer Client'];
const nonConvertedOutcomes = ['Pricing', 'Competitor', 'No Response', 'Internal Handling', 'Conflict', 'Other'];

const cleanString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const getRouteId = (value: unknown) => (typeof value === 'string' ? value : '');
const toOptionalNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getProspectPayload = (body: any, fallbackUserId?: string) => {
  const responsibleAssociate = cleanString(body.responsibleAssociate) || cleanString(body.assignedTo) || fallbackUserId || '';
  const responsiblePartner = cleanString(body.responsiblePartner);
  const assignedTo = cleanString(body.assignedTo) || responsibleAssociate || fallbackUserId || '';
  const clientName = cleanString(body.clientName);
  const stage = validStages.includes(cleanString(body.stage)) ? cleanString(body.stage) : 'Inquiry';
  const conversionOutcome = cleanString(body.conversionOutcome);
  return {
    parties: cleanString(body.parties) || clientName,
    clientName,
    enquiryNature: cleanString(body.enquiryNature),
    priorityLevel: ['High', 'Medium', 'Low'].includes(cleanString(body.priorityLevel))
      ? cleanString(body.priorityLevel)
      : 'Medium',
    enquirySource: cleanString(body.enquirySource),
    referralSource: cleanString(body.referralSource),
    estimatedMatterValue: toOptionalNumber(body.estimatedMatterValue),
    estimatedFeeValue: toOptionalNumber(body.estimatedFeeValue),
    contact: {
      name: cleanString(body.contact?.name) || clientName,
      email: cleanString(body.contact?.email) || undefined,
      phone: cleanString(body.contact?.phone) || undefined,
      ...(cleanString(body.contact?.position) ? { position: cleanString(body.contact.position) } : {}),
    },
    responsiblePartner: responsiblePartner || undefined,
    responsibleAssociate: responsibleAssociate || undefined,
    legalServicePath: Array.isArray(body.legalServicePath)
      ? body.legalServicePath
          .map((item: any) => ({
            id: cleanString(item?.id),
            label: cleanString(item?.label),
          }))
          .filter((item: any) => item.id && item.label)
      : [],
    inquiryDescription: cleanString(body.inquiryDescription),
    stage,
    engagementNotes: cleanString(body.engagementNotes),
    conversionOutcome: conversionOutcome || undefined,
    conversionReason: cleanString(body.conversionReason) || conversionOutcome || undefined,
    assignedTo,
  };
};

const validateProspectPayload = async (payload: ReturnType<typeof getProspectPayload>) => {
  if (!payload.clientName) return 'Client name is required.';
  if (!payload.contact.name) return 'Contact person is required.';
  if (!payload.inquiryDescription) return 'Inquiry description is required.';
  if (!payload.responsiblePartner) return 'Responsible partner is required.';
  if (!payload.responsibleAssociate) return 'Responsible associate is required.';
  
  if (!payload.assignedTo) {
    return 'Please select a staff member to assign this prospect to.';
  }
  
  if (!mongoose.Types.ObjectId.isValid(payload.assignedTo)) {
    return 'Invalid staff member ID. Please select a valid staff member.';
  }

  const assigneeExists = await User.exists({ _id: payload.assignedTo, isActive: true });
  if (!assigneeExists) return 'The selected staff member was not found or is inactive. Please select another staff member.';

  if (payload.responsiblePartner && !mongoose.Types.ObjectId.isValid(payload.responsiblePartner)) {
    return 'Invalid responsible partner. Please select a valid staff member.';
  }

  if (payload.responsibleAssociate && !mongoose.Types.ObjectId.isValid(payload.responsibleAssociate)) {
    return 'Invalid responsible associate. Please select a valid staff member.';
  }

  if (payload.contact.email) {
    const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.contact.email);
    if (!emailLooksValid) return 'Please enter a valid contact email address.';
  }

  if (terminalStages.includes(payload.stage as any)) {
    if (!payload.conversionOutcome) {
      return 'Please select a conversion outcome before closing this prospect.';
    }

    const validOutcome = terminalStages.includes(payload.stage as any)
      ? (payload.stage === 'Converted'
          ? convertedOutcomes.includes(payload.conversionOutcome)
          : nonConvertedOutcomes.includes(payload.conversionOutcome))
      : true;

    if (!validOutcome) {
      return 'Please select a valid conversion outcome for the selected closing stage.';
    }
  }

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
      .populate('responsiblePartner', 'name email role')
      .populate('responsibleAssociate', 'name email role')
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
      .populate('responsiblePartner', 'name email role')
      .populate('responsibleAssociate', 'name email role')
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
      .populate('responsiblePartner', 'name email role')
      .populate('responsibleAssociate', 'name email role')
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
      .populate('responsiblePartner', 'name email role')
      .populate('responsibleAssociate', 'name email role')
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
      'Quotation Preparation': 0,
      'Conversion Assessment': 0,
      'Quotation Issued': 0,
      'Awaiting Client Decision': 0,
      'Final Follow-Up': 0,
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

    if (String(prospect.stage) !== 'Converted') {
      return res.status(400).json({ message: 'Prospect must be marked Converted before converting to matter.' });
    }

    if (!String((prospect as any).conversionOutcome || '').trim()) {
      return res.status(400).json({ message: 'Please record a conversion outcome before converting this prospect.' });
    }

    const assigneeSource = prospect.responsibleAssociate || prospect.assignedTo;
    const assignee = await User.findById(assigneeSource).select('name').lean();

    // Create new case from prospect
    const caseNo = await generateCaseNo();
    const newCase = new Case({
      caseNo,
      parties: prospect.parties || prospect.clientName,
      description: prospect.inquiryDescription,
      legalServicePath: prospect.legalServicePath || [],
      clientContacts: [
        {
          name: prospect.contact.name,
          email: prospect.contact.email || undefined,
          phone: prospect.contact.phone || undefined,
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
