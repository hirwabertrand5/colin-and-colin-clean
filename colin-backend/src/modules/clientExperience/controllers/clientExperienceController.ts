import { Response } from 'express';
import { AuthRequest } from '../../../middleware/authMiddleware';
import type { AuditAction } from '../../../models/auditLogModel';
import { writeAudit } from '../../../services/auditService';
import { feedbackTemplateService } from '../services/feedbackTemplateService';
import { feedbackRequestService } from '../services/feedbackRequestService';
import { feedbackResponseService } from '../services/feedbackResponseService';
import { internalAssessmentService } from '../services/internalAssessmentService';
import { redFlagService } from '../services/redFlagService';
import { complaintService } from '../services/complaintService';
import { feedbackDeliveryService } from '../services/feedbackDeliveryService';

const actorFromReq = (req: AuthRequest) => ({
  userId: req.user?.id,
  userName: req.user?.name || 'System',
});

const getRouteParamId = (req: AuthRequest) => {
  const value = req.params.id;
  return Array.isArray(value) ? value[0] : value;
};

const buildAuditPayload = (req: AuthRequest, action: AuditAction, message: string, detail?: string) => {
  const base = {
    caseId: req.user?.id || '000000000000000000000000',
    actorName: actorFromReq(req).userName,
    action,
    message,
    ...(detail ? { detail } : {}),
  } as const;

  if (req.user?.id) {
    return {
      ...base,
      actorUserId: req.user.id,
    };
  }

  return base;
};

export const listTemplates = async (_req: AuthRequest, res: Response) => {
  try {
    const templates = await feedbackTemplateService.list();
    return res.json(templates);
  } catch (error) {
    console.error('listTemplates error', error);
    return res.status(500).json({ message: 'Failed to load templates.' });
  }
};

export const createTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const template = await feedbackTemplateService.create(req.body);
    await writeAudit(buildAuditPayload(req, 'WORKFLOW_TEMPLATE_CREATED', 'Client experience template created', template.name));
    return res.status(201).json(template);
  } catch (error) {
    console.error('createTemplate error', error);
    return res.status(500).json({ message: 'Failed to create template.' });
  }
};

export const listRequests = async (_req: AuthRequest, res: Response) => {
  try {
    const requests = await feedbackRequestService.list();
    return res.json(requests);
  } catch (error) {
    console.error('listRequests error', error);
    return res.status(500).json({ message: 'Failed to load feedback requests.' });
  }
};

export const getRequest = async (req: AuthRequest, res: Response) => {
  try {
    const requestId = getRouteParamId(req);
    if (!requestId) return res.status(400).json({ message: 'Feedback request id is required.' });

    const request = await feedbackRequestService.getById(requestId);
    if (!request) return res.status(404).json({ message: 'Feedback request not found.' });
    return res.json(request);
  } catch (error) {
    console.error('getRequest error', error);
    return res.status(500).json({ message: 'Failed to load feedback request.' });
  }
};

export const createRequest = async (req: AuthRequest, res: Response) => {
  try {
    const request = await feedbackRequestService.create({ ...req.body, createdBy: req.user?.id });
    await writeAudit(buildAuditPayload(req, 'WORKFLOW_INSTANCE_CREATED', 'Client experience feedback request created', request.requestNumber));
    return res.status(201).json(request);
  } catch (error) {
    console.error('createRequest error', error);
    return res.status(500).json({ message: 'Failed to create feedback request.' });
  }
};

export const sendRequest = async (req: AuthRequest, res: Response) => {
  try {
    const request = await feedbackDeliveryService.sendRequest({
      ...req.body,
      actorUserId: req.user?.id,
      actorName: req.user?.name || 'System',
    });
    return res.status(200).json(request);
  } catch (error: any) {
    console.error('sendRequest error', error);
    return res.status(400).json({ message: error?.message || 'Failed to send feedback request.' });
  }
};

export const resendRequest = async (req: AuthRequest, res: Response) => {
  try {
    const requestId = getRouteParamId(req);
    if (!requestId) return res.status(400).json({ message: 'Feedback request id is required.' });

    const request = await feedbackDeliveryService.resendRequest(requestId, req.user?.id, req.user?.name || 'System');
    return res.status(200).json(request);
  } catch (error: any) {
    console.error('resendRequest error', error);
    return res.status(400).json({ message: error?.message || 'Failed to resend feedback request.' });
  }
};

export const updateRequest = async (req: AuthRequest, res: Response) => {
  try {
    const requestId = getRouteParamId(req);
    if (!requestId) return res.status(400).json({ message: 'Feedback request id is required.' });

    const request = await feedbackRequestService.update(requestId, req.body);
    if (!request) return res.status(404).json({ message: 'Feedback request not found.' });
    return res.json(request);
  } catch (error) {
    console.error('updateRequest error', error);
    return res.status(500).json({ message: 'Failed to update feedback request.' });
  }
};

export const listResponses = async (_req: AuthRequest, res: Response) => {
  try {
    const responses = await feedbackResponseService.list();
    return res.json(responses);
  } catch (error) {
    console.error('listResponses error', error);
    return res.status(500).json({ message: 'Failed to load feedback responses.' });
  }
};

export const getAssessment = async (req: AuthRequest, res: Response) => {
  try {
    const requestId = getRouteParamId(req);
    if (!requestId) return res.status(400).json({ message: 'Feedback request id is required.' });

    const assessment = await internalAssessmentService.getByFeedbackRequestId(requestId);
    return res.json(assessment || null);
  } catch (error) {
    console.error('getAssessment error', error);
    return res.status(500).json({ message: 'Failed to load assessment.' });
  }
};

export const createAssessment = async (req: AuthRequest, res: Response) => {
  try {
    const assessment = await internalAssessmentService.create(req.body);
    await writeAudit(buildAuditPayload(req, 'WORKFLOW_STEP_COMPLETED', 'Client experience assessment submitted', assessment.feedbackRequestId.toString()));
    return res.status(201).json(assessment);
  } catch (error) {
    console.error('createAssessment error', error);
    return res.status(500).json({ message: 'Failed to save assessment.' });
  }
};

export const listRedFlags = async (_req: AuthRequest, res: Response) => {
  try {
    const redFlags = await redFlagService.list();
    return res.json(redFlags);
  } catch (error) {
    console.error('listRedFlags error', error);
    return res.status(500).json({ message: 'Failed to load red flags.' });
  }
};

export const listComplaints = async (_req: AuthRequest, res: Response) => {
  try {
    const complaints = await complaintService.list();
    return res.json(complaints);
  } catch (error) {
    console.error('listComplaints error', error);
    return res.status(500).json({ message: 'Failed to load complaints.' });
  }
};
