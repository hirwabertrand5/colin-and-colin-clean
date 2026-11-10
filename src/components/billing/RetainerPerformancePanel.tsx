import { Link } from 'react-router-dom';
import { RetainerPerformance } from '../../services/retainerAccountingService';
import { retainerMoney as money } from './RetainerMonthlyStatement';
import './retainer-accounting.css';
export function RetainerPerformancePanel({ data }: { data?: RetainerPerformance }) {
  if (!data) return null;
  const rows = data.statements.filter((p) => p.feeInRange || p.cashInRange || p.workInRange);
  return <section className="retainer-accounting ra-performance" aria-label="Retainer performance">
    <header className="ra-header"><div><span className="ra-eyebrow">Retainer Portfolio Monthly Overview</span><h2>Retainer Performance Dashboard</h2><p>Actual revenue received uses the payment date. Departmental production and individual TPA use the month in which approved workflow tasks were completed.</p></div><Link className="ra-link" to="/matters/retainers">Manage retainers →</Link></header>
    <div className="ra-metrics">{[['Monthly retainer revenue', data.collected], ['Value of work delivered', data.workValue], ['Staff TPA accrued and approved', data.staffTpa], ['Unutilised retainer revenue', data.unutilisedRevenue]].map(([label, value]) => <div className="ra-metric" key={label}><span>{label}</span><strong>{money(Number(value))}</strong></div>)}</div>
    {rows.length ? <div className="ra-table-wrap"><table><thead><tr><th>Retainer client / month</th><th>Fixed monthly fee</th><th>Actual revenue received</th><th>Value of work delivered</th><th>Retainer utilisation</th><th>Departmental revenue allocation</th><th>Individual TPA</th></tr></thead><tbody>{rows.map((p) => <tr key={p._id}><td><Link to={`/matters/retainers/${p.retainerId}`}>{p.clientName}</Link><small>{p.month} · {p.status}</small></td><td>{money(p.fixedFee)}</td><td>{money(p.cashInRange)}</td><td>{money(p.workInRange)}</td><td>{p.allocation.utilisation}%<small>{p.allocation.utilisationStatus}</small></td><td>{p.cashAllocation.departments.map((d) => <div key={d.department}>{d.department}<small>{money(d.allocatedRevenue)}</small></div>)}</td><td>{money(p.tpaInRange)}</td></tr>)}</tbody></table></div> : <p>No retainer activity in this reporting period. Record the fixed monthly fee in the Monthly Retainer Statement.</p>}
    <p className="ra-policy">Actual revenue received is recorded once in Billing & Margins and Management Reports. Departmental revenue allocation is based on departmental production. Individual TPA is calculated from individual monthly production and the applicable TPA percentage, without double-counting staff earnings.</p>
  </section>;
}
