import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import Case from '../models/caseModel';
import Invoice from '../models/invoiceModel';
import PettyCashExpense from '../models/pettyCashExpenseModel';
import Retainer from '../models/retainerModel';
import RetainerActivity from '../models/retainerActivityModel';
import RetainerPeriod from '../models/retainerPeriodModel';
import Task from '../models/taskModel';
import User from '../models/userModel';
import Workflow from '../models/workflowInstanceModel';
import Template from '../models/workflowTemplateModel';
import { buildYearlySequence } from '../utils/counter';
import { getContractValue, getDirectMatterCost } from '../utils/financialMetrics';
import { linkCaseToRetainer, retainerIsUsable } from '../services/retainerService';
import { ordinaryInvoiceFilter, retainerFinancials } from '../services/retainerAccountingService';
import { DEPARTMENTS, decimal, retainerDepartmentOf } from '../utils/retainerAllocation';
import { computeCaseEarnedFees, normalizeEffectiveWorkflowSteps } from '../utils/caseEarnedFees';
import { buildRoleByName } from '../utils/workflowPercentages';

const MANAGER_ROLES = new Set([
  'managing_director',
  'managing_partner',
  'executive_managing_partner',
  'senior_partner',
  'partner',
  'executive_partner',
  'associate_partner',
  'executive_associate_partner',
  'senior_executive_assistant',
  'executive_assistant',
  'originating_attorney',
]);

export const canManage = (req: AuthRequest) => Boolean(req.user?.role && MANAGER_ROLES.has(req.user.role));
const actor = (req: AuthRequest) => ({ name: req.user?.name || 'System', ...(req.user?.id ? { userId: req.user.id } : {}) });
const text = (value: unknown) => String(value ?? '').trim();
const hasField = (source: unknown, field: string) =>
  Boolean(source && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, field));
const statusError = (status: number, message: string) => Object.assign(new Error(message), { status });
const amount = (value: unknown) => {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? Math.round(result) : 0;
};
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
const statusFor = (retainer: any) =>
  retainer.status === 'Active' && retainer.endDate && retainer.endDate < new Date().toISOString().slice(0, 10)
    ? 'Expired'
    : retainer.status;

const serialize = (retainer: any) => ({
  ...retainer,
  _id: String(retainer._id),
  contractValue: amount(retainer.contractValue) || amount(retainer.totalFunded) || amount(retainer.availableBalance),
  // Retainers are shared subscriptions: this is never reduced when a case is linked.
  availableBalance: amount(retainer.contractValue) || amount(retainer.totalFunded) || amount(retainer.availableBalance),
  reservedAmount: 0,
  effectiveStatus: statusFor(retainer),
  isUsable: retainerIsUsable(retainer),
});

export const listRetainers = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req)) return res.status(403).json({ message: 'Forbidden.' });
    const status = text(req.query.status);
    const q = text(req.query.q);
    const filter: any = {};
    if (status && ['Draft', 'Active', 'Paused', 'Closed'].includes(status)) filter.status = status;
    if (q) {
      const search = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ retainerNo: search }, { name: search }, { clientName: search }, { responsiblePartner: search }];
    }

    const [retainers, caseCounts] = await Promise.all([
      Retainer.find(filter).sort({ updatedAt: -1 }).lean(),
      Case.aggregate([{ $match: { retainerId: { $exists: true } } }, { $group: { _id: '$retainerId', count: { $sum: 1 } } }]),
    ]);
    const countByRetainer = new Map(caseCounts.map((item: any) => [String(item._id), Number(item.count)]));
    res.json(retainers.map((retainer: any) => ({ ...serialize(retainer), linkedCaseCount: countByRetainer.get(String(retainer._id)) || 0 })));
  } catch (error: any) {
    res.status(500).json({ message: error?.message || 'Failed to fetch retainers.' });
  }
};

export const listActiveRetainers = async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const retainers = await Retainer.find({ status: 'Active', startDate: { $lte: today }, $or: [{ endDate: { $exists: false } }, { endDate: '' }, { endDate: { $gte: today } }] })
      .sort({ clientName: 1, name: 1 })
      .lean();
    res.json(retainers.map(serialize));
  } catch (error: any) {
    res.status(500).json({ message: error?.message || 'Failed to fetch active retainers.' });
  }
};

