import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Search, Users } from 'lucide-react';
import type { RetainerCase } from '../../services/retainerService';
import { average, caseTeamRows, departmentNames, money, score, staffSummary } from './retainerWorkspace';

export function RetainerStaffTable({ cases }: { cases: RetainerCase[] }) {
  const staff = useMemo(() => staffSummary(cases), [cases]);
  return <section className="rw-panel" aria-label="Staff earnings">
    <div className="rw-section-heading"><div><span className="rw-eyebrow">People & performance</span><h2>Staff earnings</h2><p>Names, fees and performance across the cases linked to this retainer.</p></div><span className="rw-count"><Users size={14} /> {staff.length} staff</span></div>
    {!staff.length ? <div className="rw-empty">The teams assigned to your linked cases will appear here. Open a case to assign its initiator, reviewer and signer/approver.</div> : <div className="rw-table-scroll" tabIndex={0} aria-label="Scroll staff earnings table"><table>
      <caption className="rw-sr-only">Staff totals across linked retainer cases</caption>
      <thead><tr><th scope="col">Team member</th><th scope="col" className="rw-number">Cases</th><th scope="col" className="rw-number">TPA</th><th scope="col" className="rw-number">Avg. timeliness</th><th scope="col" className="rw-number">Avg. quality</th><th scope="col" className="rw-number">Fees earned</th></tr></thead>
      <tbody>{staff.map((member) => <tr key={member.name}><th scope="row"><strong>{member.name}</strong><small>{[...member.roles].join(' · ')}</small></th><td className="rw-number">{member.cases.size}</td><td className="rw-number">{[...member.rates].sort((a, b) => a - b).map((rate) => score(rate)).join(', ')}</td><td className="rw-number">{score(average(member.timeliness))}</td><td className="rw-number">{score(average(member.quality))}</td><td className="rw-number rw-earned"><strong>{member.known ? money(member.fees) : '_'}</strong>{member.pending > 0 && <small>{member.pending} pending role {member.pending === 1 ? 'row' : 'rows'}</small>}</td></tr>)}</tbody>
      <tfoot><tr><th scope="row" colSpan={5}>Total calculated staff fees</th><td className="rw-number">{money(staff.reduce((sum, member) => sum + member.fees, 0))}</td></tr></tfoot>
    </table></div>}
    <p className="rw-footnote">Performance scores are averaged from available case-role scores. Fees are summed from the case workspace, including recorded handovers and delegated work. “_” means not yet calculated. Open a case’s team below for the individual scores and collected base.</p>
  </section>;
}

