import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { sendEmailResend } from '../services/emailResendService';
import { buildNotificationEmail } from '../services/notificationTemplateService';

export const sendTestEmail = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.email) return res.status(401).json({ message: 'Unauthorized.' });

    const to = req.body?.to ? String(req.body.to).trim() : req.user.email;

    const result = await sendEmailResend(
      [to],
      'Colin & Colin — Email Test',
      buildNotificationEmail({ title: 'Email connection test', message: `This is a requested test from Colin & Colin Legal Solutions.\nRequested by: ${req.user.name} (${req.user.email}).` })
    );

    if (!result.ok) return res.status(500).json({ message: `Email failed: ${result.error}` });

    return res.json({ message: `Email sent to ${to}.`, id: result.id });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || 'Failed to send test email.' });
  }
};
