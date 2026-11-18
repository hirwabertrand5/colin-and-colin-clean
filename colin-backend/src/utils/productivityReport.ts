import { caseMatchesAssigneeCanonical, identityMatches } from './caseAssignments';
import { CaseEarnedFeesResult, computeCaseEarnedFees, normalizeEffectiveWorkflowSteps } from './caseEarnedFees';
import { isWithinReportRange, reportTimeZone, ResolvedReportRange } from './reportRange';

const money = (n: number) => Math.round(n * 100) / 100;
const actionId = (row: any) => `${row.caseId}:${row.keyActionKey}`;

/** Bases belong to actions; fees belong to contributors. Never sum a base once per role. */
export function summarizeProductivity(rows: any[]) {
  const actions = new Map(rows.map(row => [actionId(row), row]));
  const average = (field: string) => {
    const scored = rows.filter(row => row[field] != null);
    return scored.length ? Math.round(scored.reduce((sum, row) => sum + row[field], 0) / scored.length * 10) / 10 : null;
  };
  const totalTaskFeeCollected = money([...actions.values()].reduce((sum, row) => sum + row.taskFeeCollected, 0));
  const scoredFees = rows.filter(row => row.feeEarned != null);
  return {
    completedTasks: new Set(rows.filter(row => row.caseCompleted).map(row => row.caseId)).size,
    keyActionsCompleted: actions.size,
    contributionRecords: rows.length,
    totalTaskFeeCollected,
    totalTaskFee: totalTaskFeeCollected,
    totalFeeEarned: scoredFees.length ? money(scoredFees.reduce((sum, row) => sum + row.feeEarned, 0)) : null,
    pendingFeeRecords: rows.filter(row => row.feeEarned == null).length,
    pendingQualityScores: rows.filter(row => row.qualityScore == null).length,
    pendingTimelinessScores: rows.filter(row => row.timelinessScore == null).length,
    zeroAllocationActions: [...actions.values()].filter(row => row.taskFeeCollected === 0).length,
    missingMatterReferences: [...actions.values()].filter(row => !row.matterReference).length,
    averageQualityScore: average('qualityScore'),
    averageTimelinessScore: average('timelinessScore'),
  };
}

