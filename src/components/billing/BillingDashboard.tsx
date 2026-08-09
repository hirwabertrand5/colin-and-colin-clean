import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DollarSign, TrendingUp, TrendingDown, Receipt } from 'lucide-react';
import { UserRole } from '../../App';
import { getBillingSummary, BillingSummary } from '../../services/billingService';
import { getRecentInvoices, listInvoices, InvoiceWithCase } from '../../services/invoiceService';
import { getAllCases, CaseData } from '../../services/caseService';
import { listPettyCashFunds, listExpensesForFund, PettyCashExpense } from '../../services/pettyCashService';
import usePageTitle from '../../hooks/usePageTitle';

interface BillingDashboardProps {
  userRole: UserRole;
}

const formatRwf = (n: number) => `RWF ${Math.round(n).toLocaleString('en-US')}`;

const canAccessBilling = (role: UserRole) =>
  role === 'managing_director' || role === 'executive_assistant';

const parseAmount = (value: unknown) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.-]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const getMatterProgressValue = (item: CaseData) => {
  const completed = parseAmount(item.workflowProgress?.completedValue?.amount);
  if (completed > 0) return completed;

  const planned = parseAmount(item.workflowProgress?.plannedValue?.amount);
  const budget = parseAmount(item.budget);
  const base = planned > 0 ? planned : budget;
  const percent = Number(item.workflowProgress?.percent) || 0;
  if (base > 0 && percent > 0) {
    return Math.round((base * percent) / 100);
  }

  return Number(item.billingSettings?.accruedUnbilled) || 0;
};

const isExpenseInRange = (expense: PettyCashExpense, from?: string, to?: string) => {
  if (!from || !to) return true;
  const date = String(expense.date || '').slice(0, 10);
  return date >= from.slice(0, 10) && date <= to.slice(0, 10);
};

