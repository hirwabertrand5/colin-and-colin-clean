import { FirmReportResponse } from '../../services/firmReportsService';

const money = (value: number | null | undefined) => value == null ? 'Pending' : `RWF ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value: number | null | undefined) => value == null ? 'Pending' : `${value}%`;

export default function ProductivityOverview({ data }: { data: FirmReportResponse }) {
  const summary = data.productivitySummary;
  const comparison = data.productivityReconciliation;
  const metrics = [
    { label: 'Fees Earned', value: money(comparison?.selectedPeriod.feesEarned), basis: 'Payment date', primary: true },
    { label: 'Collected base', value: money(summary?.totalTaskFeeCollected), basis: 'Payment date' },
    { label: 'Key Actions completed', value: summary?.keyActionsCompleted ?? 0, basis: 'Completion date' },
    { label: 'Matters completed', value: summary?.completedTasks ?? 0, basis: 'Completion date' },
  ];
  const workMetrics = [
    ['Sections completed', comparison?.selectedPeriod.sectionsCompleted ?? 0],
    ['Contribution records', summary?.contributionRecords ?? data.productivityRows?.length ?? 0],
    ['Zero allocations', summary?.zeroAllocationActions ?? 0],
    ['Quality scores pending', summary?.pendingQualityScores ?? 0],
    ['Timeliness scores pending', summary?.pendingTimelinessScores ?? 0],
    ['Fees pending', data.productivityEarningsSummary?.pendingFeeRecords ?? 0],
    ['Average quality', percent(summary?.averageQualityScore)],
    ['Average timeliness', percent(summary?.averageTimelinessScore)],
    ['Missing matter details', summary?.missingMatterReferences ?? 0],
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
      <h3>Dashboard comparison</h3>
      <div className="fr-table-scroll"><table>
        <thead><tr><th scope="col">Metric</th><th scope="col">Selected period</th><th scope="col">All time</th><th scope="col">Basis</th></tr></thead>
        <tbody>
          <tr><th scope="row">Fees Earned</th><td>{money(comparison.selectedPeriod.feesEarned)}</td><td>{money(comparison.allTime.feesEarned)}</td><td>Payment date</td></tr>
          <tr><th scope="row">Key Actions checked</th><td>{comparison.selectedPeriod.keyActionsChecked}</td><td>{comparison.allTime.keyActionsChecked}</td><td>Completion date · Current assignments</td></tr>
          <tr><th scope="row">Sections completed</th><td>{comparison.selectedPeriod.sectionsCompleted}</td><td>{comparison.allTime.sectionsCompleted}</td><td>Final action · Current assignments</td></tr>
        </tbody>
      </table></div>
      <div className="fr-reconciliation-counts" aria-label="Contribution reconciliation">
        <span>All-time contributions <strong>{comparison.allTimeContributionRecords}</strong></span>
        <span>In period <strong>{data.productivityRows?.length ?? 0}</strong></span>
        <span>Outside period <strong>{comparison.outsidePeriodContributionRecords}</strong></span>
        <span>Undated <strong>{comparison.undatedContributionRecords}</strong></span>
        <span>Dashboard fees pending <strong>{comparison.selectedPeriod.pendingFeeRecords}</strong></span>
      </div>
    </section>}
    <details className="fr-sources" aria-label="Calculation sources">
      <summary>Sources & calculation</summary>
      <dl>
        <div><dt>Work & matter</dt><dd>Workflow actions, assignment history, case number or parties.</dd></div>
        <div><dt>Collected base</dt><dd>Contract × action percentage, capped by Paid invoices. Earnings: payment period. Work valuation: all-time collections.</dd></div>
        <div><dt>Scores</dt><dd>Case Management quality review; legacy task scores where applicable. Timeliness: Case Workspace.</dd></div>
        <div><dt>Fee Earned</dt><dd>Collected base × TPA × timeliness × quality. Missing scores remain pending.</dd></div>
      </dl>
    </details>
  </section>;
}
