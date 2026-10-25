import { Response } from 'express';
import mongoose from 'mongoose';
import Prospect from '../models/prospectModel';
import Case from '../models/caseModel';
import User from '../models/userModel';
import ProspectFeedback from '../models/prospectFeedbackModel';
import { AuthRequest } from '../middleware/authMiddleware';
import { buildYearlySequence } from '../utils/counter';
import { sendEmailResend } from '../services/emailResendService';
import { SINGLE_CURRENCY, isRwfCurrency } from '../utils/currency';
import WorkflowTemplate from '../models/workflowTemplateModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import { buildInstanceSteps } from '../utils/workflowCompute';
import { resolveDeadlineDateTime } from '../utils/deadlineUtils';
import { computeCompletedPercentFromInstance } from '../utils/workflowPercentages';
import { resolveCanonicalTemplateForCase, normalizeTemplateMatchValue } from '../utils/workflowTemplateMatch';
import {
  PROSPECT_STAGE_CONFIG,
  getStageConfig,
  getStageSlaHours,
  isTerminalStage,
  stageChecklistKey,
  addSlaToDate,
} from '../utils/prospectStageConfig';

const isAdminRole = (role?: string) =>
  role === 'managing_director' ||
  role === 'managing_partner' ||
  role === 'senior_partner' ||
  role === 'partner' ||
  role === 'associate_partner';

const canManageProspects = (role?: string) =>
  isAdminRole(role) ||
  role === 'executive_assistant' ||
  role === 'senior_associate' ||
  role === 'associate' ||
  role === 'trainee_associate' ||
  role === 'intern';

const validStages = [
  'Inquiry',
  'Consultation',
  'Conflict Check',
  'Quotation',
  'Quotation Preparation',
  'Conversion Assessment',
  'Quotation Issued',
  'Awaiting Client Decision',
  'Final Follow-Up',
  'Engagement',
  'Converted',
  'Non-Converted',
];
const terminalStages = ['Converted', 'Non-Converted'];
const convertedOutcomes = ['Quick Advisory', 'Legal Opinion', 'Full Engagement', 'Repeat Client', 'Retainer Client'];
const nonConvertedOutcomes = ['Pricing', 'Competitor', 'No Response', 'Internal Handling', 'Conflict', 'Other'];
// Single-currency policy: the whole system operates in RWF only.
const RWF_ONLY_MESSAGE = 'Only RWF is supported.';

const cleanString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const getRouteId = (value: unknown) => (typeof value === 'string' ? value : '');
const toOptionalNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const normalizeCurrency = (value: unknown) => {
  // Single-currency policy: accept empty (defaults to RWF later), RWF, or FRW (normalised to RWF).
  // Any other code returns undefined so the caller can reject the request with a 400.
  const cleaned = cleanString(value).toUpperCase();
  if (!cleaned) return undefined;
  return isRwfCurrency(cleaned) ? SINGLE_CURRENCY : undefined;
};
const normalizePracticeArea = (value: unknown) => {
  const cleaned = cleanString(value);
  return cleaned === 'Converted' || cleaned === 'Non Converted' ? cleaned : undefined;
};
const normalizePaymentArrangement = (value: unknown) => {
  const cleaned = cleanString(value);
  const supportedTriggers = [
    'Full Payment',
    'Installments',
    'Quotation Accepted',
    'Agreed Billing Date Reached',
    'Legal Opinion Delivered',
    'Matter Milestone Completed',
    'Matter Completed',
    'Monthly Retainer Due',
  ];
  return supportedTriggers.includes(cleaned) ? cleaned : undefined;
};
const normalizePaymentMethod = (value: unknown) => {
  const cleaned = cleanString(value);
  return ['Bank Transfer', 'Cash', 'Mobile Money', 'Cheque', 'Card', 'Mixed'].includes(cleaned) ? cleaned : undefined;
};

const normalizeCompletedStagesForStage = (value: unknown, stage?: string) => {
  const stageIndex = validStages.indexOf(cleanString(stage));
  if (stageIndex < 0) {
    return Array.isArray(value)
      ? value.filter((item: unknown): item is string => typeof item === 'string' && validStages.includes(item))
      : [];
  }

  const ordered = validStages.slice(0, stageIndex + 1);
  return ordered;
};

const normalizeDateOrUndefined = (value: unknown): Date | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
};

const toEnum = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined => {
  const cleaned = cleanString(value);
  return (allowed as readonly string[]).includes(cleaned) ? (cleaned as T) : undefined;
};

/** Drop keys whose value is undefined so a spread never overwrites with undefined. */
const pruneUndefined = <T extends Record<string, unknown>>(obj: T): Partial<T> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
};

const STAGE_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Blocked'] as const;
const WAITING_ON = ['Firm', 'Client', 'Third Party', 'None'] as const;
const OPINION_PAYMENT = ['Unpaid', 'Part Paid', 'Paid'] as const;

