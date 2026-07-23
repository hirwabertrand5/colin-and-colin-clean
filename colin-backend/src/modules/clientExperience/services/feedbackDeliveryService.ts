import crypto from 'crypto';
import type { IFeedbackRequest } from '../../../models/clientExperience/feedbackRequestModel';
import FeedbackRequest from '../../../models/clientExperience/feedbackRequestModel';
import { writeAudit } from '../../../services/auditService';
import { sendEmailResend } from '../../../services/emailResendService';
import { FeedbackRequestStatus } from '../../../models/clientExperience/feedbackRequestModel';
import { googleFormService } from './googleFormService';
import type { CreateFeedbackRequestDto } from '../dto/clientExperienceDto';
import { feedbackTemplateService } from './feedbackTemplateService';

const REQUEST_STATUS_ORDER: FeedbackRequestStatus[] = ['Draft', 'Pending', 'Sending', 'Sent', 'Opened', 'Completed', 'Closed', 'Expired', 'Cancelled', 'Email Failed'];

const normalizeStatus = (value?: string): FeedbackRequestStatus => {
  const allowed = new Set<FeedbackRequestStatus>(['Draft', 'Pending', 'Sending', 'Sent', 'Opened', 'Completed', 'Closed', 'Expired', 'Cancelled', 'Email Failed']);
  return allowed.has(value as FeedbackRequestStatus) ? (value as FeedbackRequestStatus) : 'Draft';
};

const buildRequestNumber = () => {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `FR-${stamp}-${suffix}`;
};

const buildEmailHtml = (payload: { clientName?: string; surveyUrl: string; requestNumber: string }) => {
  const clientName = payload.clientName || 'Client';
  const escapedName = clientName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
      <p>Dear ${escapedName},</p>
      <p>Thank you for engaging Colin &amp; Colin Legal Solutions.</p>
      <p>We continuously strive to improve our legal services and would appreciate your feedback.</p>
      <p>Please complete the short survey below.</p>
      <p><a href="${payload.surveyUrl}" style="display: inline-block; background:#0f172a; color:#fff; padding:12px 20px; border-radius:999px; text-decoration:none;">Complete Feedback Survey</a></p>
      <p><strong>Request:</strong> ${payload.requestNumber}</p>
      <p>Estimated completion time: less than two minutes.</p>
      <p>Thank you,<br/>Client Experience Team</p>
    </div>
  `;
};

export const feedbackDeliveryService = {
  async sendRequest(payload: CreateFeedbackRequestDto & { actorUserId?: string; actorName?: string }) {
    const { actorUserId, actorName = 'System', ...requestPayload } = payload;

    if (!requestPayload.clientEmail) {
      throw new Error('A client email address is required before sending a feedback request.');
    }

    if (!requestPayload.feedbackType) {
      throw new Error('A feedback type is required before sending a feedback request.');
    }

    const template = await feedbackTemplateService.getByTriggerOrThrow(requestPayload.feedbackType);
    if (!template.googleFormUrl) {
      throw new Error('The Google Form URL has not yet been configured for this feedback template.');
    }

    const existingActive = await FeedbackRequest.findOne({
      templateId: template._id,
      clientEmail: requestPayload.clientEmail,
      feedbackType: requestPayload.feedbackType,
      status: { $in: ['Pending', 'Sending', 'Sent', 'Opened'] },
    }).lean();

    if (existingActive) {
      throw new Error('An active feedback request already exists for this client and template.');
    }

    const requestNumber = buildRequestNumber();
    const uniqueToken = crypto.randomBytes(20).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const requestDoc = await FeedbackRequest.create({
      ...requestPayload,
      templateId: template._id,
      requestNumber,
      uniqueToken,
      status: 'Pending',
      createdBy: actorUserId,
      expiresAt,
    } as any);

    const surveyUrl = googleFormService.buildPrefilledUrl(template, requestDoc as IFeedbackRequest);
    if (!surveyUrl) {
      await FeedbackRequest.findByIdAndUpdate(requestDoc._id, { status: 'Email Failed' });
      throw new Error('The selected feedback template does not have a survey configuration.');
    }

    await FeedbackRequest.findByIdAndUpdate(requestDoc._id, { status: 'Sending', googleFormUrl: surveyUrl });

    const emailHtml = buildEmailHtml({ clientName: requestPayload.clientEmail, surveyUrl, requestNumber });
    const emailResult = await sendEmailResend([requestPayload.clientEmail], 'We Value Your Feedback', emailHtml);

    if (!emailResult.ok) {
      await FeedbackRequest.findByIdAndUpdate(requestDoc._id, { status: 'Email Failed' });
      await writeAudit({
        caseId: actorUserId || '000000000000000000000000',
        actorName: actorName || 'System',
        action: 'CLIENT_EXPERIENCE_REQUEST_CREATED',
        message: 'Feedback request email delivery failed',
        detail: `${requestNumber} :: ${emailResult.error}`,
        ...(actorUserId ? { actorUserId } : {}),
      });
      throw new Error(emailResult.error || 'The email could not be delivered.');
    }

    const updatedRequest = await FeedbackRequest.findByIdAndUpdate(requestDoc._id, {
      status: 'Sent',
      sentAt: now,
      updatedAt: now,
    }, { new: true });

    await writeAudit({
      caseId: actorUserId || '000000000000000000000000',
      actorName: actorName || 'System',
      action: 'CLIENT_EXPERIENCE_REQUEST_CREATED',
      message: 'Feedback request sent',
      detail: `${requestNumber} :: ${requestPayload.clientEmail}`,
      ...(actorUserId ? { actorUserId } : {}),
    });

    return updatedRequest;
  },

  async resendRequest(id: string, actorUserId?: string, actorName = 'System') {
    const request = await FeedbackRequest.findById(id).lean();
    if (!request) {
      throw new Error('Feedback request not found.');
    }

    if (request.status === 'Completed' || request.status === 'Closed' || request.status === 'Cancelled' || request.status === 'Expired') {
      throw new Error('This request cannot be resent in its current state.');
    }

    const template = await feedbackTemplateService.getByTrigger(request.feedbackType);
    if (!template || !template.isActive) {
      throw new Error(`No active feedback template is currently available for ${request.feedbackType || 'this feedback type'}.`);
    }

    const surveyUrl = googleFormService.buildPrefilledUrl(template, request as IFeedbackRequest);
    if (!surveyUrl) {
      throw new Error('The selected feedback template does not have a survey configuration.');
    }

    const emailResult = await sendEmailResend([request.clientEmail || ''], 'We Value Your Feedback', buildEmailHtml({ clientName: request.clientEmail || 'Client', surveyUrl, requestNumber: request.requestNumber }));
    if (!emailResult.ok) {
      throw new Error(emailResult.error || 'The email could not be delivered.');
    }

    const updated = await FeedbackRequest.findByIdAndUpdate(id, {
      status: 'Sent',
      sentAt: new Date(),
      updatedAt: new Date(),
      $inc: { resendCount: 1 },
      lastResentAt: new Date(),
    }, { new: true });

    await writeAudit({
      caseId: actorUserId || '000000000000000000000000',
      actorName,
      action: 'CLIENT_EXPERIENCE_REQUEST_CREATED',
      message: 'Feedback request resent',
      detail: `${request.requestNumber}`,
      ...(actorUserId ? { actorUserId } : {}),
    });

    return updated;
  },
};

export type FeedbackDeliveryService = typeof feedbackDeliveryService;
