import { useEffect, useMemo, useState } from 'react';
import usePageTitle from '../../hooks/usePageTitle';
import {
  Plus,
  Trash2,
  Wallet,
  AlertTriangle,
  X,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Receipt,
} from 'lucide-react';

import {
  addExpenseToFund,
  addRefundToExpense,
  closeActivePettyCashFund,
  createPettyCashFund,
  deleteExpense,
  getActivePettyCashFund,
  listPettyCashFunds,
  listExpensesForFund,
  PettyCashExpense,
  PettyCashFund,
  topUpActivePettyCashFund,
} from '../../services/pettyCashService';
import { CaseData, getAllCases } from '../../services/caseService';

const API_URL = import.meta.env.VITE_API_URL;
const BACKEND_URL = API_URL ? API_URL.replace(/\/api\/?$/, '') : '';

const formatRwf = (n: number) => `RWF ${Math.round(n).toLocaleString('en-US')}`;

export default function PettyCashDashboard() {
  const [fund, setFund] = useState<PettyCashFund | null>(null);
  const [fundHistory, setFundHistory] = useState<PettyCashFund[]>([]);
  const [expenses, setExpenses] = useState<PettyCashExpense[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null);
  usePageTitle('Petty Cash');
  // Create fund modal
  const [showCreateFund, setShowCreateFund] = useState(false);
  const [fundForm, setFundForm] = useState({ name: '', description: '', initialAmount: '' });
  const [showTopUpFund, setShowTopUpFund] = useState(false);
  const [topUpForm, setTopUpForm] = useState({ amount: '', note: '' });

  // Add expense modal
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [expenseForm, setExpenseForm] = useState({
  date: '',
  title: '',
  chargeType: 'internal' as const,
  caseId: '',
  amount: '',
  note: '',
  receiptFiles: [] as File[],
});

  // Add refund modal
  const [showAddRefund, setShowAddRefund] = useState(false);
  const [refundForm, setRefundForm] = useState({
    expenseId: '',
    refundAmount: '',
    refundedBy: '',
    date: '',
    note: '',
  });
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const refundableExpenses = useMemo(() => {
    return expenses
      .map((ex) => {
        const alreadyRefunded = ex.refundAmount || 0;
        const remainingRefundable = Math.max(0, ex.amount - alreadyRefunded);
        return { ex, remainingRefundable };
      })
      .filter((x) => x.remainingRefundable > 0)
      .sort((a, b) => (a.ex.date < b.ex.date ? 1 : -1));
  }, [expenses]);

  const lowThreshold = useMemo(() => {
    if (!fund) return 0;
    return (fund.initialAmount || 0) * ((fund.lowBalancePercent || 20) / 100);
  }, [fund]);

  const isLow = useMemo(() => {
    if (!fund) return false;
    return (fund.remainingAmount || 0) <= lowThreshold;
  }, [fund, lowThreshold]);

  const spentPercent = useMemo(() => {
    if (!fund || !fund.initialAmount) return 0;
    const pct = (fund.spentAmount / fund.initialAmount) * 100;
    return Math.max(0, Math.min(100, pct));
  }, [fund]);

  const remainingPercent = useMemo(() => {
    if (!fund || !fund.initialAmount) return 0;
    const pct = (fund.remainingAmount / fund.initialAmount) * 100;
    return Math.max(0, Math.min(100, pct));
  }, [fund]);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [active, allCases, funds] = await Promise.all([
        getActivePettyCashFund(),
        getAllCases().catch(() => []),
        listPettyCashFunds().catch(() => []),
      ]);
      setFund(active);
      setCases(allCases);
      setFundHistory(funds);

      if (active?._id) {
        const ex = await listExpensesForFund(active._id);
        setExpenses(ex);
      } else {
        setExpenses([]);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load petty cash');
      setFund(null);
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreateFund = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError('');
      const initialAmount = Number(String(fundForm.initialAmount).replace(/[^\d.]/g, ''));

      if (!fundForm.name.trim() || !Number.isFinite(initialAmount) || initialAmount <= 0) {
        setError('Provide fund name and a valid initial amount.');
        return;
      }

      await createPettyCashFund({
        name: fundForm.name.trim(),
        description: fundForm.description.trim(),
        initialAmount,
      });

      setShowCreateFund(false);
      setFundForm({ name: '', description: '', initialAmount: '' });
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to create fund');
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund?._id) return;

    try {
      setError('');
      const amount = Number(String(expenseForm.amount).replace(/[^\d.]/g, ''));

      if (!expenseForm.date || !expenseForm.title.trim() || !Number.isFinite(amount) || amount <= 0) {
        setError('Provide date, title and a valid amount.');
        return;
      }
      if (expenseForm.chargeType === 'client' && !expenseForm.caseId) {
        setError('Select the related case for a client-related expense.');
        return;
      }

      await addExpenseToFund(fund._id, {
        date: expenseForm.date,
        title: expenseForm.title.trim(),
        amount,
        chargeType: expenseForm.chargeType,
        caseId: expenseForm.chargeType === 'client' ? expenseForm.caseId : undefined,
        note: expenseForm.note.trim() || undefined,
        receiptFiles: expenseForm.receiptFiles.length > 0 ? expenseForm.receiptFiles : undefined,
      });

      setShowAddExpense(false);
      setExpenseForm({
        date: '',
        title: '',
        chargeType: 'internal',
        caseId: '',
        amount: '',
        note: '',
        receiptFiles: [],
      });

      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to add expense');
    }
  };

  const handleTopUpFund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund?._id) return;
    try {
      setError('');
      const amount = Number(String(topUpForm.amount).replace(/[^\d.]/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Provide a valid top-up amount.');
        return;
      }
      await topUpActivePettyCashFund({ amount, note: topUpForm.note.trim() || undefined });
      setShowTopUpFund(false);
      setTopUpForm({ amount: '', note: '' });
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to top up fund');
    }
  };

  const handleAddRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund?._id) return;

    try {
      setError('');
      setRefundSubmitting(true);
      const refundAmount = Number(String(refundForm.refundAmount).replace(/[^\d.]/g, ''));

      if (!refundForm.expenseId || !refundForm.date || !Number.isFinite(refundAmount) || refundAmount <= 0) {
        setError('Provide expense, date and a valid refund amount.');
        return;
      }
      if (!refundForm.refundedBy.trim()) {
        setError('Provide who processed the refund.');
        return;
      }

      const expense = expenses.find((ex) => ex._id === refundForm.expenseId);
      if (expense) {
        const alreadyRefunded = expense.refundAmount || 0;
        const remainingRefundable = Math.max(0, expense.amount - alreadyRefunded);
        if (refundAmount > remainingRefundable) {
          setError(`Refund exceeds remaining refundable amount (${formatRwf(remainingRefundable)}).`);
          return;
        }
      }

      await addRefundToExpense(refundForm.expenseId, {
        refundAmount,
        refundedBy: refundForm.refundedBy.trim(),
        date: refundForm.date,
        note: refundForm.note.trim() || undefined,
      });

      setShowAddRefund(false);
      setRefundForm({
        expenseId: '',
        refundAmount: '',
        refundedBy: '',
        date: '',
        note: '',
      });

      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to add refund');
    } finally {
      setRefundSubmitting(false);
    }
  };

  const handleCloseFund = async () => {
    if (!window.confirm('Close the active petty cash fund?')) return;
    try {
      setError('');
      await closeActivePettyCashFund();
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to close fund');
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!expenseId) return;
    if (!window.confirm('Delete this expense?')) return;

    try {
      setError('');
      setDeletingExpenseId(expenseId);
      await deleteExpense(expenseId);
      setExpenses((prev) => prev.filter((ex) => ex._id !== expenseId));
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to delete expense');
    } finally {
      setDeletingExpenseId(null);
    }
  };

  // Stats (match BillingDashboard card style)
  const stats = useMemo(() => {
    const initial = fund?.initialAmount ?? 0;
    const spent = fund?.spentAmount ?? 0;
    const remaining = fund?.remainingAmount ?? 0;

    return [
      { label: 'Initial Amount', value: formatRwf(initial), trend: 'up' as const, icon: DollarSign },
      { label: 'Spent', value: formatRwf(spent), trend: 'up' as const, icon: TrendingUp },
      {
        label: 'Remaining',
        value: formatRwf(remaining),
        trend: isLow ? ('down' as const) : ('up' as const),
        icon: Wallet,
      },
      {
        label: 'Remaining Rate',
        value: `${Math.round(remainingPercent)}%`,
        trend: isLow ? ('down' as const) : ('up' as const),
        icon: TrendingDown,
      },
    ];
  }, [fund, isLow, remainingPercent]);

  const getTrendColor = (trend: 'up' | 'down') => (trend === 'up' ? 'text-green-600' : 'text-red-600');

  const getCardAccent = (label: string) => {
    if (label === 'Remaining' && isLow) return 'border-red-200 bg-red-50/30';
    return '';
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">Petty Cash</h1>
            <p className="text-gray-600">Track petty cash allocations and expenses</p>
            {fund?.name ? (
              <p className="text-xs text-gray-500 mt-2">
                Active Fund: <span className="font-medium text-gray-700">{fund.name}</span>
              </p>
            ) : null}
          </div>

          <div className="flex gap-2">
            {!fund && (
              <button
                onClick={() => setShowCreateFund(true)}
                className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
              >
                Create Fund
              </button>
            )}

            {fund && (
              <>
                <button
                  onClick={() => setShowAddExpense(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
                >
                  <Plus className="w-4 h-4" />
                  Add Expense
                </button>

                <button
                  onClick={() => setShowTopUpFund(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                >
                  <Plus className="w-4 h-4" />
                  Top Up
                </button>

                <button
                  onClick={() => setShowAddRefund(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                >
                  <DollarSign className="w-4 h-4" />
                  Add Refund
                </button>

                <button
                  onClick={handleCloseFund}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                >
                  Close Fund
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 border border-red-200 bg-red-50 text-red-700 rounded">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : !fund ? (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex items-center gap-3">
              <Wallet className="w-6 h-6 text-gray-700" />
              <div>
                <div className="font-semibold text-gray-900">No active petty cash fund</div>
                <div className="text-sm text-gray-500">Create a fund to start recording expenses.</div>
              </div>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Closed Fund History</h2>
              <span className="text-xs text-gray-500">{fundHistory.length} funds</span>
            </div>
            <div className="divide-y divide-gray-200">
              {fundHistory.map((item) => (
                <div key={item._id} className="px-5 py-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.name}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Created {new Date(item.createdAt).toLocaleDateString()} by {item.createdByName}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">{formatRwf(item.initialAmount)}</p>
                    <p className="text-xs text-gray-500">{item.status}</p>
                  </div>
                </div>
              ))}
              {fundHistory.length === 0 ? <div className="px-5 py-8 text-sm text-gray-500">No fund history yet.</div> : null}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Stats (BillingDashboard style) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {stats.map((stat) => {
              const Icon = stat.icon;
              const TrendIcon = stat.trend === 'up' ? TrendingUp : TrendingDown;

              return (
                <div
                  key={stat.label}
                  className={`bg-white border border-gray-200 rounded-lg p-5 ${getCardAccent(stat.label)}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                      <Icon className="w-5 h-5 text-gray-700" />
                    </div>
                    <div className={`flex items-center text-xs ${getTrendColor(stat.trend)}`}>
                      <TrendIcon className="w-3 h-3 mr-1" />
                      —
                    </div>
                  </div>

                  <div className="text-2xl font-semibold text-gray-900 mb-1">
                    {loading ? '…' : stat.value}
                  </div>
                  <div className="text-sm text-gray-600">{stat.label}</div>

                  {/* Progress bar only on Remaining */}
                  {stat.label === 'Remaining' && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                        <span>Remaining</span>
                        <span className="font-medium text-gray-700">{Math.round(remainingPercent)}%</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${isLow ? 'bg-red-500' : 'bg-green-600'} transition-all`}
                          style={{ width: `${remainingPercent}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-500 mt-2">
                        <span>Spent: {Math.round(spentPercent)}%</span>
                        <span>
                          {formatRwf(fund.spentAmount)} / {formatRwf(fund.initialAmount)}
                        </span>
                      </div>

                      {isLow && (
                        <div className="mt-2 text-xs text-red-700 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Low balance (≤ {fund.lowBalancePercent}%)
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Expenses panel */}
          <div className="bg-white border border-gray-200 rounded-lg mb-6">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Fund History</h2>
              <span className="text-xs text-gray-500">{fundHistory.length} funds</span>
            </div>
            <div className="divide-y divide-gray-200">
              {fundHistory.slice(0, 8).map((item) => (
                <div key={item._id} className="px-5 py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          item.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Created {new Date(item.createdAt).toLocaleDateString()} by {item.createdByName}
                      {item.topUps?.length ? ` • ${item.topUps.length} top-up${item.topUps.length === 1 ? '' : 's'}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-gray-900">{formatRwf(item.initialAmount)}</p>
                    <p className="text-xs text-gray-500">Remaining {formatRwf(item.remainingAmount)}</p>
                  </div>
                </div>
              ))}
              {fundHistory.length === 0 ? <div className="px-5 py-8 text-sm text-gray-500">No fund history yet.</div> : null}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">
                Expenses <span className="text-gray-500 font-medium">({expenses.length})</span>
              </h2>
              <Receipt className="w-5 h-5 text-gray-500" />
            </div>

            {expenses.length === 0 ? (
              <div className="px-5 py-10 text-gray-500">No expenses recorded yet.</div>
            ) : (
              <div className="divide-y divide-gray-200">
                {expenses.map((ex, idx) => (
                  <div key={ex._id} className="px-5 py-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs text-gray-400">{idx + 1}.</span>
                          <p className="text-sm font-medium text-gray-900">{ex.title}</p>

                          {ex.chargeType === 'client' ? (
                            <span className="px-2 py-0.5 text-xs rounded bg-blue-50 text-blue-700 border border-blue-200">
                              Client-related
                            </span>
                          ) : null}

                          {ex.caseNoSnapshot ? (
                            <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-700">
                              Case: {ex.caseNoSnapshot}
                            </span>
                          ) : null}
                        </div>

                        <p className="text-xs text-gray-500 mb-1">
                          {ex.date} • By {ex.createdByName}
                          {ex.receiptRef ? ` • Receipt: ${ex.receiptRef}` : ''}
                        </p>

                        {ex.partiesSnapshot ? (
                          <p className="text-xs text-gray-600">
                            Parties: <span className="font-medium">{ex.partiesSnapshot}</span>
                          </p>
                        ) : null}

                        {ex.note ? <p className="text-xs text-gray-600 mt-1">{ex.note}</p> : null}

                        {ex.refundAmount ? (
                          <p className="text-xs text-green-600 mt-1">
                            Refund: {formatRwf(ex.refundAmount)}
                            {ex.refundedBy ? ` by ${ex.refundedBy}` : ''}
                            {ex.refundDate ? ` • ${ex.refundDate}` : ''}
                          </p>
                        ) : null}

                        <div className="mt-2 text-xs space-y-1">
                          {ex.receiptUrls && ex.receiptUrls.length > 0 ? (
                            ex.receiptUrls.map((url, idx) => (
                              <div key={idx}>
                                <a
                                  href={BACKEND_URL + url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 underline font-medium"
                                >
                                  Receipt {idx + 1}
                                </a>
                              </div>
                            ))
                          ) : ex.receiptUrl ? (
                            <a
                              href={BACKEND_URL + ex.receiptUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 underline font-medium"
                            >
                              View Receipt
                            </a>
                          ) : (
                            <span className="text-gray-400">No receipts</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-semibold text-gray-900 mb-1">
                            {formatRwf(ex.amount)}
                          </p>
                        </div>

                        <button
                          onClick={() => handleDeleteExpense(ex._id)}
                          className="p-2 text-red-700 hover:bg-red-50 rounded"
                          title="Delete"
                          disabled={deletingExpenseId === ex._id}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="px-5 py-3 border-t border-gray-200">
              <span className="text-sm text-gray-600">Receipts are optional.</span>
            </div>
          </div>
        </>
      )}

      {showTopUpFund && fund && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Top Up Petty Cash</h3>
              <button onClick={() => setShowTopUpFund(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleTopUpFund} className="space-y-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                Current remaining: <span className="font-semibold text-gray-900">{formatRwf(fund.remainingAmount)}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount to Add (RWF) *</label>
                <input
                  inputMode="numeric"
                  value={topUpForm.amount}
                  onChange={(e) => setTopUpForm((p) => ({ ...p, amount: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="250000"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
                <textarea
                  value={topUpForm.note}
                  onChange={(e) => setTopUpForm((p) => ({ ...p, note: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  rows={2}
                  placeholder="Reason or approval reference"
                />
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowTopUpFund(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button type="submit" className="flex-1 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700">
                  Add Money
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Fund Modal (kept simple, consistent) */}
      {showCreateFund && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Create Petty Cash Fund</h3>
              <button onClick={() => setShowCreateFund(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateFund} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fund Name *</label>
                <input
                  value={fundForm.name}
                  onChange={(e) => setFundForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="Office Petty Cash - April"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Initial Amount (RWF) *</label>
                <input
                  inputMode="numeric"
                  value={fundForm.initialAmount}
                  onChange={(e) => setFundForm((p) => ({ ...p, initialAmount: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="500000"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={fundForm.description}
                  onChange={(e) => setFundForm((p) => ({ ...p, description: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  rows={2}
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCreateFund(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button type="submit" className="flex-1 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Expense Modal (Task modal reference) */}
      {showAddExpense && fund && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full flex flex-col" style={{ maxHeight: '90vh' }}>
            {/* Header */}
            <div className="p-6 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Add Expense</h3>
              <button
                type="button"
                onClick={() => setShowAddExpense(false)}
                className="text-gray-500 hover:text-gray-700"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddExpense} className="flex-1 overflow-y-auto space-y-4 p-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                <input
                  type="date"
                  value={expenseForm.date}
                  onChange={(e) => setExpenseForm((p) => ({ ...p, date: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={expenseForm.title}
                  onChange={(e) => setExpenseForm((p) => ({ ...p, title: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="Printer paper"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount (RWF) *</label>
                  <input
                    inputMode="numeric"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm((p) => ({ ...p, amount: e.target.value }))}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                    placeholder="45000"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expense Type</label>
                  <select
                    value={expenseForm.chargeType}
                    onChange={(e) =>
                      setExpenseForm((p) => ({
                        ...p,
                        chargeType: (e.target.value === 'client' ? 'client' : 'internal') as 'internal' | 'client',
                        caseId: e.target.value === 'client' ? p.caseId : '',
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
                  >
                    <option value="internal">Internal (Firm)</option>
                    <option value="client">Client-related (Case)</option>
                  </select>
                </div>
              </div>

              {expenseForm.chargeType === 'client' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Related Case *</label>
                  <select
                    value={expenseForm.caseId}
                    onChange={(e) => setExpenseForm((p) => ({ ...p, caseId: e.target.value }))}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
                  >
                    <option value="" disabled>
                      Select a case…
                    </option>
                    {cases.map((c) => (
                      <option key={String(c._id)} value={String(c._id)}>
                        {c.caseNo} — {c.parties}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">This helps reporting and client reimbursements.</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note (Description)</label>
                <textarea
                  value={expenseForm.note}
                  onChange={(e) => setExpenseForm((p) => ({ ...p, note: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="Additional details about the expense"
                />
              </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Receipts (optional)</label>
                <div className="space-y-2">
                  {expenseForm.receiptFiles.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {expenseForm.receiptFiles.map((file, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 bg-gray-50 border border-gray-200 rounded"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Receipt className="w-4 h-4 text-gray-600 shrink-0" />
                            <span className="text-sm text-gray-700 truncate">{file.name}</span>
                            <span className="text-xs text-gray-500 shrink-0">
                              ({(file.size / 1024).toFixed(1)} KB)
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setExpenseForm((p) => ({
                                ...p,
                                receiptFiles: p.receiptFiles.filter((_, i) => i !== idx),
                              }))
                            }
                            className="text-red-600 hover:text-red-700 ml-2 shrink-0"
                            title="Remove file"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <input
                    type="file"
                    multiple
                    onChange={(e) => {
                      const newFiles = Array.from(e.target.files || []);
                      setExpenseForm((p) => ({
                        ...p,
                        receiptFiles: [...p.receiptFiles, ...newFiles],
                      }));
                      // Reset input so user can select same file again if needed
                      if (e.target) e.target.value = '';
                    }}
                    className="w-full"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.jfif,.doc,.docx"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Supported: PDF, JPG/PNG/WEBP/HEIC, DOC/DOCX.
                  </p>
                  {expenseForm.receiptFiles.length > 0 && (
                    <p className="text-xs text-gray-500">
                      {expenseForm.receiptFiles.length} file{expenseForm.receiptFiles.length > 1 ? 's' : ''} selected
                    </p>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddExpense(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>

                <button type="submit" className="flex-1 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700">
                  Add Expense
                </button>
              </div>

              <p className="text-xs text-gray-500">
                Note: Expenses exceeding the remaining balance will be blocked automatically.
              </p>
            </form>
          </div>
        </div>
      )}

      {/* Add Refund Modal */}
      {showAddRefund && fund && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full flex flex-col" style={{ maxHeight: '90vh' }}>
            {/* Header */}
            <div className="p-6 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Add Refund</h3>
              <button
                type="button"
                onClick={() => setShowAddRefund(false)}
                className="text-gray-500 hover:text-gray-700"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddRefund} className="flex-1 overflow-y-auto space-y-4 p-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expense to Refund *</label>
                <select
                  value={refundForm.expenseId}
                  onChange={(e) => setRefundForm((p) => ({ ...p, expenseId: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
                >
                  <option value="" disabled>
                    Select an expense…
                  </option>
                  {refundableExpenses.map(({ ex, remainingRefundable }) => (
                    <option key={ex._id} value={ex._id}>
                      {ex.title} • {ex.date} • Remaining: {formatRwf(remainingRefundable)}
                    </option>
                  ))}
                </select>
                {refundableExpenses.length === 0 ? (
                  <p className="text-xs text-gray-500 mt-1">No expenses currently have refundable balance.</p>
                ) : null}
              </div>

              {refundForm.expenseId ? (
                <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                  {(() => {
                    const ex = expenses.find((e) => e._id === refundForm.expenseId);
                    if (!ex) return null;
                    const alreadyRefunded = ex.refundAmount || 0;
                    const remainingRefundable = Math.max(0, ex.amount - alreadyRefunded);
                    return (
                      <div className="space-y-1">
                        <div>
                          Selected: <span className="font-medium">{ex.title}</span>
                        </div>
                        <div>
                          Expense Amount: <span className="font-medium">{formatRwf(ex.amount)}</span>
                        </div>
                        <div>
                          Already Refunded: <span className="font-medium">{formatRwf(alreadyRefunded)}</span>
                        </div>
                        <div>
                          Remaining Refundable:{' '}
                          <span className="font-medium">{formatRwf(remainingRefundable)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : null}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Refund Date *</label>
                <input
                  type="date"
                  value={refundForm.date}
                  onChange={(e) => setRefundForm((p) => ({ ...p, date: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Refund Amount (RWF) *</label>
                <input
                  inputMode="numeric"
                  value={refundForm.refundAmount}
                  onChange={(e) => setRefundForm((p) => ({ ...p, refundAmount: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="Amount refunded"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Refunded By *</label>
                <input
                  value={refundForm.refundedBy}
                  onChange={(e) => setRefundForm((p) => ({ ...p, refundedBy: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="Person who processed the refund"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note (Description)</label>
                <textarea
                  value={refundForm.note}
                  onChange={(e) => setRefundForm((p) => ({ ...p, note: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="Additional details about the refund"
                />
              </div>

              {/* Footer */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddRefund(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={refundSubmitting}
                  className="flex-1 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {refundSubmitting ? 'Saving…' : 'Add Refund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