/** Build the workflow-control fields for a prospect from a request body. */
const getWorkflowControlPayload = (body: any) => {
  const slaHours = getStageSlaHours(cleanString(body.stage));
  const stageStartedAt =
    normalizeDateOrUndefined(body.stageStartedAt) ||
    normalizeDateOrUndefined(body.dateReceived) ||
    new Date();
  const stageDueAt =
    normalizeDateOrUndefined(body.stageDueAt) ||
    (slaHours > 0 ? addSlaToDate(stageStartedAt, slaHours) : undefined);

  const stageChecklist = Array.isArray(body.stageChecklist)
    ? body.stageChecklist
        .map((item: any) => ({
          key: cleanString(item?.key) || stageChecklistKey(cleanString(item?.label)),
          label: cleanString(item?.label),
          done: Boolean(item?.done),
          ...(cleanString(item?.doneBy) ? { doneBy: cleanString(item.doneBy) } : {}),
          ...(normalizeDateOrUndefined(item?.doneAt) ? { doneAt: normalizeDateOrUndefined(item?.doneAt) } : {}),
        }))
        .filter((item: any) => item.key && item.label)
    : undefined;

  const legalOpinionRaw = body.legalOpinion;
  const legalOpinion =
    legalOpinionRaw && typeof legalOpinionRaw === 'object'
      ? {
          ...(cleanString(legalOpinionRaw.referenceNo) ? { referenceNo: cleanString(legalOpinionRaw.referenceNo) } : {}),
          ...(cleanString(legalOpinionRaw.scope) ? { scope: cleanString(legalOpinionRaw.scope) } : {}),
          ...(Number.isFinite(Number(legalOpinionRaw.fee)) ? { fee: Number(legalOpinionRaw.fee) } : {}),
          ...(toEnum(legalOpinionRaw.paymentStatus, OPINION_PAYMENT)
            ? { paymentStatus: toEnum(legalOpinionRaw.paymentStatus, OPINION_PAYMENT) }
            : {}),
          ...(cleanString(legalOpinionRaw.outcome) ? { outcome: cleanString(legalOpinionRaw.outcome) } : {}),
          ...(normalizeDateOrUndefined(legalOpinionRaw.openedAt) ? { openedAt: normalizeDateOrUndefined(legalOpinionRaw.openedAt) } : {}),
          ...(normalizeDateOrUndefined(legalOpinionRaw.completedAt) ? { completedAt: normalizeDateOrUndefined(legalOpinionRaw.completedAt) } : {}),
          ...(normalizeDateOrUndefined(legalOpinionRaw.closedAt) ? { closedAt: normalizeDateOrUndefined(legalOpinionRaw.closedAt) } : {}),
        }
      : undefined;

  return {
    stageStatus: toEnum(body.stageStatus, STAGE_STATUSES),
    stageStartedAt,
    stageDueAt,
    stageCompletedAt: normalizeDateOrUndefined(body.stageCompletedAt),
    ...(cleanString(body.stageCompletedBy) ? { stageCompletedBy: cleanString(body.stageCompletedBy) } : {}),
    ...(cleanString(body.delayReason) ? { delayReason: cleanString(body.delayReason) } : {}),
    waitingOn: toEnum(body.waitingOn, WAITING_ON),
    ...(cleanString(body.outstandingRequirement) ? { outstandingRequirement: cleanString(body.outstandingRequirement) } : {}),
    ...(stageChecklist ? { stageChecklist } : {}),
    lastContactDate: normalizeDateOrUndefined(body.lastContactDate),
    lastFollowUpDate: normalizeDateOrUndefined(body.lastFollowUpDate),
    nextFollowUpDate: normalizeDateOrUndefined(body.nextFollowUpDate),
    ...(Number.isFinite(Number(body.followUpCount)) ? { followUpCount: Number(body.followUpCount) } : {}),
    ...(cleanString(body.followUpStatus) ? { followUpStatus: cleanString(body.followUpStatus) } : {}),
    escalationRequiredAt: normalizeDateOrUndefined(body.escalationRequiredAt),
    ...(typeof body.clientResponseReceived === 'boolean' ? { clientResponseReceived: body.clientResponseReceived } : {}),
    ...(cleanString(body.followUpOutcome) ? { followUpOutcome: cleanString(body.followUpOutcome) } : {}),
    ...(legalOpinion ? { legalOpinion } : {}),
  };
};

/**
 * When a prospect moves to a new stage, reset that stage's timing and append an
 * audit-trail entry to stageHistory so the full journey is preserved.
 */
const pushStageHistory = (prospect: any, entry: Record<string, unknown>) => {
  const history = Array.isArray(prospect.stageHistory) ? prospect.stageHistory : [];
  prospect.stageHistory = [...history, { ...entry, recordedAt: new Date() }];
};

const applyStageTransition = (prospect: any, nextStage: string, wf: ReturnType<typeof getWorkflowControlPayload>) => {
  const slaHours = getStageSlaHours(nextStage);
  const startedAt = wf.stageStartedAt || new Date();
  prospect.stage = nextStage;
  prospect.stageStatus = wf.stageStatus || 'In Progress';
  prospect.stageStartedAt = startedAt;
  prospect.stageDueAt = slaHours > 0 ? addSlaToDate(startedAt, slaHours) : undefined;
  prospect.stageCompletedAt = undefined;
  prospect.stageCompletedBy = undefined;
  if (wf.stageChecklist) prospect.stageChecklist = wf.stageChecklist;
  if (wf.waitingOn) prospect.waitingOn = wf.waitingOn;
  if (isTerminalStage(nextStage)) {
    prospect.stageStatus = wf.stageStatus || 'Completed';
    prospect.stageCompletedAt = prospect.stageCompletedAt || new Date();
    prospect.waitingOn = wf.waitingOn || 'None';
  }
  pushStageHistory(prospect, {
    stage: nextStage,
    status: prospect.stageStatus,
    startedAt,
    dueAt: prospect.stageDueAt,
    completedAt: prospect.stageCompletedAt,
    waitingOn: prospect.waitingOn,
    outstandingRequirement: wf.outstandingRequirement,
  });
};


