import mongoose from 'mongoose';
import EmailDelivery from '../models/emailDeliveryModel';
import { ARTICLES_GROUPS, CLIENT_FIELDS, MATTER_FIELDS, PARTY_EXTRA_FIELDS, SHAREHOLDER_FIELDS, INTAKE_SERVICES } from '../config/digitalIntakeSchema';

export const escapeIntakeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const section = (title: string, values: any, fields: Array<{ key: string; label: string }>) => `<h3>${escapeIntakeHtml(title)}</h3><table style="width:100%;border-collapse:collapse">${fields.filter(f => values?.[f.key] !== undefined && values[f.key] !== '').map(f => `<tr><th style="text-align:left;vertical-align:top;padding:7px;border-bottom:1px solid #ddd">${escapeIntakeHtml(f.label)}</th><td style="padding:7px;border-bottom:1px solid #ddd;white-space:pre-wrap">${escapeIntakeHtml(values[f.key])}</td></tr>`).join('')}</table>`;
export const buildIntakeSummaryEmail = (submission: any, files: any[], reviewUrl: string) => {
  const f = submission.form;
  const service = INTAKE_SERVICES.find(s => s.id === f.serviceId);
  return `<div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;color:#173a44"><h2>Client intake received</h2><p><strong>${escapeIntakeHtml(submission.reference)}</strong> · ${escapeIntakeHtml(submission.submittedAt.toISOString())}</p><p>${escapeIntakeHtml(service?.path.map(p => p.label).join(' › '))}</p>${section('Client', f.client, [...CLIENT_FIELDS, { key: 'type', label: 'Client type' }, { key: 'identityType', label: 'Identity document' }, { key: 'registrationStatus', label: 'Registration status' }])}${f.parties.map((p: any, i: number) => section(`Relevant party ${i + 1}`, p, [...CLIENT_FIELDS, ...PARTY_EXTRA_FIELDS])).join('')}${section('Legal matter', f.matter, MATTER_FIELDS)}${f.questionnaireId ? ARTICLES_GROUPS.map(g => section(g.title, f.answers, g.questions)).join('') + f.shareholders.map((s: any, i: number) => section(`Shareholder ${i + 1}`, s, SHAREHOLDER_FIELDS)).join('') : ''}<h3>Documents</h3><ul>${files.map(file => `<li>${escapeIntakeHtml(file.section)}: ${escapeIntakeHtml(file.name)}</li>`).join('')}</ul><p>Documents remain in the secure workspace.</p><p><a href="${escapeIntakeHtml(reviewUrl)}">Review submission</a></p></div>`;
};

// Enqueued in the same transaction as the submission. Unique keys prevent double receipts.
export const queueIntakeSubmissionEmails = async (submission: any, link: any, files: any[], settings: any, origin: string, session: mongoose.ClientSession) => {
  const recipients = [settings.notificationEmail || 'info@colinandcolin.com'];
  const summary = buildIntakeSummaryEmail(submission, files, `${origin}/matters/intake-prospects?submission=${submission._id}`);
  const receipt = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2>Thank you, ${escapeIntakeHtml(submission.form.client.name)}</h2><p>Colin & Colin has received your enquiry.</p><p>Your reference: <strong>${escapeIntakeHtml(submission.reference)}</strong></p><p>Our team will review your information and contact you about the next step. Please use this reference in future correspondence.</p><p>Submitting an enquiry does not establish an attorney–client relationship. Contact the firm directly about urgent deadlines.</p></div>`;
  const messages = [...recipients.map(to => ({ to, kind: 'summary', subject: `Intake received: ${submission.reference}`, html: summary })), { to: submission.form.client.email, kind: 'receipt', subject: `Your enquiry reference: ${submission.reference}`, html: receipt }];
  await EmailDelivery.create(messages.map(message => ({ key: `intake:${submission._id}:${message.kind}:${message.to}`, intakeLinkId: link._id, category: 'intake', to: message.to, subject: message.subject, html: message.html, status: 'pending', nextAttemptAt: new Date() })), { session, ordered: true });
};
