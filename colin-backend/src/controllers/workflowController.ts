import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import WorkflowTemplate from '../models/workflowTemplateModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import Case from '../models/caseModel';
import Document from '../models/documentModel';
import Task from '../models/taskModel';
import { writeAudit } from '../services/auditService';
import { createNotification, sendSms } from '../services/notifyService';
import { sendEmailResend } from '../services/emailResendService';
import { buildInstanceSteps } from '../utils/workflowCompute';

const isAdmin = (role?: string) =>
  role === 'managing_director' ||
  role === 'managing_partner' ||
  role === 'senior_partner' ||
  role === 'partner' ||
  role === 'associate_partner' ||
  role === 'executive_assistant';
const isAssociateLike = (role?: string) =>
  role === 'associate' ||
  role === 'trainee_associate' ||
  role === 'senior_associate' ||
  role === 'intern';

const actorFromReq = (req: AuthRequest) => ({
  actorName: req.user?.name || 'System',
  actorUserId: req.user?.id as string | undefined,
});

const computeWorkflowMoney = (inst: any) => {
  const plannedAmount = (inst.steps || []).reduce(
    (sum: number, s: any) => sum + (typeof s.feeAmount === 'number' ? s.feeAmount : 0),
    0
  );
  const completedAmount = (inst.steps || []).reduce(
    (sum: number, s: any) => sum + (s.status === 'Completed' && typeof s.feeAmount === 'number' ? s.feeAmount : 0),
    0
  );
  const currency = (inst.steps || []).map((s: any) => s.feeCurrency).find(Boolean);
  return { plannedAmount, completedAmount, currency };
};

const computeNextDueAt = (inst: any) => {
  const pending = (inst.steps || [])
    .filter((s: any) => s.status !== 'Completed')
    .slice()
    .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))[0];
  return pending?.dueAt;
};

const previousActiveStatus = (status?: string) => {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized && normalized !== 'closed' ? status : 'In Progress';
};

const updateCaseWorkflowProgress = async (c: any, inst: any) => {
  const { plannedAmount, completedAmount, currency } = computeWorkflowMoney(inst);
  const nextDueAt = computeNextDueAt(inst);
  const existingPlannedAmount =
    typeof c.workflowProgress?.plannedValue?.amount === 'number'
      ? c.workflowProgress.plannedValue.amount
      : Number(String(c.budget || '').replace(/[^\d.]/g, '')) || plannedAmount;
  const existingCurrency = c.workflowProgress?.plannedValue?.currency || c.billingSettings?.currency || currency || 'RWF';
  const actions = (inst.steps || []).flatMap((step: any) => (Array.isArray(step.actions) ? step.actions : []));
  const checkedActions = actions.filter((action: any) => Boolean(action?.done)).length;
  const actionTotal = actions.length;
  const percent = actionTotal > 0 ? Math.round((checkedActions / actionTotal) * 100) : 0;
  const actionCompletedAmount =
    actionTotal > 0 ? Math.round((existingPlannedAmount * percent) / 100) : completedAmount;

  c.workflowProgress = {
    status: inst.status === 'Completed' ? 'Completed' : 'In Progress',
    currentStepKey: inst.currentStepKey,
    currentStepTitle: (() => {
      if (!inst.currentStepKey) return undefined;
      const ref = (inst.steps || []).find((s: any) => s.stepKey === inst.currentStepKey);
      return ref?.title;
    })(),
    currentStepStartAt: (() => {
      if (!inst.currentStepKey) return undefined;
      const ref = (inst.steps || []).find((s: any) => s.stepKey === inst.currentStepKey);
      return ref?.startAt;
    })(),
    currentStepDueAt: (() => {
      if (!inst.currentStepKey) return undefined;
      const ref = (inst.steps || []).find((s: any) => s.stepKey === inst.currentStepKey);
      return ref?.dueAt;
    })(),
    percent,
    nextDueAt,
    plannedValue: { amount: existingPlannedAmount || undefined, currency: existingCurrency },
    completedValue: { amount: actionCompletedAmount || 0, currency: existingCurrency },
  };

  if (inst.status === 'Completed') {
    c.status = 'Closed';
  } else if (String(c.status || '').toLowerCase() === 'closed') {
    c.status = previousActiveStatus(c.workflowProgress?.status);
  }

  c.billingSettings = {
    ...(c.billingSettings || {}),
    currency: existingCurrency,
    prepaidTotal: 0,
    prepaidRemaining: 0,
    accruedUnbilled: actionCompletedAmount || 0,
  };

  await c.save();
};