export const getRetainer = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req)) return res.status(403).json({ message: 'Forbidden.' });
    const retainer = await Retainer.findById(req.params.id).lean();
    if (!retainer) return res.status(404).json({ message: 'Retainer not found.' });
    const linkedCaseCount = await Case.countDocuments({ retainerId: retainer._id });
    res.json({ ...serialize(retainer), linkedCaseCount });
  } catch (error: any) {
    res.status(500).json({ message: error?.message || 'Failed to fetch retainer.' });
  }
};

export const createRetainer = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req)) return res.status(403).json({ message: 'Forbidden.' });
    const name = text(req.body?.name);
    const clientName = text(req.body?.clientName);
    const billingModel = text(req.body?.billingModel) || 'monthly';
    const startDate = text(req.body?.startDate);
    const endDate = text(req.body?.endDate);
    const status = text(req.body?.status) || 'Draft';
    if (billingModel !== 'monthly') return res.status(400).json({ message: 'A retainer agreement requires a fixed monthly fee.' });
    if (!name || !clientName || !validDate(startDate)) {
      return res.status(400).json({ message: 'Retainer agreement, retainer client, and a valid start date are required.' });
    }
    if (endDate && (!validDate(endDate) || endDate < startDate)) return res.status(400).json({ message: 'End date must be on or after the start date.' });
    if (!['Draft', 'Active', 'Paused', 'Closed'].includes(status)) return res.status(400).json({ message: 'Invalid retainer status.' });

    // New retainer agreements use the fixed monthly fee. Preserve older
    // contract-value fields on existing records without treating them as cash.
    const contractValue = 0;
    const monthlyFee = amount(req.body?.monthlyFee);
    if ((billingModel === 'monthly' || billingModel === 'hybrid') && monthlyFee <= 0) {
      return res.status(400).json({ message: 'Record the fixed monthly fee for the retainer client.' });
    }

    const retainer = await Retainer.create({
      retainerNo: await buildYearlySequence('retainer', 'RET'),
      name,
      clientName,
      billingModel,
      status,
      currency: 'RWF',
      startDate,
      ...(endDate ? { endDate } : {}),
      ...(text(req.body?.renewalDate) ? { renewalDate: text(req.body.renewalDate) } : {}),
      ...(Number(req.body?.billingDay) >= 1 && Number(req.body?.billingDay) <= 28 ? { billingDay: Number(req.body.billingDay) } : {}),
      monthlyFee,
      contractValue,
      // Legacy fields mirror contract value for safe compatibility with data
      // created before retainers became shared subscriptions.
      totalFunded: contractValue,
      availableBalance: contractValue,
      reservedAmount: 0,
      ...(text(req.body?.scope) ? { scope: text(req.body.scope) } : {}),
      ...(text(req.body?.responsiblePartner) ? { responsiblePartner: text(req.body.responsiblePartner) } : {}),
      ...(text(req.body?.notes) ? { notes: text(req.body.notes) } : {}),
      createdBy: actor(req).name,
      excludedServices: text(req.body?.excludedServices),
      additionalWorkChargeable: req.body?.additionalWorkChargeable === true,
      scopeApprovalRequired: req.body?.scopeApprovalRequired !== false,
      utilisationThreshold: Math.max(100, Math.min(10000, Number(req.body?.utilisationThreshold) || 150)),
      ...(actor(req).userId && mongoose.Types.ObjectId.isValid(actor(req).userId!) ? { createdByUserId: new mongoose.Types.ObjectId(actor(req).userId!) } : {}),
    });

    if (contractValue > 0) {
      await RetainerActivity.create({
        retainerId: retainer._id,
        type: 'CONTRACT_VALUE_SET',
        amount: contractValue,
        balanceAfter: contractValue,
        note: 'Initial contract value.',
        createdBy: actor(req).name,
        ...(actor(req).userId && mongoose.Types.ObjectId.isValid(actor(req).userId!) ? { createdByUserId: new mongoose.Types.ObjectId(actor(req).userId!) } : {}),
      });
    }
    res.status(201).json(serialize(retainer.toObject()));
  } catch (error: any) {
    res.status(error?.code === 11000 ? 409 : 500).json({ message: error?.message || 'Failed to create retainer.' });
  }
};

