import { Link } from 'react-router-dom';
import type { RetainerCase } from '../../services/retainerService';
import type { CaseTeamEarnedFee } from '../../services/workflowInstanceService';

const money = (value?: number | null) => value == null ? '_' : `RWF ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const score = (value?: number | null) => value == null ? '_' : `${Math.round(value * 100) / 100}%`;
const roles = ['Initiator', 'Reviewer', 'Signer/Approver'];

function teamRows(matter: RetainerCase): CaseTeamEarnedFee[] {
  const team = matter.team || [];
  const missing = roles.filter((role) => !team.some((member) => member.role === role && member.isCurrentAssignment !== false))
    .map((role) => ({ key: `unassigned-${role}`, role, name: 'Not assigned', userRole: null,
      tpaPercent: 0, timelinessScore: null, qualityScore: null, taskFeeCollected: 0, earnedFee: null }));
  return [...team, ...missing].sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role) || Number(a.isCurrentAssignment === false) - Number(b.isCurrentAssignment === false));
}

export function RetainerCaseTeams({ linkedCases }: { linkedCases: RetainerCase[] }) {
  return <section className="ra-summary-section ra-case-teams" aria-label="Case teams and earned fees">
    <div className="ra-section-heading"><div><h3>Case teams and earned fees</h3><p>Assigned team members from each linked case, including cases with no monthly retainer work recorded yet.</p></div></div>
    {!linkedCases.length ? <div className="ra-summary-empty">Link a case to see its assigned team and earned fees.</div> : linkedCases.map((matter) => <article className="ra-case-team" key={matter._id}>
      <header className="ra-section-heading"><div><h4><Link to={`/cases/${matter._id}`}>{matter.parties || matter.caseNo || 'View case'}</Link></h4><p>{matter.caseNo && matter.caseNo !== 'N/A' ? `${matter.caseNo} · ` : ''}{matter.department || 'Department required'}</p></div><span className="ra-section-count">{matter.status}</span></header>
      <div className="ra-table-wrap"><table aria-label={`${matter.parties || matter.caseNo} team earnings`}>
        <thead><tr><th scope="col">Role</th><th scope="col">Team member</th><th scope="col" className="ra-number">TPA</th><th scope="col" className="ra-number">Timeliness</th><th scope="col" className="ra-number">Quality</th><th scope="col" className="ra-number">Collected base</th><th scope="col" className="ra-number">Earned fee</th></tr></thead>
        <tbody>{teamRows(matter).map((member) => <tr key={member.key}>
          <td>{member.role}</td><td><strong>{member.name}</strong>{member.isCurrentAssignment === false && <small>{member.isIndependentContributor ? 'Delegated work' : 'Handover record'}</small>}</td>
          <td className="ra-number">{member.tpaPercent ? score(member.tpaPercent) : '_'}</td><td className="ra-number">{score(member.timelinessScore)}</td><td className="ra-number">{score(member.qualityScore)}</td><td className="ra-number">{money(member.taskFeeCollected)}</td><td className="ra-number ra-earned">{money(member.earnedFee)}</td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row" colSpan={6}>Case staff earned fees</th><td className="ra-number">{money(matter.caseStaffEarnedTotal)}</td></tr></tfoot>
      </table></div>
      {!!matter.contributors?.length && <div className="ra-case-retainer-earnings"><strong>Recorded retainer TPA: {money(matter.staffTpa)}</strong><span>{matter.contributors.map((member) => `${member.name}: ${money(member.earnedTpa)}`).join(' · ')}</span></div>}
    </article>)}
    <p className="ra-table-note">Case earned fees and scores match the case workspace. Missing scores remain “_”. Recorded retainer TPA uses approved monthly production and is shown separately; these case fees are not added again to retainer totals.</p>
  </section>;
}
