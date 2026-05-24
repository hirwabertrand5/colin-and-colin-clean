import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DollarSign, TrendingUp, TrendingDown, Receipt } from 'lucide-react';
import { UserRole } from '../../App';
import { getBillingSummary, BillingSummary } from '../../services/billingService';
import { getRecentInvoices, InvoiceWithCase } from '../../services/invoiceService';
import { getAllCases, CaseData } from '../../services/caseService';
import { getActivePettyCashFund, listExpensesForFund, PettyCashExpense } from '../../services/pettyCashService';
import usePageTitle from '../../hooks/usePageTitle';

interface BillingDashboardProps {
  userRole: UserRole;
}

const formatRwf = (n: number) => `RWF ${Math.round(n).toLocaleString('en-US')}`;

const canAccessBilling = (role: UserRole) =>
  role === 'managing_director' || role === 'executive_assistant';

export default function BillingDashboard({ userRole }: BillingDashboardProps) {
  const navigate = useNavigate();

  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [recent, setRecent] = useState<InvoiceWithCase[]>([]);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [caseExpenses, setCaseExpenses] = useState<PettyCashExpense[]>([]);
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
        const [s, r, allCases, fund] = await Promise.all([
          getBillingSummary(),
          getRecentInvoices(5),
          getAllCases(),
          getActivePettyCashFund().catch(() => null),
        ]);
        const expenses = fund?._id ? await listExpensesForFund(fund._id).catch(() => []) : [];

        if (!mounted) return;
        setSummary(s);
        setRecent(r);
        setCases(allCases);
        setCaseExpenses(expenses.filter((expense) => expense.chargeType === 'client' && expense.caseId));
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

  const stats = useMemo(() => {
    const billed = summary?.billed ?? 0;
    const collected = summary?.collected ?? 0;
    const outstanding = summary?.outstanding ?? Math.max(0, billed - collected);
    const collectionRate =
      summary?.collectionRate ??
      (billed > 0 ? Math.round((collected / billed) * 100) : 0);

    return [
      { label: 'Total Billed', value: formatRwf(billed), change: '', trend: 'up' as const, icon: DollarSign },
      { label: 'Collected', value: formatRwf(collected), change: '', trend: 'up' as const, icon: TrendingUp },
      { label: 'Outstanding', value: formatRwf(outstanding), change: '', trend: outstanding > 0 ? ('down' as const) : ('up' as const), icon: TrendingDown },
      { label: 'Collection Rate', value: `${collectionRate}%`, change: '', trend: 'up' as const, icon: DollarSign },
    ];
  }, [summary]);

  const maxValue = useMemo(() => {
    const months = summary?.months || [];
    const max = months.reduce((m, x) => Math.max(m, x.billed, x.collected), 0);
    return Math.max(1, Math.ceil(max * 1.1));
  }, [summary?.months]);

  const valueHealth = useMemo(() => {
    const planned = cases.reduce((sum, item) => sum + (Number(item.workflowProgress?.plannedValue?.amount) || 0), 0);
    const earned = cases.reduce((sum, item) => sum + (Number(item.workflowProgress?.completedValue?.amount) || 0), 0);
    const spent = caseExpenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const remaining = planned - spent;
    const spentRatio = planned > 0 ? Math.round((spent / planned) * 100) : 0;
    const margin = earned - spent;
    const color = planned > 0 && spent > planned ? 'red' : spentRatio >= 85 ? 'red' : spentRatio >= 65 ? 'yellow' : 'green';
    return { planned, earned, spent, remaining, spentRatio, margin, color };
  }, [caseExpenses, cases]);

  const healthClass =
    valueHealth.color === 'red'
      ? 'bg-red-600'
      : valueHealth.color === 'yellow'
        ? 'bg-yellow-500'
        : 'bg-green-600';

  const getStatusChip = (status: 'Paid' | 'Pending') =>
    status === 'Paid'
      ? 'bg-green-100 text-green-700'
      : 'bg-yellow-100 text-yellow-700';

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
        {stats.map((stat) => {
          const Icon = stat.icon;
          const TrendIcon = stat.trend === 'up' ? TrendingUp : TrendingDown;

          return (
            <div key={stat.label} className="bg-white border border-gray-200 rounded-lg p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                  <Icon className="w-5 h-5 text-gray-700" />
                </div>
                <div className={`flex items-center text-xs ${stat.trend === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                  <TrendIcon className="w-3 h-3 mr-1" />
                  {stat.change || '—'}
                </div>
              </div>
              <div className="text-2xl font-semibold text-gray-900 mb-1">
                {loading ? '…' : stat.value}
              </div>
              <div className="text-sm text-gray-600">{stat.label}</div>
            </div>
          );
        })}
      </div>

      {/* Bottom Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">Planned Value Health</h2>
              <p className="text-sm text-gray-500 mt-1">
                Compares negotiated case value with case-linked petty cash spend and cleared workflow value.
              </p>
            </div>
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold text-white ${healthClass}`}>
              {valueHealth.spent > valueHealth.planned && valueHealth.planned > 0
                ? 'Plan exceeded'
                : valueHealth.color === 'red'
                  ? 'Low remaining value'
                  : valueHealth.color === 'yellow'
                    ? 'Watch spend'
                    : 'Healthy'}
            </span>
          </div>
          <div className="mt-5">
            <div className="mb-2 flex justify-between text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
              <span>Planned value spent</span>
              <span>{loading ? '…' : `${valueHealth.spentRatio}%`}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-gray-200">
              <div className={`h-3 rounded-full ${healthClass}`} style={{ width: `${Math.min(100, valueHealth.spentRatio)}%` }} />
            </div>
          </div>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div><div className="text-sm text-gray-500">Planned</div><div className="text-xl font-semibold text-gray-900">{formatRwf(valueHealth.planned)}</div></div>
            <div><div className="text-sm text-gray-500">Cleared/Earned</div><div className="text-xl font-semibold text-green-700">{formatRwf(valueHealth.earned)}</div></div>
            <div><div className="text-sm text-gray-500">Case Spend</div><div className="text-xl font-semibold text-gray-900">{formatRwf(valueHealth.spent)}</div></div>
            <div>
              <div className="text-sm text-gray-500">{valueHealth.margin >= 0 ? 'Profit Margin' : 'Loss'}</div>
              <div className={`text-xl font-semibold ${valueHealth.margin >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatRwf(Math.abs(valueHealth.margin))}
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
                      <span className="text-gray-500">Collected:</span>
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
                          title={`Collected: ${formatRwf(data.collected)}`}
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
                  <span className="text-sm text-gray-600">Collected</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
