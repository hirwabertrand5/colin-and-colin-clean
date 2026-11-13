import Case from '../models/caseModel';
import Task from '../models/taskModel';
import User from '../models/userModel';
import Invoice from '../models/invoiceModel';
import WorkflowTemplate from '../models/workflowTemplateModel';
import WorkflowInstance from '../models/workflowInstanceModel';
import { ordinaryInvoiceFilter, retainerEarningsRows } from './retainerAccountingService';
import type { ResolvedReportRange } from '../utils/reportRange';

const stepFields = 'stepKey title stageKey stageOrder stageTitle stagePercentage percentage order status startAt dueAt completedAt submittedAt reviewedAt doneAt carriedWork actions tpaSnapshots independentContributors custom archivedFromTemplate'.split(' ');
const stepDetails: Record<string, any> = Object.fromEntries(stepFields.map(field => [field, `$$step.${field}`]));
stepDetails.actions = { $map: { input: { $ifNull: ['$$step.actions', []] }, as: 'action', in: { done: '$$action.done', doneAt: '$$action.doneAt' } } };
const stepIdentity = Object.fromEntries('stepKey stageKey percentage status custom archivedFromTemplate'.split(' ').map(field => [field, `$$step.${field}`]));
// Preserve every step's identity, status and weight. Only work with actual
// activity needs its dates, descriptions and scoring history in a staff total.
const hasStepActivity = { $or: [
  { $not: [{ $in: [{ $toLower: { $ifNull: ['$$step.status', ''] } }, ['not started', 'in progress']] }] },
  ...['doneAt', 'submittedAt', 'reviewedAt', 'completedAt'].map(field => ({ $ne: [{ $ifNull: [`$$step.${field}`, null] }, null] })),
  ...['tpaSnapshots', 'independentContributors'].map(field => ({ $gt: [{ $size: { $ifNull: [`$$step.${field}`, []] } }, 0] })),
  { $anyElementTrue: [{ $map: { input: { $ifNull: ['$$step.actions', []] }, as: 'action', in: { $eq: ['$$action.done', true] } } }] },
] };

/** Keep the shared earnings engine, but load histories only for work in this window. */
export async function loadStaffProfitabilityInputs(period: ResolvedReportRange | null, from: Date, to: Date): Promise<any[]> {
  const inWindow = { $gte: from, $lte: to };
  const completedChecklist = { 'checklist.0': { $exists: true }, checklist: { $not: { $elemMatch: { completed: { $ne: true } } } } };
  const [matters, users, retainer, workflowCaseIds, taskCaseIds] = await Promise.all([
    Case.find().select('_id assignedTo caseAssignments assignmentHandoverHistory.role assignmentHandoverHistory.previousAssignee assignmentHandoverHistory.nextAssignee assignmentHandoverHistory.changedAt status caseNo budget createdAt updatedAt workflowProgress.status workflowProgress.percent workflowProgress.currentStepDueAt workflowProgress.nextDueAt workflowProgress.plannedValue workflowProgress.completedValue caseManagement.qualityScore workflowTemplateId retainerCoveredActionKeys').batchSize(500).lean(),
    User.find({ isActive: { $ne: false }, ...(period ? { createdAt: { $lt: period.toExclusive } } : {}) }).select('name role tpaHistory').lean(),
    retainerEarningsRows(from, to),
    WorkflowInstance.distinct('caseId', period ? { 'steps.completedAt': inWindow } : {}),
    Task.distinct('caseId', period ? { $and: [
      { $or: [{ completedAt: inWindow }, { completedAt: null, updatedAt: inWindow }] },
      { $or: [{ status: 'Completed' }, completedChecklist] },
    ] } : {}),
  ]);
  const candidateIds = [...new Map([...workflowCaseIds, ...taskCaseIds].filter(Boolean).map(id => [String(id), id])).values()];
  const candidateSet = new Set(candidateIds.map(String));
  const templateIds = [...new Set(matters.filter(m => candidateSet.has(String(m._id))).flatMap(m => m.workflowTemplateId ? [m.workflowTemplateId] : []))];
  const [templates, instances, paidTotals] = candidateIds.length ? await Promise.all([
    WorkflowTemplate.find({ _id: { $in: templateIds } }).select('_id matterType stages.key stages.title stages.name stages.percentage stages.order steps.key steps.title steps.stageKey steps.percentage steps.order').lean(),
    WorkflowInstance.aggregate([
      { $match: { caseId: { $in: candidateIds } } },
      { $project: { caseId: 1, templateId: 1, status: 1, deletedStepKeys: 1,
        steps: { $map: { input: { $ifNull: ['$steps', []] }, as: 'step', in: { $cond: [hasStepActivity, stepDetails, stepIdentity] } } },
      } },
    ]).option({ batchSize: 500 }),
    Invoice.aggregate([{ $match: { caseId: { $in: candidateIds }, status: 'Paid', ...ordinaryInvoiceFilter } }, { $group: { _id: '$caseId', total: { $sum: '$amount' } } }]),
  ]) : [[], [], []];
  // Generated, unstarted tasks have neither completed work nor scores/rates.
  // Loading all of them transferred thousands of unused stage histories.
  // Keep the legacy timestamp fallback when an approved workflow action has
  // no completion timestamp, and retain every task with an activity-rate record.
  const legacyCaseIds = instances.filter(instance => (instance.steps || []).some((step: any) =>
    !step.completedAt && (String(step.status).toLowerCase() === 'completed'
      || (step.actions?.length && step.actions.every((action: any) => action.done))))).map(instance => instance.caseId);
  const tasks = candidateIds.length ? await Task.find({ caseId: { $in: candidateIds }, $or: [
    { status: 'Completed' }, completedChecklist, { 'tpaSnapshots.0': { $exists: true } }, { caseId: { $in: legacyCaseIds } },
  ] }).select('caseId assignee supervisor title description workflowStepKey workflowStageKey completedAt updatedAt dueDate createdAt startDate checklist.completed qualityScore status taskStages.staffMember taskStages.timelinessScore tpaSnapshots.staffKey tpaSnapshots.assignmentRole tpaSnapshots.activityAt tpaSnapshots.rate').lean() : [];
  return [matters, tasks, users, templates, instances, paidTotals, retainer];
}
