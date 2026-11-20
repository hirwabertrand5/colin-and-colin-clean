import type { MyProductivityEarningsResponse } from '../services/firmReportsService';
import { PRODUCTIVITY_LABELS as labels } from '../constants/productivityLabels';
import { downloadWorkbook, type ExcelSheetDefinition } from './excelExport';

type Row = NonNullable<MyProductivityEarningsResponse['productivityRows']>[number];
export type ProductivityExportOptions = {
  data: MyProductivityEarningsResponse;
  rows: Row[];
  view: 'earnings' | 'completedWork';
  periodLabel: string;
  issue: string;
  search: string;
  sortKey: string;
  sortDir: 'asc' | 'desc';
};
const money = (value: number) => `RWF ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nullableMoney = (value?: number | null) => value == null ? 'Pending' : money(value);
const percent = (value?: number | null) => value == null ? 'Pending' : `${value}%`;
const numbered = (rows: unknown[][]) => rows.map((row, index) => [index + 1, ...row]);

/** Both report surfaces export the same records, definitions and precision. */
export function buildProductivityExport(options: ProductivityExportOptions): ExcelSheetDefinition {
  const { data, rows, view, periodLabel, issue, search, sortKey, sortDir } = options;
  const summary = data.productivitySummary;
  const comparison = data.productivityReconciliation;
  const scored = rows.filter(row => row.feeEarned != null);
  const filteredTotal = scored.length ? money(scored.reduce((sum, row) => sum + (row.feeEarned ?? 0), 0)) : rows.length ? 'Pending' : money(0);
  return {
    title: 'Productivity Report',
    sections: [
      {
        title: 'Selected Filters', headers: ['#', 'Filter', 'Value'],
        rows: numbered([
          ['Selected Staff Member', data.selectedMember?.name || 'All team members'],
          ['Selected Period', data.range.from === '0001-01-01' ? 'All time' : `${periodLabel} (${data.range.from} to ${data.range.to})`],
          ['Work date basis', 'Key Action completion date'],
          ['Earnings date basis', comparison?.dashboardFeeBasis || 'Paid invoice payment date'],
          ['Detail view', view === 'earnings' ? `${labels.feesEarned} · ${labels.paymentDate}` : `${labels.keyActionsCompleted} · ${labels.taskDate}`],
          ['Detail collected base source', view === 'earnings' ? 'Paid invoices received in selected period, allocated through the Case Workspace earnings engine' : comparison?.collectionBasis || 'Linked Paid invoices'],
          ['Timezone', comparison?.timeZone || 'Africa/Kigali'],
          ['Detail issue filter', issue], ['Detail search', search || 'None'],
          ['Detail sort', sortKey ? `${sortKey} (${sortDir})` : 'Report order'],
          [`Exported ${labels.keyActionRecords}`, rows.length],
          ['Filtered detail fee total', filteredTotal],
          ['Filtered detail pending fees', rows.length - scored.length],
        ]),
      },
      {
        title: 'Productivity Summary', headers: ['#', 'Metric', 'Value'],
        rows: numbered([
          [labels.keyActionsChecked, comparison?.selectedPeriod.keyActionsChecked ?? 'Unavailable'],
          [labels.keyActionsCompleted, summary?.keyActionsCompleted ?? 0],
          [labels.keyActionRecords, summary?.contributionRecords ?? data.productivityRows?.length ?? 0],
          [labels.mattersCompleted, summary?.completedTasks ?? 0],
          ['Collected base for payment-period earnings', money(summary?.totalTaskFeeCollected ?? 0)],
          ['Fees Earned · Payment date', nullableMoney(comparison ? comparison.selectedPeriod.feesEarned : summary?.totalFeeEarned)],
          [`${labels.staffEarnedFees} · ${labels.taskDate}`, nullableMoney(summary?.completedWorkFeeValue)],
          ['Pending Quality Scores', summary?.pendingQualityScores ?? 0],
          ['Pending Timeliness Scores', summary?.pendingTimelinessScores ?? 0],
          ['Payment-period earning records pending', data.productivityEarningsSummary?.pendingFeeRecords ?? 0],
          [labels.zeroBase, summary?.zeroAllocationActions ?? 0],
          [labels.missingReferences, summary?.missingMatterReferences ?? 0],
          ['Average Quality Score', percent(summary?.averageQualityScore)],
          ['Average Timeliness Score', percent(summary?.averageTimelinessScore)],
        ]),
      },
      {
        title: 'Dashboard Reconciliation', headers: ['Metric', 'Selected period', 'All time', 'Source'],
        rows: comparison ? [
          [labels.keyActionsChecked, comparison.selectedPeriod.keyActionsChecked, comparison.allTime.keyActionsChecked, labels.taskDate],
          [labels.sectionsCompleted, comparison.selectedPeriod.sectionsCompleted, comparison.allTime.sectionsCompleted, 'Final Key Action'],
          [labels.feesEarned, nullableMoney(comparison.selectedPeriod.feesEarned), nullableMoney(comparison.allTime.feesEarned), comparison.dashboardFeeBasis],
          ['All-Time Key Action Records', comparison.allTimeContributionRecords, '', 'All Time'],
          ['Key Action Records Outside Period', comparison.outsidePeriodContributionRecords, '', labels.taskDate],
          ['Key Action Records Without Completion Date', comparison.undatedContributionRecords, '', 'Excluded from dated periods'],
        ] : [],
      },
      {
        title: `${labels.metrics} · ${view === 'earnings' ? labels.paymentDate : labels.taskDate}`,
        headers: ['#', 'Action completed', 'Staff', 'Matter', 'Key Action', 'Collected Key Action Base', 'TPA', 'Timeliness Score', 'Quality Score', 'Formula', 'Fee Earned', 'Matter ID', 'Assignment role', 'Section', 'Key Action %', 'Matter contract value', 'Matter Paid invoices', 'Allocation status', 'Quality source', 'Review issues', 'Parties', 'Timeliness status', 'Key Action key'],
        rows: numbered(rows.map(row => [
          row.completedAt ? new Date(row.completedAt).toLocaleString('en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: comparison?.timeZone || 'Africa/Kigali' }) : 'Pending',
          row.staff, row.matter, row.task, row.taskFeeCollected ?? row.taskFee ?? 0,
          percent(row.tpaPercent), percent(row.timelinessScore), percent(row.qualityScore), row.formula,
          row.feeEarned == null ? 'Pending' : row.feeEarned,
          row.caseId || '', row.assignmentRole || '', row.workflowStage || '', row.keyActionPercent ?? '',
          row.contractValue ?? '', row.collectedAmount ?? '', row.allocationStatus || '', row.qualitySource || '',
          row.issues?.join('; ') || '', row.matterParties || '', row.timelinessStatus || '', row.keyActionKey || '',
        ])),
        currencyColumns: [6, 11, 16, 17], currencyDecimals: 2,
        percentColumns: [7, 8, 9], centerColumns: [2, 6, 7, 8, 9, 11],
      },
    ],
  };
}

export async function exportProductivityReport(kind: 'excel' | 'pdf', options: ProductivityExportOptions) {
  const sheet = buildProductivityExport(options);
  const member = options.data.selectedMember?.name || 'all-team-members';
  const filename = `productivity-report_${options.data.range.from}_to_${options.data.range.to}_${member.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  if (kind === 'excel') return downloadWorkbook(filename, [sheet]);

  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  doc.setFontSize(16);
  doc.text('Colin & Colin Legal Solutions', 10, 12);
  doc.setFontSize(12);
  doc.text(`${sheet.title} - ${member}`, 10, 20);
  let y = 28;
  for (const section of sheet.sections) {
    if (y > doc.internal.pageSize.getHeight() - 35) { doc.addPage(); y = 15; }
    doc.setFontSize(11);
    doc.text(section.title.replace(/·/g, '-'), 10, y);
    const detail = section.headers.length > 10;
    autoTable(doc, {
      startY: y + 4,
      head: [section.headers],
      body: section.rows.map(row => row.map((value, index) => typeof value === 'number' && section.currencyColumns?.includes(index + 1) ? money(value) : String(value ?? ''))),
      theme: 'striped',
      styles: { fontSize: detail ? 7 : 9, cellPadding: 2, overflow: 'linebreak', ...(detail ? { minCellWidth: 24 } : {}) },
      headStyles: { fillColor: [20, 44, 71] },
      margin: { top: 15, right: 10, bottom: 15, left: 10 },
      horizontalPageBreak: detail,
      horizontalPageBreakRepeat: detail ? [0, 3, 4] : undefined,
      ...(detail ? { columnStyles: { 3: { cellWidth: 35 }, 4: { cellWidth: 45 }, 9: { cellWidth: 55 }, 11: { cellWidth: 38 } } } : {}),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFontSize(8);
    doc.text(`Productivity Report | Page ${page} of ${pages}`, 10, doc.internal.pageSize.getHeight() - 6);
  }
  doc.save(`${filename}.pdf`);
}
