import { FirmReportResponse } from '../../services/firmReportsService';

const money = (value: number | null | undefined) => value == null ? 'Pending' : `RWF ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ProductivityOverview({ data }: { data: FirmReportResponse }) {
  const summary = data.productivitySummary;
  const reconciliation = data.productivityReconciliation;
  const cards = [
    ['Fees Earned', money(reconciliation?.selectedPeriod.feesEarned), 'Same payment-period calculation as the dashboard; includes payments for earlier completed work'],
    ['Collected base for earnings', money(summary?.totalTaskFeeCollected), `${data.productivityEarningsSummary?.pendingFeeRecords ?? 0} earning records pending; based on payments received in the selected period`],
    ['Completed Key Actions', summary?.keyActionsCompleted ?? 0, 'Distinct actions with an attributed contribution in this period'],
    ['Completed-work records', summary?.contributionRecords ?? data.productivityRows?.length ?? 0, 'One record per completed Key Action, staff member and delivery role'],
    ['Whole matters completed', summary?.completedTasks ?? 0, 'All Key Actions completed; matter finished in this period'],
    ['Completed actions with zero base', summary?.zeroAllocationActions ?? 0, 'Open the Completed work detail view to review allocation reasons'],
    ['Quality scores pending', summary?.pendingQualityScores ?? 0, 'Completed-work contribution records awaiting a recorded quality score'],
    ['Missing matter references', summary?.missingMatterReferences ?? 0, 'Distinct actions; matter ID and source link remain available'],
  ];
  return <>
    <section className="bg-white border border-gray-200 rounded-lg p-6" aria-label="Productivity summary">
      <h2 className="font-semibold text-gray-900">Productivity and earnings in the selected period</h2>
      <p className="text-sm text-gray-600 mt-2">{data.selectedMember?.name || 'All team members'} · {data.range.from === '0001-01-01' ? 'All time' : `${data.range.from} to ${data.range.to}`}{reconciliation ? ` · ${reconciliation.timeZone}` : ''}. Earnings use payment dates; work counts use completion dates.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-5">
        {cards.map(([label, value, detail]) => <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-600">{label}</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900 break-words">{value}</div>
          <p className="mt-2 text-xs text-gray-600">{detail}</p>
        </div>)}
      </div>
    </section>
    {reconciliation && <section className="bg-white border border-gray-200 rounded-lg p-6" aria-label="Dashboard reconciliation">
      <h2 className="font-semibold text-gray-900">Reconcile with the dashboard</h2>
      <p className="text-sm text-gray-600 mt-2">Select the same staff member and period on both screens. Dashboard work counts cover current assignments. Contribution records also preserve work attributed to former owners and temporary contributors.</p>
      <div className="overflow-x-auto mt-4"><table className="w-full text-sm text-left">
        <thead className="bg-gray-50"><tr><th scope="col" className="p-3">Dashboard metric</th><th scope="col" className="p-3">Selected period</th><th scope="col" className="p-3">All time</th><th scope="col" className="p-3">Source / date rule</th></tr></thead>
        <tbody className="divide-y divide-gray-200">
          <tr><th scope="row" className="p-3 font-medium">Key Actions checked</th><td className="p-3">{reconciliation.selectedPeriod.keyActionsChecked}</td><td className="p-3">{reconciliation.allTime.keyActionsChecked}</td><td className="p-3">Completed workflow steps · completion date</td></tr>
          <tr><th scope="row" className="p-3 font-medium">Sections completed</th><td className="p-3">{reconciliation.selectedPeriod.sectionsCompleted}</td><td className="p-3">{reconciliation.allTime.sectionsCompleted}</td><td className="p-3">Every action in a section completed · last completion date</td></tr>
          <tr><th scope="row" className="p-3 font-medium">Fees earned</th><td className="p-3">{money(reconciliation.selectedPeriod.feesEarned)}</td><td className="p-3">{money(reconciliation.allTime.feesEarned)}</td><td className="p-3">Case Workspace earnings · {reconciliation.dashboardFeeBasis}</td></tr>
        </tbody>
      </table></div>
      <p className="text-sm text-gray-600 mt-4">Fees Earned and the default earnings detail use payments received in the selected period, including payments for earlier work. They match the dashboard for the same staff member and period. The separate Completed work view follows action completion dates and shows its valuation explicitly.</p>
      <p className="text-xs text-gray-600 mt-2">Record reconciliation: {reconciliation.allTimeContributionRecords} all-time contributions = {data.productivityRows?.length ?? 0} in this view + {reconciliation.outsidePeriodContributionRecords} outside the period{data.range.from !== '0001-01-01' ? ` + ${reconciliation.undatedContributionRecords} without a completion date` : ''}. {reconciliation.selectedPeriod.pendingFeeRecords} dashboard earning rows await scores or rates.</p>
    </section>}
    <details className="bg-white border border-gray-200 rounded-lg p-5 text-sm text-gray-600">
      <summary className="cursor-pointer font-medium text-gray-900">Where the values come from</summary>
      <dl className="grid gap-3 mt-4 md:grid-cols-2">
        <div><dt className="font-medium text-gray-900">Work and matter reference</dt><dd>Workflow Key Actions and sections, linked to the matter by its ID. Delivery roles come from recorded activity and assignment history.</dd></div>
        <div><dt className="font-medium text-gray-900">Collected base</dt><dd>Contract value × completed action percentage, capped by linked Paid invoices and allocated proportionally across completed actions. A recorded activity can have no collected allocation.</dd></div>
        <div><dt className="font-medium text-gray-900">Quality and timeliness</dt><dd>Quality comes from Case Management, with completed task scores as a legacy fallback. Timeliness uses the shared Case Workspace scoring rules. Missing values remain pending; recorded zero scores earn zero.</dd></div>
        <div><dt className="font-medium text-gray-900">Fee calculation</dt><dd>Collected action base × recorded TPA rate × timeliness score × quality score. Fees add across contributor roles; the collected base is counted once per action. Rounding cents are reconciled to the shared matter earnings.</dd></div>
      </dl>
    </details>
  </>;
}