const completeStepInternal = async (req: AuthRequest, c: any, inst: any, stepKey: string) => {
  const step = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
  if (!step) throw new Error('Step not found.');

  // Enforce checklist completion if actions exist
  const actions = Array.isArray(step.actions) ? step.actions : [];
  const hasActions = actions.length > 0;
  const allActionsDone = !hasActions || actions.every((a: any) => a?.done === true);
  if (!allActionsDone) {
    const remaining = actions.filter((a: any) => !a?.done).map((a: any) => a?.text).filter(Boolean);
    const err: any = new Error('Cannot complete step. Pending key actions.');
    err.statusCode = 400;
    err.remainingActions = remaining;
    throw err;
  }

  const previousStepStatus = step.status;
  step.status = 'Completed';
  step.completedAt = new Date();

  const sorted = (inst.steps || []).slice().sort((a: any, b: any) => a.order - b.order);
  const idx = sorted.findIndex((x: any) => x.stepKey === stepKey);
  const next = sorted[idx + 1];

  if (next) {
    inst.currentStepKey = next.stepKey;
    const nextRef = inst.steps.find((x: any) => x.stepKey === next.stepKey);
    if (nextRef && nextRef.status === 'Not Started') nextRef.status = 'In Progress';
  } else {
    inst.status = 'Completed';
  }

  await inst.save();

  // Capture previous case workflow status for auditing
  const previousCaseWorkflowStatus = c.workflowProgress?.status;

  await updateCaseWorkflowProgress(c, inst);

  const actor = actorFromReq(req);

  // Include stage transition info when available
  const prevStage = (inst.steps || []).find((s: any) => s.stepKey === stepKey)?.stageKey || 'unknown';
  const newStage = (() => {
    if (!inst.currentStepKey) return undefined;
    const ref = (inst.steps || []).find((s: any) => s.stepKey === inst.currentStepKey);
    return ref?.stageKey;
  })();

  const stepDetailParts = [`${stepKey} • ${step.title}`];
  if (previousStepStatus) stepDetailParts.push(`from ${previousStepStatus} to ${step.status}`);
  if (prevStage && newStage && prevStage !== newStage) stepDetailParts.push(`stage: ${prevStage} → ${newStage}`);

  await writeAudit({
    caseId: String(c._id),
    actorName: actor.actorName,
    ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
    action: 'WORKFLOW_STEP_COMPLETED',
    message: 'Completed workflow step',
    detail: stepDetailParts.join(' • '),
  });

  // If the case workflow status changed, write a CASE_UPDATED audit entry
  const newCaseWorkflowStatus = c.workflowProgress?.status;
  if (previousCaseWorkflowStatus !== newCaseWorkflowStatus) {
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'CASE_UPDATED',
      message: 'Case workflow status updated',
      detail: `Workflow status: ${previousCaseWorkflowStatus || 'unknown'} → ${newCaseWorkflowStatus}`,
    });
  }

  // Notifications for ownership transfer approval (finalization)
  try {
    if (String(stepKey).toUpperCase() === 'VOT_12_OWNERSHIP_TRANSFER_APPROVAL') {
      // Find buyer & seller contacts on the case
      const contacts: any[] = Array.isArray(c.clientContacts) ? c.clientContacts : [];
      const emails = contacts.map((p: any) => String(p.email || '').trim()).filter(Boolean);
      const phones = contacts.map((p: any) => String(p.phone || '').trim()).filter(Boolean);

      const subject = 'Vehicle Ownership Transfer Completed';
      const plate = (c.parties || '') as string;
      const html = `<p>The ownership transfer has been completed for case ${String(c.caseNo || '')}.</p><p>Reference: ${String(c.caseNo || '')}</p>`;
      // Send emails (best-effort)
      if (emails.length) {
        try {
          await sendEmailResend(emails, subject, html);
        } catch {
          // ignore email send failures
        }
      }

      // Send SMS placeholder
      if (phones.length) {
        try {
          await sendSms(phones, `Ownership transfer completed for case ${String(c.caseNo || '')}.` , String(c._id));
        } catch {}
      }

      // In-app notification for internal staff roles
      try {
        await createNotification({
          type: 'WORKFLOW_NOTIFICATION',
          title: 'Ownership transfer approved',
          message: `Ownership transfer approved for case ${String(c.caseNo || '')}`,
          audienceRoles: ['executive_assistant', 'associate', 'partner', 'compliance_officer'],
          caseId: String(c._id),
        } as any);
      } catch {}
    }
  } catch (e) {
    // swallow notification errors to avoid breaking primary flow
  }

  return inst;
};

