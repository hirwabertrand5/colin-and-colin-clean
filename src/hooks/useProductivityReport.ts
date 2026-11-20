import { useEffect, useMemo, useState } from 'react';
import type { MyProductivityEarningsResponse } from '../services/firmReportsService';
import { sortRows, type SortDir } from '../utils/tableSort';

export const PRODUCTIVITY_PAGE_SIZE = 10;

/** The firm and personal reports share filtering, ordering and pagination. */
export default function useProductivityReport(data: MyProductivityEarningsResponse | null) {
  const [productivitySortKey, setProductivitySortKey] = useState('');
  const [productivitySortDir, setProductivitySortDir] = useState<SortDir>('asc');
  const [productivityPage, setProductivityPage] = useState(1);
  const [productivityView, setProductivityView] = useState<'earnings' | 'completedWork'>('earnings');
  const [productivityIssue, setProductivityIssue] = useState('all');
  const [productivitySearch, setProductivitySearch] = useState('');
  const productivityRows = (productivityView === 'earnings' ? data?.productivityEarningsRows : data?.productivityRows) || [];
  const sortedProductivityRows = useMemo(() => {
    const search = productivitySearch.toLowerCase().trim();
    const filtered = productivityRows.filter(row => {
      const matchesIssue = productivityIssue === 'all'
        || (productivityIssue === 'zero' && (row.taskFeeCollected ?? row.taskFee) === 0)
        || (productivityIssue === 'quality' && row.qualityScore == null)
        || (productivityIssue === 'timeliness' && row.timelinessScore == null)
        || (productivityIssue === 'reference' && !row.matterReference)
        || (productivityIssue === 'pending' && row.feeEarned == null);
      return matchesIssue && [row.staff, row.matter, row.task, row.caseId, row.matterParties].join(' ').toLowerCase().includes(search);
    });
    return sortRows(filtered, productivitySortKey, productivitySortDir, row => {
      switch (productivitySortKey) {
        case 'datetime': return row.completedAt || '';
        case 'staff': return row.staff || '';
        case 'matter': return row.matter || '';
        case 'task': return row.task || '';
        case 'taskFeeCollected': return row.taskFeeCollected ?? row.taskFee ?? 0;
        case 'tpa': return row.tpaPercent ?? 0;
        case 'timeliness': return row.timelinessScore == null ? -1 : row.timelinessScore;
        case 'quality': return row.qualityScore == null ? -1 : row.qualityScore;
        case 'feeEarned': return row.feeEarned == null ? -1 : row.feeEarned;
        default: return row.completedAt || '';
      }
    });
  }, [productivityRows, productivitySearch, productivityIssue, productivitySortKey, productivitySortDir]);

  useEffect(() => { setProductivityPage(1); }, [data, productivityView, productivityIssue, productivitySearch]);

  const handleProductivitySort = (column: string) => {
    setProductivitySortDir(productivitySortKey === column && productivitySortDir === 'asc' ? 'desc' : 'asc');
    setProductivitySortKey(column);
    setProductivityPage(1);
  };
  const productivityTotalPages = Math.max(1, Math.ceil(sortedProductivityRows.length / PRODUCTIVITY_PAGE_SIZE));
  const safeProductivityPage = Math.min(Math.max(1, productivityPage), productivityTotalPages);
  const pagedProductivityRows = sortedProductivityRows.slice((safeProductivityPage - 1) * PRODUCTIVITY_PAGE_SIZE, safeProductivityPage * PRODUCTIVITY_PAGE_SIZE);

  return {
    productivitySortKey, productivitySortDir, productivityView, setProductivityView,
    productivityIssue, setProductivityIssue, productivitySearch, setProductivitySearch,
    setProductivityPage, handleProductivitySort, productivityRows, sortedProductivityRows,
    productivityTotalPages, safeProductivityPage, pagedProductivityRows,
  };
}