const getProspectPayload = (body: any, fallbackUserId?: string) => {
  const responsibleAssociate = cleanString(body.responsibleAssociate) || cleanString(body.assignedTo) || fallbackUserId || '';
  const responsiblePartner = cleanString(body.responsiblePartner);
  const assignedTo = cleanString(body.assignedTo) || responsibleAssociate || fallbackUserId || '';
  const clientName = cleanString(body.clientName);
  const stage = validStages.includes(cleanString(body.stage)) ? cleanString(body.stage) : 'Inquiry';
  const conversionOutcome = cleanString(body.conversionOutcome);
  return {
    parties: cleanString(body.parties) || clientName,
    clientName,
    enquiryNature: cleanString(body.enquiryNature),
    priorityLevel: ['High', 'Medium', 'Low'].includes(cleanString(body.priorityLevel))
      ? cleanString(body.priorityLevel)
      : 'Medium',
    enquirySource: cleanString(body.enquirySource),
    referralSource: cleanString(body.referralSource),
    estimatedMatterValue: toOptionalNumber(body.estimatedMatterValue),
    estimatedMatterCurrency: normalizeCurrency(body.estimatedMatterCurrency) || 'RWF',
    estimatedFeeValue: toOptionalNumber(body.estimatedFeeValue),
    completedStages: normalizeCompletedStagesForStage(body.completedStages, stage),
    practiceArea: normalizePracticeArea(body.practiceArea),
    subPracticeActions: Array.isArray(body.subPracticeActions)
      ? body.subPracticeActions.map((item: unknown) => cleanString(item)).filter(Boolean)
      : [],
    paymentArrangement: normalizePaymentArrangement(body.paymentArrangement),
    paymentMethod: normalizePaymentMethod(body.paymentMethod),
    installmentCount: toOptionalNumber(body.installmentCount),
    depositAmount: toOptionalNumber(body.depositAmount),
    contact: {
      name: cleanString(body.contact?.name) || clientName,
      email: cleanString(body.contact?.email) || undefined,
      phone: cleanString(body.contact?.phone) || undefined,
      ...(cleanString(body.contact?.position) ? { position: cleanString(body.contact.position) } : {}),
    },
    responsiblePartner: responsiblePartner || undefined,
    responsibleAssociate: responsibleAssociate || undefined,
    legalServicePath: Array.isArray(body.legalServicePath)
      ? body.legalServicePath
          .map((item: any) => ({
            id: cleanString(item?.id),
            label: cleanString(item?.label),
          }))
          .filter((item: any) => item.id && item.label)
      : [],
    inquiryDescription: cleanString(body.inquiryDescription),
    stage,
    engagementNotes: cleanString(body.engagementNotes),
    conversionOutcome: conversionOutcome || undefined,
    conversionReason: cleanString(body.conversionReason) || conversionOutcome || undefined,
    assignedTo,
    // Workflow-control layer (only the keys the caller actually sent, so a
    // partial update never wipes timing/history it did not intend to touch).
    ...pruneUndefined(getWorkflowControlPayload({ ...body, stage })),
  };
};

const validateProspectPayload = async (payload: ReturnType<typeof getProspectPayload>, rawBody?: any) => {
  // Single-currency enforcement: reject any non-RWF currency explicitly sent by the client.
  const rawCurrency = cleanString(rawBody?.estimatedMatterCurrency);
  if (rawCurrency && !isRwfCurrency(rawCurrency)) return RWF_ONLY_MESSAGE;
  if (!payload.clientName) return 'Client name is required.';
  if (!payload.contact.name) return 'Contact person is required.';
  if (!payload.inquiryDescription) return 'Inquiry description is required.';
  if (!payload.legalServicePath?.length) return 'Please select a legal service classification.';
  if (!payload.responsiblePartner) return 'Responsible partner is required.';
  if (!payload.responsibleAssociate) return 'Responsible associate is required.';
  
  if (!payload.assignedTo) {
    return 'Please select a staff member to assign this prospect to.';
  }
  
  if (!mongoose.Types.ObjectId.isValid(payload.assignedTo)) {
    return 'Invalid staff member ID. Please select a valid staff member.';
  }

  const assigneeExists = await User.exists({ _id: payload.assignedTo, isActive: true });
  if (!assigneeExists) return 'The selected staff member was not found or is inactive. Please select another staff member.';

  if (payload.responsiblePartner && !mongoose.Types.ObjectId.isValid(payload.responsiblePartner)) {
    return 'Invalid responsible partner. Please select a valid staff member.';
  }

  if (payload.responsibleAssociate && !mongoose.Types.ObjectId.isValid(payload.responsibleAssociate)) {
    return 'Invalid responsible associate. Please select a valid staff member.';
  }

  if (payload.contact.email) {
    const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.contact.email);
    if (!emailLooksValid) return 'Please enter a valid contact email address.';
  }

  if (terminalStages.includes(payload.stage as any)) {
    if (!payload.conversionOutcome) {
      return 'Please select a conversion outcome before closing this prospect.';
    }

    const validOutcome = terminalStages.includes(payload.stage as any)
      ? (payload.stage === 'Converted'
          ? convertedOutcomes.includes(payload.conversionOutcome)
          : nonConvertedOutcomes.includes(payload.conversionOutcome))
      : true;

    if (!validOutcome) {
      return 'Please select a valid conversion outcome for the selected closing stage.';
    }
  }

  return null;
};

const generateProspectNo = () => buildYearlySequence('prospect', 'PROS');

const buildFeedbackEmailHtml = (prospectId: string) => {
  const publicUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/public/feedback/${prospectId}`;
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
        <a href="${publicUrl}" style="display:inline-block;padding:12px 18px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:700;">Provide Quick Feedback</a>
      </div>
    </div>
  `;
};