const canAssociateLikeAccessCase = async (req: AuthRequest, foundCase: any) => {
  if (!isAssociateLike(req.user?.role)) return false;

  const me = (req.user?.name || '').trim();
  if (!me) return false;

  const assignedTo = String(foundCase.assignedTo || '').trim();
  if (assignedTo && assignedTo === me) return true;

  const hasTask = await Task.exists({ caseId: foundCase._id, assignee: me });
  return Boolean(hasTask);
};

// ---------- Templates ----------
export const listActiveTemplates = async (req: AuthRequest, res: Response) => {
  try {
    const templates = await WorkflowTemplate.find({ active: true })
      .sort({ matterType: 1, version: -1 })
      .lean();
    res.json(templates);
  } catch {
    res.status(500).json({ message: 'Failed to load workflow templates.' });
  }
};

export const listAllTemplates = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });
    const templates = await WorkflowTemplate.find({}).sort({ updatedAt: -1 }).lean();
    res.json(templates);
  } catch {
    res.status(500).json({ message: 'Failed to load workflow templates.' });
  }
};

export const getTemplateById = async (req: AuthRequest, res: Response) => {
  try {
    const { templateId } = req.params as any;
    const t = await WorkflowTemplate.findById(templateId);
    if (!t) return res.status(404).json({ message: 'Template not found.' });
    res.json(t);
  } catch {
    res.status(500).json({ message: 'Failed to load template.' });
  }
};

export const createTemplate = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const created = await WorkflowTemplate.create(req.body);

    // NOTE: We avoid writing audit here because your audit log requires a caseId.
    res.status(201).json(created);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to create template.' });
  }
};

export const updateTemplate = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const { templateId } = req.params as any;
    const updated = await WorkflowTemplate.findByIdAndUpdate(templateId, req.body, { new: true });
    if (!updated) return res.status(404).json({ message: 'Template not found.' });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to update template.' });
  }
};

export const deleteTemplate = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });
    const { templateId } = req.params as any;

    const deleted = await WorkflowTemplate.findByIdAndDelete(templateId);
    if (!deleted) return res.status(404).json({ message: 'Template not found.' });

    res.json({ message: 'Template deleted.' });
  } catch {
    res.status(500).json({ message: 'Failed to delete template.' });
  }
};

// ---------- Instances ----------
export const getWorkflowForCase = async (req: AuthRequest, res: Response) => {
  try {
    const { caseId } = req.params as any;
    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    if (!isAdmin(req.user?.role)) {
      const allowed = await canAssociateLikeAccessCase(req, c);
      if (!allowed) return res.status(403).json({ message: 'Forbidden.' });
    }

    const inst: any = await WorkflowInstance.findOne({ caseId: new mongoose.Types.ObjectId(caseId) });
    if (!inst) return res.status(404).json({ message: 'No workflow instance for this case.' });

    // Backfill step actions from template if missing (safe for older instances)
    try {
      const t: any = await WorkflowTemplate.findById(inst.templateId).lean();
      let changed = false;
      for (const step of inst.steps || []) {
        const hasActions = Array.isArray(step.actions) && step.actions.length > 0;
        if (hasActions) continue;
        const templateStep = (t?.steps || []).find((x: any) => x.key === step.stepKey);
        const actions = (templateStep?.actions || []).map((text: any) => ({ text: String(text || '').trim(), done: false }));
        if (actions.length) {
          step.actions = actions;
          changed = true;
        }
      }
      if (changed) await inst.save();
    } catch {
      // ignore backfill failures
    }

    res.json(inst.toObject());
  } catch {
    res.status(500).json({ message: 'Failed to load workflow.' });
  }
};

