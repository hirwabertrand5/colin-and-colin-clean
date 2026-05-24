import { Response } from 'express';
import Prospect from '../models/prospectModel';
import Case from '../models/caseModel';
import { AuthRequest } from '../middleware/authMiddleware';
import Counter from '../models/counterModel';

const isAdminRole = (role?: string) =>
  role === 'managing_director' ||
  role === 'managing_partner' ||
  role === 'senior_partner' ||
  role === 'partner' ||
  role === 'associate_partner';

const canManageProspects = (role?: string) =>
  isAdminRole(role) ||
  role === 'executive_assistant' ||
  role === 'senior_associate';

// Generate unique prospect number
const generateProspectNo = async (): Promise<string> => {
  const counter = await Counter.findByIdAndUpdate(
    { _id: 'prospect' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  const seq = String(counter.seq).padStart(5, '0');
  return `PROS-${new Date().getFullYear()}-${seq}`;
};

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

    const prospect = await Prospect.findById(req.params.id)
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
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const prospectNo = await generateProspectNo();
    const prospect = new Prospect({
      ...req.body,
      prospectNo,
      createdBy: req.user?.id,
      stage: 'Inquiry',
      isActive: true,
    });

    const saved = await prospect.save();
    const populated = await Prospect.findById(saved._id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email');

    return res.status(201).json(populated);
  } catch (error) {
    console.error('createProspect error:', error);
    return res.status(500).json({ message: 'Failed to create prospect.' });
  }
};

export const updateProspect = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageProspects(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const prospect = await Prospect.findById(req.params.id);
    if (!prospect) {
      return res.status(404).json({ message: 'Prospect not found.' });
    }

    const oldData = prospect.toObject();
    const updates = req.body;

    // Update fields
    Object.keys(updates).forEach((key) => {
      if (key !== '_id' && key !== 'prospectNo' && key !== 'createdBy') {
        (prospect as any)[key] = updates[key];
      }
    });

    const saved = await prospect.save();
    const populated = await Prospect.findById(saved._id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .populate('convertedToMatters', 'caseNo');

    return res.json(populated);
  } catch (error) {
    console.error('updateProspect error:', error);
    return res.status(500).json({ message: 'Failed to update prospect.' });
  }
};

export const deleteProspect = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const prospect = await Prospect.findByIdAndDelete(req.params.id);
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

    const prospect = await Prospect.findById(req.params.id);
    if (!prospect) {
      return res.status(404).json({ message: 'Prospect not found.' });
    }

    if (prospect.convertedToMatters) {
      return res.status(400).json({ message: 'Prospect already converted to matter.' });
    }

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
      assignedTo: prospect.assignedTo,
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
const generateCaseNo = async (): Promise<string> => {
  const counter = await Counter.findByIdAndUpdate(
    { _id: 'case' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  const seq = String(counter.seq).padStart(5, '0');
  return `CASE-${new Date().getFullYear()}-${seq}`;
};