const createMatterFromProspect = async (
  prospect: any,
  actorName: string,
  matterStatus: 'Active' | 'Closed' | 'Temporarily Closed'
) => {
  if (!prospect) return null;
  const isTemporaryMatter = matterStatus === 'Temporarily Closed';
  const linkedMatterId = isTemporaryMatter ? prospect.temporaryClosedMatterId : prospect.convertedToMatters;
  if (linkedMatterId) {
    const existingMatter: any = await Case.findById(linkedMatterId);
    if (isTemporaryMatter && existingMatter) {
      const existingStatus = String(existingMatter.status || '').trim();
      // A matter returned to Intake can be put on hold again. An Active or
      // Closed matter, however, is a different lifecycle and must never be
      // silently repurposed as the intake hold record.
      if (existingStatus === 'Temporarily Closed' || existingStatus === 'Returned to Intake') {
        if (existingStatus !== 'Temporarily Closed') {
          existingMatter.status = 'Temporarily Closed';
          await existingMatter.save();
        }
        prospect.isActive = false;
        prospect.isTemporarilyClosed = true;
        prospect.temporarilyClosedAt = prospect.temporarilyClosedAt || new Date();
        prospect.temporarilyClosedBy = prospect.temporarilyClosedBy || actorName || 'System';
        await prospect.save();
        return existingMatter;
      }
    }

    if (!isTemporaryMatter) {
    if (prospect.isActive !== false) {
      prospect.isActive = false;
      prospect.engagementDate = prospect.engagementDate || new Date();
      await prospect.save();
    }

      return Case.findById(prospect.convertedToMatters).lean();
    }
  }

  const assigneeSource = prospect.responsibleAssociate || prospect.assignedTo;
  const assignee = await User.findById(assigneeSource).select('name').lean();
  const assigneeName = assignee?.name || actorName || 'Unassigned';
  const caseNo = await buildYearlySequence('case', 'CASE');

  // Derive structured assignments so non-admin roles can see the matter too:
  // the prospect's responsible associate becomes initiator, responsible partner
  // becomes reviewer, and the actor becomes signer/approver.
  const partnerSource = prospect.responsiblePartner;
  const partner = partnerSource ? await User.findById(partnerSource).select('name').lean() : null;
  const initiatorName = assignee?.name || actorName || 'Unassigned';
  const reviewerName = partner?.name || '';
  const signerName = actorName && actorName !== 'Unassigned' ? actorName : reviewerName || initiatorName;
  const caseAssignments = {
    ...(initiatorName ? { initiator: initiatorName } : {}),
    ...(reviewerName ? { reviewer: reviewerName } : {}),
    ...(signerName ? { signerApprover: signerName } : {}),
  };
  const assignedToDisplay = [
    initiatorName ? `Initiator: ${initiatorName}` : '',
    reviewerName ? `Reviewer: ${reviewerName}` : '',
    signerName ? `Signer/Approver: ${signerName}` : '',
  ].filter(Boolean).join(' | ') || assigneeName;

  const newCase = new Case({
    caseNo,
    parties: prospect.parties || prospect.clientName,
    description: prospect.inquiryDescription,
    legalServicePath: prospect.legalServicePath || [],
    clientContacts: [
      {
        name: prospect.contact.name,
        email: prospect.contact.email || undefined,
        phone: prospect.contact.phone || undefined,
        isPrimary: true,
      },
    ],
    assignedTo: assignedToDisplay,
    ...(Object.keys(caseAssignments).length ? { caseAssignments } : {}),
    ...(isTemporaryMatter ? { intakeProspectId: prospect._id } : {}),
    status: matterStatus,
    priority: 'Medium',
    caseType: 'Transactional Cases',
    billingSettings: {
      paymentMode: 'postpaid',
      currency: SINGLE_CURRENCY,
    },
    matterTiming: matterStatus === 'Closed' ? 'historical' : 'new',
    workflowAutomation: matterStatus !== 'Closed',
    onboarding: {
      conflictCheckStatus: prospect.conflictCheckStatus || 'Pending',
      conflictCheckedAt: prospect.conflictCheckDate,
    },
  });

  const savedCase = await newCase.save();

  // Attach a workflow so the matter behaves like a normal Active Matter:
  // resolve the canonical template from the prospect's legal-service path,
  // create its instance, and seed planned/completed values.
  if (matterStatus !== 'Closed') {
    try {
      const labels = Array.isArray(prospect.legalServicePath) ? prospect.legalServicePath : [];
      const leafLabel = labels.length ? String(labels[labels.length - 1]?.label || '') : '';
      const templates: any[] = await WorkflowTemplate.find({ active: true }).lean();
      const template = resolveCanonicalTemplateForCase(templates, {
        matterType: leafLabel || prospect.enquiryNature,
        name: leafLabel || prospect.enquiryNature,
        caseType: 'Transactional Cases',
      }) || templates.find((t) => normalizeTemplateMatchValue(t?.matterType) && normalizeTemplateMatchValue(leafLabel || prospect.enquiryNature || '').includes(normalizeTemplateMatchValue(t?.matterType)));
      if (template) {
        const startDate = resolveDeadlineDateTime(new Date()) || new Date();
        const steps = buildInstanceSteps(template, startDate);
        const inst = await WorkflowInstance.create({
          caseId: savedCase._id,
          templateId: template._id,
          status: 'Active',
          currentStepKey: steps[0]?.stepKey,
          steps,
        });
        const plannedAmount = Number(prospect.estimatedFeeValue || prospect.estimatedMatterValue) || undefined;
        // Fresh workflow: nothing is checked yet, so progress starts at 0.
        const startPercent = computeCompletedPercentFromInstance(steps as any[]);
        const startCompleted = typeof plannedAmount === 'number' ? Math.round((plannedAmount * startPercent) / 100) : 0;
        savedCase.workflowTemplateId = template._id as any;
        savedCase.workflowInstanceId = inst._id as any;
        savedCase.matterType = template.matterType;
        savedCase.workflow = template.matterType;
        savedCase.caseType = template.caseType;
        savedCase.workflowStartDate = startDate;
        savedCase.workflowProgress = {
          status: 'In Progress',
          percent: startPercent,
          ...(inst.currentStepKey ? { currentStepKey: inst.currentStepKey } : {}),
          ...(steps[0]?.title ? { currentStepTitle: steps[0].title } : {}),
          ...(steps[0]?.startAt ? { currentStepStartAt: steps[0].startAt } : {}),
          ...(steps[0]?.dueAt ? { currentStepDueAt: steps[0].dueAt } : {}),
          nextDueAt: steps[0]?.dueAt,
          plannedValue: { ...(typeof plannedAmount === 'number' ? { amount: plannedAmount } : {}), currency: SINGLE_CURRENCY },
          completedValue: { amount: startCompleted, currency: SINGLE_CURRENCY },
        } as any;
        (savedCase as any).billingSettings = {
          ...((savedCase as any).billingSettings || {}),
          currency: SINGLE_CURRENCY,
          prepaidTotal: 0,
          prepaidRemaining: 0,
          accruedUnbilled: startCompleted,
        };
        await savedCase.save();
      } else {
        savedCase.workflowProgress = {
          status: 'Not Started',
          percent: 0,
          plannedValue: { currency: SINGLE_CURRENCY } as any,
          completedValue: { amount: 0, currency: SINGLE_CURRENCY } as any,
        } as any;
        await savedCase.save();
      }
    } catch (err) {
      console.error('attach workflow to converted prospect matter failed:', err);
    }
  }

  if (isTemporaryMatter) {
    prospect.temporaryClosedMatterId = savedCase._id;
    prospect.isActive = false;
    prospect.isTemporarilyClosed = true;
    prospect.temporarilyClosedAt = new Date();
    prospect.temporarilyClosedBy = actorName || 'System';
  } else {
    prospect.convertedToMatters = savedCase._id;
    prospect.stage = matterStatus === 'Closed' ? 'Non-Converted' : 'Converted';
    prospect.engagementDate = new Date();
    prospect.isActive = false;
  }
  await prospect.save();

  return savedCase;
};

