import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, FileText, Receipt, WalletCards } from 'lucide-react';

import { UserRole } from '../../App';
import { getBillingSummary, BillingSummary } from '../../services/billingService';
import { InvoiceWithCase, listInvoices } from '../../services/invoiceService';
import { getAllCases, CaseData } from '../../services/caseService';
import { listExpensesForFund, listPettyCashFunds, PettyCashExpense } from '../../services/pettyCashService';
import { FirmReportResponse, getFirmReports } from '../../services/firmReportsService';

export type BillingFinanceView =
  | 'financial-dashboard' | 'contract-value' | 'total-billed' | 'total-collected' | 'outstanding'
  | 'direct-matter-costs' | 'gross-profit' | 'gross-profit-margin' | 'operating-expenses' | 'net-profit' | 'net-profit-margin'
  | 'all-invoices' | 'draft' | 'issued' | 'paid' | 'pending' | 'overdue' | 'invoice-count' | 'invoice-total-billed' | 'recent-invoices' | 'billing-triggers'
  | 'collections-outstanding' | 'collections-overdue' | 'collection-rate' | 'debtor-ageing' | 'payment-follow-up' | 'collection-triggers'
  | 'firm-profitability' | 'department-profitability' | 'matter-profitability' | 'client-profitability' | 'staff-profitability'
  | 'cash-position' | 'cash-inflows' | 'cash-outflows' | 'cash-forecast'
  | 'expenses' | 'expense-direct-costs' | 'expense-operating' | 'procurement'
  | 'fee-earned' | 'accrued' | 'payable' | 'deferred' | 'remuneration-paid' | 'by-role' | 'by-staff' | 'by-matter';

const managementRoles: UserRole[] = ['managing_director', 'managing_partner', 'executive_managing_partner'];
const titles: Record<BillingFinanceView, string> = {
  'financial-dashboard': 'Financial Dashboard', 'contract-value': 'Total Contract Value', 'total-billed': 'Total Billed', 'total-collected': 'Total Collected', outstanding: 'Outstanding', 'direct-matter-costs': 'Direct Matter Costs', 'gross-profit': 'Gross Profit', 'gross-profit-margin': 'Gross Profit Margin', 'operating-expenses': 'Firm Operating Expenses', 'net-profit': 'Net Profit', 'net-profit-margin': 'Net Profit Margin',
  'all-invoices': 'All Invoices', draft: 'Draft', issued: 'Issued', paid: 'Paid', pending: 'Pending', overdue: 'Overdue', 'invoice-count': 'No. of Invoices', 'invoice-total-billed': 'Total Billed', 'recent-invoices': 'Recent Invoices', 'billing-triggers': 'Billing Triggers',
  'collections-outstanding': 'Outstanding', 'collections-overdue': 'Overdue', 'collection-rate': 'Collection Rate', 'debtor-ageing': 'Debtor Ageing', 'payment-follow-up': 'Payment Follow-Up', 'collection-triggers': 'Collection Triggers',
  'firm-profitability': 'Firm Profitability', 'department-profitability': 'Department Profitability', 'matter-profitability': 'Matter Profitability', 'client-profitability': 'Client Profitability', 'staff-profitability': 'Staff Profitability',
  'cash-position': 'Cash Position', 'cash-inflows': 'Cash Inflows', 'cash-outflows': 'Cash Outflows', 'cash-forecast': 'Cash Forecast',
  expenses: 'Expenses', 'expense-direct-costs': 'Direct Matter Costs', 'expense-operating': 'Operating Expenses', procurement: 'Procurement',
  'fee-earned': 'Fee Earned', accrued: 'Accrued', payable: 'Payable', deferred: 'Deferred', 'remuneration-paid': 'Paid', 'by-role': 'By Role', 'by-staff': 'By Staff', 'by-matter': 'By Matter',
};

const money = (value: number) => `RWF ${Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-US')}`;
const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : Number(String(value || '').replace(/[^\d.-]/g, '')) || 0;
const dayKey = (value?: string) => value ? value.slice(0, 10) : '';
const today = () => dayKey(new Date().toISOString());
const isOverdue = (invoice: InvoiceWithCase) => Boolean(invoice.date && invoice.status !== 'Paid' && invoice.date < today());

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-gray-200 bg-white p-4"><div className="text-xs uppercase tracking-[0.16em] text-gray-500">{label}</div><div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div></div>;
}

