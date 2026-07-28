import { useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import usePageTitle from '../../hooks/usePageTitle';
import { getAllProspects, getProspectStats, deleteProspect, convertProspectToMatter, Prospect } from '../../services/prospectService';
import ProspectForm from './ProspectForm';

const ADMIN_ROLES = ['managing_director', 'managing_partner', 'senior_partner', 'partner', 'associate_partner'];

const getErrorMessage = (error: any, fallback: string) =>
  error?.response?.data?.message || error?.message || fallback;

export default function IntakeProspects() {
  usePageTitle('Intake & Prospects');
  const PROSPECTS_PER_PAGE = 10;
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null);
  const [filterStage, setFilterStage] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const currentRole = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}')?.role as string | undefined;
    } catch {
      return undefined;
    }
  })();
  const canUseAdminActions = currentRole ? ADMIN_ROLES.includes(currentRole) : false;

  const stageOrder = [
    'Inquiry',
    'Consultation',
    'Conflict Check',
    'Quotation',
    'Quotation Preparation',
    'Conversion Assessment',
    'Quotation Issued',
    'Awaiting Client Decision',
    'Final Follow-Up',
    'Engagement',
  ];

  useEffect(() => {
    loadData();
  }, [filterStage]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [prospectsData, statsData] = await Promise.all([
        getAllProspects(filterStage ? { stage: filterStage } : { isActive: true }),
        getProspectStats(),
      ]);
      setProspects(prospectsData);
      setStats(statsData);
      setError('');
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to load prospects'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this prospect?')) return;
    try {
      await deleteProspect(id);
      await loadData();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to delete prospect'));
    }
  };

  const handleConvert = async (prospect: Prospect) => {
    if (normalizeStage(prospect.stage) !== 'converted') return;
    if (!window.confirm(`Create a matter from "${prospect.clientName}"?`)) return;
    try {
      await convertProspectToMatter(prospect._id);
      setError('');
      await loadData();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to convert prospect to matter'));
    }
  };

  const handleFormClose = () => {
    setShowForm(false);
    setSelectedProspect(null);
    loadData();
  };

  const filteredProspects = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    return (filterStage ? prospects.filter((p) => p.stage === filterStage) : prospects)
      .filter((prospect) => {
        if (!q) return true;

        const searchBits = [
          prospect.prospectNo,
          prospect.clientName,
          prospect.parties,
          prospect.contact.name,
          prospect.contact.email,
          prospect.contact.phone,
          prospect.enquiryNature,
          prospect.enquirySource,
          prospect.referralSource,
          prospect.inquiryDescription,
          prospect.stage,
          prospect.practiceArea,
          Array.isArray(prospect.subPracticeActions) ? prospect.subPracticeActions.join(' ') : '',
          prospect.paymentArrangement,
          prospect.paymentMethod,
          prospect.installmentCount,
          prospect.depositAmount,
          prospect.responsiblePartner,
          prospect.responsibleAssociate,
        ]
          .map((value) => (typeof value === 'string' ? value : value?.name || ''))
          .join(' ')
          .toLowerCase();

        return searchBits.includes(q);
      })
      .slice()
      .sort((a, b) => {
        const stageDiff = stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage);
        if (stageDiff !== 0) return stageDiff;
        return new Date(b.dateReceived || b.createdAt).getTime() - new Date(a.dateReceived || a.createdAt).getTime();
      });
  }, [filterStage, prospects, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredProspects.length / PROSPECTS_PER_PAGE));
  const paginatedProspects = useMemo(
    () => filteredProspects.slice((currentPage - 1) * PROSPECTS_PER_PAGE, currentPage * PROSPECTS_PER_PAGE),
    [currentPage, filteredProspects]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filterStage, searchTerm]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const getUserName = (value?: string | { name?: string } | null) =>
    typeof value === 'string' ? value : value?.name || '—';

  const normalizeStage = (stage?: string) => String(stage || '').trim().toLowerCase().replace(/-/g, ' ');

  const getOutcomeBadgeClass = (stage: Prospect['stage']) =>
    normalizeStage(stage) === 'converted'
      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
      : normalizeStage(stage) === 'non converted'
      ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
      : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';

  const getPracticeAreaLabel = (prospect: Prospect) =>
    prospect.practiceArea || (normalizeStage(prospect.stage) === 'converted' ? 'Converted' : normalizeStage(prospect.stage) === 'non converted' ? 'Non Converted' : 'Not selected');

  const getSubPracticeActionsLabel = (prospect: Prospect) => {
    if (Array.isArray(prospect.subPracticeActions) && prospect.subPracticeActions.length > 0) {
      return prospect.subPracticeActions.join(' • ');
    }
    return 'Not selected';
  };

  const getPaymentSummary = (prospect: Prospect) => {
    const parts = [];
    if (prospect.paymentArrangement) parts.push(prospect.paymentArrangement);
    if (prospect.paymentMethod) parts.push(prospect.paymentMethod);
    if (prospect.paymentArrangement === 'Installments' && prospect.installmentCount) {
      parts.push(`${prospect.installmentCount} installments`);
    }
    if (typeof prospect.depositAmount === 'number' && Number.isFinite(prospect.depositAmount)) {
      parts.push(`Deposit ${prospect.depositAmount.toLocaleString()}`);
    }
    return parts.length ? parts.join(' • ') : 'Not set';
  };

  const formatMoney = (value?: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : null;

  const formatEstimatedValue = (prospect: Prospect) => {
    const money = formatMoney(prospect.estimatedMatterValue);
    if (!money) return 'Not set';
    return `${prospect.estimatedMatterCurrency || 'RWF'} ${money}`;
  };

  const getLegalClassificationLabel = (prospect: Prospect) =>
    prospect.legalServicePath?.map((item) => item.label).join(' / ') || 'Not selected';

  const getCurrentStageLabel = (prospect: Prospect) => prospect.stage || 'Inquiry';

  const pageNumbers = useMemo(() => {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }, [totalPages]);

  const getActionButton = (prospect: Prospect) => (
    <Link
      to={`/matters/intake-prospects/${prospect._id}`}
      className="text-sm font-semibold text-gray-700 transition hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
    >
      Open →
    </Link>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pt-20 pb-8">
      <div className="max-w-7xl mx-auto px-4 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Intake & Prospects</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 max-w-2xl">
              Manage incoming prospects with a simplified workflow. Capture only essential intake details and convert clients to Active Matters at the right stage.
            </p>
          </div>
          <button
            onClick={() => {
              setSelectedProspect(null);
              setShowForm(true);
            }}
            className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            <Plus className="w-5 h-5 mr-2" />
            New Prospect
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Prospects Table */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="flex flex-col gap-3 border-b border-gray-200 px-6 py-4 dark:border-gray-700 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Prospects</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {filterStage
                  ? `${filteredProspects.length} ${filterStage} prospects`
                  : `${filteredProspects.length} active prospects`}
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row lg:items-center">
              <div className="relative w-full lg:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                <input
                  type="text"
                  placeholder="Search by prospect, party, contact..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>

              <select
                value={filterStage || ''}
                onChange={(e) => setFilterStage(e.target.value || null)}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 lg:w-80"
              >
                <option value="">All stages</option>
                {stageOrder.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage} ({stats[stage] || 0})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="p-10 text-center text-gray-500 dark:text-gray-400">Loading prospects...</div>
          ) : filteredProspects.length === 0 ? (
            <div className="p-10 text-center text-gray-500 dark:text-gray-400">
              {searchTerm && filterStage
                ? `No ${filterStage} prospects match your search`
                : searchTerm
                  ? 'No prospects match your search'
                  : filterStage
                    ? `No ${filterStage} prospects`
                    : 'No prospects found'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1200px] w-full">
                <thead className="bg-gray-50/80 dark:bg-gray-900/60">
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="w-16 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">#</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Prospect Name</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Contact Person</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Legal Classification</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Estimated Fee Value</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Current Stage</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {paginatedProspects.map((prospect, index) => (
                    <tr key={prospect._id} className="align-top transition-colors hover:bg-gray-50/70 dark:hover:bg-gray-700/40">
                      <td className="px-4 py-4 text-sm font-semibold text-gray-500 dark:text-gray-400">
                        {(currentPage - 1) * PROSPECTS_PER_PAGE + index + 1}
                      </td>
                      <td className="px-5 py-4">
                        <div className="space-y-1">
                          <div className="font-semibold text-gray-900 dark:text-gray-100">{prospect.clientName}</div>
                          <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{prospect.prospectNo}</div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300">{prospect.contact?.name || '—'}</td>
                      <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300">{getLegalClassificationLabel(prospect)}</td>
                      <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300">{formatEstimatedValue(prospect)}</td>
                      <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300">{getCurrentStageLabel(prospect)}</td>
                      <td className="px-5 py-4">{getActionButton(prospect)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {filteredProspects.length > 0 && (
            <div className="flex flex-col gap-4 border-t border-gray-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Showing {(currentPage - 1) * PROSPECTS_PER_PAGE + 1}-
                {Math.min(currentPage * PROSPECTS_PER_PAGE, filteredProspects.length)} of {filteredProspects.length} prospects
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  Previous
                </button>
                {pageNumbers.map((page) => (
                  <button
                    key={page}
                    type="button"
                    onClick={() => setCurrentPage(page)}
                    className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                      page === currentPage
                        ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Prospect Form Modal */}
      {showForm && (
        <ProspectForm prospect={selectedProspect} onClose={handleFormClose} />
      )}
    </div>
  );
}