export const updateRetainer = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req)) return res.status(403).json({ message: 'Forbidden.' });
    const existing = await Retainer.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Retainer not found.' });
    const billingModel = text(req.body?.billingModel || existing.billingModel);
    if (existing.billingModel === 'monthly' && billingModel !== 'monthly') return res.status(400).json({ message: 'A retainer agreement requires a fixed monthly fee.' });
    const status = text(req.body?.status || existing.status);
    const startDate = text(req.body?.startDate || existing.startDate);
    const endDate = hasField(req.body, 'endDate') ? text(req.body?.endDate) : existing.endDate || '';
    const monthlyFee = billingModel === 'prepaid' ? 0 : hasField(req.body, 'monthlyFee') ? amount(req.body?.monthlyFee) : existing.monthlyFee || 0;
    if (!['prepaid', 'monthly', 'hybrid'].includes(billingModel) || !['Draft', 'Active', 'Paused', 'Closed'].includes(status) || !validDate(startDate)) {
      return res.status(400).json({ message: 'Invalid retainer details.' });
    }
    if (endDate && (!validDate(endDate) || endDate < startDate)) return res.status(400).json({ message: 'End date must be on or after the start date.' });
    if ((billingModel === 'monthly' || billingModel === 'hybrid') && monthlyFee <= 0) {
      return res.status(400).json({ message: 'Record the fixed monthly fee for the retainer client.' });
    }

    existing.name = text(req.body?.name) || existing.name;
    existing.clientName = text(req.body?.clientName) || existing.clientName;
    existing.billingModel = billingModel as any;
    existing.status = status as any;
    existing.startDate = startDate;
    existing.set('endDate', endDate || undefined);
    if (hasField(req.body, 'renewalDate')) existing.set('renewalDate', text(req.body?.renewalDate) || undefined);
    if (hasField(req.body, 'billingDay')) existing.set('billingDay', Number(req.body?.billingDay) >= 1 && Number(req.body?.billingDay) <= 28 ? Number(req.body.billingDay) : undefined);
    existing.monthlyFee = monthlyFee;
    if (hasField(req.body, 'excludedServices')) existing.excludedServices = text(req.body.excludedServices);
    if (hasField(req.body, 'additionalWorkChargeable')) existing.additionalWorkChargeable = req.body.additionalWorkChargeable === true;
    if (hasField(req.body, 'scopeApprovalRequired')) existing.scopeApprovalRequired = req.body.scopeApprovalRequired !== false;
    if (hasField(req.body, 'utilisationThreshold')) existing.utilisationThreshold = Math.max(100, Math.min(10000, Number(req.body.utilisationThreshold) || 150));
    // A previous version stored per-case reservations. The shared
    // subscription model always exposes the whole contract value instead.
    existing.reservedAmount = 0;
    existing.availableBalance = amount(existing.contractValue) || amount(existing.totalFunded) || amount(existing.availableBalance);
    if (hasField(req.body, 'scope')) existing.set('scope', text(req.body?.scope) || undefined);
    if (hasField(req.body, 'responsiblePartner')) existing.set('responsiblePartner', text(req.body?.responsiblePartner) || undefined);
    if (hasField(req.body, 'notes')) existing.set('notes', text(req.body?.notes) || undefined);
    await existing.save();
    res.json(serialize(existing.toObject()));
  } catch (error: any) {
    res.status(500).json({ message: error?.message || 'Failed to update retainer.' });
  }
};

/**
 * A retainer can be deleted while it has never covered a case. Once cases are
 * linked, deletion is blocked so their subscription history cannot be
 * orphaned; unlink the cases first if the agreement was created in error.
 */