export default function BillingDashboard({ userRole }: BillingDashboardProps) {
  const navigate = useNavigate();

  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [recent, setRecent] = useState<InvoiceWithCase[]>([]);
  const [allInvoices, setAllInvoices] = useState<InvoiceWithCase[]>([]);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [allExpenses, setAllExpenses] = useState<PettyCashExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  usePageTitle('Billing & Finance');
  useEffect(() => {
    if (!canAccessBilling(userRole)) {
      navigate('/dashboard');
      return;
    }

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError('');

        // Overall summary: do NOT pass from/to; backend defaults to last 6 months
        const [s, r, invoices, allCases, funds] = await Promise.all([
          getBillingSummary(),
          getRecentInvoices(5),
          listInvoices(),
          getAllCases(),
          listPettyCashFunds().catch(() => []),
        ]);
        const expenses = (await Promise.all(
          funds.map((fund) => listExpensesForFund(fund._id).catch(() => []))
        )).flat();

        if (!mounted) return;
        setSummary(s);
        setRecent(r);
        setAllInvoices(invoices);
        setCases(allCases);
        setAllExpenses(expenses);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load billing dashboard.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [userRole, navigate]);

  

  const maxValue = useMemo(() => {
    const months = summary?.months || [];
    const max = months.reduce((m, x) => Math.max(m, x.billed, x.collected), 0);
    return Math.max(1, Math.ceil(max * 1.1));
  }, [summary?.months]);

  const valueHealth = useMemo(() => {
    const contractValue =
      summary?.contractValue ??
      cases.reduce((sum, item) => {
        const plannedValue = parseAmount(item.workflowProgress?.plannedValue?.amount);
        const budgetValue = parseAmount(item.budget);
        return sum + (plannedValue > 0 ? plannedValue : budgetValue);
      }, 0);
    const totalBilled = summary?.billed ?? allInvoices.reduce((sum, invoice) => sum + parseAmount(invoice.amount), 0);
    const collected =
      summary?.collected ??
      allInvoices.filter((invoice) => invoice.status === 'Paid').reduce((sum, invoice) => sum + parseAmount(invoice.amount), 0);
    const progressValue =
      summary?.progressValue ??
      cases.reduce((sum, item) => sum + getMatterProgressValue(item), 0);
    const outstanding = Math.max(0, contractValue - collected);
    const directMatterCosts =
      summary?.directMatterCosts ??
      allExpenses
        .filter((expense) => expense.chargeType === 'client' && Boolean(expense.caseId) && isExpenseInRange(expense, summary?.from, summary?.to))
        .reduce((sum, item) => sum + Math.max(0, parseAmount(item.amount) - parseAmount(item.refundAmount)), 0);
    const firmOperatingExpenses =
      summary?.firmOperatingExpenses ??
      allExpenses
        .filter((expense) => expense.chargeType !== 'client' && isExpenseInRange(expense, summary?.from, summary?.to))
        .reduce((sum, item) => sum + Math.max(0, parseAmount(item.amount) - parseAmount(item.refundAmount)), 0);
    const grossProfit = summary?.grossProfit ?? collected - directMatterCosts;
    const grossProfitMargin = collected > 0 ? Math.round((grossProfit / collected) * 100) : 0;
    const netProfit = grossProfit - firmOperatingExpenses;
    const netProfitMargin = collected > 0 ? Math.round((netProfit / collected) * 100) : 0;
    const directMatterCostRatio = contractValue > 0 ? Math.round((directMatterCosts / contractValue) * 100) : 0;
    const color =
      contractValue > 0 && directMatterCosts > contractValue
        ? 'red'
        : directMatterCostRatio >= 85
          ? 'red'
          : directMatterCostRatio >= 65
            ? 'yellow'
            : 'green';
    return {
      contractValue,
      totalBilled,
      collected,
      outstanding,
      directMatterCosts,
      firmOperatingExpenses,
      grossProfit,
      grossProfitMargin,
      netProfit,
      netProfitMargin,
      directMatterCostRatio,
      progressValue,
      color,
    };
  }, [allExpenses, allInvoices, cases, summary]);

  const healthClass =
    valueHealth.color === 'red'
      ? 'bg-red-600'
      : valueHealth.color === 'yellow'
        ? 'bg-yellow-500'
        : 'bg-green-600';

  const getStatusChip = (status: 'Paid' | 'Pending') =>
    status === 'Paid'
      ? 'bg-green-100 text-green-700'
      : 'bg-yellow-400 text-black';

  const firmFinancialSummary = useMemo(() => {
    const totalContractValue = valueHealth.contractValue;
    const totalBilled = valueHealth.totalBilled;
    const collected = valueHealth.collected;
    const outstanding = valueHealth.outstanding;
    const directMatterCosts = valueHealth.directMatterCosts;
    const firmOperatingExpenses = valueHealth.firmOperatingExpenses;
    const grossProfit = valueHealth.grossProfit;
    const grossProfitMargin = valueHealth.grossProfitMargin;
    const netProfit = valueHealth.netProfit;
    const netProfitMargin = valueHealth.netProfitMargin;

    return {
      totalContractValue,
      totalBilled,
      collected,
      outstanding,
      directMatterCosts,
      grossProfit,
      grossProfitMargin,
      firmOperatingExpenses,
      netProfit,
      netProfitMargin,
    };
  }, [valueHealth]);

  // KPI cards should reflect the firm's financial summary (same source as Firm Reports)
  const stats = useMemo(() => {
    return [
      { label: 'Total Contract Value', value: formatRwf(firmFinancialSummary.totalContractValue) },
      { label: 'Total Billed', value: formatRwf(firmFinancialSummary.totalBilled) },
      { label: 'Total Collected', value: formatRwf(firmFinancialSummary.collected) },
      { label: 'Total Direct Matter Costs', value: formatRwf(firmFinancialSummary.directMatterCosts) },
      { label: 'Gross Profit', value: formatRwf(firmFinancialSummary.grossProfit) },
      { label: 'Firm Operating Expenses', value: formatRwf(firmFinancialSummary.firmOperatingExpenses) },
      { label: 'Net Profit', value: formatRwf(firmFinancialSummary.netProfit) },
      { label: 'Net Profit Margin (%)', value: `${firmFinancialSummary.netProfitMargin}%` },
    ];
  }, [firmFinancialSummary]);

  if (!canAccessBilling(userRole)) return null;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">Billing & Finance</h1>
            <p className="text-gray-600">Track billing, invoices, and payments</p>
          </div>
          <Link
            to="/billing/invoices"
            className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
          >
            View All Invoices
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 border border-red-200 bg-red-50 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="text-sm text-gray-600 mb-2">{stat.label}</div>
            <div className="text-2xl font-semibold text-gray-900">{loading ? '…' : stat.value}</div>
          </div>
        ))}
      </div>

      {/* Bottom Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">Firm Financial Status</h2>
              <p className="text-sm text-gray-500 mt-1">
                Adds firm-level profitability using the internal expense ledger as the operating-cost source.
              </p>
            </div>
            <span className="inline-flex rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white">
              Internal expense ledger
            </span>
          </div>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div><div className="text-sm text-gray-500">Total Contract Value</div><div className="text-xl font-semibold text-gray-900">{formatRwf(firmFinancialSummary.totalContractValue)}</div></div>
            <div><div className="text-sm text-gray-500">Total Billed</div><div className="text-xl font-semibold text-gray-900">{formatRwf(firmFinancialSummary.totalBilled)}</div></div>
            <div><div className="text-sm text-gray-500">Total Collected</div><div className="text-xl font-semibold text-green-700">{formatRwf(firmFinancialSummary.collected)}</div></div>
            <div><div className="text-sm text-gray-500">Outstanding</div><div className="text-xl font-semibold text-amber-700">{formatRwf(firmFinancialSummary.outstanding)}</div></div>
            <div><div className="text-sm text-gray-500">Direct Matter Costs</div><div className="text-xl font-semibold text-gray-900">{formatRwf(firmFinancialSummary.directMatterCosts)}</div></div>
            <div>
              <div className="text-sm text-gray-500">Gross Profit</div>
              <div className={`text-xl font-semibold ${firmFinancialSummary.grossProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatRwf(firmFinancialSummary.grossProfit)}
              </div>
            </div>
            <div><div className="text-sm text-gray-500">Firm Operating Expenses</div><div className="text-xl font-semibold text-gray-900">{formatRwf(firmFinancialSummary.firmOperatingExpenses)}</div></div>
            <div>
              <div className="text-sm text-gray-500">Net Profit</div>
              <div className={`text-xl font-semibold ${firmFinancialSummary.netProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatRwf(firmFinancialSummary.netProfit)}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Gross Profit Margin (%)</div>
              <div className={`text-xl font-semibold ${firmFinancialSummary.grossProfitMargin >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {firmFinancialSummary.grossProfitMargin}%
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Net Profit Margin (%)</div>
              <div className={`text-xl font-semibold ${firmFinancialSummary.netProfitMargin >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {firmFinancialSummary.netProfitMargin}%
              </div>
            </div>
          </div>
        </div>

        {/* Recent invoices (latest 5) */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Recent Invoices</h2>
            <Receipt className="w-5 h-5 text-gray-500" />
          </div>

          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading invoices…</div>
          ) : recent.length === 0 ? (
            <div className="px-5 py-10 text-gray-500">No invoices found.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {recent.slice(0, 5).map((invoice) => (
                <div key={invoice._id} className="px-5 py-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium text-gray-900">{invoice.invoiceNo}</p>
                        <span className={`px-2 py-0.5 text-xs rounded ${getStatusChip(invoice.status)}`}>
                          {invoice.status}
                        </span>
                      </div>

                      <p className="text-xs text-gray-500 mb-1">
                        Case: {invoice.case ? `${invoice.case.caseNo} • ${invoice.case.parties}` : '—'}
                      </p>

                      <p className="text-xs text-gray-500">Date: {invoice.date}</p>
                    </div>

                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900 mb-1">
                        {formatRwf(Number(invoice.amount) || 0)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/billing/invoices" className="text-sm text-gray-600 hover:text-gray-900">
              View all invoices →
            </Link>
          </div>
        </div>

        {/* Monthly Summary (last 6 months from backend summary response) */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Monthly Summary</h2>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading summary…</div>
          ) : (summary?.months?.length || 0) === 0 ? (
            <div className="px-5 py-10 text-gray-500">No data available.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {(summary?.months || []).slice(-6).reverse().map((m) => (
                <div key={m.month} className="px-5 py-4 hover:bg-gray-50">
                  <p className="text-sm font-medium text-gray-900 mb-2">{m.month}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-gray-500">Billed:</span>
                      <span className="ml-1 font-medium text-gray-900">{formatRwf(m.billed)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Total Collected:</span>
                      <span className="ml-1 font-medium text-green-700">{formatRwf(m.collected)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Trend chart (based on the same backend summary months) */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Billing Trend (Last 6 Months)</h2>

          {loading ? (
            <div className="h-64 flex items-center justify-center text-gray-500">Loading chart…</div>
          ) : (summary?.months?.length || 0) === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-500">No chart data.</div>
          ) : (
            <>
              <div className="h-64 flex items-end gap-4">
                {(summary?.months || []).slice(-6).map((data) => {
                  const billedHeight = (data.billed / maxValue) * 100;
                  const collectedHeight = (data.collected / maxValue) * 100;

                  return (
                    <div key={data.month} className="flex-1 flex flex-col items-center">
                      <div className="w-full flex gap-1 mb-2" style={{ height: '200px' }}>
                        <div
                          className="flex-1 bg-gray-300 rounded-t"
                          style={{ height: `${billedHeight}%`, alignSelf: 'flex-end' }}
                          title={`Billed: ${formatRwf(data.billed)}`}
                        />
                        <div
                          className="flex-1 bg-green-600 rounded-t"
                          style={{ height: `${collectedHeight}%`, alignSelf: 'flex-end' }}
                          title={`Total Collected: ${formatRwf(data.collected)}`}
                        />
                      </div>
                      <div className="text-xs text-gray-600 mt-1">{data.month.slice(5)}</div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-center gap-6 mt-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-gray-300 rounded" />
                  <span className="text-sm text-gray-600">Billed</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-600 rounded" />
                  <span className="text-sm text-gray-600">Total Collected</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