const getMatterStatusForProspectStage = (stage?: string): 'Active' | 'Closed' | null => {
  const normalized = cleanString(stage);
  if (normalized === 'Converted') return 'Active';
  if (normalized === 'Non-Converted') return 'Closed';
  return null;
};

export const reconcileTerminalProspects = async () => {
  const terminalProspects = await Prospect.find({
    stage: { $in: terminalStages },
  });

  let reconciledCount = 0;

  for (const prospect of terminalProspects) {
    const matterStatus = getMatterStatusForProspectStage(prospect.stage);
    if (!matterStatus) continue;

    const linkedCaseExists = prospect.convertedToMatters ? await Case.exists({ _id: prospect.convertedToMatters }) : false;
    if (!linkedCaseExists) {
      await createMatterFromProspect(prospect, 'System', matterStatus);
      reconciledCount += 1;
      continue;
    }

    if (prospect.isActive !== false) {
      prospect.isActive = false;
      prospect.engagementDate = prospect.engagementDate || new Date();
      await prospect.save();
      reconciledCount += 1;
    }
  }

  return reconciledCount;
};

const sendProspectFeedbackEmail = async (prospect: any) => {
  const emailAddress = String(prospect?.contact?.email || '').trim();
  if (!emailAddress) return { ok: false, error: 'Missing prospect email.' };

  const html = buildFeedbackEmailHtml(String(prospect._id));
  const result = await sendEmailResend([emailAddress], 'Thank you for connecting with Colin & Colin Legal Solutions', html);

  const feedback = await ProspectFeedback.findOne({ prospectId: prospect._id });
  if (feedback) {
    feedback.feedbackEmailSentAt = result.ok ? new Date() : undefined as any;
    await feedback.save();
  }

  return result;
};

export const getAllProspects = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageProspects(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const { stage, assignedTo, isActive } = req.query;
    const filter: any = {};
    const requestedStage = cleanString(stage);
    const includeTerminal = String((req.query as any)?.includeTerminal || '').toLowerCase() === 'true';

    if (requestedStage && terminalStages.includes(requestedStage as any) && !includeTerminal) {
      return res.json([]);
    }

    if (requestedStage) filter.stage = requestedStage;
    if (!requestedStage && !includeTerminal) {
      filter.stage = { $nin: terminalStages };
    }
    if (assignedTo) filter.assignedTo = assignedTo;
    filter.isActive = isActive !== undefined ? isActive === 'true' : true;

    const prospects = await Prospect.find(filter)
      .populate('assignedTo', 'name email')
      .populate('responsiblePartner', 'name email role')
      .populate('responsibleAssociate', 'name email role')
      .populate('createdBy', 'name email')
      .sort({ dateReceived: -1 });

    return res.json(prospects);
  } catch (error) {
    console.error('getAllProspects error:', error);
    return res.status(500).json({ message: 'Failed to fetch prospects.' });
  }
};

/**
 * Put a live intake record into the normal Matter lifecycle under
 * Temporarily Closed. The prospect leaves Intake immediately; the linked
 * matter retains the workflow and is the only place it can be reopened.
 */
