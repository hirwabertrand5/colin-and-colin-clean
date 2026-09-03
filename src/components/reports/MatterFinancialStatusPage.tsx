import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, BriefcaseBusiness, CalendarClock, CircleDollarSign, FileText, Receipt, WalletCards } from 'lucide-react';

import usePageTitle from '../../hooks/usePageTitle';
import { CaseData, getAllCases } from '../../services/caseService';
import { Invoice, listInvoices } from '../../services/invoiceService';
import { listExpensesForCase, PettyCashExpense } from '../../services/pettyCashService';
import { getAllTasks, TaskData } from '../../services/taskService';
import { resolveDeadlineDateTime } from '../../utils/workflowDeadline';

type MatterFinancialView =
  | 'financial-status'
  | 'contract-value'
  | 'amount-billed'
  | 'amount-collected'
  | 'outstanding-balance'
  | 'direct-cost'
  | 'gross-profit'
  | 'net-profit'
  | 'gross-profit-margin'
  | 'profitability'
  | 'direct-cost-workload'
  | 'timeliness';

type MatterRow = {
  matter: CaseData;
  matterId: string;
  invoices: Invoice[];
  expenses: PettyCashExpense[];
  tasks: TaskData[];
  contractValue: number;
  billed: number;
  collected: number;
  directCost: number;
  grossProfit: number;
  outstanding: number;
  grossProfitMargin: number | null;
  profitability: number | null;
  openTasks: number;
  timeliness: 'On time' | 'Late' | 'Pending';
  completionDate?: string;
  requiredDeadline?: string;
};

const viewDetails: Record<MatterFinancialView, { title: string; description: string; metricLabel: string }> = {
  'financial-status': { title: 'Matter Financial Status', description: 'Matter-level financial position from the live billing, payment and expense records.', metricLabel: 'Contract Value' },
  'contract-value': { title: 'Contract Value', description: 'Agreed matter value recorded on the matter or engagement.', metricLabel: 'Contract Value' },
  'amount-billed': { title: 'Amount Billed', description: 'Invoices issued against each matter, using invoice records and invoice dates.', metricLabel: 'Amount Billed' },
  'amount-collected': { title: 'Amount Collected', description: 'Confirmed collections from invoices recorded as Paid and their payment timestamps.', metricLabel: 'Amount Collected' },
  'outstanding-balance': { title: 'Outstanding Matter Balance', description: 'Billed matter value less confirmed collected payments.', metricLabel: 'Outstanding' },
  'direct-cost': { title: 'Matter Direct Cost', description: 'Client-related expenses allocated to each matter, net of recorded refunds.', metricLabel: 'Direct Cost' },
  'gross-profit': { title: 'Matter Gross Profit', description: 'Confirmed matter revenue less direct matter costs.', metricLabel: 'Gross Profit' },
  'net-profit': { title: 'Matter Net Profit', description: 'Matter-level net profit is unavailable because the current financial model does not expose matter-level overhead or other applicable costs.', metricLabel: 'Net Profit' },
  'gross-profit-margin': { title: 'Matter Gross Profit Margin', description: 'Gross profit divided by confirmed matter revenue, with zero-revenue margins left unavailable.', metricLabel: 'Gross Margin' },
  profitability: { title: 'Matter Profitability', description: 'Matter profitability analysis using confirmed revenue, direct cost, gross profit and margin.', metricLabel: 'Profitability' },
  'direct-cost-workload': { title: 'Matter Direct Cost Workload', description: 'Direct matter cost shown alongside linked task workload and assigned staff.', metricLabel: 'Direct Cost' },
  timeliness: { title: 'Matter Timeliness', description: 'Matter completion timeliness based on closed matters and their linked task deadlines.', metricLabel: 'Timeliness' },
};

const money = (value: number) => `RWF ${Math.round(value).toLocaleString('en-US')}`;
const percent = (value: number | null) => value === null || !Number.isFinite(value) ? 'Unavailable' : `${Math.round(value)}%`;
const numberValue = (value: number) => value.toLocaleString('en-US');
const normalize = (value?: string) => String(value || '').trim().toLowerCase().replace(/[-_]/g, ' ');
const isClosed = (matter: CaseData) => normalize(matter.status) === 'closed';
const parseMoney = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const contractValue = (matter: CaseData) => Math.max(
  parseMoney(matter.workflowProgress?.plannedValue?.amount),
  parseMoney(matter.budget),
  0
);

