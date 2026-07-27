import { Response } from 'express';
import mongoose from 'mongoose';
import Case from '../models/caseModel';
import Task from '../models/taskModel';
import CaseTakeRequest from '../models/caseTakeRequestModel';
import { writeAudit } from '../services/auditService';
import { AuthRequest } from '../middleware/authMiddleware';
import { notifyRoles, notifyUsersById, findUserByAssigneeString } from '../services/notifyService';

import WorkflowTemplate from '../models/workflowTemplateModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import { buildInstanceSteps } from '../utils/workflowCompute';
import { buildYearlySequence } from '../utils/counter';
import { isPublicYellowCase } from '../utils/caseVisibility';

const actorFromReq = (req: AuthRequest) => ({
  actorName: req.user?.name || 'System',
  actorUserId: req.user?.id as string | undefined,
});

const isAdminCaseRole = (role?: string) =>
  role === 'managing_director' ||
  role === 'managing_partner' ||
  role === 'executive_managing_partner' ||
  role === 'senior_partner' ||
  role === 'partner' ||
  role === 'executive_partner' ||
  role === 'associate_partner' ||
  role === 'executive_associate_partner' ||
  role === 'senior_executive_assistant' ||
  role === 'originating_attorney' ||
  role === 'executive_assistant';

const isAssociateLikeRole = (role?: string) =>
  role === 'associate' ||
  role === 'trainee_associate' ||
  role === 'senior_associate' ||
  role === 'intern';

const TAKE_REQUEST_APPROVER_ROLES = ['executive_assistant', 'managing_partner'] as const;
const TAKE_REQUEST_LOCK_MINUTES = 15;
const takeRequestExpiry = () => new Date(Date.now() + TAKE_REQUEST_LOCK_MINUTES * 60 * 1000);

const getTakeRequestState = (c: any) => c?.takeRequestState || { status: 'idle' };
const isTakeRequestPending = (c: any) => String(getTakeRequestState(c)?.status || '').trim().toLowerCase() === 'pending';
const isTakeRequestClaimed = (c: any) => String(getTakeRequestState(c)?.status || '').trim().toLowerCase() === 'claimed';
const isTakeRequestExpired = (c: any) => {
  const expiresAt = getTakeRequestState(c)?.lockExpiresAt;
  if (!expiresAt) return false;
  const ms = new Date(expiresAt).getTime();
  return Number.isFinite(ms) ? ms <= Date.now() : false;
};
const canTakeRequestAccess = (c: any) => isPublicYellowCase(c) && !isTakeRequestClaimed(c);

const canAssociateLikeAccessCase = async (req: AuthRequest, foundCase: any) => {
  if (!isAssociateLikeRole(req.user?.role)) return false;

  if (isPublicYellowCase(foundCase)) return true;

  const me = (req.user?.name || '').trim();
  if (!me) return false;

  const assignedTo = String(foundCase.assignedTo || '').trim();
  if (assignedTo && assignedTo === me) return true;

  const hasTask = await Task.exists({
    caseId: foundCase._id,
    assignee: me,
  });

  return Boolean(hasTask);
};

