import React, { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Download } from 'lucide-react';
import { UserRole } from '../../App';
import { getAllCases, CaseData } from '../../services/caseService';
import { addInvoiceToCase } from '../../services/invoiceService';
import { listInvoices, InvoiceWithCase } from '../../services/invoiceService';

interface InvoiceManagementProps {
  userRole: UserRole;
}

const canAccessBilling = (role: UserRole) =>
  role === 'managing_director' || role === 'executive_assistant';

const formatRwf = (n: number) => `RWF ${Math.round(n).toLocaleString('en-US')}`;

const PAGE_SIZE = 5;

export default function InvoiceManagement({ userRole }: InvoiceManagementProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'Paid' | 'Pending'>('all');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [invoices, setInvoices] = useState<InvoiceWithCase[]>([]);

  // Pagination
  const [page, setPage] = useState(1);

  // Create invoice modal
  const [showCreate, setShowCreate] = useState(false);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);

  const [newInvoice, setNewInvoice] = useState({
    caseId: '',
    date: '',
    amount: '',
    notes: '',
  });

  const loadInvoices = async () => {
    try {
      setLoading(true);
      setError('');

      const data = await listInvoices({
        status: filterStatus === 'all' ? undefined : filterStatus,
        q: searchTerm.trim() ? searchTerm.trim() : undefined,
      });

      setInvoices(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load invoices.');
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canAccessBilling(userRole)) return;
    setPage(1);
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus]);

  // Debounced search
  useEffect(() => {
    if (!canAccessBilling(userRole)) return;
    setPage(1);
    const t = setTimeout(() => loadInvoices(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const openCreateModal = async () => {
    setShowCreate(true);

    if (cases.length > 0) return;

    try {
      setCasesLoading(true);
      const all = await getAllCases();
      setCases(all);
    } catch (e: any) {
      setError(e?.message || 'Failed to load cases for invoice creation.');
    } finally {
      setCasesLoading(false);
    }
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();

    const amountNum = Number(String(newInvoice.amount).replace(/[^\d.]/g, ''));

    if (!newInvoice.caseId) {
      setError('Please select a case.');
      return;
    }
    if (!newInvoice.date) {
      setError('Please select an invoice date.');
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Please enter a valid amount.');
      return;
    }

    try {
      setError('');
      await addInvoiceToCase(newInvoice.caseId, {
        date: newInvoice.date,
        amount: amountNum,
        notes: newInvoice.notes || undefined,
      });

      setShowCreate(false);
      setNewInvoice({ caseId: '', date: '', amount: '', notes: '' });

      setPage(1);
      await loadInvoices();
    } catch (e: any) {
      setError(e?.message || 'Failed to create invoice.');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Paid':
        return 'bg-green-100 text-green-700';
      case 'Pending':
        return 'bg-yellow-100 text-yellow-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const totals = useMemo(() => {
    const totalAmount = invoices.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);
    const paidAmount = invoices
      .filter((i) => i.status === 'Paid')
      .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);
    const pendingAmount = invoices
      .filter((i) => i.status === 'Pending')
      .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);
    return { totalAmount, paidAmount, pendingAmount };
  }, [invoices]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(invoices.length / PAGE_SIZE));
  }, [invoices.length]);

  const paginatedInvoices = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return invoices.slice(start, start + PAGE_SIZE);
  }, [invoices, page]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  if (!canAccessBilling(userRole)) {
    return (
      <div className="p-6 bg-white border border-gray-200 rounded">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">You do not have permission to view billing.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">Invoice Management</h1>
            <p className="text-gray-600">Firm-wide invoice list and billing controls</p>
          </div>

          <button
            onClick={openCreateModal}
            className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Invoice
          </button>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by invoice number, notes"
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>

          <div className="flex gap-3">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="px-4 py-2 border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="all">All Status</option>
              <option value="Pending">Pending</option>
              <option value="Paid">Paid</option>
            </select>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded bg-white text-gray-700 hover:bg-gray-50"
              title="Quick export (print)"
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 border border-red-200 bg-red-50 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-600 mb-1">Total Amount</div>
          <div className="text-2xl font-semibold text-gray-900">{formatRwf(totals.totalAmount)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-600 mb-1">Paid</div>
          <div className="text-2xl font-semibold text-green-600">{formatRwf(totals.paidAmount)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-600 mb-1">Pending</div>
          <div className="text-2xl font-semibold text-yellow-600">{formatRwf(totals.pendingAmount)}</div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="px-5 py-10 text-gray-500">Loading invoices…</div>
        ) : invoices.length === 0 ? (
          <div className="px-5 py-10 text-gray-500">No invoices found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">#</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Invoice</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Case</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Amount</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Date</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Notes</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-200">
                {paginatedInvoices.map((inv, idx) => (
                  <tr key={inv._id} className="hover:bg-gray-50">
                    <td className="px-5 py-4 text-sm text-gray-500">
                      {(page - 1) * PAGE_SIZE + idx + 1}
                    </td>

                    <td className="px-5 py-4">
                      <p className="text-sm font-medium text-gray-900">{inv.invoiceNo}</p>
                      <p className="text-xs text-gray-500">ID: {String(inv._id).slice(-8)}</p>
                    </td>

                    <td className="px-5 py-4">
                      {inv.case ? (
                        <>
                          <p className="text-sm text-gray-900">{inv.case.caseNo}</p>
                          <p className="text-xs text-gray-500">{inv.case.parties}</p>
                        </>
                      ) : (
                        <p className="text-sm text-gray-500">—</p>
                      )}
                    </td>

                    <td className="px-5 py-4 text-sm font-semibold text-gray-900">
                      {formatRwf(Number(inv.amount) || 0)}
                    </td>

                    <td className="px-5 py-4">
                      <span className={`px-2 py-1 text-xs rounded ${getStatusColor(inv.status)}`}>
                        {inv.status}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <p className="text-sm text-gray-900">{inv.date}</p>
                    </td>

                    <td className="px-5 py-4">
                      <p className="text-sm text-gray-700">{inv.notes || '—'}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading && invoices.length > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, invoices.length)} of{' '}
            {invoices.length}
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-2 border border-gray-300 rounded bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Prev
            </button>

            <span className="text-sm text-gray-700">
              Page {page} of {totalPages}
            </span>

            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-2 border border-gray-300 rounded bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Create Invoice Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full">
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Create Invoice</h3>
              <p className="text-sm text-gray-500 mt-1">Choose a case, set date and amount.</p>
            </div>

            <form onSubmit={handleCreateInvoice} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Case *</label>
                <select
                  value={newInvoice.caseId}
                  onChange={(e) => setNewInvoice((p) => ({ ...p, caseId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  required
                >
                  <option value="">Select case</option>
                  {casesLoading ? (
                    <option value="" disabled>
                      Loading cases...
                    </option>
                  ) : (
                    cases.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.caseNo} • {c.parties}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input
                    type="date"
                    value={newInvoice.date}
                    onChange={(e) => setNewInvoice((p) => ({ ...p, date: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount (RWF) *</label>
                  <input
                    inputMode="numeric"
                    value={newInvoice.amount}
                    onChange={(e) => setNewInvoice((p) => ({ ...p, amount: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                    placeholder="100000"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={newInvoice.notes}
                  onChange={(e) => setNewInvoice((p) => ({ ...p, notes: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false);
                    setNewInvoice({ caseId: '', date: '', amount: '', notes: '' });
                  }}
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
    </div>
  );
}