import type { RetainerCase } from '../../services/retainerService';
import type { CaseTeamEarnedFee } from '../../services/workflowInstanceService';

export const money = (value?: number | null) => value == null ? '_' : `RWF ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const score = (value?: number | null) => value == null ? '_' : `${Math.round(value * 10) / 10}%`;
export const dateLabel = (value?: string) => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : '';
export const departmentNames = ['Dispute Resolution', 'Transaction & Advisory'];
const round = (value: number) => Math.round(value * 100) / 100;
export const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function departmentSummary(cases: RetainerCase[]) {
  const names = cases.some((matter) => !matter.department) ? [...departmentNames, 'Department not assigned'] : departmentNames;
  return names.map((name) => {
    const matters = cases.filter((matter) => (matter.department || 'Department not assigned') === name);
    const sum = (read: (matter: RetainerCase) => number) => round(matters.reduce((total, matter) => total + read(matter), 0));
    return { name, count: matters.length, billed: sum((matter) => matter.totalBilled), collected: sum((matter) => matter.totalCollected),
      costs: sum((matter) => matter.directMatterCosts), staffFees: sum((matter) => matter.staffEarnedFees || 0),
      pending: sum((matter) => matter.pendingStaffCount || 0), net: sum((matter) => matter.netAfterStaff ?? matter.grossProfit) };
  });
}

export function staffSummary(cases: RetainerCase[]) {
  const members = new Map<string, { name: string; roles: Set<string>; cases: Set<string>; rates: Set<number>; timeliness: number[]; quality: number[]; fees: number; known: number; pending: number }>();
  for (const matter of cases) for (const member of matter.team || []) {
    const key = member.name.trim().toLowerCase().replace(/\s+/g, ' ');
    let row = members.get(key);
    if (!row) { row = { name: member.name, roles: new Set(), cases: new Set(), rates: new Set(), timeliness: [], quality: [], fees: 0, known: 0, pending: 0 }; members.set(key, row); }
    row.roles.add(member.role); row.cases.add(matter._id); row.rates.add(member.tpaPercent);
    if (member.timelinessScore != null) row.timeliness.push(member.timelinessScore);
    if (member.qualityScore != null) row.quality.push(member.qualityScore);
    if (member.earnedFee == null) row.pending++; else { row.fees = round(row.fees + member.earnedFee); row.known++; }
  }
  return [...members.values()].sort((a, b) => b.fees - a.fees || a.name.localeCompare(b.name));
}

export function caseTeamRows(matter: RetainerCase): CaseTeamEarnedFee[] {
  const roles = ['Initiator', 'Reviewer', 'Signer/Approver'], team = matter.team || [];
  const missing = roles.filter((role) => !team.some((member) => member.role === role && member.isCurrentAssignment !== false))
    .map((role) => ({ key: `unassigned-${role}`, role, name: 'Not assigned', userRole: null, tpaPercent: 0, timelinessScore: null, qualityScore: null, taskFeeCollected: 0, earnedFee: null }));
  return [...team, ...missing].sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role) || Number(a.isCurrentAssignment === false) - Number(b.isCurrentAssignment === false));
}