function LoadingSkeleton() {
  return <div className="space-y-6"><div className="h-8 w-56 animate-pulse rounded bg-gray-200" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-lg border border-gray-200 bg-white" />)}</div><div className="overflow-hidden rounded-lg border border-gray-200 bg-white p-4"><div className="space-y-3">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="flex gap-3"><div className="h-9 w-10 animate-pulse rounded bg-gray-200" /><div className="h-9 flex-1 animate-pulse rounded bg-gray-200" /><div className="hidden h-9 w-32 animate-pulse rounded bg-gray-200 md:block" /></div>)}</div></div></div>;
}

function Pagination({ page, pages, total, onChange }: { page: number; pages: number; total: number; onChange: (page: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-4 text-sm text-gray-600"><span>Showing {(page - 1) * 10 + 1}–{Math.min(page * 10, total)} of {total}</span><div className="flex gap-1"><button type="button" disabled={page === 1} onClick={() => onChange(page - 1)} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Previous</button>{Array.from({ length: pages }, (_, index) => index + 1).map((number) => <button type="button" key={number} onClick={() => onChange(number)} className={`rounded border px-3 py-1.5 ${number === page ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white'}`}>{number}</button>)}<button type="button" disabled={page === pages} onClick={() => onChange(page + 1)} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Next</button></div></div>;
}

export default function BillingFinancePage({ view, userRole }: { view: BillingFinanceView; userRole: UserRole }) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceWithCase[]>([]);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [expenses, setExpenses] = useState<PettyCashExpense[]>([]);
  const [report, setReport] = useState<FirmReportResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const permitted = managementRoles.includes(userRole);
  const title = titles[view];

  useEffect(() => {
    if (!permitted) return;
    let mounted = true;
    (async () => {
      try {
        const [billing, invoiceData, caseData, funds, firmReport] = await Promise.all([
          getBillingSummary(), listInvoices(), getAllCases(), listPettyCashFunds().catch(() => []), getFirmReports({ range: 'yearly', basis: 'invoiceDate' }).catch(() => null),
        ]);
        const expenseData = (await Promise.all(funds.map((fund) => listExpensesForFund(fund._id).catch(() => [])))).flat();
        if (!mounted) return;
        setSummary(billing); setInvoices(invoiceData); setCases(caseData); setExpenses(expenseData); setReport(firmReport);
      } catch (loadError: any) { if (mounted) setError(loadError?.message || 'Failed to load finance data.'); } finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [permitted]);

  const filteredInvoices = useMemo(() => {
    if (view === 'paid') return invoices.filter((invoice) => invoice.status === 'Paid');
    if (view === 'pending' || view === 'issued') return invoices.filter((invoice) => invoice.status === 'Pending');
    if (view === 'overdue') return invoices.filter(isOverdue);
    if (view === 'recent-invoices') return [...invoices].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
    return invoices;
  }, [invoices, view]);
  const pages = Math.max(1, Math.ceil(filteredInvoices.length / 10));
  const visibleInvoices = filteredInvoices.slice((page - 1) * 10, page * 10);
  useEffect(() => setPage(1), [view]);

  const directCosts = summary?.directMatterCosts ?? expenses.filter((expense) => expense.chargeType === 'client').reduce((sum, expense) => sum + Math.max(0, amount(expense.amount) - amount(expense.refundAmount)), 0);
  const operatingExpenses = summary?.firmOperatingExpenses ?? expenses.filter((expense) => expense.chargeType !== 'client').reduce((sum, expense) => sum + Math.max(0, amount(expense.amount) - amount(expense.refundAmount)), 0);
  const billed = summary?.billed ?? invoices.reduce((sum, invoice) => sum + amount(invoice.amount), 0);
  const collected = summary?.collected ?? invoices.filter((invoice) => invoice.status === 'Paid').reduce((sum, invoice) => sum + amount(invoice.amount), 0);
  const revenue = collected;
  const grossProfit = summary?.grossProfit ?? revenue - directCosts;
  const netProfit = summary?.netProfit ?? grossProfit - operatingExpenses;
  const outstanding = Math.max(0, billed - collected);
  const margin = revenue > 0 ? (grossProfit / revenue) * 100 : null;
  const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : null;
  const contractValue = summary?.contractValue ?? cases.reduce((sum, matter) => sum + Math.max(amount(matter.workflowProgress?.plannedValue?.amount), amount(matter.budget)), 0);
  const currentMetric = view === 'contract-value' ? money(contractValue) : view === 'total-billed' || view === 'invoice-total-billed' ? money(billed) : view === 'total-collected' ? money(collected) : view === 'outstanding' || view === 'collections-outstanding' ? money(outstanding) : view === 'direct-matter-costs' || view === 'expense-direct-costs' ? money(directCosts) : view === 'gross-profit' ? money(grossProfit) : view === 'gross-profit-margin' ? (margin === null ? '—' : `${Math.round(margin)}%`) : view === 'operating-expenses' || view === 'expense-operating' ? money(operatingExpenses) : view === 'net-profit' ? money(netProfit) : view === 'net-profit-margin' ? (netMargin === null ? '—' : `${Math.round(netMargin)}%`) : view === 'total-collected' || view === 'cash-inflows' ? money(collected) : view === 'cash-outflows' ? money(directCosts + operatingExpenses) : view === 'collection-rate' ? (billed > 0 ? `${Math.round((collected / billed) * 100)}%` : '—') : view === 'invoice-count' || view === 'all-invoices' ? String(invoices.length) : view === 'paid' ? String(invoices.filter((invoice) => invoice.status === 'Paid').length) : view === 'overdue' || view === 'collections-overdue' ? String(invoices.filter(isOverdue).length) : view === 'pending' || view === 'issued' ? String(invoices.filter((invoice) => invoice.status === 'Pending').length) : view === 'fee-earned' ? money(report?.productivitySummary?.totalFeeEarned || 0) : '—';

  if (!permitted) return <div className="rounded-lg border border-gray-200 bg-white p-6"><h1 className="text-xl font-semibold text-gray-900">Access denied</h1><p className="mt-2 text-gray-600">You do not have permission to view Billing & Finance.</p></div>;
  if (loading) return <LoadingSkeleton />;

  const isInvoiceView = view.includes('invoice') || ['draft', 'issued', 'paid', 'pending', 'overdue', 'total-billed'].includes(view);
  const unsupportedViews: BillingFinanceView[] = ['draft', 'issued', 'accrued', 'payable', 'deferred', 'remuneration-paid', 'by-role', 'by-matter', 'department-profitability', 'client-profitability', 'cash-position', 'cash-forecast', 'procurement', 'billing-triggers', 'payment-follow-up', 'collection-triggers'];
  const hasSupportedTable = isInvoiceView || ['expenses', 'expense-direct-costs', 'expense-operating', 'fee-earned', 'by-staff', 'contract-value', 'total-collected', 'matter-profitability', 'staff-profitability'].includes(view);
  return <div><div className="mb-6 flex items-start justify-between gap-4"><div><Link to="/billing" className="mb-3 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> Billing & Finance</Link><h1 className="text-2xl font-semibold text-gray-900">{title}</h1><p className="mt-1 text-gray-600">Live data from the existing billing, invoice, finance, expense and reporting systems.</p></div></div>{error && <div className="mb-5 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={17} />{error}</div>}<div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Metric label={title} value={currentMetric} /><Metric label="Total Billed" value={money(billed)} /><Metric label="Total Collected" value={money(collected)} /><Metric label="Outstanding" value={money(outstanding)} /></div>{view === 'net-profit' && !summary?.netProfit && <div className="mb-5 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Net profit uses the existing firm-level calculation. Matter-level allocation is not available in the current financial model.</div>}{unsupportedViews.includes(view) && <div className="mb-5 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">The current application has no dedicated source record or API for this metric. No unrelated records are substituted.</div>}{isInvoiceView ? <InvoiceTable invoices={visibleInvoices} page={page} pages={pages} total={filteredInvoices.length} onPageChange={setPage} /> : hasSupportedTable ? <FinanceTable view={view} cases={cases} expenses={expenses} report={report} invoices={invoices} /> : <div className="rounded-lg border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">No supporting financial data is available for this view.</div>}</div>;
}

function InvoiceTable({ invoices, page, pages, total, onPageChange }: { invoices: InvoiceWithCase[]; page: number; pages: number; total: number; onPageChange: (page: number) => void }) {
  return <div className="overflow-hidden rounded-lg border border-gray-200 bg-white"><div className="overflow-x-auto">{invoices.length === 0 ? <div className="p-10 text-center text-sm text-gray-500">No invoices found.</div> : <table className="min-w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-5 py-3">#</th><th className="px-5 py-3">Invoice</th><th className="px-5 py-3">Matter / Client</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Date</th></tr></thead><tbody>{invoices.map((invoice, index) => <tr key={invoice._id} className="border-t border-gray-100"><td className="px-5 py-4 text-gray-500">{(page - 1) * 10 + index + 1}</td><td className="px-5 py-4 font-medium text-gray-900">{invoice.invoiceNo}</td><td className="px-5 py-4">{invoice.case?.caseNo || 'Matter unavailable'}<div className="text-xs text-gray-500">{invoice.case?.parties || 'Client unavailable'}</div></td><td className="px-5 py-4 font-semibold">{money(amount(invoice.amount))}</td><td className="px-5 py-4">{invoice.status}</td><td className="px-5 py-4">{invoice.date}</td></tr>)}</tbody></table>}</div>{total > 0 && <Pagination page={page} totalPages={pages} total={total} onChange={onPageChange} />}</div>;
}

function FinanceTable({ view, cases, expenses, report, invoices }: { view: BillingFinanceView; cases: CaseData[]; expenses: PettyCashExpense[]; report: FirmReportResponse | null; invoices: InvoiceWithCase[] }) {
  const rows = view === 'expenses' || view === 'expense-direct-costs' || view === 'expense-operating' ? expenses.filter((expense) => view === 'expense-direct-costs' ? expense.chargeType === 'client' : view === 'expense-operating' ? expense.chargeType !== 'client' : true).map((expense) => ({ label: expense.title, detail: `${expense.date} • ${expense.category || 'Unclassified'}`, value: money(Math.max(0, amount(expense.amount) - amount(expense.refundAmount))) })) : view === 'staff-profitability' || view === 'fee-earned' || view === 'by-staff' ? (report?.team || []).map((member) => ({ label: member.name, detail: member.role, value: money(member.earnedFees || member.revenueAttributed || 0) })) : cases.map((matter) => { const matterInvoices = invoices.filter((invoice) => String(invoice.caseId) === String(matter._id)); const matterBilled = matterInvoices.reduce((sum, invoice) => sum + amount(invoice.amount), 0); const matterCollected = matterInvoices.filter((invoice) => invoice.status === 'Paid').reduce((sum, invoice) => sum + amount(invoice.amount), 0); return { label: matter.caseNo, detail: matter.parties, value: money(view === 'contract-value' ? Math.max(amount(matter.workflowProgress?.plannedValue?.amount), amount(matter.budget)) : view === 'total-collected' ? matterCollected : matterBilled) }; });
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / 10));
  const visibleRows = rows.slice((page - 1) * 10, page * 10);
  useEffect(() => setPage(1), [view, rows.length]);

  return <div className="overflow-hidden rounded-lg border border-gray-200 bg-white"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-5 py-3">#</th><th className="px-5 py-3">Record</th><th className="px-5 py-3">Details</th><th className="px-5 py-3">Value</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={4} className="px-5 py-10 text-center text-gray-500">No supporting records are available.</td></tr> : visibleRows.map((row, index) => <tr key={`${row.label}-${index}`} className="border-t border-gray-100"><td className="px-5 py-4 text-gray-500">{(page - 1) * 10 + index + 1}</td><td className="px-5 py-4 font-medium text-gray-900">{row.label || 'Unavailable'}</td><td className="px-5 py-4 text-gray-600">{row.detail || 'Unavailable'}</td><td className="px-5 py-4 font-semibold text-gray-900">{row.value}</td></tr>)}</tbody></table></div>{rows.length > 0 && <Pagination page={page} pages={totalPages} total={rows.length} onChange={setPage} />}</div>;
}