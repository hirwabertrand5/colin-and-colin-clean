import Case from '../models/caseModel';
import Task from '../models/taskModel';
import User from '../models/userModel';
import Invoice from '../models/invoiceModel';
import WorkflowTemplate from '../models/workflowTemplateModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import { ordinaryInvoiceFilter, retainerEarningsRows } from './retainerAccountingService';
import type { ResolvedReportRange } from '../utils/reportRange';

/** Keep the shared earnings engine, but load histories only for work in this window. */
export async function loadStaffProfitabilityInputs(period: ResolvedReportRange | null, from: Date, to: Date): Promise<any[]> {
  const inWindow = { $gte: from, $lte: to };
  const [matters, users, retainer, workflowCaseIds, taskCaseIds] = await Promise.all([
    Case.find().select('_id assignedTo caseAssignments assignmentHandoverHistory status caseNo parties clientName budget createdAt updatedAt workflowProgress billingSettings caseManagement.qualityScore caseManagement.qualityScoredBy caseManagement.qualityScoredAt workflowTemplateId matterType workflow legalServicePath caseType caseTypeLabel retainerCoveredActionKeys').lean(),
    User.find({ isActive: { $ne: false }, ...(period ? { createdAt: { $lt: period.toExclusive } } : {}) }).select('name role tpaHistory').lean(),
    retainerEarningsRows(from, to),
    WorkflowInstance.distinct('caseId', period ? { 'steps.completedAt': inWindow } : {}),
    Task.distinct('caseId', period ? { $or: [{ completedAt: inWindow }, { completedAt: null, updatedAt: inWindow }] } : {}),
  ]);
  const candidateIds = [...new Map([...workflowCaseIds, ...taskCaseIds].filter(Boolean).map(id => [String(id), id])).values()];
  const candidateSet = new Set(candidateIds.map(String));
  const templateIds = [...new Set(matters.filter(m => candidateSet.has(String(m._id))).map(m => m.workflowTemplateId).filter(Boolean))];
  const [tasks, templates, instances, paidTotals] = candidateIds.length ? await Promise.all([
    Task.find({ caseId: { $in: candidateIds } }).select('caseId assignee supervisor title description workflowStepKey workflowStageKey completedAt updatedAt dueDate createdAt startDate checklist qualityScore status taskStages tpaSnapshots').lean(),
    WorkflowTemplate.find({ _id: { $in: templateIds } }).select('_id matterType stages.key stages.title stages.name stages.percentage stages.order steps.key steps.title steps.stageKey steps.percentage steps.order').lean(),
    WorkflowInstance.find({ caseId: { $in: candidateIds } }).select('caseId templateId status deletedStepKeys steps.stepKey steps.title steps.stageKey steps.stageOrder steps.stageTitle steps.stagePercentage steps.percentage steps.order steps.status steps.startAt steps.dueAt steps.completedAt steps.submittedAt steps.reviewedAt steps.doneAt steps.actions.done steps.actions.doneAt steps.tpaSnapshots steps.independentContributors steps.custom steps.archivedFromTemplate').lean(),
    Invoice.aggregate([{ $match: { caseId: { $in: candidateIds }, status: 'Paid', ...ordinaryInvoiceFilter } }, { $group: { _id: '$caseId', total: { $sum: '$amount' } } }]),
  ]) : [[], [], [], []];
  return [matters, tasks, users, templates, instances, paidTotals, retainer];
}