export const deleteRetainer = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req)) return res.status(403).json({ message: 'Forbidden.' });
    const retainerId = text(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(retainerId)) return res.status(400).json({ message: 'Invalid retainer id.' });

    const retainer = await Retainer.findById(retainerId);
    if (!retainer) return res.status(404).json({ message: 'Retainer not found.' });
    if (await RetainerPeriod.exists({ retainerId })) return res.status(409).json({ message: 'Retainers with monthly accounting history must be closed rather than deleted.' });
    const linkedCases = await Case.countDocuments({ retainerId: retainer._id });
    if (linkedCases > 0) {
      return res.status(409).json({ message: 'Unlink all cases before deleting this retainer.' });
    }

    await RetainerActivity.deleteMany({ retainerId: retainer._id });
    await retainer.deleteOne();
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ message: error?.message || 'Failed to delete retainer.' });
  }
};

export const adjustRetainerContractValue = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req)) return res.status(403).json({ message: 'Forbidden.' });
    const retainerId = text(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(retainerId)) return res.status(400).json({ message: 'Invalid retainer id.' });
    const adjustment = amount(req.body?.amount);
    if (adjustment <= 0) return res.status(400).json({ message: 'Enter a contract-value adjustment greater than zero.' });
    const session = await mongoose.startSession();
    try {
      let savedRetainer: any;
      await session.withTransaction(async () => {
        const retainer = await Retainer.findById(retainerId).session(session);
        if (!retainer) throw statusError(404, 'Retainer not found.');
        if (retainer.billingModel === 'monthly') throw statusError(400, 'A monthly-fee retainer has no subscription contract value to adjust.');
        if (retainer.status === 'Closed') throw statusError(400, 'A closed retainer cannot have its contract value adjusted.');

        const currentContractValue = amount(retainer.contractValue) || amount(retainer.totalFunded) || amount(retainer.availableBalance);
        retainer.contractValue = currentContractValue + adjustment;
        retainer.totalFunded = retainer.contractValue;
        retainer.availableBalance = retainer.contractValue;
        retainer.reservedAmount = 0;
        await retainer.save({ session });
        await RetainerActivity.create(
          [
            {
              retainerId: retainer._id,
              type: 'CONTRACT_VALUE_ADJUSTED',
              amount: adjustment,
              balanceAfter: retainer.contractValue,
              note: text(req.body?.note) || 'Contract value adjustment.',
              createdBy: actor(req).name,
              ...(actor(req).userId && mongoose.Types.ObjectId.isValid(actor(req).userId!) ? { createdByUserId: new mongoose.Types.ObjectId(actor(req).userId!) } : {}),
            },
          ],
          { session }
        );
        savedRetainer = retainer.toObject();
      });
      res.json(serialize(savedRetainer));
    } finally {
      await session.endSession();
    }
  } catch (error: any) {
    res.status(error?.status || 500).json({ message: error?.message || 'Failed to adjust retainer contract value.' });
  }
};