// Admin endpoint (rarely needed if case creation already initializes)
export const initWorkflowForCase = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const { caseId } = req.params as any;
    const { templateId } = req.body || {};

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    const exists = await WorkflowInstance.findOne({ caseId: c._id });
    if (exists) return res.status(400).json({ message: 'Workflow already exists for this case.' });

    const tId = templateId || c.workflowTemplateId;
    if (!tId) return res.status(400).json({ message: 'Missing templateId.' });

    const template: any = await WorkflowTemplate.findById(tId).lean();
    if (!template) return res.status(404).json({ message: 'Template not found.' });

    const wfStart = (c as any).workflowStartDate || c.createdAt || new Date();
    const steps = buildInstanceSteps(template, wfStart);

    const inst = await WorkflowInstance.create({
      caseId: c._id,
      templateId: template._id,
      status: 'Active',
      currentStepKey: steps[0]?.stepKey,
      steps,
    });

    c.workflowTemplateId = template._id;
    c.workflowInstanceId = inst._id;
    c.matterType = template.matterType;

    await updateCaseWorkflowProgress(c, inst);

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_INSTANCE_CREATED',
      message: 'Workflow initialized from template',
      detail: `${template.name} v${template.version}`,
    });

    res.status(201).json(inst);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to initialize workflow.' });
  }
};

// Attach a document to a specific output slot (any case-access user can do this)
export const attachOutputDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { caseId, stepKey, outputKey } = req.params as any;
    const { documentId } = req.body || {};
    if (!documentId) return res.status(400).json({ message: 'Missing documentId' });

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    if (!isAdmin(req.user?.role)) {
      const allowed = await canAssociateLikeAccessCase(req, c);
      if (!allowed) return res.status(403).json({ message: 'Forbidden.' });
    }

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });

    const step = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Step not found.' });

    const out = (step.outputs || []).find((o: any) => o.key === outputKey);
    if (!out) return res.status(404).json({ message: 'Output not found.' });

    const doc: any = await Document.findById(documentId);
    if (!doc) return res.status(404).json({ message: 'Document not found.' });

    out.documentId = doc._id;
    out.uploadedAt = new Date();

    doc.workflowInstanceId = inst._id;
    doc.stepKey = stepKey;
    doc.outputKey = outputKey;
    await doc.save();

    await inst.save();

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_OUTPUT_UPLOADED',
      message: 'Attached deliverable to workflow output',
      detail: `${stepKey} • ${outputKey} • ${doc.name || 'Document'}`,
    });

    res.json(inst);
  } catch {
    res.status(500).json({ message: 'Failed to attach output document.' });
  }
};

// Complete a step (admin only)
export const completeStep = async (req: AuthRequest, res: Response) => {
  try {
    const { caseId, stepKey } = req.params as any;

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });
    const updated = await completeStepInternal(req, c, inst, stepKey);
    res.json(updated);
  } catch (e: any) {
    const status = typeof e?.statusCode === 'number' ? e.statusCode : 500;
    res.status(status).json({
      message: e?.message || 'Failed to complete step.',
      ...(Array.isArray(e?.remainingActions) ? { remainingActions: e.remainingActions } : {}),
    });
  }
};

// Reopen a completed step (admin only)
export const reopenStep = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const { caseId, stepKey } = req.params as any;

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });

    const step = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Step not found.' });
    if (step.status !== 'Completed') return res.status(400).json({ message: 'Step is not completed.' });

    // Reopen the step
    step.status = 'In Progress';
    step.completedAt = undefined;

    // Update current step to this one
    inst.currentStepKey = stepKey;

    // If workflow was completed, set it back to Active
    if (inst.status === 'Completed') {
      inst.status = 'Active';
    }

    await inst.save();
    await updateCaseWorkflowProgress(c, inst);

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_STEP_REOPENED',
      message: 'Reopened workflow step',
      detail: `${stepKey} • ${step.title}`,
    });

    res.json(inst);
  } catch {
    res.status(500).json({ message: 'Failed to reopen step.' });
  }
};