export const moveProspectToTemporaryMatter = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageProspects(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });
    const prospectId = getRouteId(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) return res.status(400).json({ message: 'Invalid prospect ID.' });
    const prospect: any = await Prospect.findById(prospectId);
    if (!prospect) return res.status(404).json({ message: 'Prospect not found.' });
    if (terminalStages.includes(String(prospect.stage))) {
      return res.status(400).json({ message: 'Converted or non-converted prospects cannot be temporarily closed.' });
    }

    const alreadyTemporarilyClosed = Boolean(prospect.isTemporarilyClosed);
    const matter: any = await createMatterFromProspect(prospect, req.user?.name || 'System', 'Temporarily Closed');
    if (!matter) return res.status(500).json({ message: 'Failed to create the temporary matter.' });

    if (!alreadyTemporarilyClosed) {
      pushStageHistory(prospect, {
        stage: prospect.stage,
        status: 'Temporarily Closed',
        startedAt: prospect.stageStartedAt,
        dueAt: prospect.stageDueAt,
        waitingOn: prospect.waitingOn,
      });
      await prospect.save();
    }

    return res.json({ prospect, matter: { _id: matter._id, caseNo: matter.caseNo, status: matter.status } });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Failed to move prospect to temporarily closed matters.' });
  }
};

export const getProspectById = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageProspects(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const prospectId = getRouteId(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }

    const prospect = await Prospect.findById(prospectId)
      .populate('assignedTo', 'name email')
      .populate('responsiblePartner', 'name email role')
      .populate('responsibleAssociate', 'name email role')
      .populate('createdBy', 'name email')
      .populate('convertedToMatters', 'caseNo');

    if (!prospect) {
      return res.status(404).json({ message: 'Prospect not found.' });
    }

    return res.json(prospect);
  } catch (error) {
    console.error('getProspectById error:', error);
    return res.status(500).json({ message: 'Failed to fetch prospect.' });
  }
};

export const createProspect = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageProspects(req.user?.role)) {
      return res.status(403).json({ message: 'You do not have permission to create prospects.' });
    }

    const payload = getProspectPayload(req.body, req.user?.id);
    const validationMessage = await validateProspectPayload(payload, req.body);
    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const prospectNo = await generateProspectNo();
    const prospect = new Prospect({
      ...payload,
      prospectNo,
      createdBy: req.user?.id,
      dateReceived: new Date(),
      isActive: true,
    });

    // Seed the workflow-control layer: timing for the opening stage + its first
    // stage-history audit entry.
    const openingStage = prospect.stage;
    const openingStart = prospect.stageStartedAt || new Date();
    prospect.stageStartedAt = openingStart;
    prospect.stageStatus = prospect.stageStatus || (terminalStages.includes(openingStage as any) ? 'Completed' : 'In Progress');
    const openingSla = getStageSlaHours(openingStage);
    (prospect as any).stageDueAt = prospect.stageDueAt || (openingSla > 0 ? addSlaToDate(openingStart, openingSla) : undefined);
    if (terminalStages.includes(openingStage as any)) {
      prospect.stageCompletedAt = prospect.stageCompletedAt || new Date();
      prospect.waitingOn = prospect.waitingOn || 'None';
    }
    pushStageHistory(prospect, {
      stage: openingStage,
      status: prospect.stageStatus,
      startedAt: openingStart,
      dueAt: prospect.stageDueAt,
      completedAt: prospect.stageCompletedAt,
      waitingOn: prospect.waitingOn,
    });

    const saved = await prospect.save();
    if (terminalStages.includes(saved.stage as any)) {
      await createMatterFromProspect(
        saved,
        req.user?.name || 'System',
        saved.stage === 'Converted' ? 'Active' : 'Closed'
      );
    }
    const populated = await Prospect.findById(saved._id)
      .populate('assignedTo', 'name email')
      .populate('responsiblePartner', 'name email role')
      .populate('responsibleAssociate', 'name email role')
      .populate('createdBy', 'name email');

    return res.status(201).json(populated);
  } catch (error: any) {
    console.error('createProspect error:', error);
    if (error?.name === 'ValidationError') {
      const messages = Object.values(error.errors)
        .map((e: any) => e.message)
        .join('; ');
      return res.status(400).json({ message: `Validation error: ${messages}` });
    }
    if (error?.code === 11000) {
      return res.status(400).json({ message: 'A prospect with this information already exists.' });
    }
    return res.status(500).json({ message: error?.message || 'Failed to create prospect.' });
  }
};

