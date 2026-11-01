/** Real API and GridFS checks on a disposable replica set; never loads .env/MONGO_URI. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import intakeRoutes from '../routes/digitalIntake';
import prospectRoutes from '../routes/prospect';
import User from '../models/userModel';
import Prospect from '../models/prospectModel';
import Case from '../models/caseModel';
import Document from '../models/documentModel';
import Notification from '../models/notificationModel';
import AuditLog from '../models/auditLogModel';
import { ClientIntakeLink as Link, ClientIntakeSubmission as Submission, ClientIntakeAttachment as Attachment, ClientIntakeRate as Rate } from '../models/digitalIntakeModel';
import { INTAKE_SERVICES, ARTICLES_GROUPS } from '../config/digitalIntakeSchema';
import { getStageConfig, stageChecklistKey } from '../utils/prospectStageConfig';
import { publicClientOrigin } from '../services/digitalIntakeService';
import { classifyEmailFailure, getEmailConfiguration } from '../services/emailResendService';
import { serveStoredUpload, storeUploadedFile } from '../services/fileStorageService';

async function main() {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.PUBLIC_CLIENT_URL;
  const previousMode = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production'; process.env.CLIENT_URL = 'https://obsolete-preview.vercel.app';
  assert.equal(publicClientOrigin(), 'https://colin-and-colin.vercel.app');
  process.env.CLIENT_URL = 'https://app.colinandcolin.com'; assert.equal(publicClientOrigin(), 'https://colin-and-colin.vercel.app');
  process.env.CLIENT_URL = 'https://colin-and-colin-t62y.vercel.app'; assert.equal(publicClientOrigin(), 'https://colin-and-colin.vercel.app');
  process.env.CLIENT_URL = 'https://colin-and-colin.vercel.app/login'; assert.equal(publicClientOrigin(), 'https://colin-and-colin.vercel.app');
  delete process.env.CLIENT_URL; assert.equal(publicClientOrigin(), 'https://colin-and-colin.vercel.app');
  process.env.PUBLIC_CLIENT_URL = 'https://colin-and-colin.vercel.app/login'; assert.equal(publicClientOrigin(), 'https://colin-and-colin.vercel.app');
  process.env.PUBLIC_CLIENT_URL = 'https://frontend.test.invalid/'; assert.equal(publicClientOrigin(), 'https://frontend.test.invalid');
  process.env.PUBLIC_CLIENT_URL = 'http://unsafe.test.invalid'; assert.throws(publicClientOrigin, /HTTPS/);
  process.env.PUBLIC_CLIENT_URL = 'invalid-url'; assert.throws(publicClientOrigin, /invalid/);
  if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
  process.env.JWT_SECRET = 'disposable-intake-verification';
  process.env.PUBLIC_CLIENT_URL = 'https://app.test.invalid';
  const binary = path.resolve(__dirname, '../../node_modules/.cache/mongodb-memory-server/test-mongod.exe');
  console.log('Starting disposable intake verification database...');
  const replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', ...(existsSync(binary) ? { systemBinary: binary } : {}) }, instanceOpts: [{ launchTimeout: 120000 }], replSet: { count: 1, storageEngine: 'wiredTiger' } });
  let server: ReturnType<express.Express['listen']> | undefined;
  let passed = 0;
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'digital_intake_verification' });
    const manager = await User.create({ name: 'Test Manager', email: 'manager@test.invalid', role: 'managing_partner', passwordHash: 'fixture' });
    const owner = await User.create({ name: 'Test Owner', email: 'owner@test.invalid', role: 'associate', passwordHash: 'fixture' });
    const other = await User.create({ name: 'Other Staff', email: 'other@test.invalid', role: 'associate', passwordHash: 'fixture' });
    const inactive = await User.create({ name: 'Inactive Staff', email: 'inactive@test.invalid', role: 'associate', passwordHash: 'fixture', isActive: false });
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    const app = express(); app.use(express.json({ limit: '2mb' })); app.use('/api/digital-intake', intakeRoutes); app.use('/api/prospects', prospectRoutes); app.get('/uploads/:fileKey', serveStoredUpload);
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const req = async (route: string, body?: any, actor: any = manager, method?: string, token?: string) => {
      const response = await fetch(base + route, { method: method || (body ? 'POST' : 'GET'), headers: { ...(actor ? { Authorization: `Bearer ${jwt.sign({ id: String(actor._id) }, process.env.JWT_SECRET!)}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-Intake-Token': token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    };
    const ok = async (route: string, body?: any, actor: any = manager, method?: string, token?: string) => { const r = await req(route, body, actor, method, token); assert(r.status < 300, `${method || 'request'} ${route}: ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
    const staff = (route: string) => `/api/digital-intake${route}`;
    const pub = (route: string, token: string, body: any = {}) => req(staff('/public' + route), body, null, 'POST', token);
    const pass = (label: string) => console.log(`PASS ${++passed}: ${label}`);
    const assignments = { assignedTo: String(owner._id), responsiblePartner: String(manager._id), responsibleAssociate: String(owner._id) };
    const service = INTAKE_SERVICES.find(s => s.id === 'company_incorporation')!; assert(service);
    const invitation = { ...assignments, serviceId: service.id, clientName: 'Synthetic Company', clientEmail: 'client@test.invalid' };
    const generate = (extra: any = {}) => ok(staff('/links'), { ...invitation, ...extra });
    const form = (extra: any = {}) => ({ client: { type: 'Individual', name: 'Synthetic Applicant', identification: 'TEST-ID', email: 'client@test.invalid', phone: '+250700000001', country: 'Rwanda' }, parties: [{ type: 'Individual', name: 'Related Individual', relationship: 'Co-owner' }, { type: 'Company', name: 'Related Organization', tin: 'TEST-TIN' }], matter: { inquiry: 'Company formation enquiry', objectives: 'Review proposed arrangements', overview: 'Synthetic verification enquiry', concerns: 'Timing', relevantDates: 'Proposed next month' }, serviceId: service.id, questionnaireId: '', answers: {}, shareholders: [], acknowledged: true, noticeVersion: 'test-v1', documentIds: [], ...extra });
    assert.equal((await req(staff('/links'), invitation, null)).status, 401);
    assert.equal((await req(staff('/links'), invitation, inactive)).status, 403);
    assert.equal((await req(staff('/configuration'), {}, owner, 'PUT')).status, 403);
    const approvalRequired = await req(staff('/links'), invitation); assert.equal(approvalRequired.status, 409); assert.equal(approvalRequired.data.code, 'NOTICE_APPROVAL_REQUIRED');
    await ok(staff('/configuration'), { noticeText: 'Synthetic approved test notice', noticeVersion: 'test-v1', privacyContact: 'privacy@test.invalid', retentionPolicy: 'Synthetic test retention policy', noticeApproved: true }, manager, 'PUT');
    const unassigned = await ok(staff('/links'), { expiryDays: 3 }); assert.equal(unassigned.link.assignedTo, null); assert.equal(unassigned.link.clientEmail, ''); assert.equal(unassigned.link.status, 'Pending');
    for (const expiryDays of [0, 31, 1.5]) assert.equal((await req(staff('/links'), { expiryDays })).status, 400);
    pass('Authentication, inactive staff, privacy approval gate, optional invitation fields and valid expiry enforcement');
    const first = await generate(); const second = await generate();
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(first.token, second.token);
    const stored = await Link.findById(first.link._id).select('+tokenHash').lean<any>();
    assert.equal(stored.tokenHash.length, 64); assert.notEqual(stored.tokenHash, first.token); assert(!JSON.stringify(stored).includes(first.token));
    assert(!JSON.stringify(await ok(staff('/links'))).includes(first.token));
    const publicDetails = await pub('/form', first.token); assert.equal(publicDetails.status, 200);
    for (const field of ['createdBy', 'assignedTo', 'responsiblePartner', 'clientName', 'clientEmail', 'tokenHash']) assert(!(field in publicDetails.data));
    assert.equal((await Link.findById(first.link._id))!.openedAt instanceof Date, true);
    pass('Random hashed tokens, safe public response and reliable opened status');
    const mailLink = await generate();
    const sendMail = () => ok(staff(`/links/${mailLink.link._id}/send`), { token: mailLink.token });
    let mailResult = await sendMail(); assert.equal(mailResult.sent, false); assert.equal(mailResult.code, 'EMAIL_NOT_CONFIGURED'); assert.match(mailResult.message, /RESEND_API_KEY.*EMAIL_FROM/);
    const mailConfig = await ok(staff('/configuration')); assert.equal(mailConfig.delivery.email.configured, false); assert.equal(mailConfig.delivery.publicUrl.origin, 'https://app.test.invalid');
    process.env.RESEND_API_KEY = 're_synthetic_verification_only';
    mailResult = await sendMail(); assert.match(mailResult.message, /EMAIL_FROM/);
    process.env.EMAIL_FROM = 'invalid-sender'; assert.equal(getEmailConfiguration().code, 'EMAIL_SENDER_INVALID');
    process.env.EMAIL_FROM = 'Colin Verification <sender@test.invalid>';
    const nativeFetch = globalThis.fetch; let providerCalls = 0; let providerStatus = 200; let providerBody: any = { id: 'email-verification-id' }; let providerHeaders: any; let providerPayload: any;
    globalThis.fetch = (async (input: any, options?: any) => {
      if (!String(input).startsWith('https://api.resend.com/')) return nativeFetch(input, options);
      providerCalls++; providerHeaders = new Headers(options?.headers); providerPayload = JSON.parse(options.body);
      return new Response(JSON.stringify(providerBody), { status: providerStatus, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    try {
      for (const [name, message, status, code] of [
        ['validation_error', 'The test.invalid domain is not verified', 403, 'EMAIL_DOMAIN_UNVERIFIED'],
        ['validation_error', 'You can only send testing emails to your own email address', 403, 'EMAIL_TEST_MODE'],
        ['invalid_api_key', 'Invalid API key', 401, 'EMAIL_CREDENTIALS_INVALID'],
        ['rate_limit_exceeded', 'Rate limit exceeded', 429, 'EMAIL_RATE_LIMITED'],
        ['application_error', 'Service unavailable', 500, 'EMAIL_PROVIDER_UNAVAILABLE'],
      ] as const) {
        providerBody = { name, message, statusCode: status }; providerStatus = status;
        mailResult = await sendMail(); assert.equal(mailResult.sent, false); assert.equal(mailResult.code, code); assert(!JSON.stringify(mailResult).includes('re_synthetic_verification_only'));
        assert.equal((await Link.findById(mailLink.link._id))!.emailFailureCode, code);
      }
      providerBody = {}; providerStatus = 200; mailResult = await sendMail(); assert.equal(mailResult.sent, false);
      providerBody = { id: 'email-verification-id' }; mailResult = await sendMail(); assert.equal(mailResult.sent, true);
      assert.equal(providerPayload.to[0], 'client@test.invalid'); assert(providerPayload.html.includes('https://app.test.invalid/intake/form/'));
      assert.match(providerHeaders.get('Idempotency-Key'), /intake-invitation/);
      const callsBeforeRetry = providerCalls; assert.equal((await sendMail()).sent, true); assert.equal(providerCalls, callsBeforeRetry);
      assert.equal((await Link.findById(mailLink.link._id))!.emailStatus, 'Sent');
      const rotated = await ok(staff(`/links/${mailLink.link._id}/regenerate`), {}); assert(!rotated.link.emailStatus);
    } finally { globalThis.fetch = nativeFetch; delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; }
    assert.equal(classifyEmailFailure({ name: 'Error', message: 'fetch failed' }).code, 'EMAIL_PROVIDER_UNAVAILABLE');
    pass('Stable public URL, safe email diagnostics, provider failure recovery, confirmed send and duplicate email prevention');

    await Link.updateOne({ _id: second.link._id }, { expiresAt: new Date(0) });
    assert.equal((await pub('/submit', second.token, form())).status, 410);
    const revoked = await generate(); await ok(staff(`/links/${revoked.link._id}/revoke`), {});
    assert.equal((await pub('/submit', revoked.token, form())).status, 410);
    const renewed = await ok(staff(`/links/${revoked.link._id}/regenerate`), {});
    assert.equal((await pub('/form', revoked.token)).status, 404); assert.equal((await pub('/form', renewed.token)).status, 200);
    assert.equal((await pub('/form', 'invalid')).status, 404);
    pass('Expired/revoked links blocked and regenerated tokens invalidate old URLs');
    assert.equal((await pub('/submit', first.token, form({ acknowledged: false }))).status, 400);
    assert.equal((await pub('/submit', first.token, form({ client: { type: 'Company', name: 'Incomplete' } }))).status, 400);
    assert.equal((await pub('/submit', first.token, form({ documentIds: [new mongoose.Types.ObjectId().toString()] }))).status, 400);
    assert.equal((await pub('/submit', first.token, form({ questionnaireId: 'not-a-questionnaire' }))).status, 400);
    assert.equal((await pub('/submit', first.token, form({ matter: { overview: 'x'.repeat(270000) } }))).status, 413);
    pass('Required fields, conditional company fields, notice, document ownership and payload limits');
    const upload = async (token: string, name: string, content: string, type = 'application/pdf') => { const data = new FormData(); data.append('section', 'Client identification'); data.append('file', new Blob([content], { type }), name); const response = await fetch(base + staff('/public/files'), { method: 'POST', headers: { 'X-Intake-Token': token }, body: data }); return { status: response.status, data: await response.json() }; };
    assert.equal((await upload(first.token, 'spoof.pdf', '<script>bad</script>')).status, 400);
    const file = await upload(first.token, 'verification.pdf', '%PDF-1.4\nsynthetic verification'); assert.equal(file.status, 201);
    const foreign = await upload(renewed.token, 'other.pdf', '%PDF-1.4\nother verification'); assert.equal(foreign.status, 201);
    assert.equal((await pub('/submit', first.token, form({ documentIds: [foreign.data._id] }))).status, 400);
    const privateFile = await Attachment.findById(file.data._id).select('+storageId').lean<any>();
    assert.equal((await fetch(`${base}/uploads/${privateFile.storageId}`)).status, 404);
    pass('Upload signatures checked, foreign document references refused and GridFS public access blocked');
    const submitted = await Promise.all([pub('/submit', first.token, form({ documentIds: [file.data._id], stage: 'Converted', assignedTo: String(other._id) })), pub('/submit', first.token, form({ documentIds: [file.data._id] }))]);
    assert(submitted.every(r => r.status === 200), JSON.stringify(submitted)); assert.equal(submitted[0]!.data.reference, submitted[1]!.data.reference);
    const submission: any = await Submission.findOne({ linkId: first.link._id }); assert(submission); assert.equal(await Submission.countDocuments({ linkId: first.link._id }), 1);
    assert.equal(submission.form.parties.length, 2); assert.equal(submission.form.matter.concerns, 'Timing'); assert(!submission.form.assignedTo); assert.equal(await Prospect.countDocuments(), 0);
    assert.equal(await Notification.countDocuments({ dedupeKey: `intake:${submission._id}` }), 1);
    assert.equal((await pub('/form', first.token)).data.code, 'ALREADY_SUBMITTED');
    assert.equal((await req(staff(`/submissions/${submission._id}`), undefined, other)).status, 404);
    assert.equal((await req(staff(`/submissions/${submission._id}`), undefined, owner)).status, 200);
    pass('Concurrent submit is idempotent; structured parties retained; notifications survive disabled email; staff scope enforced');
    const download = await fetch(base + staff(`/files/${file.data._id}`), { headers: { Authorization: `Bearer ${jwt.sign({ id: String(owner._id) }, process.env.JWT_SECRET!)}` } });
    assert.equal(download.status, 200); assert.match(await download.text(), /^%PDF-/); assert.equal(download.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(base + staff(`/files/${file.data._id}`))).status, 401);
    assert.equal((await req(staff(`/files/${file.data._id}`), undefined, other)).status, 404);
    assert.equal((await req(staff(`/public/files/${file.data._id}`), undefined, null, 'DELETE', first.token)).status, 409);
    pass('Authorized downloads work; anonymous/other staff downloads and submitted-file deletion blocked');
    const review = { ...assignments, serviceId: service.id, internalNotes: 'Verified internally', consultationDate: '2026-10-31', attendingCounsel: 'Test Owner', previousClientStatus: 'Unknown', referredBy: 'Synthetic referral', officialClientName: 'Verified Synthetic Applicant', signatureRecord: 'Synthetic signed-record reference', recordDate: '2026-11-01', missingInformation: 'Please confirm timing.' };
    const reviewed = await ok(staff(`/submissions/${submission._id}/review`), review, owner, 'PUT');
    assert.equal(reviewed.administration.consultationDate, '2026-10-31'); assert.equal(reviewed.administration.attendingCounsel, 'Test Owner'); assert.equal(reviewed.administration.signatureRecord, 'Synthetic signed-record reference'); assert.equal(reviewed.administration.serviceId, service.id); assert.equal(String(reviewed.administration.assignedTo), assignments.assignedTo);
    const clarify = await ok(staff(`/submissions/${submission._id}/request-information`), { message: review.missingInformation });
    assert.equal(clarify.sent, false); const correctionToken = clarify.url.split('/').pop();
    const publicCorrection = await pub('/clarification', correctionToken); assert.equal(publicCorrection.data.message, review.missingInformation); assert(!publicCorrection.data.form);
    assert.equal((await req(staff(`/submissions/${submission._id}/accept`), review)).status, 409);
    assert.equal((await pub('/clarification/reply', correctionToken, { response: 'Timing confirmed.' })).status, 200);
    assert.equal((await pub('/clarification/reply', correctionToken, { response: 'Retry' })).status, 410);
    pass('Review administration persists; secure clarification is single-use and email failure preserves the request');
    const accepted = await Promise.all([req(staff(`/submissions/${submission._id}/accept`), review), req(staff(`/submissions/${submission._id}/accept`), review)]);
    assert(accepted.every(r => r.status === 200), JSON.stringify(accepted)); assert.equal(String(accepted[0]!.data.prospectId), String(accepted[1]!.data.prospectId));
    let prospect: any = await Prospect.findById(accepted[0]!.data.prospectId); assert.equal(await Prospect.countDocuments(), 1); assert.equal(await Case.countDocuments(), 0);
    assert.equal((await Submission.findById(submission._id))!.administration.signatureRecord, 'Synthetic signed-record reference'); assert.equal(prospect.referralSource, 'Synthetic referral'); assert.equal(prospect.stage, 'Inquiry'); assert.equal(String(prospect.intakeSubmissionId), String(submission._id)); assert.equal(prospect.contact.email, 'client@test.invalid'); assert.equal(prospect.contact.phone, '+250700000001'); assert(prospect.inquiryDescription.includes('Objectives:'));
    assert.equal(prospect.stageChecklist.length, getStageConfig('Inquiry')!.checklist.length); assert(+prospect.stageDueAt > +prospect.stageStartedAt);
    pass('Concurrent acceptance creates one linked Inquiry prospect with canonical checklist/SLA and no Active Matter');
    const companyLink = await generate({ questionnaireId: 'articles-of-association-v1' });
    const answers: Record<string, any> = Object.fromEntries(ARTICLES_GROUPS.flatMap(g => g.questions).map(q => [q.key, q.type === 'number' ? 2 : `Synthetic ${q.key}`])); answers.appointSecretary = true;
    const company = form({ client: { type: 'Company', name: 'Synthetic Company', tin: 'TEST-TIN-002', representativeName: 'Synthetic Representative', representativeIdentification: 'TEST-REP-ID', email: 'client@test.invalid', phone: '+250700000002', country: 'Rwanda' }, questionnaireId: 'articles-of-association-v1', answers, shareholders: [{ name: 'Synthetic Shareholder', identification: 'TEST-SH-ID', shares: 20, percentage: 40, contribution: 200 }] });
    assert.equal((await pub('/submit', companyLink.token, { ...company, shareholders: [{ name: 'Invalid', percentage: 101 }] })).status, 400);
    assert.equal((await pub('/submit', companyLink.token, company)).status, 200);
    const companySubmission: any = await Submission.findOne({ linkId: companyLink.link._id });
    for (const [key, value] of Object.entries(answers)) assert.equal(companySubmission.form.answers[key], value);
    assert.equal(companySubmission.form.shareholders[0].percentage, 40);
    const matches = await ok(staff(`/submissions/${companySubmission._id}`)); assert(matches.duplicates.some((m: any) => m.type === 'Prospect'));
    assert.equal((await req(staff(`/submissions/${companySubmission._id}/accept`), review)).status, 409);
    const companyAccepted = await ok(staff(`/submissions/${companySubmission._id}/accept`), { ...review, duplicatesReviewed: true }); assert(companyAccepted.prospectId);
    pass('Company/AoA data and every questionnaire answer retained; partial ownership allowed; duplicate confirmation required');
    const rejectLink = await generate(); await pub('/submit', rejectLink.token, form()); const rejected: any = await Submission.findOne({ linkId: rejectLink.link._id });
    await ok(staff(`/submissions/${rejected._id}/reject`), { reason: 'Synthetic rejection reason' }); assert.equal((await req(staff(`/submissions/${rejected._id}/accept`), review)).status, 409);
    pass('Rejection records its reason and prevents acceptance');
    const manual = await ok('/api/prospects', { ...assignments, clientName: 'Manual Test', contact: { name: 'Manual Test', email: 'manual@test.invalid' }, inquiryDescription: 'Manual test inquiry', legalServicePath: service.path });
    const originalClock = manual.stageStartedAt;
    const edited = await ok(`/api/prospects/${manual._id}`, { waitingOn: 'Client', inquiryDescription: 'Updated manual description' }, manager, 'PUT'); assert.equal(edited.stageStartedAt, originalClock); assert.equal(edited.clientName, 'Manual Test');
    const followed = await ok(`/api/prospects/${manual._id}/follow-up`, { outcome: 'Synthetic follow-up' }); assert.equal(followed.followUpCount, 1);
    const reassigned = await ok(`/api/prospects/${manual._id}`, { assignedTo: String(other._id) }, manager, 'PUT'); assert(reassigned.assignmentHistory.length > 0); assert.equal(reassigned.followUpCount, 1);
    pass('Manual prospect creation, partial editing, follow-up and reassignment preserve existing history and clocks');
    const pRoute = `/api/prospects/${prospect._id}`;
    assert.equal((await req(pRoute, { stage: 'Converted', conversionOutcome: 'Full Engagement', conflictCheckStatus: 'Cleared', stageChecklist: getStageConfig('Engagement')!.checklist.map(label => ({ label, key: stageChecklistKey(label), done: true })) }, manager, 'PUT')).status, 400);
    assert.equal((await req(pRoute, { stage: 'Engagement' }, manager, 'PUT')).status, 400);
    const stages = ['Inquiry', 'Consultation', 'Conflict Check', 'Quotation', 'Quotation Preparation', 'Conversion Assessment', 'Quotation Issued', 'Awaiting Client Decision', 'Final Follow-Up', 'Engagement'];
    for (let i = 0; i < stages.length; i++) {
      const current = stages[i]!; const checklist = getStageConfig(current)!.checklist;
      for (const label of checklist) await ok(pRoute + '/checklist', { key: stageChecklistKey(label), done: true }, manager, 'PATCH');
      if (current === 'Conflict Check') { assert.equal((await req(pRoute, { stage: 'Quotation' }, manager, 'PUT')).status, 400); await ok(pRoute, { conflictCheckStatus: 'Cleared', conflictCheckNotes: 'Synthetic search completed' }, manager, 'PUT'); }
      if (i + 1 < stages.length) { const advanced = await ok(pRoute, { stage: stages[i + 1] }, manager, 'PUT'); assert(advanced.stageChecklist.every((c: any) => !c.done)); }
    }
    const converted = await ok(pRoute, { stage: 'Converted', conversionOutcome: 'Full Engagement' }, manager, 'PUT'); assert(converted.matterId);
    prospect = await Prospect.findById(prospect._id); assert(prospect.conversionRequirementsVerifiedAt);
    const linkedDoc: any = await Document.findOne({ caseId: converted.matterId, url: `/api/digital-intake/files/${file.data._id}` }); assert(linkedDoc);
    assert.equal(String((await Attachment.findById(file.data._id))!.matterId), String(converted.matterId));
    assert.equal(await mongoose.connection.db!.collection('uploads.files').countDocuments({ _id: new mongoose.Types.ObjectId(privateFile.storageId) }), 1);
    await Case.updateOne({ _id: converted.matterId }, { $set: { caseAssignments: { initiator: other.name }, assignedTo: other.name } });
    assert.equal((await req(staff(`/submissions/${submission._id}`), undefined, other)).status, 200);
    pass('Configured lifecycle, both quotation stages, conflict and engagement gates enforced; conversion reuses private documents and grants assigned matter access');
    const closed = await ok(`/api/prospects/${manual._id}`, { stage: 'Non-Converted', conversionOutcome: 'Other' }, manager, 'PUT'); assert(closed.matterId); assert.equal((await Case.findById(closed.matterId))!.status, 'Closed');
    const reopenedLink = await generate({ clientEmail: 'temporary@test.invalid' }); const temporary = await ok('/api/prospects', { ...assignments, clientName: 'Temporary Test', contact: { name: 'Temporary Test' }, inquiryDescription: 'Synthetic temporary enquiry', legalServicePath: INTAKE_SERVICES.find(s => s.id === 'contractual_disputes')!.path });
    const temporaryMatter = await ok(`/api/prospects/${temporary._id}/move-to-temporary-matter`, { reason: 'Awaiting instructions' }); assert(temporaryMatter); assert.equal((await Case.findById(temporaryMatter.matterId || temporaryMatter.caseId || temporaryMatter.matter?._id || temporaryMatter._id))?.caseType, 'Litigation Cases');
    const ordinary = await storeUploadedFile({ buffer: Buffer.from('ordinary fixture'), originalname: 'ordinary.txt', mimetype: 'text/plain', size: 16 } as Express.Multer.File); assert.equal((await fetch(base + ordinary)).status, 200);
    pass('Non-conversion, temporary closure and existing ordinary document storage still work');
    assert(await AuditLog.exists({ intakeSubmissionId: submission._id, action: 'INTAKE_SUBMISSION_ACCEPTED' }));
    assert(!JSON.stringify(await AuditLog.find({ intakeLinkId: first.link._id }).lean()).includes(first.token));
    // Allow crossing one fixed-window boundary while exercising the real limiter.
    let rateLimited = false;
    for (let i = 0; i < 210; i++) { const limited = await pub('/form', reopenedLink.token); if (limited.status === 429) { rateLimited = true; break; } assert.equal(limited.status, 200); }
    assert(rateLimited, 'Public requests must be rate limited, including across a window boundary.');
    assert(await Rate.exists({ count: { $gt: 100 } }));
    pass('Audit records exclude tokens and persistent public rate limits apply');
    console.log(`Digital intake verification complete: ${passed} groups passed.`);
  } finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); await mongoose.disconnect(); await replica.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
