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

  const stageOrder = ['Inquiry', 'Consultation', 'Conflict Check', 'Quotation', 'Engagement', 'Converted', 'Non-Converted'];

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
    if (!window.confirm(`Convert "${prospect.clientName}" to active matter?`)) return;
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

  const getAssignedName = (assignedTo: Prospect['assignedTo']) =>
    typeof assignedTo === 'string' ? assignedTo : assignedTo?.name || '—';

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
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="flex flex-col gap-3 border-b border-gray-200 px-6 py-4 dark:border-gray-700 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Prospects</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {filterStage ? `${stats[filterStage] || filteredProspects.length} ${filterStage} prospects` : `${filteredProspects.length} active prospects`}
              </p>
            </div>
            <select
              value={filterStage || ''}
              onChange={(e) => setFilterStage(e.target.value || null)}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 md:w-64"
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
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading prospects...</div>
          ) : filteredProspects.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              {filterStage ? `No ${filterStage} prospects` : 'No prospects found'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">No.</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Client</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Email</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Phone</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Service</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Inquiry</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Stage</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Assigned To</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Notes</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Actions</th>
                </tr>
              </thead>
                <tbody>
                  {filteredProspects.map((prospect, index) => (
                    <tr
                      key={prospect._id}
                      className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      <td className="px-6 py-4 text-sm font-medium text-gray-700 dark:text-gray-300">{index + 1}</td>
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                        <div className="font-medium">{prospect.clientName}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{prospect.prospectNo}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {prospect.contact.email || '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {prospect.contact.phone || '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {prospect.legalServicePath?.map((p) => p.label).join(' / ') || 'N/A'}
                      </td>
                      <td className="max-w-xs px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        <div className="line-clamp-2">{prospect.inquiryDescription || '—'}</div>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            prospect.stage === 'Converted'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                              : prospect.stage === 'Non-Converted'
                              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                              : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                          }`}
                        >
                          {prospect.stage}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{getAssignedName(prospect.assignedTo)}</td>
                      <td className="max-w-xs px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        <div className="line-clamp-2">{prospect.engagementNotes || '—'}</div>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex gap-2">
                          {prospect.stage !== 'Converted' && prospect.stage !== 'Non-Converted' && (
                            <button
                              onClick={() => {
                                setSelectedProspect(prospect);
                                setShowForm(true);
                              }}
                              className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                              title="Edit"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                          )}
                          {canUseAdminActions && prospect.stage === 'Engagement' && (
                            <button
                              onClick={() => handleConvert(prospect)}
                              className="p-2 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                              title="Convert to Matter"
                            >
                              <ArrowRight className="w-4 h-4" />
                            </button>
                          )}
                          {canUseAdminActions && prospect.stage !== 'Converted' && (
                            <button
                              onClick={() => handleDelete(prospect._id)}
                              className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
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