export const updateProspect = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageProspects(req.user?.role)) {
      return res.status(403).json({ message: 'You do not have permission to update prospects.' });
    }

    const prospectId = getRouteId(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }

    const prospect = await Prospect.findById(prospectId);
    if (!prospect) {
      return res.status(404).json({ message: 'Prospect not found.' });
    }

    const updates = getProspectPayload(req.body, String(prospect.assignedTo));
    const validationMessage = await validateProspectPayload(updates, req.body);
    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    // A prospect/intake handover changes only the person accountable for the
    // live stage. Its checklist ticks, SLA clock, follow-ups and stage history
    // remain on the same record, while this trail keeps the previous owner
    // visible to the incoming person and to future reporting/audits.
    const assignmentSpecs = [
      { field: 'assignedTo', role: 'Assigned To' },
      { field: 'responsibleAssociate', role: 'Responsible Associate' },
      { field: 'responsiblePartner', role: 'Responsible Partner' },
    ] as const;
    const changedAssignments = assignmentSpecs
      .map(({ field, role }) => ({
        role,
        previousId: String((prospect as any)[field] || ''),
        nextId: String((updates as any)[field] || ''),
      }))
      .filter(({ previousId, nextId }) => previousId !== nextId);
    if (changedAssignments.length) {
      const ids = Array.from(
        new Set(
          changedAssignments
            .flatMap(({ previousId, nextId }) => [previousId, nextId])
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
        )
      );
      const people = ids.length ? await User.find({ _id: { $in: ids } }).select('name').lean() : [];
      const namesById = new Map((people as any[]).map((person) => [String(person._id), String(person.name || '').trim()]));
      const reassignedAt = new Date();
      (prospect as any).assignmentHistory = [
        ...(Array.isArray((prospect as any).assignmentHistory) ? (prospect as any).assignmentHistory : []),
        ...changedAssignments.map(({ role, previousId, nextId }) => ({
          role,
          ...(mongoose.Types.ObjectId.isValid(previousId) ? { previousAssigneeId: new mongoose.Types.ObjectId(previousId) } : {}),
          ...(namesById.get(previousId) ? { previousAssigneeName: namesById.get(previousId) } : {}),
          ...(mongoose.Types.ObjectId.isValid(nextId) ? { nextAssigneeId: new mongoose.Types.ObjectId(nextId) } : {}),
          ...(namesById.get(nextId) ? { nextAssigneeName: namesById.get(nextId) } : {}),
          reassignedAt,
          reassignedBy: req.user?.name || 'System',
        })),
      ];
    }

    const shouldSendFeedbackEmail = prospect.stage !== 'Non-Converted' && updates.stage === 'Non-Converted';

    // Workflow-control layer: when the active stage actually changes, reset that
    // stage's timing/checklist and append a fresh stage-history audit entry.
    const stageChanged = prospect.stage !== updates.stage;
    const wfUpdates = getWorkflowControlPayload({ ...req.body, stage: updates.stage });

    // Update fields
    (Object.keys(updates) as Array<keyof typeof updates>).forEach((key) => {
      (prospect as any)[key] = updates[key];
    });

    if (stageChanged) {
      applyStageTransition(prospect, updates.stage, wfUpdates);
    } else {
      // Same stage: merge only the workflow-control fields the caller actually
      // sent so a plain edit never clobbers timing or history.
      const merged = pruneUndefined(wfUpdates as Record<string, unknown>);
      // Preserve the existing stage clock / checklist / history when the caller
      // did not explicitly change them.
      if (!('stageStartedAt' in req.body) && prospect.stageStartedAt) {
        merged.stageStartedAt = prospect.stageStartedAt;
        merged.stageDueAt =
          prospect.stageDueAt || (getStageSlaHours(updates.stage) > 0
            ? addSlaToDate(prospect.stageStartedAt as Date, getStageSlaHours(updates.stage))
            : undefined);
      }
      if (!('stageChecklist' in req.body) && Array.isArray(prospect.stageChecklist)) {
        merged.stageChecklist = prospect.stageChecklist;
      }
      if (!('stageHistory' in req.body) && Array.isArray(prospect.stageHistory)) {
        merged.stageHistory = prospect.stageHistory;
      }
      if (!('stageStatus' in req.body) && prospect.stageStatus) {
        merged.stageStatus = prospect.stageStatus;
      }
      Object.assign(prospect, merged);
    }

    const saved = await prospect.save();

    if (saved.stage === 'Converted' && !saved.convertedToMatters) {
      await createMatterFromProspect(saved, req.user?.name || 'System', 'Active');
    }

    if (saved.stage === 'Non-Converted' && !saved.convertedToMatters) {
      await createMatterFromProspect(saved, req.user?.name || 'System', 'Closed');
    }

    if (terminalStages.includes(saved.stage as any) && saved.isActive !== false) {
      saved.isActive = false;
      await saved.save();
    }

    if (shouldSendFeedbackEmail) {
      await sendProspectFeedbackEmail(saved);
    }

    const populated = await Prospect.findById(saved._id)
      .populate('assignedTo', 'name email')
      .populate('responsiblePartner', 'name email role')
      .populate('responsibleAssociate', 'name email role')
      .populate('createdBy', 'name email')
      .populate('convertedToMatters', 'caseNo status');

    return res.json({ ...populated!.toObject(), matterId: (populated as any)?.convertedToMatters?._id || (populated as any)?.convertedToMatters || null });
  } catch (error: any) {
    console.error('updateProspect error:', error);
    if (error?.name === 'ValidationError') {
      const messages = Object.values(error.errors)
        .map((e: any) => e.message)
        .join('; ');
      return res.status(400).json({ message: `Validation error: ${messages}` });
    }
    return res.status(500).json({ message: error?.message || 'Failed to update prospect.' });
  }
};

/**
 * Record a client/third-party follow-up against a prospect (workflow control).
 * Appends an audit entry to stageHistory and advances the follow-up clock.
 */
