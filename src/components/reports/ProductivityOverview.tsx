import { FirmReportResponse } from '../../services/firmReportsService';
import { PRODUCTIVITY_LABELS as labels } from '../../constants/productivityLabels';

const money = (value: number | null | undefined) => value == null ? 'Pending' : `RWF ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value: number | null | undefined) => value == null ? 'Pending' : `${value}%`;

export default function ProductivityOverview({ data }: { data: FirmReportResponse }) {
  const summary = data.productivitySummary;
  const comparison = data.productivityReconciliation;
  const unavailable = 'Unavailable';
  const actionRows = new Map((data.productivityRows || []).map(row => [row.keyActionKey ? `${row.caseId}:${row.keyActionKey}` : row.id.split(':').slice(0, 2).join(':'), row]));
  const completedActions = summary?.keyActionsCompleted ?? (data.productivityRows ? actionRows.size : unavailable);
  const feesEarned = comparison?.selectedPeriod && 'feesEarned' in comparison.selectedPeriod ? comparison.selectedPeriod.feesEarned : summary?.totalFeeEarned;
  const metrics = [
    { label: labels.feesEarned, value: feesEarned === undefined ? unavailable : money(feesEarned), basis: labels.paymentDate, primary: true },
    { label: labels.collectedBase, value: summary?.totalTaskFeeCollected === undefined ? unavailable : money(summary.totalTaskFeeCollected), basis: labels.paymentDate },
    { label: labels.keyActionsChecked, value: comparison?.selectedPeriod.keyActionsChecked ?? unavailable, basis: labels.taskDate },
    { label: labels.mattersCompleted, value: summary?.completedTasks ?? unavailable, basis: labels.taskDate },
  ];
  const workMetrics = [
    [labels.keyActionsCompleted, completedActions],
    [labels.sectionsCompleted, comparison?.selectedPeriod.sectionsCompleted ?? unavailable],
    [labels.keyActionRecords, summary?.contributionRecords ?? data.productivityRows?.length ?? unavailable],
    [labels.zeroBase, summary?.zeroAllocationActions ?? (data.productivityRows ? [...actionRows.values()].filter(row => (row.taskFeeCollected ?? row.taskFee) === 0).length : unavailable)],
    [labels.pendingQuality, summary?.pendingQualityScores ?? unavailable],
    [labels.pendingTimeliness, summary?.pendingTimelinessScores ?? (data.productivityRows ? data.productivityRows.filter(row => row.timelinessScore == null).length : unavailable)],
    [labels.pendingFees, data.productivityEarningsSummary?.pendingFeeRecords ?? summary?.pendingFeeRecords ?? unavailable],
    [labels.averageQuality, percent(summary?.averageQualityScore)],
    [labels.averageTimeliness, percent(summary?.averageTimelinessScore)],
    [labels.missingReferences, summary?.missingMatterReferences ?? unavailable],
  ];
  return <section className="fr-productivity-summary" aria-label="Productivity summary">
    <div className="fr-section-heading">
      <h2>Productivity</h2>
      <span className="fr-scope">{data.selectedMember?.name || 'All team members'}{data.selectedMember?.role ? ` · ${data.selectedMember.role.replace(/_/g, ' ')}` : ''}</span>
    </div>
    <div className="fr-metrics">
      {metrics.map(metric => <div key={metric.label} className={`fr-metric${metric.primary ? ' fr-metric-primary' : ''}`}>
        <span className="fr-metric-label">{metric.label}</span>
        <strong>{metric.value}</strong>
        <span className="fr-metric-basis">{metric.basis}</span>
      </div>)}
    </div>
    <dl className="fr-work-metrics" aria-label="Work and review summary">
      {workMetrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    {comparison && <section className="fr-comparison" aria-label="Dashboard reconciliation">
      <h3>Dashboard Summary</h3>
      <div className="fr-table-scroll"><table>
        <thead><tr><th scope="col">Metric</th><th scope="col">Selected period</th><th scope="col">All time</th><th scope="col">Basis</th></tr></thead>
        <tbody>
          <tr><th scope="row">{labels.feesEarned}</th><td>{money(comparison.selectedPeriod.feesEarned)}</td><td>{money(comparison.allTime.feesEarned)}</td><td>{labels.paymentDate}</td></tr>
          <tr><th scope="row">{labels.keyActionsChecked}</th><td>{comparison.selectedPeriod.keyActionsChecked}</td><td>{comparison.allTime.keyActionsChecked}</td><td>{labels.taskDate} · Current Assignments</td></tr>
          <tr><th scope="row">{labels.sectionsCompleted}</th><td>{comparison.selectedPeriod.sectionsCompleted}</td><td>{comparison.allTime.sectionsCompleted}</td><td>Final Key Action · Current Assignments</td></tr>
        </tbody>
      </table></div>
      <div className="fr-reconciliation-counts" aria-label="Contribution reconciliation">
        <span>All-Time Key Action Records <strong>{comparison.allTimeContributionRecords}</strong></span>
        <span>Selected Period <strong>{data.productivityRows?.length ?? 0}</strong></span>
        <span>Outside Selected Period <strong>{comparison.outsidePeriodContributionRecords}</strong></span>
        <span>Missing Completion Date <strong>{comparison.undatedContributionRecords}</strong></span>
        <span>{labels.pendingFees} <strong>{comparison.selectedPeriod.pendingFeeRecords}</strong></span>
      </div>
    </section>}
    <details className="fr-sources" aria-label="Calculation sources">
      <summary>Sources & calculation</summary>
      <dl>
        <div><dt>Case Management</dt><dd>Key Actions, Assignment History, Case Number or Parties.</dd></div>
        <div><dt>{labels.collectedBase}</dt><dd>Contract Value × Key Action Percentage, capped by Paid invoices.</dd></div>
        <div><dt>{labels.qualityScore} & {labels.timelinessScore}</dt><dd>Case Management quality review; task scores where applicable. Timeliness: Case Workspace.</dd></div>
        <div><dt>{labels.feesEarned}</dt><dd>Collected Base × TPA × Timeliness Score × Quality Score.</dd></div>
      </dl>
    </details>
  </section>;
}
