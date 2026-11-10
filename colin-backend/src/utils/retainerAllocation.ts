export const DEPARTMENTS = ['Dispute Resolution', 'Transaction & Advisory'] as const;
export type RetainerDepartment = typeof DEPARTMENTS[number];
/** Use the matter's selected department before the older case-type field. */
export function retainerDepartmentOf(matter: any): RetainerDepartment | null {
  const root = Array.isArray(matter?.legalServicePath) ? matter.legalServicePath[0] : null;
  const selected = String(root?.id || '').toLowerCase();
  if (selected === 'dispute_resolution') return 'Dispute Resolution';
  if (['transactions_advisory', 'transaction_advisory'].includes(selected)) return 'Transaction & Advisory';
  const label = String(root?.label || '').replace(/^[ab]\.\s*/i, '').trim().toLowerCase();
  if (label === 'dispute resolution') return 'Dispute Resolution';
  if (['transaction & advisory', 'transactions & advisory'].includes(label)) return 'Transaction & Advisory';
  if (root) return null;
  if (matter?.caseType === 'Transactional Cases') return 'Transaction & Advisory';
  if (['Litigation Cases', 'Labor Cases'].includes(matter?.caseType)) return 'Dispute Resolution';
  return null;
}
export const rwf = (value: number) => Math.round(Number(value) || 0);
export const decimal = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Largest remainders: deterministic whole-franc shares always reconcile. */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((weight) => total * weight / sum);
  const amounts = raw.map(Math.floor);
  const order = raw.map((value, index) => ({ index, remainder: value - amounts[index]! }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remainder = rwf(total) - amounts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remainder; i++) { const index = order[i]!.index; amounts[index] = amounts[index]! + 1; }
  return amounts;
}

export function allocateRetainer(period: any, receipts: any[]) {
  const active = (period.services || []).filter((service: any) => !service.voidedAt);
  const payments = receipts.filter((r) => !r.voidedAt).slice().sort((a, b) => String(a.receivedOn || '').localeCompare(String(b.receivedOn || '')) || String(a._id || '').localeCompare(String(b._id || '')));
  const actualReceived = payments.reduce((sum, r) => sum + r.amount, 0);
  const workValue = active.reduce((sum: number, s: any) => sum + s.ordinaryFee, 0);
  // The agreement's unused revenue remains at firm level (PDF section 5).
  const allocableRevenue = Math.min(actualReceived, workValue);
  const remaining = active.map((s: any) => s.ordinaryFee);
  const serviceRevenue = active.map(() => 0);
  const receiptAllocations = payments.map((payment) => {
    const available = remaining.reduce((n: number, value: number) => n + value, 0);
    const allocable = Math.min(payment.amount, available);
    const departmentCredits = apportion(allocable, DEPARTMENTS.map((department) => active.reduce((n: number, s: any, i: number) => n + (s.department === department ? remaining[i]! : 0), 0)));
    const credits = active.map(() => 0);
    DEPARTMENTS.forEach((department, d) => {
      const indexes = active.map((s: any, i: number) => s.department === department ? i : -1).filter((i: number) => i >= 0);
      const shares = apportion(departmentCredits[d]!, indexes.map((i: number) => remaining[i]!));
      indexes.forEach((i: number, j: number) => { credits[i] = shares[j]!; remaining[i] = remaining[i]! - shares[j]!; serviceRevenue[i] = serviceRevenue[i]! + shares[j]!; });
    });
    return { receiptId: String(payment._id || ''), receivedOn: payment.receivedOn, amount: payment.amount,
      serviceCredits: credits, firmUnutilisedRevenue: payment.amount - allocable };
  });
  const services: any[] = [];
  const departments = DEPARTMENTS.map((department, i) => {
    const members = active.filter((s: any) => s.department === department);
    const amounts = members.map((s: any) => serviceRevenue[active.indexOf(s)] || 0);
    members.forEach((service: any, j: number) => {
      const production = apportion(service.ordinaryFee, service.contributors.map((c: any) => c.share));
      const revenue = apportion(amounts[j]!, service.contributors.map((c: any) => c.share));
      services.push({ ...service, allocationIndex: active.indexOf(service), allocatedRevenue: amounts[j], contributors: service.contributors.map((c: any, k: number) => ({
        ...c, production: production[k], allocatedRevenue: revenue[k],
        // TPA is earned on approved production, independent of collection (PDF section 7).
        earnedTpa: decimal(production[k]! * c.tpaPercent / 100),
      })) });
    });
    const ordinaryValue = members.reduce((sum: number, s: any) => sum + s.ordinaryFee, 0);
    return { department, ordinaryValue, share: workValue ? decimal(ordinaryValue / workValue * 100) : 0,
      allocatedRevenue: amounts.reduce((n: number, value: number) => n + value, 0) };
  });
  const staffTpa = decimal(services.reduce((sum, s) => sum + s.contributors.reduce((n: number, c: any) => n + c.earnedTpa, 0), 0));
  const utilisation = period.fixedFee ? decimal(workValue / period.fixedFee * 100) : 0;
  return { actualReceived, fixedFee: period.fixedFee, workValue, allocableRevenue,
    firmUnutilisedRevenue: actualReceived - allocableRevenue,
    outstanding: Math.max(0, period.fixedFee - actualReceived), overpayment: Math.max(0, actualReceived - period.fixedFee),
    utilisation, utilisationStatus: utilisation > 100 ? 'Overutilised' : utilisation === 100 ? 'Fully utilised' : 'Underutilised',
    excessServiceValue: Math.max(0, workValue - period.fixedFee),
    substantialOverutilisation: utilisation > (period.utilisationThreshold || 150),
    staffTpa, retainedAfterTpa: decimal(actualReceived - staffTpa),
    mattersCount: new Set(active.map((s: any) => String(s.caseId))).size,
    servicesCount: services.length, departments, services,
    receiptAllocations: receiptAllocations.map((r) => ({ ...r, serviceCredits: services.map((s: any) => r.serviceCredits[s.allocationIndex] || 0) })) };
}