export const recordProspectFollowUp = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageProspects(req.user?.role)) {
      return res.status(403).json({ message: 'You do not have permission to update prospects.' });
    }
    const prospectId = getRouteId(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }
    const prospect = await Prospect.findById(prospectId);
    if (!prospect) return res.status(404).json({ message: 'Prospect not found.' });

    const now = new Date();
    const nextFollowUpDate = normalizeDateOrUndefined(req.body?.nextFollowUpDate);
    const outcome = cleanString(req.body?.outcome) || cleanString(req.body?.followUpOutcome);
    const waitingOn = toEnum(req.body?.waitingOn, WAITING_ON) || 'Client';
    const clientResponseReceived =
      typeof req.body?.clientResponseReceived === 'boolean' ? req.body.clientResponseReceived : false;

    prospect.lastFollowUpDate = now;
    prospect.lastContactDate = now;
    prospect.followUpCount = Number(prospect.followUpCount || 0) + 1;
    prospect.followUpStatus = 'Awaiting Response';
    prospect.waitingOn = waitingOn;
    prospect.clientResponseReceived = clientResponseReceived;
    if (nextFollowUpDate) prospect.nextFollowUpDate = nextFollowUpDate;
    if (outcome) prospect.followUpOutcome = outcome;

    pushStageHistory(prospect, {
      stage: prospect.stage,
      status: prospect.stageStatus || 'In Progress',
      startedAt: prospect.stageStartedAt,
      dueAt: prospect.stageDueAt,
      completedAt: undefined,
      waitingOn,
      outstandingRequirement: prospect.outstandingRequirement,
    });

    const saved = await prospect.save();
    return res.json(saved);
  } catch (error: any) {
    console.error('recordProspectFollowUp error:', error);
    return res.status(500).json({ message: error?.message || 'Failed to record follow-up.' });
  }
};

/**
 * Toggle a single mandatory Key Action (checklist item) on the current stage.
 * Records who ticked it and when for the stage-gate / audit trail.
 */
export const toggleProspectChecklistItem = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageProspects(req.user?.role)) {
      return res.status(403).json({ message: 'You do not have permission to update prospects.' });
    }
    const prospectId = getRouteId(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }
    const prospect = await Prospect.findById(prospectId);
    if (!prospect) return res.status(404).json({ message: 'Prospect not found.' });

    const key = cleanString(req.body?.key) || stageChecklistKey(cleanString(req.body?.label));
    const label = cleanString(req.body?.label);
    const done = Boolean(req.body?.done);
    const stageConfig = getStageConfig(prospect.stage);
    const canonical = stageConfig?.checklist.find((item) => stageChecklistKey(item) === key);
    const resolvedLabel = label || canonical || key;
    if (!key) return res.status(400).json({ message: 'A checklist item key or label is required.' });

    const existing = Array.isArray(prospect.stageChecklist) ? prospect.stageChecklist : [];
    const idx = existing.findIndex((item) => item.key === key || stageChecklistKey(item.label) === key);
    const nextItem = {
      key,
      label: resolvedLabel,
      done,
      ...(done ? { doneBy: req.user?.name || cleanString(req.body?.doneBy) || 'System', doneAt: new Date() } : { doneBy: undefined, doneAt: undefined }),
    };
    const nextChecklist = idx >= 0
      ? existing.map((item, i) => (i === idx ? ({ ...item, ...nextItem } as any) : item))
      : [...existing, nextItem as any];
    prospect.stageChecklist = nextChecklist;

    const saved = await prospect.save();
    return res.json(saved);
  } catch (error: any) {
    console.error('toggleProspectChecklistItem error:', error);
    return res.status(500).json({ message: error?.message || 'Failed to update checklist item.' });
  }
};


export const deleteProspect = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const prospectId = getRouteId(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }

    const prospect = await Prospect.findByIdAndDelete(prospectId);
    if (!prospect) {
      return res.status(404).json({ message: 'Prospect not found.' });
    }

    return res.json({ message: 'Prospect deleted successfully.' });
  } catch (error) {
    console.error('deleteProspect error:', error);
    return res.status(500).json({ message: 'Failed to delete prospect.' });
  }
};

export const getProspectStats = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageProspects(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const stats = await Prospect.aggregate([
      {
        $match: {
          isActive: true,
          stage: { $nin: terminalStages },
        },
      },
      {
        $group: {
          _id: '$stage',
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    const result = {
      Inquiry: 0,
      Consultation: 0,
      'Conflict Check': 0,
      Quotation: 0,
      'Quotation Preparation': 0,
      'Conversion Assessment': 0,
      'Quotation Issued': 0,
      'Awaiting Client Decision': 0,
      'Final Follow-Up': 0,
      Engagement: 0,
      Converted: 0,
      'Non-Converted': 0,
    };

    stats.forEach((stat: any) => {
      result[stat._id as keyof typeof result] = stat.count;
    });

    return res.json(result);
  } catch (error) {
    console.error('getProspectStats error:', error);
    return res.status(500).json({ message: 'Failed to fetch prospect stats.' });
  }
};

/**
 * Convert prospect to matter
 * - Creates a new Case from prospect data
 * - Links prospect to case via convertedToMatters
 * - Updates prospect stage to the corresponding terminal state
 */
export const convertProspectToMatter = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const prospectId = getRouteId(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(prospectId)) {
      return res.status(400).json({ message: 'Invalid prospect ID.' });
    }

    const prospect = await Prospect.findById(prospectId);
    if (!prospect) {
      return res.status(404).json({ message: 'Prospect not found.' });
    }

    if (prospect.convertedToMatters) {
      return res.status(400).json({ message: 'Prospect already converted to matter.' });
    }

    if (String(prospect.stage) !== 'Converted') {
      return res.status(400).json({ message: 'Prospect must be marked Converted before converting to matter.' });
    }

    if (!String((prospect as any).conversionOutcome || '').trim()) {
      return res.status(400).json({ message: 'Please record a conversion outcome before converting this prospect.' });
    }

    const savedCase = await createMatterFromProspect(prospect, req.user?.name || 'System', 'Active');

    return res.json({
      message: 'Prospect converted to matter successfully.',
      prospect,
      matter: savedCase,
    });
  } catch (error) {
    console.error('convertProspectToMatter error:', error);
    return res.status(500).json({ message: 'Failed to convert prospect to matter.' });
  }
};
