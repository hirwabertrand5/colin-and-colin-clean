import { useEffect, useState } from 'react';
import { Plus, Edit, Trash2, ArrowRight } from 'lucide-react';
import usePageTitle from '../../hooks/usePageTitle';
import { getAllProspects, getProspectStats, deleteProspect, convertProspectToMatter, Prospect } from '../../services/prospectService';
import ProspectForm from './ProspectForm';

const ADMIN_ROLES = ['managing_director', 'managing_partner', 'senior_partner', 'partner', 'associate_partner'];

const getErrorMessage = (error: any, fallback: string) =>
  error?.response?.data?.message || error?.message || fallback;

export default function IntakeProspects() {
  usePageTitle('Intake & Prospects');
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null);
  const [filterStage, setFilterStage] = useState<string | null>(null);
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
    'Converted',
    'Non-Converted',
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
    if (prospect.stage !== 'Converted') return;
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

  const filteredProspects = (filterStage 
    ? prospects.filter(p => p.stage === filterStage)
    : prospects
  ).slice().sort((a, b) => {
    const stageDiff = stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage);
    if (stageDiff !== 0) return stageDiff;
    return new Date(b.dateReceived || b.createdAt).getTime() - new Date(a.dateReceived || a.createdAt).getTime();
  });

  const getUserName = (value?: string | { name?: string } | null) =>
    typeof value === 'string' ? value : value?.name || '—';

  const getOutcomeBadgeClass = (stage: Prospect['stage']) =>
    stage === 'Converted'
      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
      : stage === 'Non-Converted'
      ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
      : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';

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
          <div className="flex flex-col gap-3 border-b border-gray-200 px-6 py-4 dark:border-gray-700 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Prospects</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {filterStage
                  ? `${stats[filterStage] || filteredProspects.length} ${filterStage} prospects`
                  : `${filteredProspects.length} active prospects`}
              </p>
            </div>
            <select
              value={filterStage || ''}
              onChange={(e) => setFilterStage(e.target.value || null)}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 md:w-80"
            >
              <option value="">All stages</option>
              {stageOrder.map((stage) => (
                <option key={stage} value={stage}>
                  {stage} ({stats[stage] || 0})
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="p-10 text-center text-gray-500 dark:text-gray-400">Loading prospects...</div>
          ) : filteredProspects.length === 0 ? (
            <div className="p-10 text-center text-gray-500 dark:text-gray-400">
              {filterStage ? `No ${filterStage} prospects` : 'No prospects found'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1480px] w-full table-fixed">
                <thead className="bg-gray-50/80 dark:bg-gray-900/60">
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="w-20 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">#</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Prospect</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Contact</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Matter</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Enquiry</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Stage</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Ownership</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredProspects.map((prospect, index) => {
                    const contactBits = [
                      prospect.contact.email,
                      prospect.contact.phone,
                    ].filter(Boolean);
                    const partnerName = getUserName(prospect.responsiblePartner);
                    const associateName = getUserName(prospect.responsibleAssociate || prospect.assignedTo);

                    return (
                      <tr key={prospect._id} className="align-top transition-colors hover:bg-gray-50/70 dark:hover:bg-gray-700/40">
                        <td className="px-4 py-4 text-sm font-semibold text-gray-500 dark:text-gray-400">
                          {index + 1}
                        </td>
                        <td className="px-5 py-4">
                          <div className="space-y-1">
                            <div className="font-semibold text-gray-900 dark:text-gray-100">{prospect.clientName}</div>
                            <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                              {prospect.prospectNo}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              Received {new Date(prospect.dateReceived || prospect.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
                            <div className="font-medium text-gray-900 dark:text-gray-100">{prospect.contact.name || '—'}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {contactBits.length ? contactBits.join(' • ') : 'No contact details provided'}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                            <div className="line-clamp-2">{prospect.legalServicePath?.map((p) => p.label).join(' / ') || 'N/A'}</div>
                            {(prospect.estimatedMatterValue || prospect.estimatedFeeValue) && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {prospect.estimatedMatterValue ? `Matter ${prospect.estimatedMatterValue}` : ''}
                                {prospect.estimatedMatterValue && prospect.estimatedFeeValue ? ' • ' : ''}
                                {prospect.estimatedFeeValue ? `Fee ${prospect.estimatedFeeValue}` : ''}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                            <div className="line-clamp-3">{prospect.inquiryDescription || '—'}</div>
                            {(prospect.enquiryNature || prospect.enquirySource || prospect.referralSource) && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {prospect.enquiryNature ? `${prospect.enquiryNature}` : ''}
                                {prospect.enquiryNature && (prospect.enquirySource || prospect.referralSource) ? ' • ' : ''}
                                {prospect.enquirySource ? `${prospect.enquirySource}` : ''}
                                {prospect.enquirySource && prospect.referralSource ? ' • ' : ''}
                                {prospect.referralSource ? `${prospect.referralSource}` : ''}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="space-y-2">
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getOutcomeBadgeClass(prospect.stage)}`}
                            >
                              {prospect.stage}
                            </span>
                            {prospect.conversionOutcome && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {prospect.conversionOutcome}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
                            <div>
                              <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Partner</span>
                              <p className="font-medium text-gray-900 dark:text-gray-100">{partnerName}</p>
                            </div>
                            <div>
                              <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Associate</span>
                              <p className="font-medium text-gray-900 dark:text-gray-100">{associateName}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap gap-2">
                            {prospect.stage !== 'Converted' && prospect.stage !== 'Non-Converted' && (
                              <button
                                onClick={() => {
                                  setSelectedProspect(prospect);
                                  setShowForm(true);
                                }}
                                className="inline-flex items-center rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-900/20"
                                title="Edit"
                              >
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                              </button>
                            )}
                            {canUseAdminActions && prospect.stage === 'Converted' && !prospect.convertedToMatters && (
                              <button
                                onClick={() => handleConvert(prospect)}
                                className="inline-flex items-center rounded-lg border border-green-200 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50 dark:border-green-900 dark:text-green-300 dark:hover:bg-green-900/20"
                                title="Create Matter"
                              >
                                <ArrowRight className="mr-2 h-4 w-4" />
                                Convert
                              </button>
                            )}
                            {canUseAdminActions && prospect.stage !== 'Converted' && (
                              <button
                                onClick={() => handleDelete(prospect._id)}
                                className="inline-flex items-center rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-900/20"
                                title="Delete"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
