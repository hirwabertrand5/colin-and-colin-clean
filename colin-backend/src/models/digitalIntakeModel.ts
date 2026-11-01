import mongoose, { Schema } from 'mongoose';

const staff = { type: Schema.Types.ObjectId, ref: 'User', default: null };
const history = new Schema({ action: String, actorName: String, at: { type: Date, default: Date.now }, note: String }, { _id: false });
const linkSchema = new Schema({
  reference: { type: String, required: true, unique: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  tokenVersion: { type: Number, default: 1 },
  createdBy: { ...staff, required: true }, responsiblePartner: staff, responsibleAssociate: staff, assignedTo: staff,
  clientName: { type: String, maxlength: 300 }, clientEmail: { type: String, lowercase: true, maxlength: 254 },
  serviceId: String, questionnaireId: String, introduction: { type: String, maxlength: 2000 },
  expiresAt: { type: Date, required: true, index: true }, revokedAt: Date, openedAt: Date, submittedAt: Date,
  submissionId: { type: Schema.Types.ObjectId, ref: 'ClientIntakeSubmission' },
  sentAt: Date, emailStatus: String, emailFailureCode: String, sentTokenVersion: Number, uploadCount: { type: Number, default: 0 }, uploadBytes: { type: Number, default: 0 },
  notice: { version: String, text: String, contact: String, retention: String, approvedBy: staff, approvedAt: Date },
}, { timestamps: true, optimisticConcurrency: true });
linkSchema.index({ createdBy: 1, createdAt: -1 });
linkSchema.index({ assignedTo: 1, createdAt: -1 });
export const ClientIntakeLink = mongoose.model<any>('ClientIntakeLink', linkSchema);

const submissionSchema = new Schema({
  reference: { type: String, required: true, unique: true },
  linkId: { type: Schema.Types.ObjectId, ref: 'ClientIntakeLink', required: true, unique: true },
  // Only the validated public form shape is stored here; internal fields are separate.
  form: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['Awaiting Review', 'Under Review', 'Additional Information Requested', 'Accepted', 'Rejected'], default: 'Awaiting Review', index: true },
  submittedAt: { type: Date, default: Date.now }, reviewedBy: staff, reviewedAt: Date,
  noticeAcknowledgment: { version: String, text: String, contact: String, retention: String, at: Date },
  prospectId: { type: Schema.Types.ObjectId, ref: 'Prospect', default: null, index: true },
  internalNotes: { type: String, default: '', maxlength: 20000 }, missingInformation: { type: String, maxlength: 5000 },
  administration: { serviceId: String, responsiblePartner: staff, responsibleAssociate: staff, assignedTo: staff, consultationDate: String, attendingCounsel: String, previousClientStatus: String, referredBy: String, officialClientName: String, signatureRecord: String, recordDate: String },
  rejectionReason: { type: String, maxlength: 5000 },
  clarificationHash: { type: String, select: false }, clarificationExpiresAt: Date,
  clarifications: [{ message: String, requestedAt: Date, requestedBy: staff, response: String, respondedAt: Date }],
  reviewHistory: { type: [history], default: [] }, duplicateReview: { confirmedAt: Date, confirmedBy: staff },
}, { timestamps: true, optimisticConcurrency: true });
submissionSchema.index({ 'form.client.email': 1 });
submissionSchema.index({ 'form.client.phone': 1 });
submissionSchema.index({ 'form.client.identification': 1 });
submissionSchema.index({ 'form.client.tin': 1 });
export const ClientIntakeSubmission = mongoose.model<any>('ClientIntakeSubmission', submissionSchema);

const attachmentSchema = new Schema({
  linkId: { type: Schema.Types.ObjectId, ref: 'ClientIntakeLink', required: true, index: true },
  submissionId: { type: Schema.Types.ObjectId, ref: 'ClientIntakeSubmission', default: null, index: true },
  tokenVersion: { type: Number, required: true },
  storageId: { type: String, required: true, select: false },
  name: { type: String, required: true }, size: Number, mimeType: String, section: String,
  matterId: { type: Schema.Types.ObjectId, ref: 'Case', default: null },
}, { timestamps: true });
export const ClientIntakeAttachment = mongoose.model<any>('ClientIntakeAttachment', attachmentSchema);

const settingsSchema = new Schema({
  key: { type: String, unique: true, default: 'portal' },
  noticeText: String, noticeVersion: String, privacyContact: String, retentionPolicy: String,
  noticeApproved: { type: Boolean, default: false }, approvedBy: staff, approvedAt: Date,
  defaultExpiryDays: { type: Number, default: 7, min: 1, max: 30 },
}, { timestamps: true });
export const ClientIntakeSettings = mongoose.model<any>('ClientIntakeSettings', settingsSchema);

// Shared across API replicas; TTL is cleanup, the time window is enforced explicitly.
const rateSchema = new Schema({ key: { type: String, unique: true }, count: Number, expiresAt: Date });
rateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const ClientIntakeRate = mongoose.model<any>('ClientIntakeRate', rateSchema);
