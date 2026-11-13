import { Fragment, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Users } from 'lucide-react';
import type { Department, RetainerAllocation, RetainerWork } from '../../services/retainerAccountingService';
import type { RetainerCase } from '../../services/retainerService';

const money = (value: number) => `RWF ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const departments: Department[] = ['Dispute Resolution', 'Transaction & Advisory'];
const sumMoney = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100;

type MatterProduction = {
  caseId: string; matterNo: string; name: string; department: Department;
  tasks: Set<string>; production: number; earnedTpa: number; rates: Set<number>;
};
type StaffProduction = {
  userId: string; name: string; role: string; tasks: Set<string>;
  production: number; earnedTpa: number; matters: Map<string, MatterProduction>;
};

/** Summarise the server's approved contribution snapshots; never reprice TPA here. */
export function summariseRetainerStaff(recordedServices: RetainerWork[], linkedCases: RetainerCase[]) {
  const mattersById = new Map(linkedCases.map((matter) => [matter._id, matter]));
  const services = recordedServices.filter((service) => !service.voidedAt);
  const members = new Map<string, StaffProduction>();
  for (const service of services) {
    for (const contributor of service.contributors) {
      let member = members.get(contributor.userId);
      if (!member) {
        member = { userId: contributor.userId, name: contributor.name, role: contributor.role,
          tasks: new Set(), production: 0, earnedTpa: 0, matters: new Map() };
        members.set(contributor.userId, member);
      }
      const taskKey = `${service.caseId}:${service._id}`;
      member.tasks.add(taskKey);
      member.production = sumMoney([member.production, contributor.production]);
      member.earnedTpa = sumMoney([member.earnedTpa, contributor.earnedTpa]);
      // Keep the recorded department if the matter's classification changes later.
      const matterKey = `${service.caseId}:${service.department}`;
      let matter = member.matters.get(matterKey);
      if (!matter) {
        matter = { caseId: service.caseId, matterNo: service.matterNo, name: mattersById.get(service.caseId)?.parties || '',
          department: service.department, tasks: new Set(), production: 0, earnedTpa: 0, rates: new Set() };
        member.matters.set(matterKey, matter);
      }
      matter.tasks.add(taskKey);
      matter.production = sumMoney([matter.production, contributor.production]);
      matter.earnedTpa = sumMoney([matter.earnedTpa, contributor.earnedTpa]);
      matter.rates.add(contributor.tpaPercent);
    }
  }
  return [...members.values()].sort((a, b) => b.earnedTpa - a.earnedTpa || a.name.localeCompare(b.name));
}

export function RetainerProductionSummary({ allocation, linkedCases, month, allTime = false }: {
  allocation?: Pick<RetainerAllocation, 'services' | 'departments' | 'workValue' | 'allocableRevenue' | 'staffTpa'>;
  linkedCases: RetainerCase[]; month: string; allTime?: boolean;
}) {
  const summaryId = useId();
  const [expanded, setExpanded] = useState<string[]>([]);
  const services = (allocation?.services || []).filter((service) => !service.voidedAt);
  const staff = summariseRetainerStaff(services, linkedCases);
  const linkedWithoutDepartment = linkedCases.filter((matter) => !matter.department).length;
  const value = (amount: number) => allocation ? money(amount) : '—';

  return <div className="ra-production-summary" key={month}>
    <section className="ra-summary-section" aria-label="Department summary">
      <div className="ra-section-heading"><div><h3>Department summary</h3><p>Work value and revenue credit for {month}. Each matter uses its recorded department.</p></div><span className="ra-section-count">{linkedCases.length} linked matters</span></div>
      <div className="ra-table-wrap"><table>
        <caption className="ra-sr-only">Departmental production and revenue allocation for {month}</caption>
        <thead><tr><th scope="col">Department</th><th scope="col" className="ra-number">Linked matters</th><th scope="col" className="ra-number">Approved tasks</th><th scope="col" className="ra-number">Work value</th><th scope="col" className="ra-number">Production share</th><th scope="col" className="ra-number">Revenue credit</th><th scope="col" className="ra-number">Staff TPA</th>{allTime && <><th scope="col" className="ra-number">Case expenses</th><th scope="col" className="ra-number">Net contribution</th></>}</tr></thead>
        <tbody>{departments.map((department) => {
          const recorded = allocation?.departments.find((item) => item.department === department);
          const work = services.filter((service) => service.department === department);
          const tpa = sumMoney(work.flatMap((service) => service.contributors.map((contributor) => contributor.earnedTpa)));
          const costs = sumMoney(linkedCases.filter((matter) => matter.department === department).map((matter) => matter.directMatterCosts || 0));
          return <tr key={department}><th scope="row">{department}</th><td className="ra-number">{linkedCases.filter((matter) => matter.department === department).length}</td><td className="ra-number">{allocation ? work.length : '—'}</td><td className="ra-number">{value(recorded?.ordinaryValue || 0)}</td><td className="ra-number">{allocation ? `${recorded?.share || 0}%` : '—'}</td><td className="ra-number">{value(recorded?.allocatedRevenue || 0)}</td><td className="ra-number">{value(tpa)}</td>{allTime && <><td className="ra-number">{money(costs)}</td><td className="ra-number">{value(sumMoney([recorded?.allocatedRevenue || 0, -costs, -tpa]))}</td></>}</tr>;
        })}{linkedWithoutDepartment > 0 && <tr><th scope="row">Department required</th><td className="ra-number">{linkedWithoutDepartment}</td><td colSpan={5}>Select a department on these matters before recording work.</td>{allTime && <><td className="ra-number">{money(sumMoney(linkedCases.filter((matter) => !matter.department).map((matter) => matter.directMatterCosts || 0)))}</td><td className="ra-number">{money(-sumMoney(linkedCases.filter((matter) => !matter.department).map((matter) => matter.directMatterCosts || 0)))}</td></>}</tr>}</tbody>
        <tfoot><tr><th scope="row">Total</th><td className="ra-number">{linkedCases.length}</td><td className="ra-number">{allocation ? services.length : '—'}</td><td className="ra-number">{value(allocation?.workValue || 0)}</td><td className="ra-number">{allocation?.workValue ? '100%' : '—'}</td><td className="ra-number">{value(allocation?.allocableRevenue || 0)}</td><td className="ra-number">{value(allocation?.staffTpa || 0)}</td>{allTime && <><td className="ra-number">{money(sumMoney(linkedCases.map((matter) => matter.directMatterCosts || 0)))}</td><td className="ra-number">{value(sumMoney([allocation?.allocableRevenue || 0, -(allocation?.staffTpa || 0), ...linkedCases.map((matter) => -(matter.directMatterCosts || 0))]))}</td></>}</tr></tfoot>
      </table></div>
      <p className="ra-table-note">Revenue credit is the department’s share of revenue received. Unallocated revenue stays at firm level.{allTime && ' Net contribution = revenue credit − linked case expenses − accrued staff TPA. Work uses its recorded department; expenses use the case’s current department.'}</p>
    </section>

    <section className="ra-summary-section" aria-label="Staff earnings by case">
      <div className="ra-section-heading"><div><h3>Staff earnings by case</h3><p>Approved individual production × applicable TPA rate. Expand a staff member to see each case.</p></div><span className="ra-section-count"><Users size={14} /> {staff.length} contributors</span></div>
      {!staff.length ? <div className="ra-summary-empty">{allTime ? 'No staff earnings recorded yet. Record approved workflow tasks and their contributors in Monthly statements.' : allocation ? 'No staff TPA recorded for this month. Record approved workflow tasks and their contributors to show earnings here.' : 'Prepare this month’s statement and record approved workflow tasks to see staff production and TPA by case.'}</div> : <div className="ra-table-wrap"><table className="ra-staff-table">
        <caption className="ra-sr-only">Individual production and TPA earned for {month}</caption>
        <thead><tr><th scope="col">Staff member</th><th scope="col" className="ra-number">Cases worked</th><th scope="col" className="ra-number">Approved tasks</th><th scope="col" className="ra-number">Individual production</th><th scope="col" className="ra-number">TPA earned</th></tr></thead>
        <tbody>{staff.map((member) => {
          const isExpanded = expanded.includes(member.userId);
          const detailId = `${summaryId}-retainer-staff-${member.userId}`;
          const casesWorked = new Set([...member.matters.values()].map((matter) => matter.caseId)).size;
          return <Fragment key={member.userId}>
            <tr><th scope="row"><button type="button" className="ra-staff-toggle" aria-expanded={isExpanded} aria-controls={detailId} onClick={() => setExpanded((current) => isExpanded ? current.filter((id) => id !== member.userId) : [...current, member.userId])}><ChevronDown size={16} /><span>{member.name}<small>{member.role.replaceAll('_', ' ')}</small></span></button></th><td className="ra-number">{casesWorked}</td><td className="ra-number">{member.tasks.size}</td><td className="ra-number">{money(member.production)}</td><td className="ra-number ra-earned">{money(member.earnedTpa)}</td></tr>
            <tr id={detailId} hidden={!isExpanded} className="ra-staff-detail"><td colSpan={5}><div className="ra-case-breakdown"><h4>{member.name} · Case breakdown</h4><table aria-label={`${member.name} case earnings`}><thead><tr><th scope="col">Matter</th><th scope="col">Department</th><th scope="col" className="ra-number">Approved tasks</th><th scope="col" className="ra-number">Production</th><th scope="col" className="ra-number">TPA rate</th><th scope="col" className="ra-number">TPA earned</th></tr></thead><tbody>{[...member.matters.entries()].map(([key, matter]) => <tr key={key}><td><Link to={`/cases/${matter.caseId}`}>{matter.name || (matter.matterNo && matter.matterNo !== 'N/A' ? matter.matterNo : 'View matter')}</Link>{matter.name && matter.matterNo && matter.matterNo !== 'N/A' && <small>{matter.matterNo}</small>}</td><td>{matter.department}</td><td className="ra-number">{matter.tasks.size}</td><td className="ra-number">{money(matter.production)}</td><td className="ra-number">{[...matter.rates].sort((a, b) => a - b).map((rate) => `${rate}%`).join(', ')}</td><td className="ra-number ra-earned">{money(matter.earnedTpa)}</td></tr>)}</tbody><tfoot><tr><th scope="row" colSpan={3}>Staff total</th><td className="ra-number">{money(member.production)}</td><td /><td className="ra-number">{money(member.earnedTpa)}</td></tr></tfoot></table></div></td></tr>
          </Fragment>;
        })}</tbody>
        <tfoot><tr><th scope="row" colSpan={3}>Total individual production / TPA</th><td className="ra-number">{money(sumMoney(staff.map((member) => member.production)))}</td><td className="ra-number">{money(sumMoney(staff.map((member) => member.earnedTpa)))}</td></tr></tfoot>
      </table></div>}
      <p className="ra-table-note">TPA shown is accrued earnings from approved work. A task shared by several staff appears for each contributor; its work value is split by their recorded contribution.</p>
    </section>
  </div>;
}