export function RetainerCaseTable({ cases, saving, onUnlink, onLink }: { cases: RetainerCase[]; saving: boolean; onUnlink: (matter: RetainerCase) => void; onLink: () => void }) {
  const [query, setQuery] = useState(''), [department, setDepartment] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [collapsedFirst, setCollapsedFirst] = useState(false);
  const visible = cases.filter((matter) => (!department || (matter.department || 'Unassigned') === department) && `${matter.caseNo} ${matter.parties} ${(matter.team || []).map((member) => member.name).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const total = (read: (matter: RetainerCase) => number) => visible.reduce((sum, matter) => sum + read(matter), 0);
  return <section className="rw-panel" aria-label="Linked case performance">
    <div className="rw-section-heading"><div><span className="rw-eyebrow">Cases under this agreement</span><h2>Linked cases <span className="rw-inline-count">{cases.length}</span></h2><p>Case collections, staff fees and net contribution. Expand a case to see its team.</p></div><button className="rw-button" type="button" onClick={onLink}>Link a case</button></div>
    {!!cases.length && <div className="rw-case-filters"><label><Search size={16} /><input aria-label="Search linked cases or staff" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search case, client or staff member" /></label><select aria-label="Filter cases by department" value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">All departments</option>{departmentNames.map((name) => <option key={name}>{name}</option>)}{cases.some((matter) => !matter.department) && <option value="Unassigned">Department not assigned</option>}</select></div>}
    {!visible.length ? <div className="rw-empty">{cases.length ? 'No linked cases match this search.' : 'No linked cases yet. Link an existing case to see department and staff performance.'}</div> : <div className="rw-table-scroll" tabIndex={0} aria-label="Scroll linked case performance"><table className="rw-cases-table">
      <caption className="rw-sr-only">Financial performance of linked cases</caption>
      <thead><tr><th scope="col">Case / department</th><th scope="col">Status</th><th scope="col" className="rw-number">Billed</th><th scope="col" className="rw-number">Collected</th><th scope="col" className="rw-number">Staff fees</th><th scope="col" className="rw-number">Net contribution</th><th scope="col"><span className="rw-sr-only">Actions</span></th></tr></thead>
      <tbody>{visible.map((matter) => {
        const open = expanded.includes(matter._id) || (!collapsedFirst && matter._id === cases[0]?._id);
        const detailsId = `retainer-case-team-${matter._id}`;
        return <Fragment key={matter._id}><tr>
          <th scope="row"><div className="rw-matter-title"><button type="button" className="rw-expand" aria-label={`${open ? 'Hide' : 'Show'} team for ${matter.parties || matter.caseNo}`} aria-expanded={open} aria-controls={detailsId} onClick={() => { if (matter._id === cases[0]?._id) setCollapsedFirst(true); setExpanded((current) => open ? current.filter((id) => id !== matter._id) : [...current, matter._id]); }}><ChevronDown size={16} /></button><div><Link to={`/cases/${matter._id}`}>{matter.parties || matter.caseNo || 'View case'}</Link><small>{matter.caseNo && matter.caseNo !== 'N/A' ? `${matter.caseNo} · ` : ''}{matter.department || 'Department not assigned'}</small></div></div></th>
          <td><span className="rw-status">{matter.status}</span></td><td className="rw-number">{money(matter.totalBilled)}</td><td className="rw-number">{money(matter.totalCollected)}</td><td className="rw-number">{money(matter.staffEarnedFees)}{!!matter.pendingStaffCount && <small>{matter.pendingStaffCount} pending</small>}</td><td className="rw-number">{money(matter.netAfterStaff ?? matter.grossProfit)}{!!matter.pendingStaffCount && <small>Before pending fees</small>}</td><td><button className="rw-text-button" type="button" aria-label={`Unlink ${matter.parties || matter.caseNo}`} disabled={saving} onClick={() => onUnlink(matter)}>Unlink</button></td>
        </tr><tr id={detailsId} hidden={!open} className="rw-team-detail"><td colSpan={7}><div className="rw-team-breakdown"><div className="rw-section-heading"><h3>{matter.parties || matter.caseNo} · Team earnings</h3><Link to={`/cases/${matter._id}`}>Open case workspace ↗</Link></div><table aria-label={`${matter.parties || matter.caseNo} team earnings`}>
          <thead><tr><th scope="col">Role</th><th scope="col">Team member</th><th scope="col" className="rw-number">TPA</th><th scope="col" className="rw-number">Timeliness</th><th scope="col" className="rw-number">Quality</th><th scope="col" className="rw-number">Collected base</th><th scope="col" className="rw-number">Earned fee</th></tr></thead>
          <tbody>{caseTeamRows(matter).map((member) => <tr key={member.key}><td>{member.role}</td><th scope="row">{member.name}{member.isCurrentAssignment === false && <small>{member.isIndependentContributor ? 'Delegated work' : 'Handover record'}</small>}</th><td className="rw-number">{member.tpaPercent ? score(member.tpaPercent) : '_'}</td><td className="rw-number">{score(member.timelinessScore)}</td><td className="rw-number">{score(member.qualityScore)}</td><td className="rw-number">{money(member.taskFeeCollected)}</td><td className="rw-number rw-earned">{money(member.earnedFee)}</td></tr>)}</tbody>
        </table><p className="rw-footnote">Earned fee = collected base × TPA × timeliness × quality. Values match this case’s workspace. Missing scores remain “_”.</p></div></td></tr></Fragment>;
      })}</tbody>
      <tfoot><tr><th scope="row" colSpan={2}>{query || department ? 'Filtered cases total' : 'Linked cases total'}</th><td className="rw-number">{money(total((matter) => matter.totalBilled))}</td><td className="rw-number">{money(total((matter) => matter.totalCollected))}</td><td className="rw-number">{money(total((matter) => matter.staffEarnedFees || 0))}</td><td className="rw-number">{money(total((matter) => matter.netAfterStaff ?? matter.grossProfit))}</td><td /></tr></tfoot>
    </table></div>}
    <p className="rw-footnote">Net contribution = case collections − direct case costs − calculated staff fees, before firm overheads. Pending staff fees are excluded until scored.</p>
  </section>;
}