// Extend a workflow step deadline (admin only)
export const extendStepDeadline = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const { caseId, stepKey } = req.params as any;
    const { extendDays, reason } = req.body || {};

    const days = Number(extendDays);
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      return res.status(400).json({ message: 'extendDays must be a number between 1 and 365.' });
    }

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });

    const step = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Step not found.' });
    if (!step.dueAt) return res.status(400).json({ message: 'Step has no due date to extend.' });
    if (step.status === 'Completed') return res.status(400).json({ message: 'Cannot extend a completed step.' });

    const oldDue = new Date(step.dueAt);
    const newDue = new Date(oldDue.getTime() + days * 24 * 60 * 60 * 1000);
    step.dueAt = newDue;

    await inst.save();

    // Update case nextDueAt if this step is now the nearest pending
    const nextDueAt = (() => {
      const pending = (inst.steps || [])
        .filter((s: any) => s.status !== 'Completed')
        .slice()
        .sort((a: any, b: any) => new Date(a.dueAt || 0).getTime() - new Date(b.dueAt || 0).getTime())[0];
      return pending?.dueAt;
    })();

    c.workflowProgress = {
      ...(c.workflowProgress || {}),
      nextDueAt,
    };
    await c.save();

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_STEP_DEADLINE_EXTENDED',
      message: 'Extended workflow step deadline',
      detail: `${stepKey} • +${days}d${reason ? ` • ${String(reason).trim()}` : ''}`,
    });

    res.json(inst);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to extend deadline.' });
  }
};