export const listRetainerCases = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req)) return res.status(403).json({ message: 'Forbidden.' });
    const retainerId = text(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(retainerId)) return res.status(400).json({ message: 'Invalid retainer id.' });
    const cases = await Case.find({ retainerId: new mongoose.Types.ObjectId(retainerId) })
      .select('caseNo parties status priority budget workflowProgress legalServicePath caseType createdAt updatedAt caseAssignments assignedTo assignmentHandoverHistory caseManagement retainerCoveredActionKeys workflowTemplateId')
      .sort({ updatedAt: -1 })
      .lean();
    const caseIds = cases.map((item: any) => item._id);

    const [invoiceTotals, expenses, retainerFinancialData, workflows, tasks, users] = await Promise.all([
      caseIds.length
        ? Invoice.aggregate([
            { $match: { caseId: { $in: caseIds }, ...ordinaryInvoiceFilter } },
            {
              $group: {
                _id: '$caseId',
                totalBilled: { $sum: '$amount' },
                totalCollected: { $sum: { $cond: [{ $eq: ['$status', 'Paid'] }, '$amount', 0] } },
              },
            },
          ])
        : [],
      caseIds.length
        ? PettyCashExpense.find({ caseId: { $in: caseIds }, chargeType: 'client' }).select('caseId amount refundAmount').lean()
        : [],
      retainerFinancials(null, null, null, retainerId),
      caseIds.length ? Workflow.find({ caseId: { $in: caseIds } }).lean() : [],
      caseIds.length ? Task.find({ caseId: { $in: caseIds } }).lean() : [],
      caseIds.length ? User.find({}).select('name role tpaHistory').lean() : [],
    ]);
    const templates = workflows.length ? await Template.find({ _id: { $in: workflows.map((workflow) => workflow.templateId).filter(Boolean) } }).lean() : [];
    const workflowByCase = new Map(workflows.map((workflow) => [String(workflow.caseId), workflow]));
    const templateById = new Map(templates.map((template) => [String(template._id), template]));
    const tasksByCase = new Map<string, any[]>();
    for (const task of tasks) {
      const key = String(task.caseId);
      const list = tasksByCase.get(key) || [];
      list.push(task); tasksByCase.set(key, list);
    }
    const roleByName = buildRoleByName(users);
    const invoiceByCase = new Map(invoiceTotals.map((item: any) => [String(item._id), item]));
    const revenueByCase = new Map<string, number>();
    const productionByCase = new Map<string, number>();
    const services = retainerFinancialData.statements.flatMap((p) => p.allocation.services);
    const servicesByCase = new Map<string, any[]>();
    for (const service of services) {
      const key = String(service.caseId); revenueByCase.set(key, (revenueByCase.get(key) || 0) + service.allocatedRevenue);
      productionByCase.set(key, (productionByCase.get(key) || 0) + service.ordinaryFee);
      const work = servicesByCase.get(key) || [];
      work.push(service); servicesByCase.set(key, work);
    }
    const costsByCase = new Map<string, number>();
    for (const expense of expenses as any[]) {
      const caseId = String(expense.caseId);
      costsByCase.set(caseId, (costsByCase.get(caseId) || 0) + getDirectMatterCost(expense));
    }

    const caseRows = cases.map((caseItem: any) => {
      const invoice = invoiceByCase.get(String(caseItem._id));
      const contractValue = getContractValue(caseItem);
      const totalBilled = amount(invoice?.totalBilled);
      const totalCollected = amount(invoice?.totalCollected) + (revenueByCase.get(String(caseItem._id)) || 0);
      const directMatterCosts = amount(costsByCase.get(String(caseItem._id)));
      const grossProfit = totalCollected - directMatterCosts;
      const work = servicesByCase.get(String(caseItem._id)) || [];
      const contributors = new Map<string, { userId: string; name: string; earnedTpa: number }>();
      for (const service of work) for (const member of service.contributors) {
        const key = String(member.userId);
        const prior = contributors.get(key);
        contributors.set(key, { userId: key, name: member.name, earnedTpa: decimal((prior?.earnedTpa || 0) + member.earnedTpa) });
      }
      const staffTpa = decimal([...contributors.values()].reduce((total, member) => total + member.earnedTpa, 0));
      const retainerRevenue = revenueByCase.get(String(caseItem._id)) || 0;
      const workflow = workflowByCase.get(String(caseItem._id));
      const template = workflow ? templateById.get(String(workflow.templateId)) : null;
      const earnedFees = computeCaseEarnedFees({
        caseDoc: caseItem,
        template,
        workflowInstance: { ...(workflow || {}), steps: normalizeEffectiveWorkflowSteps(workflow, template) },
        tasks: tasksByCase.get(String(caseItem._id)) || [],
        collectedAmount: amount(invoice?.totalCollected),
        roleByName,
      });
      return {
        ...caseItem,
        contractValue,
        ordinaryWorkValue: productionByCase.get(String(caseItem._id)) || 0,
        retainerRevenue,
        staffTpa,
        servicesCount: work.length,
        team: earnedFees.team,
        caseStaffEarnedTotal: earnedFees.staffEarnedTotal,
        contributors: [...contributors.values()].sort((a, b) => b.earnedTpa - a.earnedTpa || a.name.localeCompare(b.name)),
        netContribution: decimal(retainerRevenue - directMatterCosts - staffTpa),
        department: retainerDepartmentOf(caseItem),
        totalBilled,
        totalCollected,
        outstanding: Math.max(0, totalBilled - amount(invoice?.totalCollected)),
        directMatterCosts,
        grossProfit,
        profitStatus: grossProfit > 0 ? 'Profitable' : grossProfit < 0 ? 'Loss' : 'Break-even',
      };
    });
    const summary = caseRows.reduce(
      (totals, caseItem) => ({
        caseCount: totals.caseCount + 1,
        contractValue: totals.contractValue + caseItem.contractValue,
        ordinaryWorkValue: totals.ordinaryWorkValue + caseItem.ordinaryWorkValue,
        totalBilled: totals.totalBilled + caseItem.totalBilled,
        totalCollected: totals.totalCollected + caseItem.totalCollected,
        outstanding: totals.outstanding + caseItem.outstanding,
        directMatterCosts: totals.directMatterCosts + caseItem.directMatterCosts,
        grossProfit: totals.grossProfit + caseItem.grossProfit,
        profitableCases: totals.profitableCases + (caseItem.profitStatus === 'Profitable' ? 1 : 0),
        lossMakingCases: totals.lossMakingCases + (caseItem.profitStatus === 'Loss' ? 1 : 0),
      }),
      { caseCount: 0, contractValue: 0, ordinaryWorkValue: 0, totalBilled: 0, totalCollected: 0, outstanding: 0, directMatterCosts: 0, grossProfit: 0, profitableCases: 0, lossMakingCases: 0 }
    );
    const accounting = {
      recordedMonths: retainerFinancialData.statements.length,
      fixedFees: retainerFinancialData.billed,
      actualReceived: retainerFinancialData.collected,
      outstanding: retainerFinancialData.outstanding,
      overpayment: retainerFinancialData.statements.reduce((total, p) => total + p.allocation.overpayment, 0),
      workValue: retainerFinancialData.workValue,
      staffTpa: retainerFinancialData.staffTpa,
      firmUnutilisedRevenue: retainerFinancialData.unutilisedRevenue,
      allocableRevenue: retainerFinancialData.collected - retainerFinancialData.unutilisedRevenue,
      departments: DEPARTMENTS.map((department) => {
        const work = services.filter((service) => service.department === department);
        const ordinaryValue = work.reduce((total, service) => total + service.ordinaryFee, 0);
        return { department, ordinaryValue,
          share: retainerFinancialData.workValue ? decimal(ordinaryValue / retainerFinancialData.workValue * 100) : 0,
          allocatedRevenue: work.reduce((total, service) => total + service.allocatedRevenue, 0) };
      }),
      services,
    };
    res.json({ cases: caseRows, summary, accounting });
  } catch (error: any) {
    res.status(500).json({ message: error?.message || 'Failed to fetch retainer cases.' });
  }
};