/** Two independent date dimensions, both using the Case Workspace earnings engine. */
export function buildProductivityReconciliation({
  matters, templatesById, instancesByCaseId, tasksByCaseId, historicalCollectedByCaseId,
  paidInvoicesByCaseId, roleByName, selectedMemberName, period, allRows, earningRows,
  historicalFeesByCaseId, periodFeesByCaseId,
}: {
  matters: any[]; templatesById: Map<string, any>; instancesByCaseId: Map<string, any>;
  tasksByCaseId: Map<string, any[]>; historicalCollectedByCaseId: Map<string, number>;
  paidInvoicesByCaseId: Map<string, number>; roleByName: Map<string, string>;
  selectedMemberName: string | null; period: ResolvedReportRange | null; allRows: any[]; earningRows: any[];
  historicalFeesByCaseId?: Map<string, CaseEarnedFeesResult>; periodFeesByCaseId?: Map<string, CaseEarnedFeesResult>;
}) {
  const periodRows = allRows.filter(row => isWithinReportRange(row.completedAt, period)).map(row => ({
    ...row, caseCompleted: row.caseCompleted && isWithinReportRange(row.caseCompletedAt, period),
  }));
  const workSummary = summarizeProductivity(periodRows);
  const earningSummary = summarizeProductivity(earningRows);
  const newScope = () => ({ keyActionsChecked: 0, sectionsCompleted: 0, feesEarned: 0 as number | null, pendingFeeRecords: 0 });
  const allTime = newScope();
  const selectedPeriod = newScope();
  let knownAllTime = false;
  let knownPeriod = false;
  for (const matter of matters) {
    const caseId = String(matter._id);
    const instance = instancesByCaseId.get(caseId);
    const template = templatesById.get(String(instance?.templateId || matter.workflowTemplateId || ''));
    const steps = normalizeEffectiveWorkflowSteps(instance, template);
    const inputs = { caseDoc: matter, template, workflowInstance: { ...instance, steps }, tasks: tasksByCaseId.get(caseId) || [], roleByName };
    const historical = historicalFeesByCaseId?.get(caseId) || computeCaseEarnedFees({ ...inputs, collectedAmount: historicalCollectedByCaseId.get(caseId) || 0 });
    const inPeriod = period ? periodFeesByCaseId?.get(caseId) || computeCaseEarnedFees({ ...inputs, collectedAmount: paidInvoicesByCaseId.get(caseId) || 0 }) : historical;
    const mine = (team: typeof historical.team) => selectedMemberName ? team.filter(member => identityMatches(member.name, selectedMemberName)) : team;
    for (const member of mine(historical.team)) {
      if (member.earnedFee == null) allTime.pendingFeeRecords++;
      else { allTime.feesEarned! += member.earnedFee; knownAllTime = true; }
    }
    for (const member of mine(inPeriod.team)) {
      if (member.earnedFee == null) selectedPeriod.pendingFeeRecords++;
      else { selectedPeriod.feesEarned! += member.earnedFee; knownPeriod = true; }
    }
    // Dashboard work counters describe the current portfolio. Contributor rows
    // additionally preserve work by former owners and temporary contributors.
    if (selectedMemberName && !caseMatchesAssigneeCanonical(matter, selectedMemberName)) continue;
    const stages = new Map<string, any[]>();
    for (const step of steps) {
      const key = String(step.stageKey || `__step_${step.stepKey}`);
      stages.set(key, [...(stages.get(key) || []), step]);
      if (String(step.status).toLowerCase() !== 'completed') continue;
      allTime.keyActionsChecked++;
      if (isWithinReportRange(step.completedAt, period)) selectedPeriod.keyActionsChecked++;
    }
    for (const stage of stages.values()) {
      if (!stage.length || !stage.every(step => String(step.status).toLowerCase() === 'completed')) continue;
      allTime.sectionsCompleted++;
      const dates = stage.filter(step => step.completedAt).map(step => +new Date(step.completedAt)).filter(Number.isFinite);
      if (!period || (dates.length && isWithinReportRange(new Date(Math.max(...dates)), period))) selectedPeriod.sectionsCompleted++;
    }
  }
  allTime.feesEarned = knownAllTime ? money(allTime.feesEarned!) : null;
  selectedPeriod.feesEarned = knownPeriod ? money(selectedPeriod.feesEarned!) : null;
  return {
    rows: periodRows,
    earningsRows: earningRows,
    earningsSummary: { ...earningSummary, totalFeeEarned: selectedPeriod.feesEarned },
    summary: {
      ...workSummary,
      totalFeeEarned: selectedPeriod.feesEarned,
      totalTaskFeeCollected: earningSummary.totalTaskFeeCollected,
      totalTaskFee: earningSummary.totalTaskFeeCollected,
      pendingFeeRecords: earningSummary.pendingFeeRecords,
      completedWorkPendingFeeRecords: workSummary.pendingFeeRecords,
      completedWorkFeeValue: workSummary.totalFeeEarned,
      completedWorkCollectedBase: workSummary.totalTaskFeeCollected,
    },
    reconciliation: {
      timeZone: reportTimeZone(),
      activityBasis: 'Key Action completion date',
      collectionBasis: 'All-time Paid invoices linked by matter ID; values reflect current collections and scores',
      dashboardFeeBasis: 'Paid invoice payment date (paidAt; updatedAt for legacy invoices)',
      allTime, selectedPeriod,
      allTimeContributionRecords: allRows.length,
      outsidePeriodContributionRecords: allRows.filter(row => row.completedAt && !isWithinReportRange(row.completedAt, period)).length,
      undatedContributionRecords: allRows.filter(row => !row.completedAt).length,
    },
  };
}
