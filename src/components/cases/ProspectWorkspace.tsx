import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FileText, Receipt, ClipboardList, Briefcase, Circle, Trash2 } from 'lucide-react';
import usePageTitle from '../../hooks/usePageTitle';
import { deleteProspect, getProspectById, Prospect } from '../../services/prospectService';
import { getProspectFeedback, upsertProspectFeedback, ProspectFeedback as ProspectFeedbackModel } from '../../services/prospectFeedbackService';
import ProspectForm from './ProspectForm';

const STAGE_ORDER = [
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

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'billing', label: 'Billing / Triggers' },
  { id: 'feedback', label: 'Client Feedback' },
] as const;

type ProspectTab = (typeof TABS)[number]['id'];

const getCurrencySymbol = (currency?: string) => {
  switch (currency) {
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'CNY':
      return '¥';
    case 'INR':
      return '₹';
    default:
      return currency || 'RWF';
  }
};

const formatEstimatedValue = (prospect?: Prospect | null) => {
  if (!prospect?.estimatedMatterValue) return 'Not set';
  const currency = prospect.estimatedMatterCurrency || 'RWF';
  const symbol = getCurrencySymbol(currency);
  const formattedValue = prospect.estimatedMatterValue.toLocaleString();
  if (currency === 'RWF') return `${currency} ${formattedValue}`;
  return `${currency} ${symbol} ${formattedValue}`;
};

const getDisplayName = (value?: string | { name?: string } | null) => {
  if (typeof value === 'string') return value || '—';
  return value?.name || '—';
};

