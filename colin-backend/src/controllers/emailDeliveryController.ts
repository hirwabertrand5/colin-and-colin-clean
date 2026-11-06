import { Request, Response } from 'express';
import { Resend } from 'resend';
import EmailDelivery from '../models/emailDeliveryModel';
import EmailWebhook from '../models/emailWebhookModel';
import Notification from '../models/notificationModel';
import { getEmailConfiguration } from '../services/emailResendService';
import { notificationEmailEnabled } from '../services/notificationPolicy';

export const getEmailDeliveryStatus = async (_req: Request, res: Response) => {
  const counts = await EmailDelivery.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  const recent = await EmailDelivery.find().sort({ updatedAt: -1 }).limit(30).select('to subject status attempts lastCode lastError updatedAt').lean();
  const queueErrors = await Notification.countDocuments({ emailQueueState: 'failed' });
  res.json({ configuration: getEmailConfiguration(), enabled: notificationEmailEnabled(), webhookConfigured: Boolean(process.env.RESEND_WEBHOOK_SECRET), queueErrors, counts, recent });
};

export const receiveEmailWebhook = async (req: Request, res: Response) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ message: 'Webhook signing secret is not configured.' });
  let event: any;
  try {
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ message: 'Raw request body required.' });
    event = new Resend(process.env.RESEND_API_KEY || 'webhook-verification-only').webhooks.verify({ payload: req.body.toString('utf8'), headers: {
      id: String(req.headers['svix-id'] || ''), timestamp: String(req.headers['svix-timestamp'] || ''), signature: String(req.headers['svix-signature'] || ''),
    }, webhookSecret: secret });
  } catch { return res.status(400).json({ message: 'Invalid webhook signature.' }); }
  const statuses: Record<string, string> = { 'email.delivered': 'delivered', 'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed' };
  const status = statuses[event.type];
  if (!status || !event.data?.email_id) return res.sendStatus(204);
  const occurredAt = new Date(event.created_at);
  if (!Number.isFinite(occurredAt.getTime())) return res.status(400).json({ message: 'Invalid webhook timestamp.' });
  await EmailWebhook.updateOne({ eventId: String(req.headers['svix-id']) }, { $setOnInsert: {
    eventId: String(req.headers['svix-id']), providerId: event.data.email_id, status, occurredAt,
  } }, { upsert: true }).catch((error: any) => { if (error.code !== 11000) throw error; });
  return res.sendStatus(204);
};