const parseMoney = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
  const n = Number(String(value || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const calculateActionProgress = (steps: any[], plannedAmount: number) => {
  const actions = (steps || []).flatMap((step: any) => (Array.isArray(step.actions) ? step.actions : []));
  const checked = actions.filter((action: any) => Boolean(action?.done)).length;
  const total = actions.length;
  const percent = total > 0 ? Math.round((checked / total) * 100) : 0;
  return { percent, completedAmount: Math.round((plannedAmount * percent) / 100) };
};

const generateCaseNo = () => buildYearlySequence('case', 'CASE');

const applySequentialInitialActions = (steps: any[], rawInitialActions: any) => {
  const allowed = rawInitialActions && typeof rawInitialActions === 'object' ? rawInitialActions : {};
  const orderedRefs = (steps || [])
    .slice()
    .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
    .flatMap((step: any) =>
      (Array.isArray(step.actions) ? step.actions : []).map((action: any, index: number) => ({
        step,
        action,
        index,
      }))
    );

  for (const ref of orderedRefs) {
    const requestedIndexes = Array.isArray(allowed?.[ref.step.stepKey]) ? allowed[ref.step.stepKey] : [];
    const requested = requestedIndexes.map((value: any) => Number(value)).includes(ref.index);
    if (!requested) break;
    ref.action.done = true;
    ref.action.doneAt = new Date();
    if (ref.step.status === 'Not Started') ref.step.status = 'In Progress';
  }
};

const buildTakeRequestNotificationHtml = (opts: {
  requestNo: string;
  caseNo: string;
  parties: string;
  requesterName: string;
  currentStepTitle?: string;
  dueDate?: Date | string;
  reviewUrl: string;
}) => {
  const dueText = opts.dueDate ? new Date(opts.dueDate).toLocaleString() : 'Not set';
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
      <p>A yellow urgency matter has been requested.</p>
      <p><strong>Request:</strong> ${opts.requestNo}</p>
      <p><strong>Matter:</strong> ${opts.caseNo} • ${opts.parties}</p>
      <p><strong>Requested by:</strong> ${opts.requesterName}</p>
      <p><strong>Current step:</strong> ${opts.currentStepTitle || '—'}<br /><strong>Due:</strong> ${dueText}</p>
      <p>
        <a href="${opts.reviewUrl}" style="display:inline-block;padding:12px 18px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:700;margin-right:8px;">Approve / Deny</a>
        <a href="${opts.reviewUrl}" style="display:inline-block;padding:12px 18px;background:#ffffff;color:#0f172a;text-decoration:none;border-radius:999px;font-weight:700;border:1px solid #cbd5e1;">Open Matter</a>
      </p>
    </div>
  `;
};

export const getAllCases = async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;

    if (isAdminCaseRole(role)) {
      const cases = await Case.find().sort({ updatedAt: -1 });
      return res.json(cases);
    }

    const me = (req.user?.name || '').trim();

    const assignedCases = me ? await Case.find({ assignedTo: me }).sort({ updatedAt: -1 }) : [];
    const taskCaseIds = me ? await Task.distinct('caseId', { assignee: me }) : [];
    const taskCases = taskCaseIds.length ? await Case.find({ _id: { $in: taskCaseIds } }).sort({ updatedAt: -1 }) : [];
    const yellowCandidates = await Case.find({
      status: { $nin: ['Closed', 'Temporarily Closed'] },
      'workflowProgress.status': { $ne: 'Completed' },
    }).sort({ updatedAt: -1 });
    const yellowCases = yellowCandidates.filter((c: any) => isPublicYellowCase(c));

    const map = new Map<string, any>();
    [...assignedCases, ...taskCases, ...yellowCases].forEach((c: any) => map.set(String(c._id), c));
    return res.json(Array.from(map.values()));
  } catch {
    return res.status(500).json({ message: 'Failed to fetch cases.' });
  }
};

export const createCase = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminCaseRole(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const workflowAutomation = (req.body as any)?.workflowAutomation !== false && (req.body as any)?.matterTiming !== 'historical';
    const caseNo = String((req.body as any)?.caseNo || '').trim() || (await generateCaseNo());
    const newCase = new Case({
      ...req.body,
      caseNo,
      matterTiming: workflowAutomation ? 'new' : 'historical',
      workflowAutomation,
      ...(workflowAutomation
        ? {}
        : {
            workflowTemplateId: undefined,
            workflowInstanceId: undefined,
            workflowProgress: {
              status: 'Not Started',
              percent: 0,
              plannedValue: {
                amount: parseMoney((req.body as any)?.workflowProgress?.plannedValue?.amount) || undefined,
                currency:
                  (req.body as any)?.workflowProgress?.plannedValue?.currency ||
                  (req.body as any)?.billingSettings?.currency ||
                  'RWF',
              },
              completedValue: {
                amount: 0,
                currency:
                  (req.body as any)?.workflowProgress?.plannedValue?.currency ||
                  (req.body as any)?.billingSettings?.currency ||
                  'RWF',
              },
            },
          }),
    });

    // Normalize billing settings if provided
    const bs = (req.body as any)?.billingSettings;
    if (bs && typeof bs === 'object') {
      const paymentMode = String(bs.paymentMode || 'postpaid') === 'prepaid' ? 'prepaid' : 'postpaid';
      const currency = String(bs.currency || 'RWF').trim().toUpperCase() || 'RWF';
      const prepaidTotal = Number(bs.prepaidTotal);
      const normalizedPrepaidTotal = Number.isFinite(prepaidTotal) && prepaidTotal > 0 ? prepaidTotal : 0;

      (newCase as any).billingSettings = {
        paymentMode,
        currency,
        prepaidTotal: normalizedPrepaidTotal,
        prepaidRemaining:
          paymentMode === 'prepaid'
            ? Number.isFinite(Number(bs.prepaidRemaining))
              ? Math.max(0, Number(bs.prepaidRemaining))
              : normalizedPrepaidTotal
            : 0,
        accruedUnbilled: Math.max(0, Number(bs.accruedUnbilled) || 0),
      };
    }

    await newCase.save();

    // ✅ Initialize workflow instance if workflowTemplateId provided
    const workflowTemplateId = (req.body as any)?.workflowTemplateId;
    if (workflowAutomation && workflowTemplateId) {
      const template: any = await WorkflowTemplate.findById(workflowTemplateId).lean();
      if (template) {
        const wfStart = (newCase as any).workflowStartDate || newCase.createdAt || new Date();
        const steps = buildInstanceSteps(template, wfStart);
        applySequentialInitialActions(steps as any[], (req.body as any)?.initialWorkflowActions);

        const inst = await WorkflowInstance.create({
          caseId: newCase._id,
          templateId: template._id,
          status: 'Active',
          currentStepKey: steps[0]?.stepKey,
          steps,
        });

        newCase.workflowTemplateId = template._id as any;
        newCase.workflowInstanceId = inst._id as any;
        newCase.matterType = template.matterType;

        const templatePlannedAmount = steps.reduce(
          (sum: number, s: any) => sum + (typeof s.feeAmount === 'number' ? s.feeAmount : 0),
          0
        );
        const requestedPlannedAmount = parseMoney((req.body as any)?.workflowProgress?.plannedValue?.amount) || parseMoney((req.body as any)?.budget);
        const plannedAmount = requestedPlannedAmount || templatePlannedAmount;
        const plannedCurrency =
          (req.body as any)?.workflowProgress?.plannedValue?.currency ||
          steps.map((s: any) => s.feeCurrency).find(Boolean) ||
          (newCase as any).billingSettings?.currency ||
          'RWF';
        const actionProgress = calculateActionProgress(steps as any[], plannedAmount);
        newCase.workflowProgress = {
          status: 'In Progress',
          percent: actionProgress.percent,
          ...(inst.currentStepKey ? { currentStepKey: inst.currentStepKey } : {}),
          ...(steps[0]?.title ? { currentStepTitle: steps[0].title } : {}),
          ...(steps[0]?.startAt ? { currentStepStartAt: steps[0].startAt } : {}),
          ...(steps[0]?.dueAt ? { currentStepDueAt: steps[0].dueAt } : {}),
          nextDueAt: steps[0]?.dueAt,
          plannedValue: { amount: plannedAmount || undefined, currency: plannedCurrency },
          completedValue: { amount: actionProgress.completedAmount, currency: plannedCurrency },
        };
        (newCase as any).billingSettings = {
          ...((newCase as any).billingSettings || {}),
          currency: plannedCurrency,
          prepaidTotal: 0,
          prepaidRemaining: 0,
          accruedUnbilled: actionProgress.completedAmount,
        };

        await newCase.save();

        const actor = actorFromReq(req);
        await writeAudit({
          caseId: String(newCase._id),
          actorName: actor.actorName,
          ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
          action: 'WORKFLOW_INSTANCE_CREATED',
          message: 'Workflow initialized from template',
          detail: `${template.name} v${template.version}`,
        });
      }
    }

    const actor = actorFromReq(req);

    await writeAudit({
      caseId: String(newCase._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'CASE_CREATED',
      message: 'Created case',
      detail: `${newCase.caseNo || ''} • ${newCase.parties || ''}`.trim(),
    });

    return res.status(201).json(newCase);
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || 'Failed to create case.' });
  }
};

export const getCaseById = async (req: AuthRequest, res: Response) => {
  try {
    const foundCase: any = await Case.findById(req.params.id);
    if (!foundCase) return res.status(404).json({ message: 'Case not found.' });

    if (isAdminCaseRole(req.user?.role)) {
      return res.json(foundCase);
    }

    if (isAssociateLikeRole(req.user?.role)) {
      const allowed = await canAssociateLikeAccessCase(req, foundCase);
      if (allowed) return res.json(foundCase);
    }

    if (isPublicYellowCase(foundCase)) return res.json(foundCase);

    return res.status(403).json({ message: 'Forbidden.' });
  } catch {
    return res.status(500).json({ message: 'Failed to fetch case.' });
  }
};

export const requestTakeCase = async (req: AuthRequest, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const caseId = String(req.params.id || '').trim();
    if (!caseId) return res.status(400).json({ message: 'Missing case id.' });

    const requesterId = String(req.user?.id || '').trim();
    const requesterName = String(req.user?.name || '').trim();
    const requesterRole = String(req.user?.role || '').trim();
    if (!requesterId || !requesterName) return res.status(401).json({ message: 'Unauthorized.' });

    const existingCase: any = await Case.findById(caseId);
    if (!existingCase) return res.status(404).json({ message: 'Case not found.' });
    if (!canTakeRequestAccess(existingCase)) {
      return res.status(400).json({ message: 'This matter is not currently available as a yellow urgent matter.' });
    }

    if (String(existingCase.assignedTo || '').trim() === requesterName) {
      return res.status(400).json({ message: 'You are already assigned to this matter.' });
    }

    if (isTakeRequestPending(existingCase) && !isTakeRequestExpired(existingCase)) {
      return res.status(409).json({ message: 'Another request is already pending for this matter.' });
    }

    const caseObjectId = new mongoose.Types.ObjectId(caseId);
    const requesterObjectId = new mongoose.Types.ObjectId(requesterId);
    const requestId = new mongoose.Types.ObjectId();
    const requestNo = await buildYearlySequence('caseTakeRequest', 'TR');
    const now = new Date();
    const caseSnapshot = {
      caseNo: existingCase.caseNo,
      parties: existingCase.parties,
      workflowLabel: existingCase.workflow || existingCase.matterType || existingCase.caseType,
      currentStepTitle: existingCase.workflowProgress?.currentStepTitle,
      currentStepDueAt: existingCase.workflowProgress?.currentStepDueAt || existingCase.workflowProgress?.nextDueAt,
      urgencyColor: 'yellow',
    };

    let createdRequest: any = null;
    await session.withTransaction(async () => {
      const lockedCase: any = await Case.findOneAndUpdate(
        {
          _id: caseObjectId,
          $or: [
            { 'takeRequestState.status': { $exists: false } },
            { 'takeRequestState.status': 'idle' },
            { 'takeRequestState.status': 'denied' },
            {
              'takeRequestState.status': 'pending',
              'takeRequestState.lockExpiresAt': { $lte: now },
            },
          ],
        },
        {
          $set: {
            takeRequestState: {
              status: 'pending',
              requestId,
              requestedByUserId: requesterObjectId,
              requestedByName: requesterName,
              requestedByRole: requesterRole,
              requestedAt: now,
              lockExpiresAt: takeRequestExpiry(),
              lastUpdatedAt: now,
            },
          },
        },
        { new: true, session }
      );

      if (!lockedCase) {
        const err: any = new Error('Another request is already pending for this matter.');
        err.statusCode = 409;
        throw err;
      }

      const requestDoc: any = {
        _id: requestId,
        caseId: caseObjectId,
        requestNo,
        requestedByUserId: requesterObjectId,
        requestedByName: requesterName,
        requestedByRole: requesterRole,
        currentAssignee: String(existingCase.assignedTo || '').trim(),
        status: 'Pending',
        requestedAt: now,
        requestSnapshot: caseSnapshot,
      };
      if (req.user?.email) requestDoc.requestedByEmail = String(req.user.email).trim().toLowerCase();

      createdRequest = (await CaseTakeRequest.create([requestDoc], { session }))[0];

      await writeAudit({
        caseId,
        ...(req.user?.id ? { actorUserId: String(req.user.id) } : {}),
        actorName: requesterName,
        action: 'CASE_TAKE_REQUESTED',
        message: 'Requested to take yellow matter',
        detail: `${requestNo} • ${existingCase.caseNo || ''} • ${existingCase.parties || ''}`.trim(),
      });
    });

    const reviewUrl = `/cases/${caseId}?takeRequest=${requestId.toString()}`;
    const reviewHtml = buildTakeRequestNotificationHtml({
      requestNo,
      caseNo: existingCase.caseNo,
      parties: existingCase.parties,
      requesterName,
      currentStepTitle: existingCase.workflowProgress?.currentStepTitle,
      dueDate: existingCase.workflowProgress?.currentStepDueAt || existingCase.workflowProgress?.nextDueAt,
      reviewUrl,
    });

    const assignedUser: any = await findUserByAssigneeString(String(existingCase.assignedTo || '').trim());
    const notifyStaffRoles = TAKE_REQUEST_APPROVER_ROLES as unknown as string[];
    const notificationPayload = {
      type: 'WORKFLOW_NOTIFICATION',
      title: 'Yellow matter request pending',
      message: `${requesterName} requested to take ${existingCase.caseNo || 'a matter'} (${existingCase.parties || 'No parties'}).`,
      severity: 'warning' as const,
      link: reviewUrl,
      caseId,
    };

    await notifyRoles({
      roles: notifyStaffRoles,
      category: 'approvals',
      notification: notificationPayload,
      email: {
        subject: `Matter take request pending: ${existingCase.caseNo || 'Matter'}`,
        html: reviewHtml,
      },
    });

    const assignedUserRole = String(assignedUser?.role || '').trim();
    const shouldNotifyAssignedUser =
      assignedUser?._id &&
      String(assignedUser._id) !== requesterId &&
      !TAKE_REQUEST_APPROVER_ROLES.includes(assignedUserRole as (typeof TAKE_REQUEST_APPROVER_ROLES)[number]);

    if (shouldNotifyAssignedUser) {
      await notifyUsersById({
        userIds: [String(assignedUser._id)],
        category: 'approvals',
        notification: notificationPayload,
        email: {
          subject: `Matter take request pending: ${existingCase.caseNo || 'Matter'}`,
          html: reviewHtml,
        },
      });
    }

    return res.status(201).json({
      request: createdRequest,
      case: await Case.findById(caseId),
    });
  } catch (e: any) {
    await session.abortTransaction().catch(() => {});
    return res.status(e?.statusCode || 500).json({ message: e?.message || 'Failed to create take request.' });
  } finally {
    session.endSession();
  }
};

const resolveTakeRequestDecision = async (req: AuthRequest, res: Response, decision: 'Approved' | 'Denied') => {
  const session = await mongoose.startSession();
  try {
    if (!isAdminCaseRole(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const caseId = String(req.params.id || '').trim();
    const requestId = String(req.params.requestId || '').trim();
    const decisionReason = String((req.body as any)?.reason || '').trim();
    if (!caseId || !requestId) return res.status(400).json({ message: 'Missing case or request id.' });

    const caseObjectId = new mongoose.Types.ObjectId(caseId);
    const requestObjectId = new mongoose.Types.ObjectId(requestId);
    const existingRequest: any = await CaseTakeRequest.findOne({ _id: requestObjectId, caseId: caseObjectId }).lean();
    if (!existingRequest) return res.status(404).json({ message: 'Take request not found.' });
    if (existingRequest.status !== 'Pending') {
      return res.status(400).json({ message: 'Take request is no longer pending.' });
    }

    const now = new Date();
    let updatedCase: any = null;
    await session.withTransaction(async () => {
      const caseDoc: any = await Case.findOne({ _id: caseObjectId }).session(session);
      if (!caseDoc) {
        const err: any = new Error('Case not found.');
        err.statusCode = 404;
        throw err;
      }

      if (String(caseDoc.takeRequestState?.requestId || '') !== requestId) {
        const err: any = new Error('This request is not the active pending request for the matter.');
        err.statusCode = 409;
        throw err;
      }

      if (decision === 'Approved') {
        updatedCase = await Case.findOneAndUpdate(
          { _id: caseObjectId, 'takeRequestState.requestId': requestObjectId, 'takeRequestState.status': 'pending' },
          {
            $set: {
              assignedTo: existingRequest.requestedByName,
              takeRequestState: {
                status: 'claimed',
                requestId: requestObjectId,
                requestedByUserId: existingRequest.requestedByUserId,
                requestedByName: existingRequest.requestedByName,
                requestedByRole: existingRequest.requestedByRole,
                requestedAt: existingRequest.requestedAt,
                lockExpiresAt: undefined,
                claimedAt: now,
                decisionByUserId: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
                decisionByName: req.user?.name || 'System',
                decisionReason: decisionReason || undefined,
                lastUpdatedAt: now,
              },
            },
          },
          { new: true, session }
        );

        if (!updatedCase) {
          const err: any = new Error('The take request could not be approved because the lock changed.');
          err.statusCode = 409;
          throw err;
        }
      } else {
        updatedCase = await Case.findOneAndUpdate(
          { _id: caseObjectId, 'takeRequestState.requestId': requestObjectId, 'takeRequestState.status': 'pending' },
          {
            $set: {
              takeRequestState: {
                status: 'idle',
                requestId: undefined,
                requestedByUserId: undefined,
                requestedByName: undefined,
                requestedByRole: undefined,
                requestedAt: undefined,
                lockExpiresAt: undefined,
                claimedAt: undefined,
                decisionByUserId: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
                decisionByName: req.user?.name || 'System',
                decisionReason: decisionReason || undefined,
                lastUpdatedAt: now,
              },
            },
          },
          { new: true, session }
        );

        if (!updatedCase) {
          const err: any = new Error('The take request could not be denied because the lock changed.');
          err.statusCode = 409;
          throw err;
        }
      }

      await CaseTakeRequest.updateOne(
        { _id: requestObjectId, caseId: caseObjectId, status: 'Pending' },
        {
          $set: {
            status: decision,
            decidedAt: now,
            decidedByUserId: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
            decidedByName: req.user?.name || 'System',
            decisionReason: decisionReason || undefined,
          },
        },
        { session }
      );

      await writeAudit({
        caseId,
        ...(req.user?.id ? { actorUserId: String(req.user.id) } : {}),
        actorName: req.user?.name || 'System',
        action: decision === 'Approved' ? 'CASE_TAKE_REQUEST_APPROVED' : 'CASE_TAKE_REQUEST_DENIED',
        message: decision === 'Approved' ? 'Approved take request' : 'Denied take request',
        detail: `${existingRequest.requestNo} • ${existingRequest.requestedByName}${decisionReason ? ` • ${decisionReason}` : ''}`,
      });
    });

    const requesterId = String(existingRequest.requestedByUserId || '');
    const requesterName = String(existingRequest.requestedByName || 'Requester');
    const reviewUrl = `/cases/${caseId}?takeRequest=${requestId}`;
    const outcomeTitle = decision === 'Approved' ? 'Take request approved' : 'Take request denied';
    const outcomeMessage =
      decision === 'Approved'
        ? `Your request to take ${updatedCase?.caseNo || 'the matter'} was approved.`
        : `Your request to take ${updatedCase?.caseNo || 'the matter'} was denied.`;
    const emailHtml = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
        <p>${outcomeMessage}</p>
        <p><strong>Matter:</strong> ${updatedCase?.caseNo || '—'} • ${updatedCase?.parties || '—'}</p>
        ${decisionReason ? `<p><strong>Reason:</strong> ${decisionReason}</p>` : ''}
        <p><a href="${reviewUrl}" style="display:inline-block;padding:12px 18px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:700;">Open Matter</a></p>
      </div>
    `;

    if (requesterId) {
      await notifyUsersById({
        userIds: [requesterId],
        category: 'approvals',
        notification: {
          type: 'WORKFLOW_NOTIFICATION',
          title: outcomeTitle,
          message: outcomeMessage,
          severity: decision === 'Approved' ? 'info' : 'warning',
          link: reviewUrl,
          caseId,
        },
        email: {
          subject: outcomeTitle,
          html: emailHtml,
        },
      });
    }

    return res.json({
      message: decision === 'Approved' ? 'Take request approved.' : 'Take request denied.',
      case: updatedCase,
    });
  } catch (e: any) {
    await session.abortTransaction().catch(() => {});
    return res.status(e?.statusCode || 500).json({ message: e?.message || `Failed to ${decision.toLowerCase()} take request.` });
  } finally {
    session.endSession();
  }
};

export const approveTakeRequest = async (req: AuthRequest, res: Response) =>
  resolveTakeRequestDecision(req, res, 'Approved');

export const denyTakeRequest = async (req: AuthRequest, res: Response) =>
  resolveTakeRequestDecision(req, res, 'Denied');

export const updateCase = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminCaseRole(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const before: any = await Case.findById(req.params.id);
    const updated: any = await Case.findByIdAndUpdate(req.params.id, req.body, { new: true });

    if (!updated) return res.status(404).json({ message: 'Case not found.' });

    // If workflow template was changed, re-initialize the workflow instance and progress
    const beforeTemplateId = before?.workflowTemplateId ? String(before.workflowTemplateId) : '';
    const nextTemplateId = (req.body as any)?.workflowTemplateId ? String((req.body as any).workflowTemplateId) : '';
    const didChangeTemplate = Boolean(nextTemplateId && nextTemplateId !== beforeTemplateId);
    const beforeStart = before?.workflowStartDate ? new Date(before.workflowStartDate).toISOString().slice(0, 10) : '';
    const nextStart = (req.body as any)?.workflowStartDate
      ? new Date((req.body as any).workflowStartDate).toISOString().slice(0, 10)
      : '';
    const didChangeStartDate = Boolean(nextStart && nextStart !== beforeStart);

    if (didChangeTemplate || didChangeStartDate) {
      const templateIdToUse = nextTemplateId || beforeTemplateId;
      if (templateIdToUse) {
        const template: any = await WorkflowTemplate.findById(templateIdToUse).lean();
        if (template) {
          const wfStartRaw = (req.body as any)?.workflowStartDate || updated.workflowStartDate || updated.createdAt || new Date();
          const wfStart = wfStartRaw instanceof Date ? wfStartRaw : new Date(wfStartRaw);
          const steps = buildInstanceSteps(template, wfStart);

          let inst: any = await WorkflowInstance.findOne({ caseId: updated._id });
          if (!inst) {
            inst = await WorkflowInstance.create({
              caseId: updated._id,
              templateId: template._id,
              status: 'Active',
              currentStepKey: steps[0]?.stepKey,
              steps,
            });
          } else {
            inst.templateId = template._id;
            inst.status = 'Active';
            inst.currentStepKey = steps[0]?.stepKey;
            inst.steps = steps;
            await inst.save();
          }

          updated.workflowTemplateId = template._id as any;
          updated.workflowInstanceId = inst._id as any;
          updated.matterType = template.matterType;
          updated.workflowStartDate = wfStart;

          const templatePlannedAmount = steps.reduce(
            (sum: number, s: any) => sum + (typeof s.feeAmount === 'number' ? s.feeAmount : 0),
            0
          );
          const requestedPlannedAmount =
            parseMoney((req.body as any)?.workflowProgress?.plannedValue?.amount) ||
            parseMoney((req.body as any)?.budget) ||
            parseMoney(updated.workflowProgress?.plannedValue?.amount);
          const plannedAmount = requestedPlannedAmount || templatePlannedAmount;
          const plannedCurrency =
            (req.body as any)?.workflowProgress?.plannedValue?.currency ||
            steps.map((s: any) => s.feeCurrency).find(Boolean) ||
            updated.billingSettings?.currency ||
            'RWF';
          const actionProgress = calculateActionProgress(steps as any[], plannedAmount);

          updated.workflowProgress = {
            status: 'In Progress',
            percent: actionProgress.percent,
            ...(inst.currentStepKey ? { currentStepKey: inst.currentStepKey } : {}),
            ...(steps[0]?.title ? { currentStepTitle: steps[0].title } : {}),
            ...(steps[0]?.startAt ? { currentStepStartAt: steps[0].startAt } : {}),
            ...(steps[0]?.dueAt ? { currentStepDueAt: steps[0].dueAt } : {}),
            nextDueAt: steps[0]?.dueAt,
            plannedValue: { amount: plannedAmount || undefined, currency: plannedCurrency },
            completedValue: { amount: actionProgress.completedAmount, currency: plannedCurrency },
          };
          updated.billingSettings = {
            ...(updated.billingSettings || {}),
            currency: plannedCurrency,
            prepaidTotal: 0,
            prepaidRemaining: 0,
            accruedUnbilled: actionProgress.completedAmount,
          };

          await updated.save();
        }
      }
    }

    if (!didChangeTemplate && !didChangeStartDate && (req.body as any)?.workflowProgress?.plannedValue) {
      const plannedAmount = parseMoney((req.body as any).workflowProgress.plannedValue.amount);
      if (plannedAmount > 0) {
        const plannedCurrency =
          (req.body as any).workflowProgress.plannedValue.currency || updated.billingSettings?.currency || 'RWF';
        const inst: any = await WorkflowInstance.findOne({ caseId: updated._id }).lean();
        const actionProgress = calculateActionProgress(inst?.steps || [], plannedAmount);
        updated.workflowProgress = {
          ...(updated.workflowProgress || {}),
          plannedValue: { amount: plannedAmount, currency: plannedCurrency },
          percent: actionProgress.percent,
          completedValue: { amount: actionProgress.completedAmount, currency: plannedCurrency },
        };
        updated.billingSettings = {
          ...(updated.billingSettings || {}),
          currency: plannedCurrency,
          prepaidTotal: 0,
          prepaidRemaining: 0,
          accruedUnbilled: actionProgress.completedAmount,
        };
        await updated.save();
      }
    }

    const changes: string[] = [];
    if (before) {
      if (req.body.status && req.body.status !== before.status)
        changes.push(`Status: ${before.status} → ${req.body.status}`);
      if (req.body.priority && req.body.priority !== before.priority)
        changes.push(`Priority: ${before.priority} → ${req.body.priority}`);
      if (req.body.assignedTo && req.body.assignedTo !== before.assignedTo)
        changes.push(`Assigned: ${before.assignedTo || '-'} → ${req.body.assignedTo}`);
      if (req.body.budget && String(req.body.budget) !== String(before.budget))
        changes.push(`Budget: ${before.budget || '-'} → ${req.body.budget}`);
      if (req.body.caseNo && req.body.caseNo !== before.caseNo) changes.push(`Case No changed`);
      if (req.body.parties && req.body.parties !== before.parties) changes.push(`Parties changed`);
      if (req.body.caseType && req.body.caseType !== before.caseType) changes.push(`Case type changed`);
      if (req.body.matterType && req.body.matterType !== before.matterType) changes.push(`Matter type changed`);
      if (req.body.legalServicePath) changes.push(`Legal service classification updated`);
      if ((req.body as any)?.workflowTemplateId && String((req.body as any).workflowTemplateId) !== beforeTemplateId)
        changes.push(`Workflow template updated`);
      if ((req.body as any)?.workflowStartDate) changes.push(`Workflow start date updated`);
      if ((req.body as any)?.billingSettings) changes.push(`Billing settings updated`);
    }

    const actor = actorFromReq(req);

    await writeAudit({
      caseId: String(updated._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'CASE_UPDATED',
      message: 'Updated case',
      detail: changes.length ? changes.join(' • ') : `${updated.caseNo || ''}`.trim(),
    });

    return res.json(updated);
  } catch {
    return res.status(500).json({ message: 'Failed to update case.' });
  }
};

export const deleteCase = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminCaseRole(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const deleted = await Case.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Case not found.' });

    return res.json({ message: 'Case deleted.' });
  } catch {
    return res.status(500).json({ message: 'Failed to delete case.' });
  }
};
