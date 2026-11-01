import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import { ClientIntakeAttachment as Attachment, ClientIntakeLink as Link, ClientIntakeSubmission as Submission, ClientIntakeSettings as Settings } from '../models/digitalIntakeModel';
import User from '../models/userModel';
import Prospect from '../models/prospectModel';
import Case from '../models/caseModel';
import AuditLog from '../models/auditLogModel';
import { INTAKE_SERVICES, DEFAULT_NOTICE, QUESTIONNAIRES, OFFICIAL_USE_FIELDS, INTAKE_CONFIRMATION } from '../config/digitalIntakeSchema';
import { IntakeError, textValue, validateEmail, serviceById, validateIntakeForm } from './digitalIntakeValidation';
import { createProspectRecord } from '../controllers/prospectController';
import { notifyUsersById } from './notifyService';
import { getEmailConfiguration, sendEmailResend } from './emailResendService';
import { storeRestrictedUpload, deleteRestrictedUpload } from './fileStorageService';
import { caseMatchesAssignee } from '../utils/caseAssignments';

export const INTAKE_MANAGERS = ['managing_director', 'managing_partner', 'executive_managing_partner', 'executive_assistant', 'senior_partner', 'partner', 'executive_partner', 'associate_partner', 'executive_associate_partner', 'originating_attorney'];
export const INTAKE_STAFF = [...INTAKE_MANAGERS, 'senior_associate', 'associate', 'senior_executive_assistant', 'trainee_associate', 'intern'];
export const canManageIntake = (req: AuthRequest) => INTAKE_MANAGERS.includes(req.user?.role || '');
export const intakeHash = (token: string) => createHash('sha256').update(token).digest('hex');
const tokenValue = () => randomBytes(32).toString('base64url');
const idValue = (value: unknown) => {
  const id = textValue(value, 24, true);
  if (!mongoose.isValidObjectId(id)) throw new IntakeError(400, 'Invalid record reference.');
  return id;
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const DEFAULT_PUBLIC_CLIENT_ORIGIN = 'https://colin-and-colin.vercel.app';
export const publicClientOrigin = () => {
  // Use the frontend address confirmed by the firm. Explicit configuration may
  // override it; an older custom domain or preview must not replace the default.
  const explicit = String(process.env.PUBLIC_CLIENT_URL || '').trim();
  let url: URL;
  try {
    const legacy = String(process.env.CLIENT_URL || '').trim();
    let useLegacy = false;
    if (!explicit && legacy) {
      const candidate = new URL(legacy);
      useLegacy = candidate.origin === DEFAULT_PUBLIC_CLIENT_ORIGIN || (process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(candidate.hostname));
    }
    url = new URL(explicit || (useLegacy ? legacy : DEFAULT_PUBLIC_CLIENT_ORIGIN));
  } catch { throw new IntakeError(503, 'The public intake address is invalid. An administrator must set PUBLIC_CLIENT_URL to the frontend HTTPS address.', 'PUBLIC_URL_INVALID'); }
  if (url.username || url.password || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new IntakeError(503, 'The public intake address must use HTTPS. An administrator must correct PUBLIC_CLIENT_URL.', 'PUBLIC_URL_INVALID');
  return url.origin;
};
const publicUrl = (token: string, correction = false) => `${publicClientOrigin()}/intake/${correction ? 'clarification' : 'form'}/${token}`;
const reference = (prefix: string) => `${prefix}-${new Date().getUTCFullYear()}-${randomBytes(6).toString('hex').toUpperCase()}`;
const scope = (req: AuthRequest): any => canManageIntake(req) ? {} : { $or: ['createdBy', 'responsiblePartner', 'responsibleAssociate', 'assignedTo'].map(field => ({ [field]: req.user!.id })) };
export const authorizedIntakeLink = async (id: unknown, req: AuthRequest, session: mongoose.ClientSession | null = null, includeDeleted = false) => {
  const link = await Link.findOne({ _id: idValue(id), ...scope(req), ...(includeDeleted ? {} : { deletedAt: null }) }).session(session);
  if (!link) throw new IntakeError(404, 'Intake record not found.');
  return link;
};
const audit = async (req: AuthRequest, action: string, link: any, submission?: any, note = '', session: mongoose.ClientSession | null = null) => {
  await AuditLog.create([{
    caseId: new mongoose.Types.ObjectId('000000000000000000000000'),
    intakeLinkId: link._id, ...(submission ? { intakeSubmissionId: submission._id } : {}),
    ...(req.user?.id ? { actorUserId: new mongoose.Types.ObjectId(req.user.id) } : {}), actorName: req.user?.name || 'Client intake portal',
    action: action as any, message: action.replace(/_/g, ' '), detail: `${submission?.reference || link.reference}${note ? ` • ${note}` : ''}`,
  }], { session });
};
export const linkStatus = (link: any) => link.submittedAt ? 'Submitted' : link.revokedAt ? 'Revoked' : +new Date(link.expiresAt) <= Date.now() ? 'Expired' : link.openedAt ? 'Opened' : 'Pending';
const safeLink = (link: any) => {
  const out = typeof link.toObject === 'function' ? link.toObject() : { ...link };
  delete out.tokenHash;
  return { ...out, status: linkStatus(link) };
};
const officialFields = (body: any) => Object.fromEntries(OFFICIAL_USE_FIELDS.map(question => {
  const value = textValue(body[question.key], 500);
  if (question.type === 'date' && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new IntakeError(400, 'Enter a valid consultation or record date.');
  return [question.key, value];
}));
const assignmentFields = async (payload: any, required = false) => {
  const out: any = {};
  for (const field of ['responsiblePartner', 'responsibleAssociate', 'assignedTo']) {
    const raw = payload[field];
    if (!raw && !required) { out[field] = null; continue; }
    const id = idValue(raw);
    if (!await User.exists({ _id: id, isActive: { $ne: false } })) throw new IntakeError(400, 'Select active staff members for all assignments.');
    out[field] = new mongoose.Types.ObjectId(id);
  }
  return out;
};
export const getIntakeSettings = async (): Promise<any> => (await Settings.findOne({ key: 'portal' }).lean<any>()) || {
  key: 'portal', noticeText: DEFAULT_NOTICE, noticeVersion: 'draft-1', privacyContact: '', retentionPolicy: '', noticeApproved: false, defaultExpiryDays: 7,
};
export const updateIntakeSettings = async (payload: any, req: AuthRequest) => {
  if (!canManageIntake(req)) throw new IntakeError(403, 'Management approval is required to publish the privacy notice.');
  const noticeText = textValue(payload.noticeText, 15000, true);
  const noticeVersion = textValue(payload.noticeVersion, 100, true);
  const privacyContact = textValue(payload.privacyContact, 500, true);
  const retentionPolicy = textValue(payload.retentionPolicy, 3000, true);
  const defaultExpiryDays = Number(payload.defaultExpiryDays || 7);
  if (!Number.isInteger(defaultExpiryDays) || defaultExpiryDays < 1 || defaultExpiryDays > 30) throw new IntakeError(400, 'Expiry must be between 1 and 30 days.');
  const previous = await getIntakeSettings();
  if (previous.noticeApproved && previous.noticeVersion === noticeVersion && (previous.noticeText !== noticeText || previous.privacyContact !== privacyContact || previous.retentionPolicy !== retentionPolicy)) throw new IntakeError(400, 'Use a new notice version when changing approved privacy wording.');
  const setting = await Settings.findOneAndUpdate({ key: 'portal' }, { $set: {
    noticeText, noticeVersion, privacyContact, retentionPolicy, defaultExpiryDays,
    noticeApproved: payload.noticeApproved === true, approvedBy: req.user!.id, approvedAt: new Date(),
  } }, { upsert: true, returnDocument: 'after', runValidators: true });
  await audit(req, 'INTAKE_NOTICE_UPDATED', { _id: undefined, reference: noticeVersion });
  return setting;
};
export const getIntakeDeliveryConfiguration = () => {
  let publicUrl: { configured: boolean; origin?: string; message: string };
  try { publicUrl = { configured: true, origin: publicClientOrigin(), message: 'Public invitation address configured.' }; }
  catch (error: any) { publicUrl = { configured: false, message: error.message }; }
  return { email: getEmailConfiguration(), publicUrl };
};
export const generateIntakeLink = async (payload: any, req: AuthRequest) => {
  const settings = await getIntakeSettings();
  if (!settings.noticeApproved) throw new IntakeError(409, 'Management must approve the intake privacy notice and retention statement first.', 'NOTICE_APPROVAL_REQUIRED');
  const assignments = await assignmentFields(payload);
  const service = serviceById(payload.serviceId);
  const questionnaireId = textValue(payload.questionnaireId, 100);
  if (questionnaireId && !QUESTIONNAIRES.some(q => q.id === questionnaireId && service?.path.some(p => q.serviceIds.includes(p.id)))) throw new IntakeError(400, 'Choose a questionnaire applicable to the selected service.');
  const days = Number(payload.expiryDays ?? settings.defaultExpiryDays);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new IntakeError(400, 'Link expiry must be between 1 and 30 days.');
  const token = tokenValue();
  const url = publicUrl(token);
  const link = await Link.create({ ...assignments, reference: reference('INL'), tokenHash: intakeHash(token), createdBy: req.user!.id,
    clientName: textValue(payload.clientName, 300), clientEmail: validateEmail(payload.clientEmail),
    serviceId: service?.id || '', questionnaireId, introduction: textValue(payload.introduction, 2000), expiresAt: new Date(Date.now() + days * 86400000),
    notice: { version: settings.noticeVersion, text: settings.noticeText, contact: settings.privacyContact, retention: settings.retentionPolicy, approvedBy: settings.approvedBy, approvedAt: settings.approvedAt },
  });
  await audit(req, 'INTAKE_LINK_GENERATED', link);
  return { link: safeLink(link), url, token };
};
export const listIntakeLinks = async (req: AuthRequest) => {
  const links = await Link.find({ ...scope(req), deletedAt: null }).sort({ createdAt: -1, _id: -1 }).populate('assignedTo responsiblePartner responsibleAssociate', 'name').lean();
  return links.map(safeLink);
};
export const deleteIntakeLink = async (id: unknown, req: AuthRequest) => {
  const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
    const link = await authorizedIntakeLink(id, req, session);
    link.deletedAt = new Date(); link.deletedBy = req.user!.id; link.revokedAt = new Date();
    await link.save({ session });
    // Keep received submissions, attachments and prospect relationships intact.
    await audit(req, 'INTAKE_LINK_DELETED', link, undefined, '', session);
  }); } finally { await session.endSession(); }
  return { deleted: true };
};
export const changeIntakeLink = async (id: unknown, action: 'revoke' | 'regenerate', req: AuthRequest) => {
  const link = await authorizedIntakeLink(id, req);
  if (link.submittedAt) throw new IntakeError(409, 'This invitation has already been submitted. Use an additional-information request for clarification.');
  let token: string | undefined;
  let url: string | undefined;
  if (action === 'revoke') link.revokedAt = new Date();
  else {
    token = tokenValue(); url = publicUrl(token);
    link.tokenHash = intakeHash(token); link.tokenVersion += 1; link.revokedAt = undefined; link.openedAt = undefined;
    link.emailStatus = undefined; link.emailFailureCode = undefined;
    link.expiresAt = new Date(Date.now() + Number((await getIntakeSettings()).defaultExpiryDays || 7) * 86400000);
  }
  await link.save();
  await audit(req, action === 'revoke' ? 'INTAKE_LINK_REVOKED' : 'INTAKE_LINK_REGENERATED', link);
  return { link: safeLink(link), ...(token ? { token, url } : {}) };
};
export const sendIntakeInvitation = async (id: unknown, rawToken: unknown, req: AuthRequest) => {
  const link = await authorizedIntakeLink(id, req);
  if (!['Pending', 'Opened'].includes(linkStatus(link))) throw new IntakeError(409, 'This link cannot be sent in its current status.');
  const token = textValue(rawToken, 100, true);
  const stored: any = await Link.findById(link._id).select('+tokenHash').lean<any>();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !timingSafeEqual(Buffer.from(intakeHash(token)), Buffer.from(stored.tokenHash))) throw new IntakeError(400, 'Regenerate the link to obtain a new copy before sending.');
  if (!link.clientEmail) throw new IntakeError(400, 'This invitation needs a client email address.');
  const url = publicUrl(token);
  if (link.emailStatus === 'Sent' && link.sentTokenVersion === link.tokenVersion) return { sent: true, message: 'This invitation has already been sent. You can still copy and share its link.' };
  const result = await sendEmailResend([link.clientEmail], 'Your secure Colin & Colin intake form', `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#102c36"><h2>Colin & Colin Legal Solutions</h2><p>Hello ${escapeHtml(link.clientName || 'there')},</p><p>${escapeHtml(link.introduction || 'Please complete our secure intake form so our team can review your enquiry.')}</p><p><a href="${escapeHtml(url)}">Open your secure intake form</a></p><p>Expires: ${new Date(link.expiresAt).toISOString().slice(0, 10)}. Please keep this link private.</p><p>${escapeHtml(link.notice.contact || '')}</p><p>Submitting the form does not establish an attorney–client relationship.</p></div>`, { idempotencyKey: `intake-invitation/${link._id}/${link.tokenVersion}` });
  link.emailStatus = result.ok ? 'Sent' : 'Failed'; link.emailFailureCode = result.ok ? undefined : result.code; if (result.ok) { link.sentAt = new Date(); link.sentTokenVersion = link.tokenVersion; } await link.save();
  await audit(req, result.ok ? 'INTAKE_LINK_SENT' : 'INTAKE_EMAIL_FAILED', link);
  return result.ok ? { sent: true, message: 'Invitation accepted by the email provider. Check the recipient?s inbox and spam folder.' } : { sent: false, code: result.code, retryable: result.retryable, message: result.error };
};
export const resolvePublicIntakeLink = async (token: string, session: mongoose.ClientSession | null = null) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new IntakeError(404, 'This intake link is invalid.', 'INVALID_LINK');
  const link = await Link.findOne({ tokenHash: intakeHash(token), deletedAt: null }).session(session);
  if (!link) throw new IntakeError(404, 'This intake link is invalid.', 'INVALID_LINK');
  if (link.revokedAt) throw new IntakeError(410, 'This intake link has been revoked. Please contact the firm.', 'REVOKED_LINK');
  if (+new Date(link.expiresAt) <= Date.now()) throw new IntakeError(410, 'This intake link has expired. Please request a new link.', 'EXPIRED_LINK');
  return link;
};
export const publicIntakeDetails = async (token: string) => {
  const link = await resolvePublicIntakeLink(token);
  if (link.submittedAt) throw new IntakeError(409, 'Your form has already been submitted. Please contact the firm for any changes.', 'ALREADY_SUBMITTED');
  await Link.updateOne({ _id: link._id, openedAt: { $exists: false } }, { $set: { openedAt: new Date() } });
  return { expiresAt: link.expiresAt, introduction: link.introduction, serviceId: link.serviceId, questionnaireId: link.questionnaireId,
    notice: { version: link.notice.version, text: link.notice.text, contact: link.notice.contact, retention: link.notice.retention },
    // Intended recipient identity and all staff fields stay internal.
    services: INTAKE_SERVICES, questionnaires: QUESTIONNAIRES };
};
const assertUploadFile = (file: Express.Multer.File) => {
  const extension = file.originalname.split('.').pop()?.toLowerCase();
  const b = file.buffer;
  const valid = extension === 'pdf' && file.mimetype === 'application/pdf' && b.subarray(0, 5).toString() === '%PDF-'
    || ['jpg', 'jpeg'].includes(extension || '') && file.mimetype === 'image/jpeg' && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    || extension === 'png' && file.mimetype === 'image/png' && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    || extension === 'doc' && file.mimetype === 'application/msword' && b.subarray(0, 8).equals(Buffer.from([208,207,17,224,161,177,26,225]))
    || extension === 'docx' && file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && b.subarray(0, 2).toString() === 'PK' && b.includes(Buffer.from('word/')) && b.includes(Buffer.from('[Content_Types].xml'));
  if (!valid || !file.size || file.size > 10 * 1048576) throw new IntakeError(400, 'Upload a valid PDF, DOC, DOCX, JPG or PNG file up to 10 MB.');
};
export const uploadIntakeAttachment = async (token: string, file: Express.Multer.File | undefined, section: unknown) => {
  if (!file) throw new IntakeError(400, 'Select a supporting document.');
  assertUploadFile(file);
  const link = await resolvePublicIntakeLink(token);
  const reserved = await Link.findOneAndUpdate({ _id: link._id, tokenVersion: link.tokenVersion, submittedAt: { $exists: false }, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() }, uploadCount: { $lt: 20 }, uploadBytes: { $lte: 100 * 1048576 - file.size } }, { $inc: { uploadCount: 1, uploadBytes: file.size } }, { returnDocument: 'after' });
  if (!reserved) throw new IntakeError(409, 'This invitation cannot accept more documents (maximum 20 files / 100 MB).');
  let storageId: string | undefined;
  try {
    storageId = await storeRestrictedUpload(file, String(link._id));
    const attachment = await Attachment.create({ linkId: link._id, tokenVersion: link.tokenVersion, storageId, name: textValue(file.originalname.replace(/[\\/]/g, '_'), 255, true), size: file.size, mimeType: file.mimetype, section: textValue(section, 100) });
    return { _id: attachment._id, name: attachment.name, size: attachment.size, section: attachment.section };
  } catch (error) {
    if (storageId) await deleteRestrictedUpload(storageId).catch(() => {});
    await Link.updateOne({ _id: link._id }, { $inc: { uploadCount: -1, uploadBytes: -file.size } });
    throw error;
  }
};
export const removeIntakeAttachment = async (token: string, id: unknown) => {
  const link = await resolvePublicIntakeLink(token);
  // Serialize against final submission so a submitted document cannot be removed.
  const session = await mongoose.startSession();
  let storageId = '';
  try { await session.withTransaction(async () => {
    const locked = await Link.findOneAndUpdate({ _id: link._id, tokenVersion: link.tokenVersion, submittedAt: { $exists: false }, revokedAt: { $exists: false } }, { $inc: { uploadCount: -1 } }, { session, returnDocument: 'after' });
    if (!locked) throw new IntakeError(409, 'The form is no longer open for editing.');
    const file = await Attachment.findOneAndDelete({ _id: idValue(id), linkId: link._id, tokenVersion: link.tokenVersion, submissionId: null }).session(session).select('+storageId');
    if (!file) throw new IntakeError(404, 'Document not found.');
    storageId = file.storageId;
    await Link.updateOne({ _id: link._id }, { $inc: { uploadBytes: -file.size } }, { session });
  }); } finally { await session.endSession(); }
  await deleteRestrictedUpload(storageId).catch(() => {});
};
export const submitIntakeForm = async (token: string, body: any) => {
  const session = await mongoose.startSession();
  let saved: any; let linkDoc: any; let createdNow = false;
  try { await session.withTransaction(async () => {
    createdNow = false;
    const link = await resolvePublicIntakeLink(token, session); linkDoc = link;
    if (link.submittedAt) { saved = await Submission.findOne({ linkId: link._id }).session(session); return; }
    const form = validateIntakeForm(body, link);
    const ids = Array.isArray(body.documentIds) ? body.documentIds.map(idValue) : [];
    if (new Set(ids).size !== ids.length || ids.length > 20) throw new IntakeError(400, 'Document references are invalid.');
    const files = await Attachment.find({ _id: { $in: ids }, linkId: link._id, tokenVersion: link.tokenVersion, submissionId: null }).session(session);
    if (files.length !== ids.length) throw new IntakeError(400, 'A document does not belong to this invitation.');
    const submission = new Submission({ reference: reference('INT'), linkId: link._id, form, submittedAt: new Date(),
      noticeAcknowledgment: body.confirmationVersion === INTAKE_CONFIRMATION.version
        ? { kind: 'enquiry-confirmation', ...INTAKE_CONFIRMATION, at: new Date() }
        : { kind: 'notice', version: link.notice.version, text: link.notice.text, contact: link.notice.contact, retention: link.notice.retention, at: new Date() }, reviewHistory: [{ action: 'Submitted', actorName: 'Client', at: new Date() }] });
    await submission.save({ session });
    // The invitation write is the concurrency boundary for uploads and final submit.
    link.submittedAt = submission.submittedAt; link.submissionId = submission._id; await link.save({ session });
    await Attachment.updateMany({ _id: { $in: ids } }, { $set: { submissionId: submission._id } }, { session });
    await audit({} as AuthRequest, 'INTAKE_SUBMISSION_RECEIVED', link, submission, '', session);
    saved = submission;
    createdNow = true;
  }); } finally { await session.endSession(); }
  const recipients = [...new Set([linkDoc.createdBy, linkDoc.assignedTo, linkDoc.responsiblePartner, linkDoc.responsibleAssociate].filter(Boolean).map(String))] as string[];
  // Notification/email delivery never rolls back a successful client submission.
  if (createdNow) await Promise.resolve().then(() => notifyUsersById({ userIds: recipients, category: 'taskAssignments', notification: { type: 'INTAKE_SUBMISSION', title: 'Client intake received', message: `${saved.reference} • ${saved.form.client.name} • ${INTAKE_SERVICES.find(s => s.id === saved.form.serviceId)?.label || 'Legal enquiry'} • ${new Date(saved.submittedAt).toISOString()}`, link: `/matters/intake-prospects?submission=${saved._id}`, dedupeKey: `intake:${saved._id}` }, email: { subject: `Intake received: ${saved.reference}`, html: `<p>A client intake submission is ready for review.</p><p>Reference: ${escapeHtml(saved.reference)}</p><p>Client: ${escapeHtml(saved.form.client.name)}</p><p>Service: ${escapeHtml(INTAKE_SERVICES.find(s => s.id === saved.form.serviceId)?.label || 'Legal enquiry')}</p><p>Received: ${new Date(saved.submittedAt).toISOString()}</p><p><a href="${publicClientOrigin()}/matters/intake-prospects?submission=${saved._id}">Review in the application</a></p>` } })).catch(() => {});
  return { reference: saved.reference, submittedAt: saved.submittedAt };
};
export const listIntakeSubmissions = async (req: AuthRequest) => {
  const links = await Link.find(scope(req)).select('_id assignedTo responsiblePartner responsibleAssociate').lean<any[]>();
  const items = await Submission.find({ linkId: { $in: links.map(l => l._id) }, deletedAt: null }).sort({ submittedAt: -1, _id: -1 }).select('reference status submittedAt prospectId linkId form.client.name form.serviceId administration.serviceId').lean<any[]>();
  const staff = await User.find({ _id: { $in: links.map(l => l.assignedTo).filter(Boolean) } }).select('name').lean();
  return items.map(item => ({ ...item, clientName: item.form?.client?.name, service: INTAKE_SERVICES.find(s => s.id === (item.administration?.serviceId || item.form?.serviceId))?.label || '', assignedStaff: staff.find(u => String(u._id) === String(links.find(l => String(l._id) === String(item.linkId))?.assignedTo))?.name || 'Unassigned', form: undefined }));
};
export const authorizedSubmission = async (id: unknown, req: AuthRequest, session: mongoose.ClientSession | null = null) => {
  const submission = await Submission.findOne({ _id: idValue(id), deletedAt: null }).session(session);
  if (!submission) throw new IntakeError(404, 'Submission not found.');
  let link: any;
  try { link = await authorizedIntakeLink(String(submission.linkId), req, session, true); }
  catch (error) {
    const matters = await Case.find({ intakeSubmissionId: submission._id }).select('assignedTo caseAssignments').session(session).lean();
    if (!matters.some(matter => caseMatchesAssignee(matter, req.user!.name) || caseMatchesAssignee(matter, req.user!.email))) throw error;
    link = await Link.findById(submission.linkId).session(session);
    if (!link) throw new IntakeError(404, 'Intake record not found.');
  }
  return { submission, link };
};
export const deleteIntakeSubmission = async (id: unknown, req: AuthRequest) => {
  const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
    const { submission, link } = await authorizedSubmission(id, req, session);
    if (submission.status === 'Accepted' || submission.prospectId) throw new IntakeError(409, 'Accepted submissions are retained with their linked prospect and cannot be deleted.');
    // Use invitation permissions, rather than the later matter-team read permission.
    await authorizedIntakeLink(String(link._id), req, session, true);
    submission.deletedAt = new Date(); submission.deletedBy = req.user!.id;
    submission.clarificationHash = undefined; submission.clarificationExpiresAt = undefined;
    submission.reviewHistory.push({ action: 'Deleted', actorName: req.user!.name, at: new Date() });
    await submission.save({ session });
    link.deletedAt ||= new Date(); link.deletedBy ||= req.user!.id; link.revokedAt = new Date();
    await link.save({ session });
    await audit(req, 'INTAKE_SUBMISSION_DELETED', link, submission, '', session);
  }); } finally { await session.endSession(); }
  return { deleted: true };
};
const duplicateCandidates = async (submission: any, req: AuthRequest) => {
  const client = submission.form.client;
  const contacts: any[] = [];
  if (client.email) contacts.push({ 'contact.email': client.email });
  if (client.phone) contacts.push({ 'contact.phone': client.phone });
  const prospects = contacts.length ? await Prospect.find({ $or: contacts, ...(canManageIntake(req) ? {} : { $and: [{ $or: ['assignedTo', 'responsiblePartner', 'responsibleAssociate'].map(k => ({ [k]: req.user!.id })) }] }) }).select('clientName prospectNo').limit(20).lean() : [];
  const identities: any[] = [];
  for (const key of ['email', 'phone', 'tin', 'identification']) if (client[key]) identities.push({ [`form.client.${key}`]: client[key] });
  const allowedLinks = await Link.find(scope(req)).select('_id').lean();
  const submissions = identities.length ? await Submission.find({ _id: { $ne: submission._id }, deletedAt: null, linkId: { $in: allowedLinks.map(l => l._id) }, $or: identities }).select('reference form.client.name').limit(20).lean<any[]>() : [];
  const caseContacts: any[] = [];
  if (client.email) caseContacts.push({ 'clientContacts.email': client.email });
  if (client.phone) caseContacts.push({ 'clientContacts.phone': client.phone });
  const cases = caseContacts.length ? await Case.find({ $or: caseContacts }).select('caseNo parties assignedTo caseAssignments').limit(40).lean() : [];
  return [...prospects.map(p => ({ type: 'Prospect', reference: p.prospectNo, name: p.clientName })), ...submissions.map(s => ({ type: 'Submission', reference: s.reference, name: s.form?.client?.name })), ...cases.filter(c => canManageIntake(req) || caseMatchesAssignee(c, req.user!.name) || caseMatchesAssignee(c, req.user!.email)).map(c => ({ type: 'Matter', reference: c.caseNo, name: c.parties }))];
};
export const getIntakeSubmission = async (id: unknown, req: AuthRequest) => {
  const { submission, link } = await authorizedSubmission(id, req);
  const files = await Attachment.find({ submissionId: submission._id }).lean();
  return { ...submission.toObject(), link: safeLink(link), files, duplicates: await duplicateCandidates(submission, req) };
};
export const reviewIntakeSubmission = async (id: unknown, body: any, req: AuthRequest) => {
  const assignments = await assignmentFields(body);
  const confirmedService = serviceById(body.serviceId);
  const administration = { ...officialFields(body), ...assignments, serviceId: confirmedService?.id || '' };
  const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
    const { submission, link } = await authorizedSubmission(id, req, session);
    if (['Accepted', 'Rejected'].includes(submission.status)) throw new IntakeError(409, 'This submission has already been resolved.');
    submission.internalNotes = textValue(body.internalNotes, 20000);
    submission.missingInformation = textValue(body.missingInformation, 5000);
    submission.administration = administration;
    submission.status = 'Under Review'; submission.reviewedBy = req.user!.id; submission.reviewedAt = new Date();
    submission.reviewHistory.push({ action: 'Reviewed', actorName: req.user!.name, at: new Date() });
    await submission.save({ session });
    Object.assign(link, assignments); await link.save({ session });
    await audit(req, 'INTAKE_SUBMISSION_REVIEWED', link, submission, '', session);
  }); } finally { await session.endSession(); }
  return getIntakeSubmission(id, req);
};
export const acceptIntakeSubmission = async (id: unknown, body: any, req: AuthRequest) => {
  const assignments = await assignmentFields(body, true);
  const confirmedService = serviceById(body.serviceId, true)!;
  const session = await mongoose.startSession();
  let result: any;
  try { await session.withTransaction(async () => {
    const { submission, link } = await authorizedSubmission(id, req, session);
    if (submission.status === 'Accepted' && submission.prospectId) { result = { prospectId: submission.prospectId }; return; }
    if (submission.status === 'Rejected') throw new IntakeError(409, 'A rejected submission cannot be accepted.');
    if (submission.status === 'Additional Information Requested') throw new IntakeError(409, 'Wait for the requested information or review the submission again before acceptance.');
    const duplicates = await duplicateCandidates(submission, req);
    if (duplicates.length && body.duplicatesReviewed !== true) throw new IntakeError(409, 'Review the possible duplicate records before accepting this submission.');
    const form = submission.form;
    const client = form.client;
    const prospect = await createProspectRecord({ responsiblePartner: String(assignments.responsiblePartner), responsibleAssociate: String(assignments.responsibleAssociate), assignedTo: String(assignments.assignedTo), clientName: client.name,
      contact: { name: client.type === 'Company' ? client.representativeName : client.name, email: client.email, phone: client.phone, position: client.profession },
      parties: [client.name, ...form.parties.map((p: any) => p.name)].join(' | '), enquiryNature: form.matter.inquiry,
      inquiryDescription: [form.matter.overview, `Objectives: ${form.matter.objectives}`, form.matter.concerns ? `Concerns: ${form.matter.concerns}` : ''].filter(Boolean).join('\n\n'),
      enquirySource: 'Digital client intake', referralSource: textValue(body.referredBy, 500) || submission.reference, legalServicePath: confirmedService.path, stage: 'Inquiry',
    }, req.user!, session);
    prospect.intakeSubmissionId = submission._id; await prospect.save({ session });
    submission.prospectId = prospect._id; submission.status = 'Accepted'; submission.reviewedBy = req.user!.id; submission.reviewedAt = new Date();
    submission.administration = { ...officialFields({ ...(submission.administration?.toObject?.() || submission.administration || {}), ...body }), ...assignments, serviceId: confirmedService.id };
    submission.internalNotes = textValue(body.internalNotes ?? submission.internalNotes, 20000);
    submission.clarificationHash = undefined;
    if (duplicates.length) submission.duplicateReview = { confirmedBy: req.user!.id, confirmedAt: new Date() };
    submission.reviewHistory.push({ action: 'Accepted into prospect pipeline', actorName: req.user!.name, at: new Date() });
    await submission.save({ session });
    Object.assign(link, assignments); await link.save({ session });
    await audit(req, 'INTAKE_SUBMISSION_ACCEPTED', link, submission, prospect.prospectNo, session);
    result = { prospectId: prospect._id, prospectNo: prospect.prospectNo };
  }); } finally { await session.endSession(); }
  return result;
};
export const rejectIntakeSubmission = async (id: unknown, body: any, req: AuthRequest) => {
  const { submission, link } = await authorizedSubmission(id, req);
  if (['Accepted', 'Rejected'].includes(submission.status)) throw new IntakeError(409, 'This submission has already been resolved.');
  submission.rejectionReason = textValue(body.reason, 5000, true); submission.status = 'Rejected';
  submission.reviewedBy = req.user!.id; submission.reviewedAt = new Date(); submission.clarificationHash = undefined;
  submission.reviewHistory.push({ action: 'Rejected', actorName: req.user!.name, at: new Date(), note: submission.rejectionReason });
  await submission.save(); await audit(req, 'INTAKE_SUBMISSION_REJECTED', link, submission);
  return { status: submission.status };
};
export const requestIntakeInformation = async (id: unknown, body: any, req: AuthRequest) => {
  const { submission, link } = await authorizedSubmission(id, req);
  if (['Accepted', 'Rejected'].includes(submission.status)) throw new IntakeError(409, 'This submission has already been resolved.');
  const message = textValue(body.message, 5000, true); const token = tokenValue(); const url = publicUrl(token, true);
  submission.clarificationHash = intakeHash(token); submission.clarificationExpiresAt = new Date(Date.now() + 7 * 86400000);
  submission.status = 'Additional Information Requested'; submission.clarifications.push({ message, requestedAt: new Date(), requestedBy: req.user!.id });
  submission.reviewHistory.push({ action: 'Additional information requested', actorName: req.user!.name, at: new Date(), note: message });
  await submission.save(); await audit(req, 'INTAKE_INFORMATION_REQUESTED', link, submission);
  const email = await sendEmailResend([submission.form.client.email], `Additional information requested: ${submission.reference}`, `<h2>Colin & Colin Legal Solutions</h2><p>Please provide additional information for your enquiry.</p><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(url)}">Reply securely</a></p><p>This link expires in seven days.</p>`);
  return email.ok ? { url, sent: true, message: 'Additional-information request accepted by the email provider.' } : { url, sent: false, code: email.code, retryable: email.retryable, message: email.error };
};
export const publicClarification = async (token: string, body?: any) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new IntakeError(404, 'This clarification link is invalid.');
  const submission = await Submission.findOne({ clarificationHash: intakeHash(token), clarificationExpiresAt: { $gt: new Date() }, status: 'Additional Information Requested', deletedAt: null });
  if (!submission) throw new IntakeError(410, 'This clarification link has expired or is no longer available.');
  const request = submission.clarifications[submission.clarifications.length - 1];
  if (!body) return { reference: submission.reference, message: request.message };
  request.response = textValue(body.response, 20000, true); request.respondedAt = new Date();
  submission.clarificationHash = undefined; submission.status = 'Awaiting Review';
  submission.reviewHistory.push({ action: 'Client clarification received', actorName: 'Client', at: new Date() });
  await submission.save();
  const link = await Link.findById(submission.linkId);
  await notifyUsersById({ userIds: [String(link.assignedTo || link.createdBy)], category: 'taskAssignments', notification: { type: 'INTAKE_SUBMISSION', title: 'Client clarification received', message: submission.reference, link: `/matters/intake-prospects?submission=${submission._id}` } }).catch(() => {});
  return { reference: submission.reference, received: true };
};
