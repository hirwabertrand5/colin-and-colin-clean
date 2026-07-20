import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Prospect from '../models/prospectModel';
import ProspectFeedback from '../models/prospectFeedbackModel';
import { AuthRequest } from '../middleware/authMiddleware';
import { sendEmailResend } from '../services/emailResendService';
import { buildGoogleFormSubmissionUrl } from '../services/intakeAutomationConfig';

const cleanString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const toOptionalBoolean = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
};

const buildFeedbackEmailHtml = (prospectId: string) => {
  const publicUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/public/feedback/${prospectId}`;
  const googleFormUrl = buildGoogleFormSubmissionUrl(prospectId);
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;background:#f8fafc;padding:24px;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e2e8f0;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
          <div style="width:44px;height:44px;border-radius:12px;background:#0f172a;color:#ffffff;display:flex;align-items:center;justify-content:center;font-weight:700;">C&C</div>
          <div>
            <div style="font-size:18px;font-weight:700;color:#0f172a;">Colin & Colin Legal Solutions</div>
            <div style="font-size:13px;color:#64748b;">Client experience follow-up</div>
          </div>
        </div>
        <h2 style="margin:0 0 12px;font-size:24px;color:#0f172a;">Thank you for connecting with us</h2>
        <p style="margin:0 0 16px;font-size:15px;color:#334155;">We appreciate the time you spent speaking with our team. Your perspective helps us improve how we support future matters.</p>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;">If you are willing, please share a few quick thoughts about your experience by clicking the button below.</p>
        <div style="display:flex;flex-wrap:wrap;gap:12px;">
          <a href="${publicUrl}" style="display:inline-block;padding:12px 18px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:700;">Provide Quick Feedback</a>
          <a href="${googleFormUrl}" style="display:inline-block;padding:12px 18px;background:#f8fafc;color:#0f172a;text-decoration:none;border-radius:999px;font-weight:700;border:1px solid #cbd5e1;">Open Google Form</a>
        </div>
      </div>
    </div>
  `;
};

export const getProspectFeedback = async (req: AuthRequest, res: Response) => {
  try {
    const prospectId = cleanString(req.params.prospectId);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }

    const feedback = await ProspectFeedback.findOne({ prospectId }).lean();
    return res.json(feedback || null);
  } catch (error) {
    console.error('getProspectFeedback error:', error);
    return res.status(500).json({ message: 'Failed to fetch prospect feedback.' });
  }
};

export const upsertProspectFeedback = async (req: AuthRequest, res: Response) => {
  try {
    const prospectId = cleanString(req.params.prospectId);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }

    const prospect = await Prospect.findById(prospectId).lean();
    if (!prospect) {
      return res.status(404).json({ message: 'Prospect not found.' });
    }

    const existing = await ProspectFeedback.findOne({ prospectId });
    const updates = {
      primaryReasonCategory: cleanString(req.body?.primaryReasonCategory) || undefined,
      primaryReasonDetail: cleanString(req.body?.primaryReasonDetail) || undefined,
      clientComment: cleanString(req.body?.clientComment) || undefined,
      completedByRole: cleanString(req.body?.completedByRole) || undefined,
      internalCategory: cleanString(req.body?.internalCategory) || undefined,
      wasAvoidable: toOptionalBoolean(req.body?.wasAvoidable),
      estimatedConversionProbability: cleanString(req.body?.estimatedConversionProbability) || undefined,
      firmImprovementNotes: cleanString(req.body?.firmImprovementNotes) || undefined,
      partnerApprovalStatus: cleanString(req.body?.partnerApprovalStatus) || 'Pending',
    };

    const feedback = existing
      ? Object.assign(existing, updates)
      : new ProspectFeedback({ prospectId, ...updates });

    await feedback.save();
    return res.json(feedback);
  } catch (error) {
    console.error('upsertProspectFeedback error:', error);
    return res.status(500).json({ message: 'Failed to save prospect feedback.' });
  }
};

export const triggerProspectFeedbackEmail = async (req: AuthRequest, res: Response) => {
  try {
    const prospectId = cleanString(req.params.prospectId);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }

    const prospect = await Prospect.findById(prospectId);
    if (!prospect) {
      return res.status(404).json({ message: 'Prospect not found.' });
    }

    const emailAddress = prospect.contact?.email;
    if (!emailAddress) {
      return res.status(400).json({ message: 'Prospect has no contact email.' });
    }

    const html = buildFeedbackEmailHtml(prospectId);
    const result = await sendEmailResend([emailAddress], 'Thank you for connecting with Colin & Colin Legal Solutions', html);

    const feedback = await ProspectFeedback.findOne({ prospectId });
    if (feedback) {
      feedback.feedbackEmailSentAt = result.ok ? new Date() : undefined as any;
      await feedback.save();
    }

    if (!result.ok) {
      return res.status(500).json({ message: result.error });
    }

    return res.json({ message: 'Feedback email sent successfully.' });
  } catch (error) {
    console.error('triggerProspectFeedbackEmail error:', error);
    return res.status(500).json({ message: 'Failed to send feedback email.' });
  }
};

export const publicSubmitProspectFeedback = async (req: Request, res: Response) => {
  try {
    const prospectId = cleanString(req.params?.prospectId);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }

    const feedback = await ProspectFeedback.findOne({ prospectId });
    if (!feedback) {
      await ProspectFeedback.create({
        prospectId,
        primaryReasonCategory: cleanString(req.body?.primaryReasonCategory) || undefined,
        primaryReasonDetail: cleanString(req.body?.primaryReasonDetail) || undefined,
        clientComment: cleanString(req.body?.clientComment) || undefined,
      } as any);
    } else {
      feedback.primaryReasonCategory = cleanString(req.body?.primaryReasonCategory) as any;
      feedback.primaryReasonDetail = cleanString(req.body?.primaryReasonDetail) as any;
      feedback.clientComment = cleanString(req.body?.clientComment) as any;
      await feedback.save();
    }

    return res.json({ message: 'Feedback submitted.' });
  } catch (error) {
    console.error('publicSubmitProspectFeedback error:', error);
    return res.status(500).json({ message: 'Failed to submit feedback.' });
  }
};

export const googleFormWebhook = async (req: Request, res: Response) => {
  try {
    const prospectId = cleanString(req.body?.prospectId || req.body?.prospect_id);
    const primaryReason = cleanString(req.body?.primaryReason || req.body?.primary_reason);
    const clientComment = cleanString(req.body?.clientComment || req.body?.client_comment);

    if (!prospectId || !mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }

    const feedback = await ProspectFeedback.findOne({ prospectId });
    if (!feedback) {
      await ProspectFeedback.create({
        prospectId,
        primaryReasonCategory: primaryReason || undefined,
        clientComment: clientComment || undefined,
      } as any);
    } else {
      if (primaryReason) {
        feedback.primaryReasonCategory = primaryReason as any;
      }
      if (clientComment) {
        feedback.clientComment = clientComment as any;
      }
      await feedback.save();
    }

    return res.json({ message: 'Google Form feedback received.' });
  } catch (error) {
    console.error('googleFormWebhook error:', error);
    return res.status(500).json({ message: 'Failed to process Google Form feedback.' });
  }
};
