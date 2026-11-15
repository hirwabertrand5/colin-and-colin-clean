import mongoose from 'mongoose';
import EmailDelivery from '../models/emailDeliveryModel';
import { brandedEmail, emailAction, emailDate, emailParagraph } from './emailBranding';
import { ARTICLES_GROUPS, CLIENT_FIELDS, MATTER_FIELDS, PARTY_EXTRA_FIELDS, SHAREHOLDER_FIELDS, INTAKE_SERVICES } from '../config/digitalIntakeSchema';

export const escapeIntakeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const section = (title: string, values: any, fields: Array<{ key: string; label: string }>) => `<h3>${escapeIntakeHtml(title)}</h3><table style="width:100%;border-collapse:collapse;table-layout:fixed">${fields.filter(f => values?.[f.key] !== undefined && values[f.key] !== '').map(f => `<tr><th scope="row" style="width:42%;text-align:left;vertical-align:top;padding:7px;border-bottom:1px solid #ddd;font-size:12px;line-height:1.7;color:#64748b;overflow-wrap:anywhere;word-wrap:break-word;word-break:break-word">${escapeIntakeHtml(f.label)}</th><td style="padding:7px;border-bottom:1px solid #ddd;white-space:pre-wrap;font-size:13px;line-height:1.7;vertical-align:top;overflow-wrap:anywhere;word-wrap:break-word;word-break:break-word">${escapeIntakeHtml(values[f.key])}</td></tr>`).join('')}</table>`;
export const buildIntakeSummaryEmail = (submission: any, files: any[], reviewUrl: string) => {
  const f = submission.form;
  const service = INTAKE_SERVICES.find(s => s.id === f.serviceId);
  return brandedEmail({ title: 'Client intake received', eyebrow: 'INTAKE SUBMISSION', preheader: `${submission.reference} · ${f.client.name}`, bodyHtml: `<div><p><strong>${escapeIntakeHtml(submission.reference)}</strong> · ${escapeIntakeHtml(submission.submittedAt.toISOString())}</p><p>${escapeIntakeHtml(service?.path.map(p => p.label).join(' › '))}</p>${section('Client', f.client, [...CLIENT_FIELDS, { key: 'type', label: 'Client type' }, { key: 'identityType', label: 'Identity document' }, { key: 'registrationStatus', label: 'Registration status' }])}${f.parties.map((p: any, i: number) => section(`Relevant party ${i + 1}`, p, [...CLIENT_FIELDS, ...PARTY_EXTRA_FIELDS])).join('')}${section('Legal matter', f.matter, MATTER_FIELDS)}${f.questionnaireId ? ARTICLES_GROUPS.map(g => section(g.title, f.answers, g.questions)).join('') + f.shareholders.map((s: any, i: number) => section(`Shareholder ${i + 1}`, s, SHAREHOLDER_FIELDS)).join('') : ''}<h3>Documents</h3><ul>${files.map(file => `<li>${escapeIntakeHtml(file.section)}: ${escapeIntakeHtml(file.name)}</li>`).join('')}</ul><p>Documents remain in the secure workspace.</p>${emailAction('Review submission', reviewUrl)}</div>`, note: 'Client-supplied information. Review and verify it in the workspace. Supporting documents remain protected in the application.' });
};

export const buildIntakeInvitationEmail = ({ name, message, url, expiresAt, contact = '' }: { name: string; message: string; url: string; expiresAt: Date | string; contact?: string }) => brandedEmail({
  title: 'Your secure intake form', eyebrow: 'CLIENT INTAKE', preheader: 'Tell us how we can help. Your private intake form is ready.',
  bodyHtml: emailParagraph(name ? `Dear ${name},` : 'Hello,') + emailParagraph(message)
    + emailAction('Complete intake form', url)
    + `<div style="padding:17px 19px;background:#f7f5f0;border-left:3px solid #bea580;margin:22px 0"><p style="font-size:13px;line-height:1.7;color:#334155;margin:0"><strong>Your link is available until</strong><br>${escapeIntakeHtml(emailDate(expiresAt))}</p></div>`
    + emailParagraph('Have your National ID or passport ready. For an existing business, also prepare its registration certificate. You can save your progress and return using the same private link.')
    + (contact ? emailParagraph(contact) : '')
    + `<p style="font-size:12px;line-height:1.7;color:#657184;margin:22px 0 0">If the button does not open, copy this address into your browser:<br><a href="${escapeIntakeHtml(url)}" style="color:#405575;word-break:break-all;overflow-wrap:anywhere">${escapeIntakeHtml(url)}</a></p>`,
  note: 'Please keep this invitation private. Submitting the form does not establish an attorney–client relationship. Contact the firm directly about urgent deadlines.',
});

