import { Link } from 'react-router-dom';
import { FirmReportResponse } from '../../services/firmReportsService';
import SortableHeader from '../ui/SortableHeader';
import { SortDir } from '../../utils/tableSort';

type Row = NonNullable<FirmReportResponse['productivityRows']>[number];
type Props = {
  rows: Row[]; filteredRows: Row[]; total: number; data: FirmReportResponse | null; startIndex: number;
  view: 'earnings' | 'completedWork'; setView: (view: 'earnings' | 'completedWork') => void;
  search: string; setSearch: (search: string) => void; issue: string; setIssue: (issue: string) => void;
  sortKey: string; sortDir: SortDir; onSort: (key: string) => void;
};
const money = (value: number) => `RWF ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value?: number | null) => value == null ? '—' : `${Math.round(value * 10) / 10}%`;

export default function ProductivityRecords(props: Props) {
  const { rows, filteredRows, total, data, view, setView, search, setSearch, issue, setIssue, sortKey, sortDir, onSort, startIndex } = props;
  const scored = filteredRows.filter(row => row.feeEarned != null);
  const totalFee = scored.length ? money(scored.reduce((sum, row) => sum + (row.feeEarned || 0), 0)) : filteredRows.length ? 'Pending' : money(0);
  const column = (label: string, key: string, align: 'left' | 'center' | 'right' = 'left') => <SortableHeader label={label} column={key} sortKey={sortKey} sortDir={sortDir} onSort={onSort} align={align === 'right' ? 'right' : 'left'} className={`px-4 py-3${align === 'center' ? ' text-center' : ''}`} />;
  const date = (value: string | null) => value ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: data?.productivityReconciliation?.timeZone || 'Africa/Kigali' }) : '—';
  return <>
    <div className="fr-records-heading">
      <div><h2>{view === 'earnings' ? 'Earnings detail' : 'Completed work'}</h2><p>{view === 'earnings' ? 'Payment date' : 'Completion date'}</p></div>
      <div className="fr-view-switch" role="group" aria-label="Productivity detail view">
        <button aria-pressed={view === 'earnings'} onClick={() => setView('earnings')}>Earnings</button>
        <button aria-pressed={view === 'completedWork'} onClick={() => setView('completedWork')}>Completed work</button>
      </div>
    </div>
    {view === 'completedWork' && <div className="fr-valuation" aria-label="Completed-work valuation">
      <span>Work valuation</span><strong>{data?.productivitySummary?.completedWorkFeeValue == null ? 'Pending' : money(data.productivitySummary.completedWorkFeeValue)}</strong>
      <span>Collected base</span><strong>{money(data?.productivitySummary?.completedWorkCollectedBase ?? 0)}</strong>
      <span>Fees pending</span><strong>{data?.productivitySummary?.completedWorkPendingFeeRecords ?? 0}</strong><span>Current collections</span>
    </div>}
    <div className="fr-records-tools">
      <input aria-label="Search productivity records" placeholder="Search matters, actions or staff" value={search} onChange={event => setSearch(event.target.value)} />
      <select aria-label="Filter productivity issues" value={issue} onChange={event => setIssue(event.target.value)}>
        <option value="all">All records</option><option value="zero">Zero allocation</option><option value="quality">Quality pending</option><option value="timeliness">Timeliness pending</option><option value="reference">Missing matter details</option><option value="pending">Fee pending</option>
      </select>
      <span className="fr-record-count" role="status">{filteredRows.length} of {total} records</span>
      {data && view === 'earnings' && <strong className="text-sm" aria-label="Earnings detail total">{totalFee}</strong>}
    </div>
    {!data || !rows.length ? <div className="px-5 py-8 text-gray-500">{!data ? 'No data.' : 'No matching records.'}</div> : <div className="fr-table-scroll">
      <table className="fr-record-table">
        <thead><tr><th scope="col">#</th>{column('Date / Time', 'datetime')}{column('Staff', 'staff')}{column('Matter', 'matter')}{column('Key Action', 'task')}{column('Collected Key Action Base', 'taskFeeCollected', 'right')}{column('TPA', 'tpa', 'center')}{column('Timeliness Score', 'timeliness', 'center')}{column('Quality Score', 'quality', 'center')}<th scope="col">Formula</th>{column('Fee Earned', 'feeEarned', 'right')}<th scope="col">Allocation / Review Status</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.id}>
          <td className="fr-secondary">{startIndex + index + 1}</td>
          <td>{date(row.completedAt)}</td>
          <td>{row.staff}<div className="fr-secondary">{row.assignmentRole}</div></td>
          <td>{row.caseId ? <Link to={`/cases/${row.caseId}?tab=case-management&step=${encodeURIComponent(row.keyActionKey || '')}`}>{row.matter}</Link> : row.matter}{row.matterParties && row.matterParties !== row.matter && <div className="fr-secondary">{row.matterParties}</div>}</td>
          <td>{row.task}<div className="fr-secondary">{row.workflowStage} · {percent(row.keyActionPercent ?? row.taskProgressPercent)}</div></td>
          <td className="fr-number">{money(row.taskFeeCollected ?? row.taskFee)}<div className="fr-secondary">Matter paid: {money(row.collectedAmount ?? 0)}</div></td>
          <td className="fr-score">{percent(row.tpaPercent)}</td>
          <td className="fr-score">{percent(row.timelinessScore)}<div className="fr-secondary">{row.timelinessStatus}</div></td>
          <td className="fr-score">{row.qualityScore == null ? <span className="fr-pending">Pending</span> : percent(row.qualityScore)}<div className="fr-secondary">{row.qualitySource}</div></td>
          <td className="fr-formula">{row.formula}</td>
          <td className="fr-number"><strong>{row.feeEarned == null ? <span className="fr-pending">Pending</span> : money(row.feeEarned)}</strong></td>
          <td className="fr-status">{row.issues?.length ? row.issues.join(' · ') : row.allocationStatus}{row.caseId && <div className="fr-secondary"><Link to={`/cases/${row.caseId}?tab=billing`}>Billing</Link></div>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </>;
}
