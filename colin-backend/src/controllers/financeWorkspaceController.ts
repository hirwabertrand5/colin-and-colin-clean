import type { Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware';
import Case from '../models/caseModel';
import Invoice from '../models/invoiceModel';
import Expense from '../models/pettyCashExpenseModel';
import Fund from '../models/pettyCashFundModel';
import { getContractValue } from '../utils/financialMetrics';
import { invoicePaymentDate } from '../utils/invoicePaymentDate';
import { isWithinReportRange, localISODate, reportTimeZone, resolveOptionalReportRange } from '../utils/reportRange';
import { getStaffEarningsReport } from './staffEarningsController';
import { readFinanceCache, invalidateFinanceReads } from '../services/financeReadCache';

type Row = Record<string, string | number | boolean | null>;
const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const positive = (n: unknown) => Math.max(0, money(n));
const rate = (a: number, b: number) => b > 0 ? money(a / b * 100) : null;
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
class FinanceReadError extends Error {
  constructor(public status: number, public body: any) { super(body?.message || 'Unable to load finance records.'); }
}
const daysBetween = (a: string, b: string) => Math.max(0, Math.floor((Date.parse(b) - Date.parse(a)) / 86400000));
const groups = new Set(['financial-dashboard', 'invoicing', 'collections', 'cash-flow', 'expenses', 'remuneration']);
const sortable = new Set(['reference', 'client', 'matterNo', 'date', 'recorded', 'amount', 'billed', 'collected', 'outstanding', 'contractValue', 'directCosts', 'status', 'age', 'dueDate', 'netCost', 'vendor', 'category', 'refund', 'inflow', 'outflow', 'earnedFee', 'staff', 'role', 'actions', 'eligibleBase', 'unfundedBase', 'costs', 'count', 'unbilled', 'missing', 'tpa']);

/** One projected read per source, no workflow/report fan-out on financial pages.
 * Only the requested page of rows crosses the network. All aggregates retain
 * the whole selected period, independently of the table's search and status.
 */
export const getFinanceWorkspace = async (req: AuthRequest, res: Response) => {
  const started = performance.now();
  try {
    const group = String(req.params.section || '');
    if (!groups.has(group)) return res.status(404).json({ message: 'Unknown finance section.' });
    const query = req.query as Record<string, unknown>;
    const range = resolveOptionalReportRange({ ...query, range: query.range || 'ytd' });
    if (range && 'error' in range) return res.status(400).json({ message: range.error });
    const pageSize = Number(query.pageSize || 10);
    const requestedPage = Number(query.page || 1);
    const sort = String(query.sort || 'date');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isInteger(requestedPage) || requestedPage < 1
      || !sortable.has(sort) || !['asc', 'desc'].includes(String(query.dir || 'desc'))) {
      return res.status(400).json({ message: 'Invalid pagination or sorting options.' });
    }
    const q = String(query.q || '').trim().toLowerCase().slice(0, 200);
    const status = String(query.status || 'all');
    const tab = String(query.tab || 'all');
    const path = String(query.servicePath || '').split('/').filter(Boolean);
    if (path.length > 8 || path.some(id => id.length > 150)) return res.status(400).json({ message: 'Invalid legal service filter.' });
    const end = range?.toISO || localISODate(new Date());
    const within = (value: unknown) => isWithinReportRange(value, range);
    const beforeEnd = (value: any) => Boolean(value && (!range || new Date(value) < range.toExclusive));
    if (req.get('X-Finance-Refresh') === '1') invalidateFinanceReads();
    const readTab = group === 'remuneration' ? tab : ['triggers', 'vendors'].includes(tab) ? tab : 'all';
    const key = JSON.stringify([req.user?.id, group, range?.fromISO, end, reportTimeZone(), path, query.staff || '', query.role || '', readTab, readTab === 'vendors' ? query.fund || '' : '']);
    const snapshot = await readFinanceCache(`view:${key}`, async () => {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: reportTimeZone(), year: 'numeric', month: '2-digit', day: '2-digit' });
    const day = (value: any) => formatter.format(new Date(value));
    let rows: Row[] = [];
    const metrics: Record<string, number | null> = {};
    const ageing = [{ key: 'current', label: 'Not yet due', value: 0, count: 0 },
      { key: '1-30', label: '1–30 days overdue', value: 0, count: 0 },
      { key: '31-60', label: '31–60 days overdue', value: 0, count: 0 },
      { key: '61-90', label: '61–90 days overdue', value: 0, count: 0 },
      { key: '91-120', label: '91–120 days overdue', value: 0, count: 0 },
      { key: '120+', label: 'Over 120 days', value: 0, count: 0 },
      { key: 'unknown', label: 'Due date not recorded', value: 0, count: 0 }];
    const trend = new Map<string, { label: string; billed: number; collected: number; costs: number }>();
    const addTrend = (date: any, field: 'billed' | 'collected' | 'costs', amount: number) => {
      if (!date || !within(date)) return;
      const key = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date).slice(0, 7) : day(date).slice(0, 7);
      const row = trend.get(key) || { label: key, billed: 0, collected: 0, costs: 0 };
      row[field] += amount; trend.set(key, row);
    };
    const options: Record<string, any> = { services: [], staff: [], roles: [], funds: [] };
    let notes: string[] = [];

    if (group === 'remuneration') {
      // Reuse the authoritative completed-action/TPA engine; GET never persists.
      const data = await readFinanceCache(`earnings:${JSON.stringify([req.user?.id, range?.fromISO, end, reportTimeZone()])}`, async () => {
        let body: any; let code = 200;
        const capture = { status(n: number) { code = n; return this; }, json(value: any) { body = value; return this; } };
        const readReq = Object.create(req);
        Object.defineProperty(readReq, 'query', { value: { range: query.range || 'ytd', from: query.from, to: query.to, collectionScope: 'all', scope: 'finance-workspace' } });
        await getStaffEarningsReport(readReq, capture as unknown as Response);
        if (code !== 200) throw new FinanceReadError(code, body);
        return body;
      });
      let source = data.rows as any[];
      if (query.staff) source = source.filter(r => r.staffKey === String(query.staff));
      if (query.role) source = source.filter(r => r.systemRole === String(query.role));
      const uniqueActions = new Map<string, any>();
      for (const row of source) uniqueActions.set(`${row.caseId}:${row.keyActionKey}`, row);
      metrics.earnedFee = source.some(r => r.earnedFee != null) ? money(source.reduce((n, r) => n + (r.earnedFee || 0), 0)) : null;
      metrics.eligibleBase = money([...uniqueActions.values()].reduce((n, r) => n + r.eligibleCollectedBase, 0));
      metrics.unfundedBase = money([...uniqueActions.values()].reduce((n, r) => n + r.uncollectedActionValue, 0));
      metrics.actions = uniqueActions.size;
      metrics.staffCount = new Set(source.map(r => r.staffKey)).size;
      metrics.awaitingInput = source.filter(r => r.status === 'awaiting-input' || r.status === 'incomplete').length;
      metrics.accrued = null; metrics.payable = null; metrics.deferred = null; metrics.paid = null;
      options.staff = data.staffOptions; options.roles = [...new Set(source.map(r => r.systemRole).filter(Boolean))];
      if (['by-staff', 'by-role', 'by-matter'].includes(tab)) {
        const rollup = new Map<string, Row>();
        for (const row of source) {
          const key = tab === 'by-role' ? row.systemRole || 'Unmapped role' : tab === 'by-matter' ? row.caseId : row.staffKey;
          const current = rollup.get(key) || { id: key, reference: tab === 'by-role' ? key.replace(/_/g, ' ') : tab === 'by-matter' ? row.matterNo : row.staffName,
            caseId: tab === 'by-matter' ? row.caseId : null, client: tab === 'by-matter' ? row.matterName : null, role: tab === 'by-staff' ? row.systemRole : null,
            actions: 0, earnedFee: null, missing: 0 };
          current.actions = Number(current.actions) + 1;
          if (row.earnedFee != null) current.earnedFee = money(Number(current.earnedFee || 0) + row.earnedFee);
          if (row.earnedFee == null) current.missing = Number(current.missing) + 1;
          rollup.set(key, current);
        }
        rows = [...rollup.values()];
      } else if (!['balances', 'accrued', 'payable', 'deferred', 'paid'].includes(tab)) {
        rows = source.map(r => ({ id: r.key, reference: r.keyActionTitle, caseId: r.caseId, matterNo: r.matterNo, client: r.matterName,
          staff: r.staffName, role: r.systemRole || r.assignmentRole, date: r.completionAt, amount: r.grossActionValue,
          eligibleBase: r.eligibleCollectedBase, unfundedBase: r.uncollectedActionValue, earnedFee: r.earnedFee, status: r.status,
          tpa: r.tpaPercent, timeliness: r.timelinessScore, quality: r.qualityScore, formula: r.formula,
          note: r.statusNote, completionSource: r.completionSourceLabel, ledgerRevision: r.ledgerRevision || null }));
      }
      notes = ['Earned fee = eligible collected action value × activity-time TPA × timeliness × quality. Work completion determines the reporting period; confirmed collections fund the cap.',
        'Accrued, payable, deferred and paid remuneration need payroll approval and disbursement records. Earned fees do not establish those balances.'];
    } else {
      const needExpenses = ['financial-dashboard', 'cash-flow', 'expenses'].includes(group);
      const needInvoices = group !== 'expenses';
      const cutoff = range ? { createdAt: { $lt: range.toExclusive } } : {};
      const sourceKey = range?.toExclusive.toISOString() || 'all';
      const [matters, invoices, expenses, funds] = await Promise.all([
        readFinanceCache(`matters:${sourceKey}`, () => Case.find(cutoff).select('_id caseNo parties clientName status assignedTo legalServicePath budget workflowProgress.plannedValue workflowProgress.completedValue workflowProgress.percent billingSettings.accruedUnbilled createdAt').lean().exec()),
        needInvoices ? readFinanceCache(`invoices:${sourceKey}`, () => Invoice.find(cutoff).select('_id caseId invoiceNo date dueDate amount status paidAt createdAt updatedAt invoiceFileUrl proofUrl').lean().exec()) : [],
        needExpenses ? readFinanceCache(`expenses:${sourceKey}`, () => Expense.find(cutoff).select('_id fundId caseId date title category vendor amount refundAmount refundDate chargeType createdAt receiptUrl receiptUrls createdByName').lean().exec()) : [],
        group === 'cash-flow' || group === 'expenses' ? readFinanceCache('funds', () => Fund.find({}).select('_id name remainingAmount status').lean().exec()) : [],
      ]);
      const matches = (matter: any) => path.every((id, i) => matter.legalServicePath?.[i]?.id === id);
      const matterMap = new Map<string, any>();
      const financials = new Map<string, Row>();
      const serviceMap = new Map<string, any>();
      for (const matter of matters as any[]) {
        for (let i = 0; i < (matter.legalServicePath || []).length; i++) {
          const ancestors = matter.legalServicePath.slice(0, i).map((p: any) => p.id);
          const segment = matter.legalServicePath[i];
          serviceMap.set([...ancestors, segment.id].join('/'), { id: segment.id, label: segment.label, parent: ancestors.join('/'), depth: i });
        }
        if (!matches(matter)) continue;
        const id = String(matter._id); matterMap.set(id, matter);
        financials.set(id, { id, caseId: id, reference: matter.caseNo || 'Unnumbered matter', matterNo: matter.caseNo || 'Unnumbered matter',
          client: matter.parties || matter.clientName || 'Unassigned client', status: matter.status || 'Open', date: matter.createdAt?.toISOString() || null,
          contractValue: within(matter.createdAt) ? positive(getContractValue(matter)) : 0, billed: 0, collected: 0, outstanding: 0, directCosts: 0, allBilled: 0,
          unbilled: 0, progress: positive(matter.workflowProgress?.percent), owner: matter.assignedTo || 'Unassigned' });
      }
      options.services = [...serviceMap.values()]; options.funds = funds.map((f: any) => ({ id: String(f._id), name: f.name }));
      const invoiceRows: Row[] = []; const movements: Row[] = []; const expenseRows: Row[] = [];
      Object.assign(metrics, { contractValue: 0, billed: 0, collected: 0, outstanding: 0, overdue: 0, invoiceCount: 0, paidCount: 0, pendingCount: 0,
        directCosts: 0, operatingExpenses: 0, grossExpenses: 0, refunds: 0, openingMovement: 0, periodInflow: 0, periodOutflow: 0, missingDueDates: 0, unbilled: 0, periodOverdueCount: 0, periodOutstanding: 0 });
      let billedCohortPaid = 0; let weightedAge = 0; let agedAmount = 0;
      const addMovement = (date: any, row: Row, inflow: number, outflow: number) => {
        if (!date || !beforeEnd(date)) return;
        if (within(date)) {
          movements.push({ ...row, date: /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : new Date(date).toISOString(), inflow, outflow });
          metrics.periodInflow! += inflow; metrics.periodOutflow! += outflow;
        } else metrics.openingMovement! += inflow - outflow;
      };
      for (const inv of invoices as any[]) {
        const matter = financials.get(String(inv.caseId));
        if (path.length && !matter) continue;
        const amount = positive(inv.amount); const payment = invoicePaymentDate(inv);
        const paidByEnd = inv.status === 'Paid' && beforeEnd(payment);
        const issuedInRange = within(inv.createdAt);
        const isPaid = paidByEnd;
        const due = inv.dueDate || null;
        const overdueDays = !isPaid && due && due < end ? daysBetween(due, end) : 0;
        const invoiceAge = inv.date ? daysBetween(inv.date, end) : null;
        const derivedStatus = isPaid ? 'Paid' : overdueDays > 0 ? 'Overdue' : 'Pending';
        const band = !due ? 'unknown' : !overdueDays ? 'current' : overdueDays <= 30 ? '1-30' : overdueDays <= 60 ? '31-60' : overdueDays <= 90 ? '61-90' : overdueDays <= 120 ? '91-120' : '120+';
        const row: Row = { id: String(inv._id), recordType: 'invoice', reference: inv.invoiceNo, caseId: matter ? String(inv.caseId) : null,
          matterNo: matter?.reference || 'Unlinked matter', client: matter?.client || 'Unlinked client', amount, date: inv.date, recorded: inv.createdAt?.toISOString() || null,
          dueDate: due, paidAt: isPaid && payment ? new Date(payment).toISOString() : null, status: derivedStatus,
          age: !isPaid && !due ? null : overdueDays, invoiceAge, band, outstanding: isPaid ? 0 : amount, fileUrl: inv.invoiceFileUrl || null, proofUrl: inv.proofUrl || null };
        if (matter) matter.allBilled = Number(matter.allBilled) + amount;
        if (issuedInRange) {
          metrics.billed! += amount; metrics.invoiceCount!++;
          if (isPaid) { metrics.paidCount!++; billedCohortPaid += amount; } else metrics.pendingCount!++;
          if (!isPaid) metrics.periodOutstanding! += amount;
          if (overdueDays > 0) metrics.periodOverdueCount!++;
          if (matter) matter.billed = Number(matter.billed) + amount;
          addTrend(inv.createdAt, 'billed', amount);
        }
        if (inv.status === 'Paid' && within(payment)) {
          metrics.collected! += amount; if (matter) matter.collected = Number(matter.collected) + amount;
          addTrend(payment, 'collected', amount);
        }
        if (inv.status === 'Paid') addMovement(payment, { ...row, id: `payment:${row.id}`, reference: `${inv.invoiceNo} · collection`, category: 'Client collection' }, amount, 0);
        if (!isPaid) {
          metrics.outstanding! += amount; if (matter) matter.outstanding = Number(matter.outstanding) + amount;
          const bucket = ageing.find(b => b.key === band)!; bucket.value += amount; bucket.count++;
          if (overdueDays) metrics.overdue! += amount;
          if (!due) metrics.missingDueDates!++;
          if (invoiceAge != null) { weightedAge += invoiceAge * amount; agedAmount += amount; }
        }
        if (group === 'collections' ? !isPaid : issuedInRange) invoiceRows.push(row);
      }
      const fundNames = new Map(funds.map((f: any) => [String(f._id), f.name]));
      for (const exp of expenses as any[]) {
        const matter = financials.get(String(exp.caseId));
        if (path.length && !matter) continue;
        const gross = positive(exp.amount); const refund = Math.min(gross, positive(exp.refundAmount));
        const incurred = within(exp.createdAt) ? gross : 0;
        const refunded = exp.refundDate && within(exp.refundDate) ? refund : 0;
        const net = incurred - refunded;
        const direct = exp.chargeType === 'client' && Boolean(exp.caseId);
        metrics.grossExpenses! += incurred; metrics.refunds! += refunded;
        if (direct) { metrics.directCosts! += net; if (matter) matter.directCosts = Number(matter.directCosts) + net; }
        else metrics.operatingExpenses! += net;
        const row: Row = { id: String(exp._id), reference: exp.title, caseId: matter ? String(exp.caseId) : null, matterNo: matter?.reference || null,
          client: matter?.client || null, date: exp.date, recorded: exp.createdAt?.toISOString() || null, amount: incurred, refund: refunded, netCost: money(net),
          category: exp.category || 'Uncategorised', vendor: exp.vendor || 'Not recorded', status: direct ? 'Direct matter cost' : 'Operating expense',
          fundId: String(exp.fundId), fund: fundNames.get(String(exp.fundId)) || 'Unassigned fund', fileUrl: exp.receiptUrls?.[0] || exp.receiptUrl || null };
        if (incurred || refunded) expenseRows.push(row);
        addTrend(exp.createdAt, 'costs', gross); if (exp.refundDate) addTrend(exp.refundDate, 'costs', -refund);
        addMovement(exp.createdAt, { ...row, id: `expense:${row.id}` }, 0, gross);
        if (exp.refundDate) addMovement(exp.refundDate, { ...row, id: `refund:${row.id}`, reference: `${exp.title} · refund`, category: 'Expense refund' }, refund, 0);
      }
      for (const [id, row] of financials) {
        metrics.contractValue! += Number(row.contractValue);
        const m = matterMap.get(id);
        const work = positive(m.workflowProgress?.completedValue?.amount) || positive(getContractValue(m)) * positive(m.workflowProgress?.percent) / 100;
        row.unbilled = money(Math.max(0, work - Number(row.allBilled)));
        if (within(m.createdAt) || row.billed || row.collected || row.outstanding) metrics.unbilled! += Number(row.unbilled);
      }
      metrics.invoiceSettlementRate = rate(billedCohortPaid, metrics.billed!);
      metrics.collectionRate = rate(metrics.collected!, metrics.billed!);
      metrics.cashToBillingRatio = rate(metrics.collected!, metrics.billed!);
      metrics.averageInvoice = metrics.invoiceCount ? money(metrics.billed! / metrics.invoiceCount) : null;
      metrics.averageDebtorAge = agedAmount ? money(weightedAge / agedAmount) : null;
      metrics.grossProfit = money(metrics.collected! - metrics.directCosts!);
      metrics.grossMargin = rate(metrics.grossProfit, metrics.collected!);
      metrics.netProfit = money(metrics.grossProfit - metrics.operatingExpenses!);
      metrics.netMargin = rate(metrics.netProfit, metrics.collected!);
      metrics.totalExpenses = money(metrics.directCosts! + metrics.operatingExpenses!);
      metrics.netCashFlow = money(metrics.periodInflow! - metrics.periodOutflow!);
      metrics.closingMovement = money(metrics.openingMovement! + metrics.netCashFlow);
      metrics.pettyCash = path.length ? null : money(funds.filter((f: any) => f.status === 'active').reduce((n: number, f: any) => n + f.remainingAmount, 0));
      metrics.bankBalance = null;
      metrics.monthlyExpenseRunRate = range ? money(Math.max(0, metrics.totalExpenses) / Math.max(1, daysBetween(range.fromISO, range.toISO) + 1) * 30) : null;
      rows = group === 'invoicing' || group === 'collections' ? invoiceRows : group === 'cash-flow' ? movements : group === 'expenses' ? expenseRows
        : [...financials.values()].filter(r => r.contractValue || r.billed || r.collected || r.outstanding || r.directCosts);
      if (group === 'invoicing' && tab === 'triggers') rows = [...financials.values()].filter(r => Number(r.unbilled) > 0);
      if (group === 'expenses' && tab === 'vendors') {
        const vendors = new Map<string, Row>();
        for (const row of expenseRows.filter(r => !query.fund || r.fundId === String(query.fund))) {
          const key = String(row.vendor);
          const current = vendors.get(key) || { id: key, reference: key, count: 0, amount: 0, refund: 0, netCost: 0 };
          for (const field of ['amount', 'refund', 'netCost']) current[field] = money(Number(current[field]) + Number(row[field]));
          current.count = Number(current.count) + 1; vendors.set(key, current);
        }
        rows = [...vendors.values()];
      }
      notes = ['Contract values, billings and costs use system entry dates. Collections use the recorded payment date, with an updated-date fallback for legacy payments. Refunds use their own refund date.',
        'Receivables include all invoices entered by the report end, excluding payments received by that date. Collection rate = period collections ÷ period billings, including collections on older invoices, so it can exceed 100%. Invoice settlement rate is the paid share of invoices entered in this period.'];
      if (group === 'collections' || group === 'invoicing') notes.push('Overdue status requires a recorded due date. Invoices without payment terms remain in the unknown due-date band; no default payment term is assumed.');
      if (group === 'cash-flow') notes.push('Recorded cash movement includes collections, expense payments and refunds. Petty cash is the current saved fund balance. Bank balances and committed future payments are not recorded; the forecast is a scenario.');
      if (group === 'expenses') notes.push('Vendor spend comes from expense records. Purchase orders, supplier invoices and procurement approvals are not recorded in the current system.');
    }
    return { rows, metrics, ageing, trend: [...trend.values()], options, notes };
    });
    let rows = [...snapshot.rows];
    const { metrics, ageing, trend, options, notes } = snapshot;
    if (group === 'cash-flow' && tab === 'inflows') rows = rows.filter(r => Number(r.inflow) > 0);
    if (group === 'cash-flow' && tab === 'outflows') rows = rows.filter(r => Number(r.outflow) > 0);
    if (status !== 'all') rows = rows.filter(r => r.status === status || r.band === status);
    if (query.fund && !(group === 'expenses' && tab === 'vendors')) rows = rows.filter(r => r.fundId === String(query.fund));
    if (q) rows = rows.filter(row => ['reference', 'matterNo', 'client', 'staff', 'role', 'vendor', 'category', 'owner'].some(key => String(row[key] || '').toLowerCase().includes(q)));
    const direction = query.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const x = a[sort], y = b[sort];
      if (x == null || x === '') return y == null || y === '' ? String(a.id).localeCompare(String(b.id)) : 1;
      if (y == null || y === '') return -1;
      const compared = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
      return compared * direction || String(a.id).localeCompare(String(b.id));
    });
    const total = rows.length;
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Server-Timing', `finance;dur=${(performance.now() - started).toFixed(1)}`);
    return res.json({ section: group, range: { key: range?.key || 'all', from: range?.fromISO || null, to: end, label: range?.label || 'All time' },
      currency: 'RWF', timeZone: reportTimeZone(), metrics: Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, v == null ? null : money(v)])),
      ageing: ageing.map(r => ({ ...r, value: money(r.value) })), trend: [...trend].sort((a, b) => a.label.localeCompare(b.label)).map(r => ({ ...r, billed: money(r.billed), collected: money(r.collected), costs: money(r.costs) })),
      rows: rows.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) }, options, notes });
  } catch (error) {
    if (error instanceof FinanceReadError) return res.status(error.status).json(error.body);
    console.error('Finance workspace read failed:', error instanceof Error ? error.message : error);
    return res.status(500).json({ message: 'Unable to load finance records. Please try again.' });
  }
};
