import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Briefcase, ArrowUpDown } from 'lucide-react';
import { UserRole } from '../../App';
import { getAllCases, deleteCase, CaseData } from '../../services/caseService';
import usePageTitle from '../../hooks/usePageTitle';
import {
  formatDueCountdown,
  getDeadlinePillClass,
  getUrgencyColorForDueDate,
} from '../../utils/workflowDeadline';
import { getCasePracticePath } from '../../utils/caseLabels';

interface CaseListProps {
  userRole: UserRole;
}

const isAssociateLike = (role: UserRole) =>
  role === 'associate' || role === 'trainee_associate' || role === 'senior_associate' || role === 'intern';

type SortKey = 'nextDeadline' | 'createdAt' | 'caseNo' | 'parties' | 'workflow' | 'currentStep';
type SortDir = 'asc' | 'desc';

export default function CaseList({ userRole }: CaseListProps) {
  const CASES_PER_PAGE = 10;

  usePageTitle('Active Matters');

  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('nextDeadline');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [cases, setCases] = useState<CaseData[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const assocLike = isAssociateLike(userRole);
  const canManageCases = userRole === 'managing_director' || userRole === 'executive_assistant';

  const deferredSearchTerm = useDeferredValue(searchTerm);

  useEffect(() => {
    loadCases();
    // eslint-disable-next-line
  }, []);

  const loadCases = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAllCases();
      // Treat a case as closed if its explicit status is 'Closed' or its workflowProgress.status is 'Completed'.
      const active = (data || []).filter((c) => {
        const isClosedStatus = String(c.status || '').toLowerCase() === 'closed';
        const isWorkflowCompleted = (c.workflowProgress && c.workflowProgress.status) === 'Completed';
        return !(isClosedStatus || isWorkflowCompleted);
      });
      setCases(active);
    } catch (err: any) {
      setError(err.message || 'Failed to load cases');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCase = async (caseId?: string) => {
    if (!caseId || !canManageCases) return;
    if (!window.confirm('Are you sure you want to delete this case?')) return;

    try {
      setError('');
      await deleteCase(caseId);
      setCases((prev) => prev.filter((c) => c._id !== caseId));
    } catch (err: any) {
      setError(err.message || 'Failed to delete case');
    }
  };

  const getDeadlinePillClassForCase = (c: CaseData) => {
    const due = c.workflowProgress?.currentStepDueAt;
    const start = c.workflowProgress?.currentStepStartAt || c.workflowStartDate || c.createdAt;
    return getDeadlinePillClass(due, start);
  };

  const collator = useMemo(() => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }), []);

  const indexedCases = useMemo(() => {
    const toMs = (value: string | undefined) => {
      if (!value) return 0;
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : 0;
    };

    const urgencyRank = (c: CaseData) => {
      const start = c.workflowProgress?.currentStepStartAt || c.workflowStartDate || c.createdAt;
      const due = c.workflowProgress?.currentStepDueAt;
      const color = getUrgencyColorForDueDate(due, start);
      if (color === 'red') return 0;
      if (color === 'yellow') return 1;
      if (color === 'green') return 2;
      if (color === 'blue') return 3;
      return 4;
    };

    const nextDueAtMs = (c: CaseData) => {
      // Use only the current active step due date for sorting (business rule)
      const raw = c.workflowProgress?.currentStepDueAt;
      if (!raw) return Number.MAX_SAFE_INTEGER;
      const ms = Date.parse(String(raw));
      return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
    };

    return cases.map((c, originalIndex) => ({
      c,
      originalIndex,
      searchable: `${c.caseNo ?? ''} ${c.parties ?? ''}`.toLowerCase(),
      createdAtMs: toMs(c.createdAt),
      workflowLabel: getCasePracticePath(c).toLowerCase(),
      currentStepLabel: String(c.workflowProgress?.currentStepTitle || '').toLowerCase(),
      deadlineRank: urgencyRank(c),
      nextDueAtMs: nextDueAtMs(c),
    }));
  }, [cases]);

  const filteredSortedCases = useMemo(() => {
    const q = deferredSearchTerm.trim().toLowerCase();

    let list = indexedCases;
    if (q) {
      list = list.filter((x) => x.searchable.includes(q));
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    const sorted = list.slice().sort((a, b) => {
      let cmp = 0;

      switch (sortKey) {
        case 'createdAt':
          cmp = a.createdAtMs - b.createdAtMs;
          break;
        case 'nextDeadline': {
          // Red first (most urgent), then earlier due dates
          cmp = a.deadlineRank - b.deadlineRank;
          if (cmp === 0) cmp = a.nextDueAtMs - b.nextDueAtMs;
          break;
        }
        case 'caseNo':
          cmp = collator.compare(a.c.caseNo ?? '', b.c.caseNo ?? '');
          break;
        case 'parties':
          cmp = collator.compare(a.c.parties ?? '', b.c.parties ?? '');
          break;
        case 'workflow':
          cmp = collator.compare(a.workflowLabel, b.workflowLabel);
          break;
        case 'currentStep':
          cmp = collator.compare(a.currentStepLabel, b.currentStepLabel);
          break;
        default:
          cmp = 0;
      }

      if (cmp !== 0) return cmp * dir;
      return a.originalIndex - b.originalIndex;
    });

    return sorted.map((x) => x.c);
  }, [collator, deferredSearchTerm, indexedCases, sortDir, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filteredSortedCases.length / CASES_PER_PAGE));
  const paginatedCases = filteredSortedCases.slice(
    (currentPage - 1) * CASES_PER_PAGE,
    currentPage * CASES_PER_PAGE
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortKey, sortDir]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">
              {assocLike ? 'My Matters' : 'Practice Management'}
            </h1>
            <p className="text-gray-600">
              {assocLike ? 'Matters assigned to you' : 'Track firm-wide matters, assignments, and progress'}
            </p>
          </div>

          {canManageCases && (
            <Link
              to="/cases/new"
              className="inline-flex items-center px-4 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Case
            </Link>
          )}
        </div>

        {/* Search + Filter */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by case number or parties..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-gray-400 focus:outline-none"
            />
          </div>

          <div className="flex gap-2">
            <select
              value={sortKey}
              onChange={(e) => {
                const nextKey = e.target.value as SortKey;
                setSortKey(nextKey);
                if (nextKey === 'nextDeadline') setSortDir('asc');
              }}
              className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-gray-400 focus:outline-none"
            >
              <option value="nextDeadline">Sort: Next Deadline (Urgent)</option>
              <option value="createdAt">Sort: Date Created</option>
              <option value="workflow">Sort: Workflow</option>
              <option value="currentStep">Sort: Current Step</option>
              <option value="caseNo">Sort: Case No.</option>
              <option value="parties">Sort: Parties</option>
            </select>

            <button
              type="button"
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition"
              title={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
            >
              <ArrowUpDown className="w-4 h-4 mr-2" />
              {sortDir === 'asc' ? 'Asc' : 'Desc'}
            </button>
          </div>

        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                {[
                  'No.',
                  'Case No.',
                  'Parties',
                  'Workflow',
                  'Current Step',
                  'Assigned To',
                  'Date Created',
                  'Billing Value',
                  'Fees Cleared',
                  'Next Deadline',
                  'Actions',
                ].map((header) => (
                  <th
                    key={header}
                    className="px-6 py-4 text-left text-xs font-medium text-gray-600 uppercase tracking-wider"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {paginatedCases.map((item, index) => {
                const pillClass = getDeadlinePillClassForCase(item);
                const pillColor = getUrgencyColorForDueDate(
                  item.workflowProgress?.currentStepDueAt,
                  item.workflowProgress?.currentStepStartAt || item.workflowStartDate || item.createdAt
                );

                return (
                <tr key={item._id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-5 text-sm text-gray-500">
                    {(currentPage - 1) * CASES_PER_PAGE + index + 1}
                  </td>
                  <td className="px-6 py-5 text-sm font-medium text-gray-900">{item.caseNo}</td>
                  <td className="px-6 py-5 text-sm text-gray-900">{item.parties}</td>
                  <td className="px-6 py-5 text-sm text-gray-700">{item.workflow || item.matterType || '—'}</td>

                  <td className="px-6 py-5 text-sm text-gray-700">
                    {item.workflowProgress?.status === 'Completed'
                      ? 'Completed'
                      : item.workflowProgress?.currentStepTitle || '—'}
                  </td>

                  <td className="px-6 py-5 text-sm text-gray-600">{item.assignedTo}</td>

                  <td className="px-6 py-5 text-sm text-gray-500">
                    {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—'}
                  </td>

                  <td className="px-6 py-5 text-sm text-gray-500">
                    {typeof item.workflowProgress?.plannedValue?.amount === 'number'
                      ? `${item.workflowProgress.plannedValue.currency || 'RWF'} ${item.workflowProgress.plannedValue.amount.toLocaleString()}`
                      : '—'}
                  </td>

                  <td className="px-6 py-5 text-sm text-gray-500">
                    {typeof item.workflowProgress?.completedValue?.amount === 'number'
                      ? `${item.workflowProgress.completedValue.currency || 'RWF'} ${item.workflowProgress.completedValue.amount.toLocaleString()}`
                      : '—'}
                  </td>

                  <td className="px-6 py-5 text-sm text-gray-500">
                    {item.workflowProgress?.currentStepDueAt ? new Date(item.workflowProgress.currentStepDueAt).toLocaleDateString() : '—'}
                    {item.workflowProgress?.currentStepDueAt ? (
                      <div
                        className={`mt-1 inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${pillClass}`}
                        data-urgency-color={pillColor}
                      >
                        {formatDueCountdown(item.workflowProgress?.currentStepDueAt)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-6 py-5">
                    <Link to={`/cases/${item._id}`} className="text-sm font-medium text-gray-700 hover:text-gray-900">
                      Open →
                    </Link>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>

        {loading && <div className="text-center py-12 text-gray-500">Loading cases...</div>}

        {!loading && filteredSortedCases.length === 0 && (
          <div className="text-center py-12">
            <Briefcase className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No cases found</p>
          </div>
        )}

        {!loading && filteredSortedCases.length > 0 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
            <p className="text-sm text-gray-600">
              Showing {(currentPage - 1) * CASES_PER_PAGE + 1}-
              {Math.min(currentPage * CASES_PER_PAGE, filteredSortedCases.length)} of {filteredSortedCases.length} cases
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