export const buildIntakeReceiptEmail = (submission: any) => brandedEmail({
  title: 'We have received your enquiry', eyebrow: 'ENQUIRY RECEIVED', preheader: `Your enquiry has been received. Reference: ${submission.reference}.`,
  bodyHtml: emailParagraph(`Dear ${submission.form.client.name},`)
    + emailParagraph('Thank you for sharing your information with us. Your intake form and supporting documents have been received securely.')
    + `<div style="padding:20px;background:#f7f5f0;border-left:3px solid #bea580;margin:24px 0"><p style="font-size:11px;letter-spacing:1px;color:#7c6b51;margin:0 0 8px">YOUR ENQUIRY REFERENCE</p><strong style="font-size:20px;color:#16254a">${escapeIntakeHtml(submission.reference)}</strong><p style="font-size:12px;color:#657184;margin:10px 0 0">${escapeIntakeHtml(emailDate(submission.submittedAt))}</p></div>`
    + emailParagraph('Our team will review your enquiry and contact you about the next step. If we need further details or documents, we will send you a secure reply link.')
    + emailParagraph('Please include your enquiry reference in any correspondence with the firm.'),
  note: 'Submitting an enquiry does not establish an attorney–client relationship. Contact the firm directly about urgent deadlines.',
});

export const buildIntakeClarificationEmail = ({ name, reference, message, url, expiresAt }: { name: string; reference: string; message: string; url: string; expiresAt: Date | string }) => brandedEmail({
  title: 'A little more information', eyebrow: 'YOUR ENQUIRY', preheader: `Additional information requested for ${reference}.`,
  bodyHtml: emailParagraph(`Dear ${name},`) + emailParagraph(`We are reviewing your enquiry (${reference}). Please help us with the following information:`)
    + `<div style="padding:18px 20px;background:#f7f5f0;border-left:3px solid #bea580;margin:22px 0">${emailParagraph(message)}</div>`
    + emailAction('Reply securely', url) + emailParagraph('Use the secure reply page to send your response and attach any requested documents.')
    + emailParagraph(`Your reply link is available until ${emailDate(expiresAt)}.`),
  note: 'Keep this link private. Contact the firm directly if your enquiry involves an urgent deadline.',
});

// Enqueued in the same transaction as the submission. Unique keys prevent double receipts.
export const queueIntakeSubmissionEmails = async (submission: any, link: any, files: any[], settings: any, origin: string, session: mongoose.ClientSession) => {
  const recipients = [settings.notificationEmail || 'info@colinandcolin.com'];
  const summary = buildIntakeSummaryEmail(submission, files, `${origin}/matters/intake-prospects?submission=${submission._id}`);
  const receipt = buildIntakeReceiptEmail(submission);
  const messages = [...recipients.map(to => ({ to, kind: 'summary', subject: `Intake received: ${submission.reference}`, html: summary })), { to: submission.form.client.email, kind: 'receipt', subject: `Your enquiry reference: ${submission.reference}`, html: receipt }];
  await EmailDelivery.create(messages.map(message => ({ key: `intake:${submission._id}:${message.kind}:${message.to}`, intakeLinkId: link._id, category: 'intake', to: message.to, subject: message.subject, html: message.html, status: 'pending', nextAttemptAt: new Date() })), { session, ordered: true });
};
