import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ChevronDown, ChevronRight, Info, Loader2 } from 'lucide-react';

import {
  getStaffEarnings,
  StaffEarningsCollectionScope,
  StaffEarningsResponse,
  StaffEarningsRow,
  StaffEarningsRange,
} from '../../services/staffEarningsService';
import { SortDir, sortRows, toggleSortKey } from '../../utils/tableSort';
import SortableHeader from '../ui/SortableHeader';
import TableExport from '../ui/TableExport';

const PAGE_SIZE = 12;

const money = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '_' : `RWF ${Math.round(value).toLocaleString('en-US')}`;
const pct = (value: number | null | undefined) => (value == null ? '_' : `${value}%`);

const STATUS_STYLES: Record<StaffEarningsRow['status'], { label: string; className: string }> = {
  ready: { label: 'Eligible', className: 'border-green-200 bg-green-50 text-green-700' },
  'awaiting-collection': { label: 'Awaiting collection', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  'awaiting-input': { label: 'Awaiting input', className: 'border-orange-200 bg-orange-50 text-orange-800' },
  incomplete: { label: 'Not attributable', className: 'border-gray-200 bg-gray-50 text-gray-600' },
};

/** Sort keys map to a value extractor so nulls always sink instead of throwing. */
const SORT_VALUES: Record<string, (row: StaffEarningsRow) => unknown> = {
  staff: (row) => row.staffName,
  role: (row) => row.systemRole || row.assignmentRole,
  matter: (row) => row.matterNo || row.matterName,
  keyAction: (row) => row.keyActionTitle,
  stage: (row) => row.stageTitle,
  completedAt: (row) => row.completionAt,
  contractValue: (row) => row.contractValue,
  actionPercent: (row) => row.keyActionPercent,
  grossActionValue: (row) => row.grossActionValue,
  collected: (row) => row.collectedAmount,
  eligibleBase: (row) => row.eligibleCollectedBase,
  tpa: (row) => row.tpaPercent,
  timeliness: (row) => row.timelinessScore,
  quality: (row) => row.qualityScore,
  earnedFee: (row) => row.earnedFee,
};

function KpiCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warn' | 'muted';
}) {
  const toneClass = tone === 'warn' ? 'text-amber-700' : tone === 'muted' ? 'text-gray-500' : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

/** The full, step-by-step explanation of one row's calculation. */
function CalculationDetail({ row }: { row: StaffEarningsRow }) {
  const payments = row.paymentTimestamps || [];
  return (
    <div className="space-y-3 bg-gray-50 px-5 py-4 text-sm text-gray-700">
      <div>
        <h4 className="font-semibold text-gray-900">Calculation</h4>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Gross action value = contract value x action percentage ={' '}
            <span className="font-medium tabular-nums">
              {money(row.contractValue)} x {pct(row.keyActionPercent)} = {money(row.grossActionValue)}
            </span>
          </li>
          <li>
            Eligible collected base = the matter&apos;s confirmed paid collections, capped at the completed work
            value and allocated across completed Key Actions in proportion to value ={' '}
            <span className="font-medium tabular-nums">{money(row.eligibleCollectedBase)}</span>
            <span className="block text-xs text-gray-500">
              Allocation rule: paid collections x (action value / completed value). Collections are distributed
              once across the completed actions, so no collected amount is ever counted twice.
            </span>
          </li>
          <li>
            Staff earned fee = eligible base x TPA x timeliness x quality ={' '}
            <span className="font-medium tabular-nums">{row.formula}</span>
            <span className="block text-xs text-gray-500">
              TPA {pct(row.tpaPercent)} comes from the staff system role
              {row.systemRole ? ` (${row.systemRole})` : ''}; quality is the matter Quality Score from Case
              Management; timeliness is the average score of the completed Key Actions.
            </span>
          </li>
        </ol>
      </div>

      <div>
        <h4 className="font-semibold text-gray-900">Source timestamps</h4>
        <dl className="mt-2 grid gap-1 sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="font-medium text-gray-600">Work completed:</dt>
            <dd className="tabular-nums">
              {row.completionAtLocal || 'â€”'}
              {row.timeZone ? ` (${row.timeZone})` : ''}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium text-gray-600">Determined by:</dt>
            <dd>{row.completionSourceLabel || 'No timestamp recorded'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium text-gray-600">UTC instant:</dt>
            <dd className="tabular-nums">{row.completionAt || 'â€”'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium text-gray-600">Ledger snapshot:</dt>
            <dd className="break-all text-xs">
              {row.ledgerEntryKey ? `${row.ledgerEntryKey} (rev ${row.ledgerRevision ?? 1})` : 'Not yet recorded'}
            </dd>
          </div>
        </dl>
      </div>

      <div>
        <h4 className="font-semibold text-gray-900">Collections funding this matter</h4>
        {payments.length === 0 ? (
          <p className="mt-1 text-xs text-gray-600">No confirmed paid invoices in the selected collection scope.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs">
            {payments.map((payment) => (
              <li key={`${payment.invoiceNo}-${payment.paidAt}`} className="tabular-nums">
                {payment.invoiceNo || 'Invoice'} â€” {money(payment.amount)} received{' '}
                {payment.paidAt ? new Date(payment.paidAt).toISOString().slice(0, 10) : 'on an unknown date'}
              </li>
            ))}
          </ul>
        )}
      </div>

      {row.missingInputs.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-900">Missing inputs</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-800">
            {row.missingInputs.map((input) => (
              <li key={input}>{input}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Staff Earnings report â€” period-based, attributed to the period in which each
 * Key Action was COMPLETED.
 *
 * The work period and the collection scope are deliberately separate controls:
 * the work period decides which rows appear, the collection scope decides which
 * paid invoices may cap the eligible base. They are never conflated.
 */
export default function StaffEarningsReport({ userRole }: { userRole: string }) {
  const permitted = ['managing_director', 'managing_partner', 'executive_managing_partner'].includes(userRole);

  const [range, setRange] = useState<StaffEarningsRange>('monthly');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [staffKey, setStaffKey] = useState('');
  const [role, setRole] = useState('');
  const [collectionScope, setCollectionScope] = useState<StaffEarningsCollectionScope>('all');

  const [report, setReport] = useState<StaffEarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState('completedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!permitted) return;
    if (range === 'custom' && (!customFrom || !customTo)) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    getStaffEarnings({
      range,
      from: range === 'custom' ? customFrom : undefined,
      to: range === 'custom' ? customTo : undefined,
      staffKey: staffKey || undefined,
      role: role || undefined,
      collectionScope,
    })
      .then((data) => {
        if (!active) return;
        setReport(data);
        setPage(1);
      })
      .catch((reason: any) => {
        if (active) setError(reason?.message || 'Unable to load the staff earnings report.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [permitted, range, customFrom, customTo, staffKey, role, collectionScope]);

  const rows = useMemo(() => report?.rows || [], [report]);
  const sortedRows = useMemo(
    () => sortRows(rows, sortKey, sortDir, (row) => SORT_VALUES[sortKey]?.(row)),
    [rows, sortKey, sortDir]
  );
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const visibleRows = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const expandedRow = useMemo(() => sortedRows.find((row) => row.key === expanded) || null, [sortedRows, expanded]);

  useEffect(() => setPage((current) => Math.min(current, totalPages)), [totalPages]);

  const onSort = (column: string) => {
    const next = toggleSortKey(sortKey, sortDir, column);
    setSortKey(next.key);
    setSortDir(next.dir);
  };

  if (!permitted) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h1 className="text-xl font-semibold text-gray-900">Access denied</h1>
        <p className="mt-2 text-gray-600">You do not have permission to view Staff Earnings.</p>
      </div>
    );
  }

  if (loading && !report) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span role="status">Loading staff earningsâ€¦</span>
      </div>
    );
  }

  /** One sortable row per earning event, expandable to show its full maths. */
  const renderRows = () =>
    visibleRows.map((row) => {
      const isOpen = expanded === row.key;
      const status = STATUS_STYLES[row.status];
      return (
        <tr key={row.key} className="border-t border-gray-100 align-top hover:bg-gray-50">
          <td className="px-2 py-2.5">
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : row.key)}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Hide' : 'Show'} calculation for ${row.keyActionTitle}`}
              className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-800"
            >
              {isOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
            </button>
          </td>
          <td className="px-4 py-2.5">
            <div className="font-medium text-gray-900">{row.staffName}</div>
            <div className="text-xs text-gray-500">{row.assignmentRole}</div>
          </td>
          <td className="px-4 py-2.5 text-gray-600">{row.systemRole || '_'}</td>
          <td className="px-4 py-2.5">
            <Link
              to={`/cases/${row.caseId}`}
              className="font-medium text-indigo-700 hover:underline"
              title={row.matterName || undefined}
            >
              {row.matterNo || row.matterName || 'Matter'}
            </Link>
          </td>
          <td className="px-4 py-2.5 text-gray-800">{row.keyActionTitle}</td>
          <td className="px-4 py-2.5 text-gray-600">{row.stageTitle || '_'}</td>
          <td className="px-4 py-2.5">
            <div className="whitespace-nowrap tabular-nums text-gray-800">{row.completionAtLocal || '_'}</div>
            <div className="text-xs text-gray-500">{row.completionSourceLabel || 'No timestamp'}</div>
          </td>
          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-gray-700">{money(row.contractValue)}</td>
          <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{pct(row.keyActionPercent)}</td>
          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-gray-700">{money(row.grossActionValue)}</td>
          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-gray-700">{money(row.collectedAmount)}</td>
          <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums text-gray-900">
            {money(row.eligibleCollectedBase)}
          </td>
          <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{pct(row.tpaPercent)}</td>
          <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{pct(row.timelinessScore)}</td>
          <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{pct(row.qualityScore)}</td>
          <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900">
            {money(row.earnedFee)}
          </td>
          <td className="px-4 py-2.5">
            <span
              className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${status.className}`}
            >
              {status.label}
            </span>
            {row.statusNote && <div className="mt-1 max-w-xs text-xs text-gray-500">{row.statusNote}</div>}
          </td>
        </tr>
      );
    });

  return (
    <div>
      {/* ---------- Header + explicit period statement ---------- */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to="/billing/finance/remuneration"
            className="mb-2 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            Firm Remuneration
          </Link>
          <h2 className="text-xl font-semibold text-gray-900">Staff Earnings by Completion Period</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Each Key Action is attributed to the period in which the work was completed, using the completion
            timestamp stored by the backend â€” not the invoice date and not the payment date.
          </p>
          {report && (
            <p className="mt-2 text-sm font-medium text-gray-800">
              Selected period: {report.period.from} â†’ {report.period.to}
            </p>
          )}
        </div>
        {loading && (
          <span className="inline-flex items-center gap-2 text-xs text-indigo-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Updatingâ€¦
          </span>
        )}
      </div>

      {/* ---------- Filters ---------- */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <label className="flex flex-col text-sm text-gray-700">
          Work period
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as StaffEarningsRange)}
            className="mt-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900"
          >
            <option value="daily">Last Day</option>
            <option value="weekly">Last Week</option>
            <option value="monthly">Last Month</option>
            <option value="quarterly">Last Quarter</option>
            <option value="yearly">Last Year</option>
            <option value="ytd">Year to Date</option>
            <option value="custom">Custom Range</option>
          </select>
        </label>
        {range === 'custom' && (
          <>
            <label className="flex flex-col text-sm text-gray-700">
              From
              <input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="mt-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900"
              />
            </label>
            <label className="flex flex-col text-sm text-gray-700">
              To
              <input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                className="mt-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900"
              />
            </label>
          </>
        )}
        <label className="flex flex-col text-sm text-gray-700">
          Staff member
          <select
            value={staffKey}
            onChange={(event) => setStaffKey(event.target.value)}
            className="mt-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900"
          >
            <option value="">All staff</option>
            {(report?.staffOptions || []).map((option) => (
              <option key={option.key} value={option.key}>
                {option.name}
                {option.role ? ` â€” ${option.role}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm text-gray-700">
          System role
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="mt-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900"
          >
            <option value="">All roles</option>
            {(report?.roles || []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm text-gray-700">
          Collections included
          <select
            value={collectionScope}
            onChange={(event) => setCollectionScope(event.target.value as StaffEarningsCollectionScope)}
            className="mt-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900"
          >
            <option value="all">All confirmed paid collections</option>
            <option value="period">Payments received in the work period</option>
          </select>
        </label>
      </div>

      {/* Make the two period meanings impossible to confuse. */}
      {report && (
        <div className="mb-4 flex items-start gap-2 rounded border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Work period is not the collection period.</p>
            <p>
              Rows are filtered by {report.period.basisLabel} Collections currently capping the eligible base:{' '}
              {report.collection.label}. {report.collection.note}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle size={17} aria-hidden="true" />
          {error}
        </div>
      )}

      {/* ---------- Totals: work value, eligible base and fee stay distinct ---- */}
      {report && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Staff earned fee"
            value={money(report.totals.earnedFee)}
            hint="Eligible collected base x TPA x timeliness x quality"
          />
          <KpiCard
            label="Gross action value"
            value={money(report.totals.grossActionValue)}
            hint="Contract value x completed action %"
          />
          <KpiCard
            label="Eligible collected base"
            value={money(report.totals.eligibleCollectedBase)}
            hint="Paid collections, capped at completed work value"
          />
          <KpiCard
            label="Rows not yet eligible"
            value={String(report.counts.rowsAwaitingCollection + report.counts.rowsAwaitingInput)}
            tone={report.counts.rowsAwaitingCollection + report.counts.rowsAwaitingInput > 0 ? 'warn' : 'default'}
            hint="Awaiting collection or a missing score"
          />
        </div>
      )}

      {/* ---------- Per-staff summary ---------- */}
      {report && report.summary.length > 0 && (
        <div className="mb-5 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-3">
            <h3 className="font-semibold text-gray-900">Staff summary</h3>
            <p className="text-xs text-gray-500">
              Work value, eligible collected base and earned fee are reported as three separate amounts.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5">Staff member</th>
                  <th className="px-4 py-2.5">System role</th>
                  <th className="px-4 py-2.5 text-right">Matters</th>
                  <th className="px-4 py-2.5 text-right">Key Actions</th>
                  <th className="px-4 py-2.5 text-right">Gross action value</th>
                  <th className="px-4 py-2.5 text-right">Eligible base</th>
                  <th className="px-4 py-2.5 text-right">Staff earned fee</th>
                  <th className="px-4 py-2.5 text-right">Awaiting</th>
                </tr>
              </thead>
              <tbody>
                {report.summary.map((entry) => (
                  <tr key={entry.staffKey} className="border-t border-gray-100">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{entry.staffName}</td>
                    <td className="px-4 py-2.5 text-gray-600">{entry.systemRole || '_'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{entry.mattersCount}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{entry.keyActionsCount}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{money(entry.grossActionValue)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{money(entry.eligibleCollectedBase)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                      {money(entry.earnedFee)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                      {entry.rowsAwaitingCollection + entry.rowsAwaitingInput || 'â€”'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- Detailed, sortable table ---------- */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div>
            <h3 className="font-semibold text-gray-900">Earnings detail</h3>
            <p className="text-xs text-gray-500">Select a row to expand its calculation and source timestamps.</p>
          </div>
          <TableExport
            filename="staff_earnings_by_completion_period"
            title="Staff Earnings by Completion Period"
            subtitle={
              report
                ? `${report.period.from} â†’ ${report.period.to} Â· ${sortedRows.length} rows Â· attributed by Key Action completion`
                : ''
            }
            columns={[
              { label: 'Staff', value: (row: StaffEarningsRow) => row.staffName },
              { label: 'System role', value: (row: StaffEarningsRow) => row.systemRole || '' },
              { label: 'Matter', value: (row: StaffEarningsRow) => `${row.matterNo} ${row.matterName}`.trim() },
              { label: 'Key Action', value: (row: StaffEarningsRow) => row.keyActionTitle },
              { label: 'Stage', value: (row: StaffEarningsRow) => row.stageTitle || '' },
              { label: 'Completed at', value: (row: StaffEarningsRow) => row.completionAtLocal || '' },
              { label: 'Completed at (UTC)', value: (row: StaffEarningsRow) => row.completionAt || '' },
              { label: 'Timestamp source', value: (row: StaffEarningsRow) => row.completionSourceLabel || '' },
              { label: 'Contract value', value: (row: StaffEarningsRow) => row.contractValue, type: 'money' },
              { label: 'Action %', value: (row: StaffEarningsRow) => row.keyActionPercent ?? '', type: 'percent' },
              { label: 'Gross action value', value: (row: StaffEarningsRow) => row.grossActionValue, type: 'money' },
              { label: 'Collected', value: (row: StaffEarningsRow) => row.collectedAmount, type: 'money' },
              { label: 'Eligible collected base', value: (row: StaffEarningsRow) => row.eligibleCollectedBase, type: 'money' },
              { label: 'Uncollected work value', value: (row: StaffEarningsRow) => row.uncollectedActionValue, type: 'money' },
              { label: 'TPA %', value: (row: StaffEarningsRow) => row.tpaPercent, type: 'percent' },
              { label: 'Timeliness', value: (row: StaffEarningsRow) => row.timelinessScore ?? '', type: 'percent' },
              { label: 'Quality', value: (row: StaffEarningsRow) => row.qualityScore ?? '', type: 'percent' },
              { label: 'Staff earned fee', value: (row: StaffEarningsRow) => row.earnedFee ?? '', type: 'money' },
              { label: 'Calculation', value: (row: StaffEarningsRow) => row.formula },
              { label: 'Status', value: (row: StaffEarningsRow) => STATUS_STYLES[row.status].label },
              { label: 'Explanation', value: (row: StaffEarningsRow) => row.statusNote || '' },
            ]}
            rows={sortedRows}
          />
        </div>

        {sortedRows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            No Key Actions were completed inside the selected period. Try a wider period or a different staff
            filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1600px] text-left text-sm">
              <thead className="bg-white text-xs uppercase tracking-wide text-gray-500">
                <tr className="border-b border-gray-200">
                  <th className="w-8 px-2 py-2.5" />
                  <SortableHeader label="Staff" column="staff" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortableHeader label="System role" column="role" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortableHeader label="Matter" column="matter" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortableHeader label="Key Action" column="keyAction" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortableHeader label="Stage" column="stage" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortableHeader label="Completed" column="completedAt" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortableHeader label="Contract" column="contractValue" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                  <SortableHeader label="Action %" column="actionPercent" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                  <SortableHeader label="Gross value" column="grossActionValue" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                  <SortableHeader label="Collected" column="collected" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                  <SortableHeader label="Eligible base" column="eligibleBase" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                  <SortableHeader label="TPA" column="tpa" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                  <SortableHeader label="Timeliness" column="timeliness" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                  <SortableHeader label="Quality" column="quality" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                  <SortableHeader label="Earned fee" column="earnedFee" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {renderRows()}
                {/* Drill-down sits directly beneath the row it explains. */}
                {expandedRow && (
                  <tr className="border-t border-gray-100">
                    <td colSpan={17} className="p-0">
                      <CalculationDetail row={expandedRow} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {sortedRows.length > PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-3 text-sm text-gray-600">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}â€“{Math.min(page * PAGE_SIZE, sortedRows.length)} of{' '}
              {sortedRows.length}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
                className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page === totalPages}
                onClick={() => setPage(page + 1)}
                className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40"
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