export const listRetainerActivity = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req)) return res.status(403).json({ message: 'Forbidden.' });
    const retainerId = text(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(retainerId)) return res.status(400).json({ message: 'Invalid retainer id.' });
    const activities = await RetainerActivity.find({ retainerId: new mongoose.Types.ObjectId(retainerId) }).sort({ createdAt: -1 }).limit(200).lean();
    const caseIds = activities.map((activity: any) => activity.caseId).filter(Boolean);
    const cases = caseIds.length ? await Case.find({ _id: { $in: caseIds } }).select('caseNo parties').lean() : [];
    const caseMap = new Map(cases.map((item: any) => [String(item._id), item]));
    res.json(activities.map((activity: any) => ({ ...activity, case: activity.caseId ? caseMap.get(String(activity.caseId)) || null : null })));
  } catch (error: any) {
    res.status(500).json({ message: error?.message || 'Failed to fetch retainer activity.' });
  }
};

export const setCaseRetainer = async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req)) return res.status(403).json({ message: 'Forbidden.' });
    const requestedRetainerId = text(req.body?.retainerId);
    const caseDoc = await linkCaseToRetainer({
      caseId: text(req.params.caseId),
      ...(requestedRetainerId ? { retainerId: requestedRetainerId } : {}),
      actor: actor(req),
    });
    res.json(caseDoc);
  } catch (error: any) {
    res.status(400).json({ message: error?.message || 'Failed to update retainer coverage.' });
  }
};
