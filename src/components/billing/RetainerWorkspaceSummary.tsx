import type { RetainerCase, RetainerWorkspaceAccounting } from '../../services/retainerService';
import { RetainerProductionSummary } from './RetainerProductionSummary';
import { RetainerCaseTeams } from './RetainerCaseTeams';

const money = (value: number) => `RWF ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function RetainerWorkspaceSummary({ accounting, linkedCases }: { accounting: RetainerWorkspaceAccounting; linkedCases: RetainerCase[] }) {
  const caseCosts = linkedCases.reduce((total, matter) => total + (matter.directMatterCosts || 0), 0);
  const retained = Math.round((accounting.actualReceived - caseCosts - accounting.staffTpa) * 100) / 100;
  const collection = accounting.fixedFees ? Math.round((accounting.fixedFees - accounting.outstanding) / accounting.fixedFees * 10000) / 100 : 0;
  return <section className="retainer-accounting ra-workspace-summary" aria-label="Retainer financial overview">
    <div className="ra-section-heading"><div><span className="ra-eyebrow">All recorded months</span><h2>Retainer performance</h2><p>{accounting.recordedMonths} recorded month{accounting.recordedMonths === 1 ? '' : 's'} · {linkedCases.length} linked case{linkedCases.length === 1 ? '' : 's'} · {new Set(accounting.services.flatMap((service) => service.contributors.map((member) => member.userId))).size} contributing staff</p></div></div>
    <div className="ra-metrics ra-workspace-metrics">
      <Metric label="Total monthly fees" value={money(accounting.fixedFees)} detail="Sum of fees in recorded statements" />
      <Metric label="Revenue received" value={money(accounting.actualReceived)} detail={`${collection}% of recorded fees collected`} />
      <Metric label="Outstanding fees" value={money(accounting.outstanding)} detail={accounting.overpayment ? `${money(accounting.overpayment)} overpaid across recorded months` : 'Unpaid amounts across recorded months'} />
      <Metric label="Work delivered" value={money(accounting.workValue)} detail={`${accounting.services.length} approved tasks · ordinary professional value`} />
      <Metric label="Linked case expenses" value={money(caseCosts)} detail="Direct client costs, after refunds" />
      <Metric label="Staff earnings (TPA)" value={money(accounting.staffTpa)} detail="Accrued from approved staff contributions" />
      <Metric label="Net after costs and TPA" value={money(retained)} detail="Revenue received − linked case expenses − all staff TPA" />
      <Metric label="Revenue held at firm level" value={money(accounting.firmUnutilisedRevenue)} detail={`${money(accounting.allocableRevenue)} allocated to departments`} />
    </div>
    {!accounting.recordedMonths && <p className="ra-summary-empty">No monthly statements recorded yet. Open Monthly statements to record the fixed fee, approved work and payments.</p>}
    <p className="ra-table-note">Financial totals include all recorded months, including work on previously linked cases. Expenses cover currently linked cases. Net contribution is before firm overheads; staff earnings are accrued TPA, not payments made.</p>
    <RetainerCaseTeams linkedCases={linkedCases} />
    <RetainerProductionSummary allocation={accounting} linkedCases={linkedCases} month="all recorded months" allTime />
  </section>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="ra-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
