import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { authenticate, AuthRequest } from '../middleware/authMiddleware';
import { ClientIntakeAttachment, ClientIntakeRate } from '../models/digitalIntakeModel';
import Case from '../models/caseModel';
import { caseMatchesAssignee } from '../utils/caseAssignments';
import { streamRestrictedUpload } from '../services/fileStorageService';
import { IntakeError } from '../services/digitalIntakeValidation';
import * as intake from '../services/digitalIntakeService';
import { INTAKE_SERVICES, QUESTIONNAIRES } from '../config/digitalIntakeSchema';

const router = express.Router();
type Handler = (req: AuthRequest, res: Response) => Promise<any>;
const run = (handler: Handler) => (req: AuthRequest, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };
const token = (req: Request) => typeof req.headers['x-intake-token'] === 'string' ? req.headers['x-intake-token'] : '';
router.use((_req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }); next(); });
router.use('/public', (req, res, next) => { (async () => {
  // Applied before multipart parsing. Persistent windows work across Render replicas.
  const windowMs = 10 * 60000;
  const stamp = Math.floor(Date.now() / windowMs);
  const kinds = [{ key: req.ip || req.socket.remoteAddress || 'unknown', limit: 180 }];
  if (token(req)) kinds.push({ key: token(req), limit: req.path.includes('files') ? 40 : 100 });
  for (const kind of kinds) {
    const key = createHash('sha256').update(`${kind.key}:${stamp}:${req.method}:${req.path.includes('files') ? 'files' : 'form'}`).digest('hex');
    let bucket: any;
    try { bucket = await ClientIntakeRate.findOneAndUpdate({ key }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((stamp + 2) * windowMs) } }, { upsert: true, returnDocument: 'after' }); }
    catch (error: any) { if (error.code === 11000) bucket = await ClientIntakeRate.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { returnDocument: 'after' }); else throw error; }
    if (bucket.count > kind.limit) { res.setHeader('Retry-After', '600'); throw new IntakeError(429, 'Too many requests. Please try again shortly.'); }
  }
  const bytes = Number(req.headers['content-length'] || 0);
  if (!req.is('multipart/form-data') && (bytes > 256 * 1024 || Buffer.byteLength(JSON.stringify(req.body || {})) > 256 * 1024)) throw new IntakeError(413, 'The submitted information is too large. Please shorten the text.');
})().then(() => next()).catch(next); });

// Public tokens use a dedicated header, keeping them out of API access-log URLs.
router.post('/public/form', run(async (req, res) => res.json(await intake.publicIntakeDetails(token(req)))));
router.post('/public/submit', run(async (req, res) => res.json(await intake.submitIntakeForm(token(req), req.body))));
const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1048576, files: 1, fields: 1, fieldSize: 300 } });
router.post('/public/files', run(async (req, res) => {
  const link = await intake.resolvePublicIntakeLink(token(req));
  if (link.submittedAt) throw new IntakeError(409, 'This form has already been submitted.');
  await new Promise<void>((resolve, reject) => multipart.single('file')(req, res, error => error ? reject(error) : resolve()));
  res.status(201).json(await intake.uploadIntakeAttachment(token(req), req.file, req.body.section));
}));
router.delete('/public/files/:id', run(async (req, res) => { await intake.removeIntakeAttachment(token(req), req.params.id); res.json({ removed: true }); }));
router.post('/public/clarification', run(async (req, res) => res.json(await intake.publicClarification(token(req)))));
router.post('/public/clarification/reply', run(async (req, res) => res.json(await intake.publicClarification(token(req), req.body))));

router.use(authenticate, (req: AuthRequest, res, next) => {
  if (!intake.INTAKE_STAFF.includes(req.user?.role || '')) return res.status(403).json({ message: 'You do not have access to digital intake.' });
  next();
});
router.get('/configuration', run(async (req, res) => res.json({ settings: await intake.getIntakeSettings(), services: INTAKE_SERVICES, questionnaires: QUESTIONNAIRES, canManage: intake.canManageIntake(req), delivery: intake.getIntakeDeliveryConfiguration() })));
router.put('/configuration', run(async (req, res) => res.json(await intake.updateIntakeSettings(req.body, req))));
router.get('/links', run(async (req, res) => res.json(await intake.listIntakeLinks(req))));
router.post('/links', run(async (req, res) => res.status(201).json(await intake.generateIntakeLink(req.body, req))));
router.delete('/links/:id', run(async (req, res) => res.json(await intake.deleteIntakeLink(req.params.id, req))));
router.post('/links/:id/revoke', run(async (req, res) => res.json(await intake.changeIntakeLink(req.params.id, 'revoke', req))));
router.post('/links/:id/regenerate', run(async (req, res) => res.json(await intake.changeIntakeLink(req.params.id, 'regenerate', req))));
router.post('/links/:id/send', run(async (req, res) => res.json(await intake.sendIntakeInvitation(req.params.id, req.body.token, req))));
router.get('/submissions', run(async (req, res) => res.json(await intake.listIntakeSubmissions(req))));
router.get('/submissions/:id', run(async (req, res) => res.json(await intake.getIntakeSubmission(req.params.id, req))));
router.delete('/submissions/:id', run(async (req, res) => res.json(await intake.deleteIntakeSubmission(req.params.id, req))));
router.put('/submissions/:id/review', run(async (req, res) => res.json(await intake.reviewIntakeSubmission(req.params.id, req.body, req))));
router.post('/submissions/:id/accept', run(async (req, res) => res.json(await intake.acceptIntakeSubmission(req.params.id, req.body, req))));
router.post('/submissions/:id/reject', run(async (req, res) => res.json(await intake.rejectIntakeSubmission(req.params.id, req.body, req))));
router.post('/submissions/:id/request-information', run(async (req, res) => res.json(await intake.requestIntakeInformation(req.params.id, req.body, req))));
router.get('/files/:id', run(async (req, res) => {
  const file = await ClientIntakeAttachment.findById(req.params.id).select('+storageId');
  if (!file || !file.submissionId) throw new IntakeError(404, 'Document not found.');
  let allowed = false;
  try { await intake.authorizedSubmission(String(file.submissionId), req); allowed = true; } catch { /* A later matter team can also access linked documents. */ }
  if (!allowed && file.matterId) {
    const matter = await Case.findById(file.matterId).select('assignedTo caseAssignments').lean();
    allowed = !!matter && (intake.canManageIntake(req) || caseMatchesAssignee(matter, req.user!.name) || caseMatchesAssignee(matter, req.user!.email));
  }
  if (!allowed) throw new IntakeError(404, 'Document not found.');
  return streamRestrictedUpload(file.storageId, res);
}));
router.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return res.end();
  if (error instanceof multer.MulterError) return res.status(400).json({ message: 'Upload one supported file up to 10 MB at a time.', code: 'UPLOAD_LIMIT' });
  const status = error instanceof IntakeError ? error.status : error?.name === 'VersionError' ? 409 : error?.status === 400 ? 400 : 503;
  return res.status(status).json({ message: status === 503 && !(error instanceof IntakeError) ? 'The intake service is temporarily unavailable. Please try again.' : error?.name === 'VersionError' ? 'This record changed. Refresh and try again.' : error.message, code: error instanceof IntakeError ? error.code : 'SERVICE_ERROR' });
});
export default router;