export default function ProspectWorkspace() {
  const { prospectId } = useParams();
  const navigate = useNavigate();
  usePageTitle('Prospect Workspace');

  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<ProspectTab>('overview');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<ProspectFeedbackModel | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({
    completedByRole: '',
    internalCategory: '',
    wasAvoidable: undefined as boolean | undefined,
    estimatedConversionProbability: '',
    firmImprovementNotes: '',
    partnerApprovalStatus: 'Pending' as 'Pending' | 'Approved',
  });
  const [feedbackSaving, setFeedbackSaving] = useState(false);

  const loadProspect = async () => {
    if (!prospectId) return;
    try {
      setLoading(true);
      setError('');
      const data = await getProspectById(prospectId);
      setProspect(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load prospect workspace');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProspect();
  }, [prospectId]);

  useEffect(() => {
    const loadFeedback = async () => {
      if (!prospectId) return;
      try {
        setFeedbackLoading(true);
        const data = await getProspectFeedback(prospectId);
        setFeedback(data);
        if (data) {
          setFeedbackForm({
            completedByRole: data.completedByRole || '',
            internalCategory: data.internalCategory || '',
            wasAvoidable: data.wasAvoidable,
            estimatedConversionProbability: data.estimatedConversionProbability || '',
            firmImprovementNotes: data.firmImprovementNotes || '',
            partnerApprovalStatus: data.partnerApprovalStatus || 'Pending',
          });
        }
      } catch (err) {
        console.error('Failed to load prospect feedback', err);
      } finally {
        setFeedbackLoading(false);
      }
    };

    loadFeedback();
  }, [prospectId]);

  const handleDelete = async () => {
    if (!prospectId) return;
    try {
      setDeleting(true);
      await deleteProspect(prospectId);
      navigate('/matters/intake-prospects');
    } catch (err: any) {
      setError(err?.message || 'Failed to delete prospect');
      setShowDeleteModal(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleEditClose = async () => {
    setShowEditForm(false);
    await loadProspect();
  };

  const stageIndex = useMemo(() => {
    if (!prospect?.stage) return -1;
    return STAGE_ORDER.indexOf(prospect.stage);
  }, [prospect?.stage]);

  const progressPercent = useMemo(() => {
    if (stageIndex < 0) return 0;
    const numerator = stageIndex + 1;
    return Math.round((numerator / STAGE_ORDER.length) * 100);
  }, [stageIndex]);

  const milestoneItems = useMemo(() => {
    const currentStage = prospect?.stage || 'Inquiry';
    return STAGE_ORDER.map((stage) => ({
      stage,
      completed: STAGE_ORDER.indexOf(stage) <= stageIndex,
      active: stage === currentStage,
    }));
  }, [prospect?.stage, stageIndex]);

  const currentStageLabel = prospect?.stage || 'Inquiry';

  const handleFeedbackSave = async () => {
    if (!prospectId) return;
    try {
      setFeedbackSaving(true);
      const data = await upsertProspectFeedback(prospectId, {
        ...feedbackForm,
        completedByRole: feedbackForm.completedByRole || undefined,
        internalCategory: feedbackForm.internalCategory || undefined,
        wasAvoidable: feedbackForm.wasAvoidable,
        estimatedConversionProbability: feedbackForm.estimatedConversionProbability || undefined,
        firmImprovementNotes: feedbackForm.firmImprovementNotes || undefined,
        partnerApprovalStatus: feedbackForm.partnerApprovalStatus,
      });
      setFeedback(data);
    } catch (err) {
      console.error('Failed to save prospect feedback', err);
    } finally {
      setFeedbackSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-20 pb-8 dark:bg-gray-900 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <Link to="/matters/intake-prospects" className="mb-6 inline-flex items-center text-sm font-medium text-gray-600 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Intake & Prospects
        </Link>

        {loading ? (
          <div className="rounded-3xl border border-gray-200 bg-white p-10 text-center text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            Loading prospect workspace...
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        ) : prospect ? (
          <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="border-b border-gray-200 bg-gray-50/70 p-6 dark:border-gray-700 dark:bg-gray-900/30">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.24em] text-gray-500 dark:text-gray-400">Prospect Workspace</p>
                  <h1 className="mt-2 text-3xl font-semibold text-gray-900 dark:text-gray-100">{prospect.clientName}</h1>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    {prospect.prospectNo} • {prospect.contact?.name || 'Contact pending'} • {prospect.contact?.email || 'No email on file'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDeleteModal(true)}
                    className="inline-flex items-center rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 dark:border-red-900 dark:bg-gray-800 dark:text-red-300 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEditForm(true)}
                    className="inline-flex items-center rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-gray-700 dark:bg-blue-600 dark:hover:bg-blue-500"
                  >
                    Edit Prospect
                  </button>
                </div>
              </div>

              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
                  <span>Milestone progress</span>
                  <span>{progressPercent}% complete</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div className="h-full rounded-full bg-gradient-to-r from-slate-900 to-blue-600 transition-all" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
                {TABS.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                        isActive
                          ? 'bg-gray-900 text-white shadow-sm dark:bg-gray-100 dark:text-gray-900'
                          : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-6">
              {activeTab === 'overview' && (
                <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-5 dark:border-gray-700 dark:bg-gray-900/40">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-blue-100 p-2 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        <ClipboardList className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Prospect overview</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">A condensed view of the intake journey and current next step.</p>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 lg:grid-cols-2">
                      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Client metrics</div>
                        <div className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-medium text-gray-500 dark:text-gray-400">Client name</span>
                            <span className="text-right font-semibold text-gray-900 dark:text-gray-100">{prospect.clientName || '—'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-medium text-gray-500 dark:text-gray-400">Contact person</span>
                            <span className="text-right font-semibold text-gray-900 dark:text-gray-100">{prospect.contact?.name || '—'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-medium text-gray-500 dark:text-gray-400">Parties</span>
                            <span className="text-right font-semibold text-gray-900 dark:text-gray-100">{prospect.parties || '—'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-medium text-gray-500 dark:text-gray-400">Email</span>
                            <span className="text-right font-semibold text-gray-900 dark:text-gray-100">{prospect.contact?.email || '—'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-medium text-gray-500 dark:text-gray-400">Telephone</span>
                            <span className="text-right font-semibold text-gray-900 dark:text-gray-100">{prospect.contact?.phone || '—'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Enquiry insights</div>
                        <div className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-medium text-gray-500 dark:text-gray-400">Nature</span>
                            <span className="text-right font-semibold text-gray-900 dark:text-gray-100">{prospect.enquiryNature || '—'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-medium text-gray-500 dark:text-gray-400">Source</span>
                            <span className="text-right font-semibold text-gray-900 dark:text-gray-100">{prospect.enquirySource || '—'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-medium text-gray-500 dark:text-gray-400">Referral</span>
                            <span className="text-right font-semibold text-gray-900 dark:text-gray-100">{prospect.referralSource || '—'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Assignment tracker</div>
                        <div className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-medium text-gray-500 dark:text-gray-400">Responsible partner</span>
                            <span className="text-right font-semibold text-gray-900 dark:text-gray-100">{getDisplayName(prospect.responsiblePartner)}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-medium text-gray-500 dark:text-gray-400">Responsible associate</span>
                            <span className="text-right font-semibold text-gray-900 dark:text-gray-100">{getDisplayName(prospect.responsibleAssociate || prospect.assignedTo)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Legal classification path</div>
                        <div className="mt-3 text-sm font-semibold leading-6 text-gray-900 dark:text-gray-100">
                          {prospect.legalServicePath?.map((item) => item.label).join(' / ') || 'Not selected'}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 space-y-2">
                      {milestoneItems.map((item) => (
                        <div
                          key={item.stage}
                          className={`flex items-start gap-3 rounded-2xl border px-3 py-3 ${
                            item.active
                              ? 'border-l-4 border-emerald-500 bg-slate-50 shadow-sm dark:bg-slate-800/50'
                              : item.completed
                                ? 'border-gray-200 bg-white text-slate-900 dark:border-gray-700 dark:bg-gray-800 dark:text-slate-100'
                                : 'border-dashed border-gray-200 bg-transparent text-slate-900 dark:border-gray-700 dark:text-slate-100'
                          }`}
                        >
                          {item.completed ? (
                            <CheckCircle2 className={`mt-0.5 h-5 w-5 ${item.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-green-600'}`} />
                          ) : (
                            <Circle className={`mt-0.5 h-5 w-5 ${item.active ? 'text-slate-400 dark:text-slate-500' : 'text-gray-400'}`} />
                          )}
                          <div>
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.stage}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {item.active ? 'Active milestone' : item.completed ? 'Completed' : 'Pending'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          <Receipt className="h-5 w-5" />
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Billing snapshot</h2>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Estimated value and trigger summary.</p>
                        </div>
                      </div>
                      <div className="mt-5 space-y-3 text-sm text-gray-700 dark:text-gray-300">
                        <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
                          <span>Estimated fee</span>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{formatEstimatedValue(prospect)}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
                          <span>Billing trigger</span>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{prospect.paymentArrangement || 'Not set'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl bg-green-100 p-2 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                          <Briefcase className="h-5 w-5" />
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Workflow status</h2>
                          <p className="text-sm text-gray-500 dark:text-gray-400">The next intake action is staged for the team.</p>
                        </div>
                      </div>
                      <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-900/40">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Active next step</div>
                        <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{currentStageLabel} is the current milestone in the intake journey.</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'billing' && (
                <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-6 dark:border-gray-700 dark:bg-gray-900/40">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        <Receipt className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Billing and triggers</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">The pricing structure and trigger milestones for this prospect.</p>
                      </div>
                    </div>

                    <div className="mt-6 space-y-4 text-sm text-gray-700 dark:text-gray-300">
                      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Estimated matter value</div>
                        <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{formatEstimatedValue(prospect)}</div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Billing triggers</div>
                          <div className="mt-2 font-semibold text-gray-900 dark:text-gray-100">{prospect.paymentArrangement || 'Not set'}</div>
                        </div>
                        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Payment method</div>
                          <div className="mt-2 font-semibold text-gray-900 dark:text-gray-100">{prospect.paymentMethod || 'Not set'}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                    <div className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Structural milestones</div>
                    <div className="mt-4 space-y-3">
                      {milestoneItems.filter((item) => item.completed || item.active).map((item) => (
                        <div key={item.stage} className="rounded-2xl border border-gray-200 bg-gray-50/70 px-3 py-3 dark:border-gray-700 dark:bg-gray-900/40">
                          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item.stage}</div>
                          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{item.active ? 'Active milestone' : 'Completed'} </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'feedback' && (
                <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-6 dark:border-gray-700 dark:bg-gray-900/40">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-blue-100 p-2 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Client response view</h2>
                        <p className="text-sm text-slate-600 dark:text-slate-400">A read-only summary of the client’s feedback submission.</p>
                      </div>
                    </div>

                    {feedbackLoading ? (
                      <div className="mt-5 rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-sm font-medium text-slate-600 dark:border-gray-700 dark:bg-gray-800 dark:text-slate-400">
                        Loading client feedback status...
                      </div>
                    ) : feedback?.primaryReasonCategory || feedback?.primaryReasonDetail || feedback?.clientComment ? (
                      <div className="mt-5 space-y-3 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-slate-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-slate-300">
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-medium text-slate-500 dark:text-slate-400">Primary reason category</span>
                          <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{feedback?.primaryReasonCategory || '—'}</span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-medium text-slate-500 dark:text-slate-400">Reason detail</span>
                          <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{feedback?.primaryReasonDetail || '—'}</span>
                        </div>
                        <div>
                          <div className="font-medium text-slate-500 dark:text-slate-400">Client comment</div>
                          <div className="mt-2 rounded-xl bg-slate-50 p-3 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300">{feedback?.clientComment || 'No comment provided.'}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-5 rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-sm font-medium text-slate-600 dark:border-gray-700 dark:bg-gray-800 dark:text-slate-400">
                        Awaiting External Client Survey Response (Google Form)...
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        <ClipboardList className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Internal management assessment</h2>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Use this layer to document the internal review and partner approval.</p>
                      </div>
                    </div>

                    {prospect?.isActive !== false ? (
                      <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300">
                        Feedback portal triggers automatically when a prospect is marked as Non-Converted.
                      </div>
                    ) : null}

                    <div className="mt-5 space-y-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Completed by</label>
                        <select value={feedbackForm.completedByRole} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, completedByRole: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                          <option value="">Select role</option>
                          <option value="Executive Administrator">Executive Administrator</option>
                          <option value="Responsible Associate">Responsible Associate</option>
                          <option value="Responsible Partner">Responsible Partner</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Category</label>
                        <select value={feedbackForm.internalCategory} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, internalCategory: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                          <option value="">Select category</option>
                          <option value="Pricing & Commercial Issues">Pricing & Commercial Issues</option>
                          <option value="Response & Service Issues">Response & Service Issues</option>
                          <option value="Scope & Service Issues">Scope & Service Issues</option>
                          <option value="Client Decision Issues">Client Decision Issues</option>
                          <option value="Competitive Issues">Competitive Issues</option>
                          <option value="Internal Firm Constraints">Internal Firm Constraints</option>
                          <option value="Client Experience Issues">Client Experience Issues</option>
                          <option value="Administrative Issues">Administrative Issues</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Was this loss avoidable?</label>
                        <div className="flex gap-3">
                          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                            <input type="radio" checked={feedbackForm.wasAvoidable === true} onChange={() => setFeedbackForm((prev) => ({ ...prev, wasAvoidable: true }))} /> Yes
                          </label>
                          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                            <input type="radio" checked={feedbackForm.wasAvoidable === false} onChange={() => setFeedbackForm((prev) => ({ ...prev, wasAvoidable: false }))} /> No
                          </label>
                        </div>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Estimated probability of conversion</label>
                        <input value={feedbackForm.estimatedConversionProbability} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, estimatedConversionProbability: event.target.value }))} placeholder="e.g. 45%" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">What should the firm improve?</label>
                        <textarea value={feedbackForm.firmImprovementNotes} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, firmImprovementNotes: event.target.value }))} rows={4} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                      </div>

                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Partner approval</div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Required before the prospect can be formally closed as a non-converted history record.</div>
                          </div>
                          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{feedbackForm.partnerApprovalStatus}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => setFeedbackForm((prev) => ({ ...prev, partnerApprovalStatus: 'Approved' }))} className="rounded-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Mark approved</button>
                          <button type="button" onClick={() => setFeedbackForm((prev) => ({ ...prev, partnerApprovalStatus: 'Pending' }))} className="rounded-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Keep pending</button>
                          <button type="button" onClick={() => { setFeedbackForm((prev) => ({ ...prev, partnerApprovalStatus: 'Approved' })); void handleFeedbackSave(); }} disabled={feedbackSaving} className="rounded-full bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300">
                            {feedbackSaving ? 'Saving...' : 'Approve & Close Prospect'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {showDeleteModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/60 p-4">
            <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-800">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Delete prospect?</h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                This will remove the prospect record from the intake list. This action cannot be undone.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deleting ? 'Deleting...' : 'Delete Prospect'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showEditForm && prospect && (
          <ProspectForm prospect={prospect} onClose={handleEditClose} layout="side-over" />
        )}
      </div>
    </div>
  );
}
