import { useEffect, useState } from 'react';
import { FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import { getMyProductivityEarningsReport, type MyProductivityEarningsResponse } from '../../services/firmReportsService';
import useProductivityReport from '../../hooks/useProductivityReport';
import { exportProductivityReport } from '../../utils/productivityReportExport';
import ProductivityReportContent from './ProductivityReportContent';

type Params = NonNullable<Parameters<typeof getMyProductivityEarningsReport>[0]>;

export default function MyProductivityReport({ params, refreshRevision }: { params?: Params; refreshRevision: number }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<{ key: string; loading: boolean; data: MyProductivityEarningsResponse | null; error: string }>();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  // All time must be explicit: the personal endpoint otherwise defaults to this month.
  const requestKey = JSON.stringify([params || { range: 'all' }, refreshRevision, refreshToken]);
  const current = state?.key === requestKey ? state : undefined;
  const data = current?.data || null;
  const loading = !current || current.loading;
  const report = useProductivityReport(data);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ key: requestKey, loading: true, data: null, error: '' });
    setExportError('');
    const [requestParams] = JSON.parse(requestKey) as [Params];
    void getMyProductivityEarningsReport(requestParams, controller.signal).then(response => {
      if (active) setState({ key: requestKey, loading: false, data: response, error: '' });
    }).catch(error => {
      if (active) setState({ key: requestKey, loading: false, data: null, error: error?.message || 'Failed to load your productivity report.' });
    });
    return () => { active = false; controller.abort(); };
  }, [requestKey]);

  useEffect(() => {
    const refresh = () => setRefreshToken(value => value + 1);
    window.addEventListener('task-report-updated', refresh);
    return () => window.removeEventListener('task-report-updated', refresh);
  }, []);

  const download = async (kind: 'excel' | 'pdf') => {
    if (!data || loading || exporting) return;
    setExporting(true); setExportError('');
    try {
      await exportProductivityReport(kind, {
        data, rows: report.sortedProductivityRows, view: report.productivityView,
        periodLabel: data.range.from === '0001-01-01' ? 'All time' : 'Selected period',
        issue: report.productivityIssue, search: report.productivitySearch,
        sortKey: report.productivitySortKey, sortDir: report.productivitySortDir,
      });
    } catch (error: any) {
      setExportError(error?.message || 'Failed to export your productivity report.');
    } finally { setExporting(false); }
  };

  return <div className="firm-reports" aria-label="My productivity report" aria-busy={loading}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-gray-500">{loading ? 'Loading your productivity report…' : data ? data.range.from === '0001-01-01' ? 'All time' : `${data.range.from} to ${data.range.to}` : 'Your productivity report'}</p>
      <div className="fr-header-actions">
        <button type="button" className="fr-refresh" aria-label="Refresh productivity report" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={15} />Refresh</button>
        <button type="button" className="fr-export" disabled={!data || loading || exporting} onClick={() => void download('excel')}><FileSpreadsheet size={15} />Excel</button>
        <button type="button" className="fr-export" disabled={!data || loading || exporting} onClick={() => void download('pdf')}><FileText size={15} />PDF</button>
      </div>
    </div>
    {(current?.error || exportError) && <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-4 text-red-700">{current?.error || exportError}</div>}
    {loading ? <p role="status" className="py-8 text-center text-gray-500">Loading report…</p> : data ? <ProductivityReportContent data={data} report={report} /> : null}
  </div>;
}