// ---- Stub/placeholder handlers for admin workflow maintenance endpoints ----
// These are intentionally minimal to avoid server startup errors when route
// files import them. Implementations can be expanded later as needed.
export const addStep = async (req: AuthRequest, res: Response) => {
  try {
    // Admin-only: add a step to a workflow instance. Not implemented yet.
    return res.status(501).json({ message: 'Not implemented: addStep' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to add step.' });
  }
};

export const addStepAction = async (req: AuthRequest, res: Response) => {
  try {
    return res.status(501).json({ message: 'Not implemented: addStepAction' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to add step action.' });
  }
};

export const updateStep = async (req: AuthRequest, res: Response) => {
  try {
    return res.status(501).json({ message: 'Not implemented: updateStep' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to update step.' });
  }
};

export const deleteStep = async (req: AuthRequest, res: Response) => {
  try {
    return res.status(501).json({ message: 'Not implemented: deleteStep' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to delete step.' });
  }
};

export const updateStepAction = async (req: AuthRequest, res: Response) => {
  try {
    return res.status(501).json({ message: 'Not implemented: updateStepAction' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to update step action.' });
  }
};

export const deleteStepAction = async (req: AuthRequest, res: Response) => {
  try {
    return res.status(501).json({ message: 'Not implemented: deleteStepAction' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to delete step action.' });
  }
};

export const auditCaseWorkflowMismatches = async (req: AuthRequest, res: Response) => {
  try {
    return res.status(501).json({ message: 'Not implemented: auditCaseWorkflowMismatches' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to audit mismatches.' });
  }
};

export const fixCaseWorkflowMismatches = async (req: AuthRequest, res: Response) => {
  try {
    return res.status(501).json({ message: 'Not implemented: fixCaseWorkflowMismatches' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to fix mismatches.' });
  }
};

// Toggle a key action checkbox (admin only)
export const toggleStepAction = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const { caseId, stepKey, index } = req.params as any;
    const actionIndex = Number(index);
    if (!Number.isInteger(actionIndex) || actionIndex < 0) {
      return res.status(400).json({ message: 'Invalid action index.' });
    }

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });

    const step: any = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Step not found.' });

    // Backfill actions from template if needed
    if (!Array.isArray(step.actions) || step.actions.length === 0) {
      const t: any = await WorkflowTemplate.findById(inst.templateId).lean();
      const templateStep = (t?.steps || []).find((x: any) => x.key === stepKey);
      step.actions = (templateStep?.actions || []).map((text: any) => ({ text: String(text || '').trim(), done: false }));
    }

    const actions = Array.isArray(step.actions) ? step.actions : [];
    const target = actions[actionIndex];
    if (!target) return res.status(404).json({ message: 'Action not found.' });

    const nextDone = !Boolean(target.done);
    if (nextDone) {
      const orderedSteps = (inst.steps || []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
      const flatActions = orderedSteps.flatMap((orderedStep: any) =>
        (orderedStep.actions || []).map((action: any, idx: number) => ({
          step: orderedStep,
          action,
          idx,
          key: orderedStep.stepKey,
        }))
      );
      const currentFlatIndex = flatActions.findIndex((item: any) => item.key === stepKey && item.idx === actionIndex);
      const previousIncomplete = flatActions.slice(0, currentFlatIndex).find((item: any) => !item.action?.done);
      if (previousIncomplete) {
        return res.status(400).json({ message: 'Complete the previous key action first.' });
      }
    }

    target.done = nextDone;
    target.doneAt = nextDone ? new Date() : undefined;

    if (step.status === 'Not Started') step.status = 'In Progress';
    if (!nextDone) {
      const orderedSteps = (inst.steps || []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
      const stepIndex = orderedSteps.findIndex((orderedStep: any) => orderedStep.stepKey === stepKey);
      for (const orderedStep of orderedSteps.slice(stepIndex)) {
        const actionsToReset = orderedStep.stepKey === stepKey
          ? (orderedStep.actions || []).slice(actionIndex + 1)
          : (orderedStep.actions || []);
        for (const action of actionsToReset) {
          action.done = false;
          action.doneAt = undefined;
        }
        if (orderedStep.stepKey === stepKey) {
          orderedStep.status = 'In Progress';
          orderedStep.completedAt = undefined;
        } else {
          orderedStep.status = 'Not Started';
          orderedStep.completedAt = undefined;
        }
      }
      inst.status = 'Active';
      inst.currentStepKey = stepKey;
    }

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_STEP_ACTION_TOGGLED',
      message: 'Updated workflow key action',
      detail: `${stepKey} • ${target.text} • ${nextDone ? 'done' : 'not done'}`,
    });

    // If all key actions are done, auto-complete the step (and update case progress/billing)
    const allDone = actions.length === 0 || actions.every((a: any) => a?.done === true);
    if (allDone && step.status !== 'Completed') {
      const updated = await completeStepInternal(req, c, inst, stepKey);
      return res.json(updated);
    }

    await inst.save();
    await updateCaseWorkflowProgress(c, inst);
    res.json(inst);
  } catch (e: any) {
    const status = typeof e?.statusCode === 'number' ? e.statusCode : 500;
    res.status(status).json({
      message: e?.message || 'Failed to update key action.',
      ...(Array.isArray(e?.remainingActions) ? { remainingActions: e.remainingActions } : {}),
    });
  }
};

// Set a specific fee for a step (admin only; used for fee ranges)
export const setStepFeeAmount = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ message: 'Forbidden.' });

    const { caseId, stepKey } = req.params as any;
    const { amount, currency } = req.body || {};

    const feeAmount = Number(amount);
    if (!Number.isFinite(feeAmount) || feeAmount < 0) {
      return res.status(400).json({ message: 'amount must be a non-negative number.' });
    }

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    const inst: any = await WorkflowInstance.findOne({ caseId: c._id });
    if (!inst) return res.status(404).json({ message: 'Workflow instance not found.' });

    const step: any = (inst.steps || []).find((s: any) => s.stepKey === stepKey);
    if (!step) return res.status(404).json({ message: 'Step not found.' });
    if (step.status === 'Completed') return res.status(400).json({ message: 'Cannot change fee for a completed step.' });

    step.feeAmount = feeAmount;
    step.feeSetByUser = true;
    if (typeof currency === 'string' && currency.trim()) step.feeCurrency = currency.trim().toUpperCase();

    await inst.save();
    await updateCaseWorkflowProgress(c, inst);

    const actor = actorFromReq(req);
    await writeAudit({
      caseId: String(c._id),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'WORKFLOW_STEP_FEE_SET',
      message: 'Set workflow step fee',
      detail: `${stepKey} • ${step.feeCurrency || ''} ${feeAmount}`,
    });

    res.json(inst);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to set step fee.' });
  }
};
