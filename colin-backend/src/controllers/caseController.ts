import { Response } from 'express';
import Case from '../models/caseModel';
import Task from '../models/taskModel';
import { writeAudit } from '../services/auditService';
import { AuthRequest } from '../middleware/authMiddleware';

import WorkflowTemplate from '../models/workflowTemplateModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import { buildInstanceSteps } from '../utils/workflowCompute';
import { buildYearlySequence } from '../utils/counter';

const actorFromReq = (req: AuthRequest) => ({
  actorName: req.user?.name || 'System',
  actorUserId: req.user?.id as string | undefined,
});

const isAdminCaseRole = (role?: string) =>
  role === 'managing_director' ||
  role === 'managing_partner' ||
  role === 'senior_partner' ||
  role === 'partner' ||
  role === 'associate_partner' ||
  role === 'executive_assistant';

const isAssociateLikeRole = (role?: string) =>
  role === 'associate' ||
  role === 'trainee_associate' ||
  role === 'senior_associate' ||
  role === 'intern';

const canAssociateLikeAccessCase = async (req: AuthRequest, foundCase: any) => {
  if (!isAssociateLikeRole(req.user?.role)) return false;

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

export const getAllCases = async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;

    if (isAdminCaseRole(role)) {
      const cases = await Case.find().sort({ updatedAt: -1 });
      return res.json(cases);
    }

    if (isAssociateLikeRole(role)) {
      const me = (req.user?.name || '').trim();
      if (!me) return res.json([]);

      const assignedCases = await Case.find({ assignedTo: me }).sort({ updatedAt: -1 });
      const taskCaseIds = await Task.distinct('caseId', { assignee: me });
      const taskCases = await Case.find({ _id: { $in: taskCaseIds } }).sort({ updatedAt: -1 });

      const map = new Map<string, any>();
      [...assignedCases, ...taskCases].forEach((c: any) => map.set(String(c._id), c));
      return res.json(Array.from(map.values()));
    }

    return res.status(403).json({ message: 'Forbidden.' });
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

    return res.status(403).json({ message: 'Forbidden.' });
  } catch {
    return res.status(500).json({ message: 'Failed to fetch case.' });
  }
};

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
    if (req.user?.role !== 'managing_director' && req.user?.role !== 'executive_assistant') {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const deleted = await Case.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Case not found.' });

    return res.json({ message: 'Case deleted.' });
  } catch {
    return res.status(500).json({ message: 'Failed to delete case.' });
  }
};