const directCost = (expenses: PettyCashExpense[]) => expenses
  .filter((expense) => expense.chargeType === 'client')
  .reduce((sum, expense) => sum + Math.max(0, parseMoney(expense.amount) - parseMoney(expense.refundAmount)), 0);

const completionStatus = (matter: CaseData, tasks: TaskData[]): MatterRow['timeliness'] => {
  if (!isClosed(matter)) return 'Pending';
  const deadlines = tasks
    .map((task) => resolveDeadlineDateTime(task.dueDate))
    .filter((date): date is Date => Boolean(date && Number.isFinite(date.getTime())));
  if (!deadlines.length || !matter.updatedAt) return 'Pending';
  const latestDeadline = Math.max(...deadlines.map((date) => date.getTime()));
  return new Date(matter.updatedAt).getTime() <= latestDeadline ? 'On time' : 'Late';
};

function Kpi({ icon: Icon, label, value }: { icon: typeof CircleDollarSign; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-500"><Icon size={16} />{label}</div>
      <div className="mt-3 text-2xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}

export default function MatterFinancialStatusPage({ view }: { view: MatterFinancialView }) {
  const PAGE_SIZE = 10;
  const [cases, setCases] = useState<CaseData[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [expensesByMatter, setExpensesByMatter] = useState<Record<string, PettyCashExpense[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const detail = viewDetails[view];

  usePageTitle(detail.title);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');

    Promise.all([getAllCases(), listInvoices(), getAllTasks()])
      .then(async ([matterData, invoiceData, taskData]) => {
        const expenseResults = await Promise.allSettled(
          matterData
            .filter((matter) => matter._id)
            .map(async (matter) => [matter._id as string, await listExpensesForCase(matter._id as string)] as const)
        );
        if (!mounted) return;
        const nextExpenses: Record<string, PettyCashExpense[]> = {};
        expenseResults.forEach((result) => {
          if (result.status === 'fulfilled') nextExpenses[result.value[0]] = result.value[1];
        });
        setCases(matterData);
        setInvoices(invoiceData);
        setTasks(taskData);
        setExpensesByMatter(nextExpenses);
      })
      .catch((loadError) => {
        if (mounted) setError(loadError?.message || 'Unable to load matter financial data.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, []);

  const rows = useMemo<MatterRow[]>(() => cases.map((matter) => {
    const matterId = String(matter._id || '');
    const matterInvoices = invoices.filter((invoice) => String(invoice.caseId) === matterId);
    const matterTasks = tasks.filter((task) => String(task.caseId) === matterId);
    const matterExpenses = expensesByMatter[matterId] || [];
    const billed = matterInvoices.reduce((sum, invoice) => sum + parseMoney(invoice.amount), 0);
    const collected = matterInvoices.filter((invoice) => invoice.status === 'Paid').reduce((sum, invoice) => sum + parseMoney(invoice.amount), 0);
    const costs = directCost(matterExpenses);
    const revenue = collected;
    const grossProfit = revenue - costs;
    return {
      matter,
      matterId,
      invoices: matterInvoices,
      expenses: matterExpenses,
      tasks: matterTasks,
      contractValue: contractValue(matter),
      billed,
      collected,
      directCost: costs,
      grossProfit,
      outstanding: Math.max(0, billed - collected),
      grossProfitMargin: revenue > 0 ? (grossProfit / revenue) * 100 : null,
      profitability: contractValue(matter) > 0 ? (grossProfit / contractValue(matter)) * 100 : null,
      openTasks: matterTasks.filter((task) => task.status !== 'Completed').length,
      timeliness: completionStatus(matter, matterTasks),
      completionDate: isClosed(matter) ? matter.updatedAt : undefined,
      requiredDeadline: matterTasks.length
        ? matterTasks.map((task) => task.dueDate).sort().at(-1)
        : undefined,
    };
  }), [cases, expensesByMatter, invoices, tasks]);

  const sortedRows = useMemo(() => [...rows].sort((left, right) => {
    const metric = (row: MatterRow) => view === 'contract-value' || view === 'financial-status' ? row.contractValue
      : view === 'amount-billed' ? row.billed
        : view === 'amount-collected' ? row.collected
          : view === 'outstanding-balance' ? row.outstanding
            : view === 'direct-cost' || view === 'direct-cost-workload' ? row.directCost
              : view === 'gross-profit' || view === 'net-profit' ? row.grossProfit
                : view === 'gross-profit-margin' ? row.grossProfitMargin || 0
                  : view === 'profitability' ? row.profitability || 0
                    : row.timeliness === 'On time' ? 100 : row.timeliness === 'Late' ? 0 : -1;
    return metric(right) - metric(left);
  }), [rows, view]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const paginatedRows = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [view]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  const total = useMemo(() => {
    if (view === 'contract-value' || view === 'financial-status') return rows.reduce((sum, row) => sum + row.contractValue, 0);
    if (view === 'amount-billed') return rows.reduce((sum, row) => sum + row.billed, 0);
    if (view === 'amount-collected') return rows.reduce((sum, row) => sum + row.collected, 0);
    if (view === 'outstanding-balance') return rows.reduce((sum, row) => sum + row.outstanding, 0);
    if (view === 'direct-cost' || view === 'direct-cost-workload') return rows.reduce((sum, row) => sum + row.directCost, 0);
    if (view === 'gross-profit') return rows.reduce((sum, row) => sum + row.grossProfit, 0);
    if (view === 'gross-profit-margin') {
      const revenue = rows.reduce((sum, row) => sum + row.collected, 0);
      return revenue > 0 ? (rows.reduce((sum, row) => sum + row.grossProfit, 0) / revenue) * 100 : null;
    }
    if (view === 'profitability') return rows.length ? rows.reduce((sum, row) => sum + (row.profitability || 0), 0) / rows.length : null;
    if (view === 'timeliness') {
      const completed = rows.filter((row) => row.timeliness !== 'Pending');
      return completed.length ? (completed.filter((row) => row.timeliness === 'On time').length / completed.length) * 100 : null;
    }
    return null;
  }, [rows, view]);

  const metricValue = (row: MatterRow) => {
    if (view === 'contract-value' || view === 'financial-status') return money(row.contractValue);
    if (view === 'amount-billed') return money(row.billed);
    if (view === 'amount-collected') return money(row.collected);
    if (view === 'outstanding-balance') return money(row.outstanding);
    if (view === 'direct-cost' || view === 'direct-cost-workload') return money(row.directCost);
    if (view === 'net-profit') return 'Unavailable';
    if (view === 'gross-profit') return money(row.grossProfit);
    if (view === 'gross-profit-margin') return percent(row.grossProfitMargin);
    if (view === 'profitability') return percent(row.profitability);
    return row.timeliness;
  };

  const totalValue = view === 'net-profit' ? 'Unavailable' : view === 'timeliness' || view === 'gross-profit-margin' || view === 'profitability' ? percent(total) : money(total || 0);
  const completedMatters = rows.filter((row) => row.timeliness !== 'Pending');

  return (
    <div className="min-h-full bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link to="/management/matters?view=financial-status" className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-900"><ArrowLeft size={16} /> Matter Financial Status</Link>
            <h1 className="text-2xl font-semibold text-gray-900">{detail.title}</h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-600">{detail.description}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-right text-xs text-gray-500 shadow-sm">Source: existing matter, billing, finance, expense and task records</div>
        </div>

        {error && <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle size={18} />{error}</div>}
        {view === 'net-profit' && <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><AlertCircle size={18} className="mt-0.5 shrink-0" />The current backend calculates net profit at firm level only. No matter-level overhead or other applicable-cost allocation is available, so this page does not invent a net-profit value.</div>}

        {loading ? <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">Loading matter financial data...</div> : (
          <>
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi icon={BriefcaseBusiness} label="Matters" value={numberValue(rows.length)} />
              <Kpi icon={CircleDollarSign} label={detail.metricLabel} value={totalValue} />
              {view === 'amount-billed' ? <Kpi icon={Receipt} label="Invoices" value={numberValue(invoices.length)} /> : view === 'amount-collected' ? <Kpi icon={WalletCards} label="Paid invoices" value={numberValue(invoices.filter((invoice) => invoice.status === 'Paid').length)} /> : view === 'timeliness' ? <Kpi icon={CalendarClock} label="Completed matters" value={numberValue(completedMatters.length)} /> : <Kpi icon={FileText} label="Linked tasks" value={numberValue(tasks.length)} />}
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 px-5 py-4"><h2 className="font-semibold text-gray-900">{detail.title} by matter</h2></div>
              {sortedRows.length === 0 ? <div className="p-10 text-center text-sm text-gray-500">No matter records are available.</div> : <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-5 py-3">#</th><th className="px-5 py-3">Matter</th><th className="px-5 py-3">Client</th><th className="px-5 py-3">{view === 'amount-billed' ? 'Invoices / Dates' : view === 'amount-collected' ? 'Payments / Last Payment' : view === 'direct-cost-workload' ? 'Direct Cost / Workload' : view === 'timeliness' ? 'Completion / Deadline' : 'Revenue / Direct Cost'}</th><th className="px-5 py-3">{detail.metricLabel}</th><th className="px-5 py-3">Status</th></tr></thead><tbody>{paginatedRows.map((row, index) => <tr key={row.matterId} className="border-t border-gray-100 align-top hover:bg-gray-50"><td className="px-5 py-4 text-gray-500">{(page - 1) * PAGE_SIZE + index + 1}</td><td className="px-5 py-4"><Link to={`/matters/${row.matterId}`} className="font-medium text-blue-700 hover:underline">{row.matter.caseNo || row.matterId}</Link><div className="mt-1 text-xs text-gray-500">{row.matter.status || 'Status unavailable'}</div></td><td className="px-5 py-4 text-gray-700">{row.matter.parties || 'Client unavailable'}</td><td className="px-5 py-4 text-gray-700">{view === 'amount-billed' ? <div>{row.invoices.length} invoice{row.invoices.length === 1 ? '' : 's'}<div className="mt-1 text-xs text-gray-500">{row.invoices.map((invoice) => `${invoice.date} (${invoice.status})`).join(', ') || 'No invoices'}</div></div> : view === 'amount-collected' ? <div>{row.invoices.filter((invoice) => invoice.status === 'Paid').length} payment{row.invoices.filter((invoice) => invoice.status === 'Paid').length === 1 ? '' : 's'}<div className="mt-1 text-xs text-gray-500">{row.invoices.filter((invoice) => invoice.status === 'Paid').map((invoice) => invoice.updatedAt || invoice.date).join(', ') || 'No confirmed payments'}</div></div> : view === 'direct-cost-workload' ? <div>{money(row.directCost)}<div className="mt-1 text-xs text-gray-500">{row.openTasks} open / {row.tasks.length} total tasks{row.tasks.length ? ` · ${Array.from(new Set(row.tasks.map((task) => task.assignee).filter(Boolean)).values()).join(', ')}` : ''}</div></div> : view === 'timeliness' ? <div>{row.completionDate ? `Completed ${row.completionDate.slice(0, 10)}` : 'Not completed'}<div className="mt-1 text-xs text-gray-500">{row.requiredDeadline ? `Deadline ${row.requiredDeadline}` : 'Deadline unavailable'}</div></div> : <div>{money(row.collected)} revenue<div className="mt-1 text-xs text-gray-500">{money(row.directCost)} direct cost</div></div>}</td><td className="px-5 py-4 font-semibold text-gray-900">{metricValue(row)}</td><td className="px-5 py-4">{view === 'timeliness' ? <span className={row.timeliness === 'On time' ? 'text-green-700' : row.timeliness === 'Late' ? 'text-red-700' : 'text-gray-500'}>{row.timeliness}</span> : view === 'net-profit' ? <span className="text-gray-500">Unavailable</span> : row.matter.status || 'Unavailable'}</td></tr>)}</tbody></table></div>}
              {sortedRows.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-4 text-sm text-gray-600"><span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sortedRows.length)} of {sortedRows.length}</span><div className="flex items-center gap-1"><button type="button" onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))} disabled={page === 1} className="rounded border border-gray-300 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>{Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => <button type="button" key={pageNumber} onClick={() => setPage(pageNumber)} className={`rounded border px-3 py-1.5 ${pageNumber === page ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>{pageNumber}</button>)}<button type="button" onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))} disabled={page === totalPages} className="rounded border border-gray-300 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40">Next</button></div></div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}