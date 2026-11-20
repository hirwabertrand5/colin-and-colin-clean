import type { MyProductivityEarningsResponse } from '../../services/firmReportsService';
import type useProductivityReport from '../../hooks/useProductivityReport';
import { PRODUCTIVITY_PAGE_SIZE } from '../../hooks/useProductivityReport';
import ProductivityOverview from './ProductivityOverview';
import ProductivityRecords from './ProductivityRecords';
import './firmReports.css';

export default function ProductivityReportContent({ data, report }: {
  data: MyProductivityEarningsResponse | null;
  report: ReturnType<typeof useProductivityReport>;
}) {
  return <div className="space-y-6">
    {data && <ProductivityOverview data={data} />}
    <section className="fr-records" aria-label="Productivity records">
      <ProductivityRecords data={data} rows={report.pagedProductivityRows} filteredRows={report.sortedProductivityRows}
        total={report.productivityRows.length} startIndex={(report.safeProductivityPage - 1) * PRODUCTIVITY_PAGE_SIZE}
        view={report.productivityView} setView={view => { report.setProductivityView(view); report.setProductivityIssue('all'); report.setProductivitySearch(''); report.setProductivityPage(1); }}
        search={report.productivitySearch} setSearch={report.setProductivitySearch}
        issue={report.productivityIssue} setIssue={report.setProductivityIssue}
        sortKey={report.productivitySortKey} sortDir={report.productivitySortDir} onSort={report.handleProductivitySort} />
      {report.sortedProductivityRows.length > PRODUCTIVITY_PAGE_SIZE && <div className="fr-records-footer">
        <span>Page {report.safeProductivityPage} of {report.productivityTotalPages} · {report.sortedProductivityRows.length} contribution records</span>
        <div className="fr-pagination">
          <button type="button" onClick={() => report.setProductivityPage(page => Math.max(1, page - 1))} disabled={report.safeProductivityPage <= 1}>Previous</button>
          <button type="button" onClick={() => report.setProductivityPage(page => Math.min(report.productivityTotalPages, page + 1))} disabled={report.safeProductivityPage >= report.productivityTotalPages}>Next</button>
        </div>
      </div>}
    </section>
  </div>;
}
