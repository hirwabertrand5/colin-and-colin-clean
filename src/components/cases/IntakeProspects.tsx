import { useEffect, useState } from 'react';
import { Plus, Edit, Trash2, ArrowRight, CheckCircle, AlertCircle } from 'lucide-react';
import usePageTitle from '../../hooks/usePageTitle';
import { getAllProspects, getProspectStats, deleteProspect, convertProspectToMatter, Prospect } from '../../services/prospectService';
import ProspectForm from './ProspectForm';
import MatterLifecycle from './MatterLifecycle';

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

  const filteredProspects = filterStage 
    ? prospects.filter(p => p.stage === filterStage)
    : prospects;

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

        <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr] mb-8">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Focused intake workflow</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Use this board to move prospects from inquiry through engagement. Keep the form lean, prioritize next actions, and convert to a matter when the client is ready.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Quick tips</h3>
            <ul className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-400 list-disc list-inside">
              <li>Filter by stage to focus on the next step.</li>
              <li>Keep prospect details concise and actionable.</li>
              <li>Convert to active matter once the client signs.</li>
            </ul>
          </div>
        </div>

        <MatterLifecycle />

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 mb-8">
          {stageOrder.map((stage) => (
            <button
              key={stage}
              onClick={() => setFilterStage(filterStage === stage ? null : stage)}
              className={`p-4 rounded-lg border-2 transition-all cursor-pointer ${
                filterStage === stage
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-400'
              }`}
            >
              <div className="text-sm font-medium text-gray-600 dark:text-gray-400">{stage}</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {stats[stage] || 0}
              </div>
            </button>
          ))}
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Prospects Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
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
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Client</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Contact</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Service</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Stage</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Amount</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Actions</th>
                </tr>
              </thead>
                <tbody>
                  {filteredProspects.map((prospect) => (
                    <tr
                      key={prospect._id}
                      className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                        <div className="font-medium">{prospect.clientName}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{prospect.prospectNo}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        <div>{prospect.contact.name}</div>
                        <div className="text-xs">{prospect.contact.email}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {prospect.legalServicePath?.map((p) => p.label).join(' / ') || 'N/A'}
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
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {prospect.quotationAmount ? `$${prospect.quotationAmount.toLocaleString()}` : '-'}
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
