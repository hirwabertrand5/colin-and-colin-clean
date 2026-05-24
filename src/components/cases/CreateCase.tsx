import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { createCase, CaseData, CaseType } from '../../services/caseService';
import { listActiveWorkflowTemplates, WorkflowTemplate } from '../../services/workflowService';
import { LEGAL_SERVICES_TREE, ServiceNode } from '../../constants/legalServicesTree';

type StaffUser = {
  _id: string;
  name: string;
  email: string;
  role: string;
};

const API_URL = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:5000/api';
const getToken = () => localStorage.getItem('token');

const SERVICE_LEVEL_LABELS = ['Legal Service', 'Category', 'Practice Area', 'Service Line', 'Sub-category', 'Detail'];
const CREATE_CASE_DRAFT_KEY = 'createCaseDraft:v1';

export default function CreateCase() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateManuallySelected, setTemplateManuallySelected] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [draftNotice, setDraftNotice] = useState<string>('');

  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);

  const [servicePath, setServicePath] = useState<string[]>([]);

  const [formData, setFormData] = useState<CaseData>({
    caseNo: '',
    parties: '',
    // ✅ will be auto-set by decision tree
    caseType: 'Transactional Cases' as CaseType,
    status: 'On Boarding',
    priority: 'Medium',
    assignedTo: '',
    description: '',
    legalServicePath: [],
    workflow: '',
    estimatedDuration: '',
    budget: '',
    workflowTemplateId: '',
    workflowStartDate: new Date().toISOString().slice(0, 10),

    billingSettings: {
      paymentMode: 'postpaid',
      currency: 'RWF',
      prepaidTotal: 0,
      prepaidRemaining: 0,
      accruedUnbilled: 0,
    },
  });

  const statuses = [
    'On Boarding',
    'Under Submission',
    'Pre trial',
    'Mediation',
    'Hearing',
    'Appeal',
    'Pronouncement',
    'Cope of Judgement',
    'Execution',
  ];

  // Load draft (local-only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CREATE_CASE_DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.formData) setFormData((prev) => ({ ...prev, ...parsed.formData }));
      if (Array.isArray(parsed?.servicePath)) setServicePath(parsed.servicePath);
      if (typeof parsed?.step === 'number') setStep(parsed.step);
      setDraftNotice('Loaded your saved draft.');
      setTimeout(() => setDraftNotice(''), 2500);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveDraft = () => {
    try {
      localStorage.setItem(
        CREATE_CASE_DRAFT_KEY,
        JSON.stringify({
          step,
          servicePath,
          formData,
          savedAt: new Date().toISOString(),
        })
      );
      setDraftNotice('Draft saved on this device.');
      setTimeout(() => setDraftNotice(''), 2500);
    } catch {
      setDraftNotice('Failed to save draft.');
      setTimeout(() => setDraftNotice(''), 2500);
    }
  };

  useEffect(() => {
    const fetchStaff = async () => {
      setLoadingStaff(true);
      try {
        const res = await fetch(`${API_URL}/users/staff`, {
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        });

        if (res.status === 401) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          window.location.href = '/login';
          return;
        }

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Failed to fetch staff users (${res.status}): ${text}`);
        }

        const data: StaffUser[] = await res.json();
        setStaffUsers(data);
      } catch (e: any) {
        setError(e.message || 'Failed to load staff');
      } finally {
        setLoadingStaff(false);
      }
    };

    fetchStaff();
  }, []);

  useEffect(() => {
    const fetchTemplates = async () => {
      setTemplatesLoading(true);
      try {
        const data = await listActiveWorkflowTemplates();
        setTemplates(data);
      } catch (e: any) {
        setError(e.message || 'Failed to load workflow templates');
      } finally {
        setTemplatesLoading(false);
      }
    };
    fetchTemplates();
  }, []);

  const handleInputChange = (field: string, value: any) => {
    setFormData({ ...formData, [field]: value });
  };

  // -------------------------
  // Decision Tree helpers
  // -------------------------
  const findNode = (nodes: ServiceNode[], id: string) => nodes.find((node) => node.id === id);

  const selectedServiceNodes = useMemo(() => {
    const nodes: ServiceNode[] = [];
    let currentNodes = LEGAL_SERVICES_TREE;

    for (const id of servicePath) {
      const match = findNode(currentNodes, id);
      if (!match) break;
      nodes.push(match);
      currentNodes = match.children || [];
    }

    return nodes;
  }, [servicePath]);

  const serviceLevels = useMemo(() => {
    const levels: Array<{
      label: string;
      options: ServiceNode[];
      value: string;
      placeholder: string;
    }> = [];

    let currentOptions = LEGAL_SERVICES_TREE;
    let depth = 0;

    while (currentOptions.length > 0) {
      levels.push({
        label: SERVICE_LEVEL_LABELS[depth] || `Level ${depth + 1}`,
        options: currentOptions,
        value: servicePath[depth] || '',
        placeholder: depth === 0 ? 'Select...' : `Select ${SERVICE_LEVEL_LABELS[depth - 1].toLowerCase()} first`,
      });

      const selectedNode = servicePath[depth] ? findNode(currentOptions, servicePath[depth]) : undefined;
      if (!selectedNode?.children?.length) break;

      currentOptions = selectedNode.children;
      depth += 1;
    }

    return levels;
  }, [servicePath]);

  const updateServicePathAtLevel = (levelIndex: number, value: string) => {
    setServicePath((prev) => {
      const next = prev.slice(0, levelIndex);
      if (value) next[levelIndex] = value;
      return next;
    });
  };

  const resolveCaseTypeFromSelection = (nodes: ServiceNode[]): CaseType | null => {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      if (nodes[i].caseType) return nodes[i].caseType as CaseType;
    }
    return null;
  };

  const resolveSuggestedMatterType = (nodes: ServiceNode[]): string | null => {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const suggested = nodes[i].suggestedMatterTypes?.[0];
      if (suggested) return suggested;
    }
    return null;
  };

  // Keep formData.caseType always in sync with tree selection
  useEffect(() => {
    const ct = resolveCaseTypeFromSelection(selectedServiceNodes);
    const suggested = resolveSuggestedMatterType(selectedServiceNodes);
    const legalServicePath = selectedServiceNodes.map((node) => ({ id: node.id, label: node.label }));

    setFormData((prev) => ({
      ...prev,
      caseType: ct || prev.caseType,
      workflow: suggested || prev.workflow,
      legalServicePath,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServiceNodes]);

  const computedCaseType = useMemo(
    () => resolveCaseTypeFromSelection(selectedServiceNodes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedServiceNodes]
  );

  const selectedServicePathLabel = useMemo(
    () => selectedServiceNodes.map((node) => node.label).join(' -> '),
    [selectedServiceNodes]
  );

  const isServiceSelectionValid = () => {
    // Require at least a selection that yields a caseType
    return Boolean(computedCaseType);
  };

  const handleNext = () => {
    if (step < 3) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      // final safety: ensure caseType set
      if (!formData.caseType) {
        throw new Error('Missing case type. Please complete Legal Service classification.');
      }
      if (!formData.workflowTemplateId) {
        throw new Error('Missing workflow template. Please select a workflow template.');
      }

      await createCase(formData);
      setSuccess('Case created successfully!');
      setTimeout(() => navigate('/cases'), 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to create case');
    } finally {
      setLoading(false);
    }
  };

  const canProceed = () => {
    if (step === 1) {
      return Boolean(formData.caseNo && formData.parties && formData.assignedTo && isServiceSelectionValid());
    }
    if (step === 2) {
      return Boolean(formData.workflowTemplateId && formData.workflowStartDate);
    }
    return true;
  };

  const selectedWorkflowTemplate = useMemo(
    () => templates.find((t) => t._id === formData.workflowTemplateId),
    [formData.workflowTemplateId, templates]
  );

  // Auto-select a workflow template when the service-line decision tree suggests a matter type.
  useEffect(() => {
    if (templatesLoading) return;
    if (templateManuallySelected) return;

    const suggested = resolveSuggestedMatterType(selectedServiceNodes);
    const ct = resolveCaseTypeFromSelection(selectedServiceNodes);

    if (!suggested || !ct) return;
    const match = templates.find((t) => t.matterType === suggested && t.caseType === ct);
    if (!match) return;

    setFormData((prev) => ({
      ...prev,
      workflowTemplateId: match._id,
      caseType: match.caseType as CaseType,
      workflow: match.matterType,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServiceNodes, templates, templatesLoading, templateManuallySelected]);

  const toMinutesFromSla = (sla: any): number => {
    if (!sla) return 0;
    const unit = sla.unit;
    const value = typeof sla.max === 'number' ? sla.max : typeof sla.min === 'number' ? sla.min : undefined;
    if (typeof value === 'number' && unit) {
      if (unit === 'hours') return Math.round(value * 60);
      if (unit === 'days') return Math.round(value * 24 * 60);
      if (unit === 'weeks') return Math.round(value * 7 * 24 * 60);
    }
    const text = String(sla.text || '').toLowerCase().trim();
    if (!text) return 0;
    if (/^\\d+(\\.\\d+)?$/.test(text)) return Math.round(Number(text) * 60);

    let total = 0;
    const re = /(\\d+(\\.\\d+)?)\\s*(weeks?|w|days?|d|hours?|hrs?|hr|h)\\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const n = Number(m[1]);
      const u = m[3];
      if (!Number.isFinite(n)) continue;
      if (u === 'week' || u === 'weeks' || u === 'w') total += n * 7 * 24 * 60;
      else if (u === 'day' || u === 'days' || u === 'd') total += n * 24 * 60;
      else total += n * 60;
    }
    return Math.max(0, Math.round(total));
  };

  const formatCurrency = (amount?: number, currency?: string) => {
    if (typeof amount !== 'number' || Number.isNaN(amount)) return '—';
    return `${currency || 'RWF'} ${amount.toLocaleString()}`;
  };

  const formatRelativeDue = (date?: Date) => {
    if (!date) return 'TBD';
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return `${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} overdue`;
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
  };

  const getUrgencyStyle = (date?: Date) => {
    if (!date) return 'bg-gray-100 text-gray-700';
    const hoursRemaining = (date.getTime() - new Date().getTime()) / (1000 * 60 * 60);
    if (hoursRemaining <= 48) return 'bg-red-100 text-red-700';
    if (hoursRemaining <= 120) return 'bg-orange-100 text-orange-700';
    return 'bg-green-100 text-green-700';
  };

  const selectedWorkflowSteps = useMemo(() => {
    if (!selectedWorkflowTemplate || !formData.workflowStartDate) return [];

    const stages: Array<{ key: string; title: string }> = Array.isArray(
      (selectedWorkflowTemplate as any).stages
    )
      ? (selectedWorkflowTemplate as any).stages
      : [];
    const stageTitleByKey = new Map(stages.map((s) => [s.key, s.title]));

    const steps = Array.isArray((selectedWorkflowTemplate as any).steps)
      ? [...(selectedWorkflowTemplate as any).steps].sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
      : [];

    const start = new Date(`${formData.workflowStartDate}T00:00:00`);
    let cursor = new Date(start);

    return steps.map((s: any, index: number) => {
      const minutes = toMinutesFromSla(s.sla);
      const stepStart = new Date(cursor);
      const dueAt = new Date(stepStart.getTime() + minutes * 60_000);
      cursor = new Date(dueAt);

      const feeAmount = typeof s?.fee?.min === 'number' ? s.fee.min : undefined;
      const feeCurrency = s?.fee?.currency || 'RWF';
      const slaLabel = typeof s?.sla?.max === 'number' && s?.sla?.unit ? `${s.sla.max} ${s.sla.unit}` : s?.sla?.text || '—';

      return {
        key: s.key,
        title: s.title,
        stageLabel: stageTitleByKey.get(s.stageKey) || s.stageKey || 'Stage',
        responsibleRole: s.responsibleRole,
        feeAmount: feeAmount,
        feeCurrency,
        feeText: typeof s?.fee?.text === 'string' ? s.fee.text : undefined,
        slaLabel,
        dueAt,
        stepIndex: index + 1,
      };
    });
  }, [selectedWorkflowTemplate, formData.workflowStartDate]);

  const workflowSummary = useMemo(() => {
    if (selectedWorkflowSteps.length === 0) return null;

    const totalFee = selectedWorkflowSteps.reduce((sum, step) => sum + (step.feeAmount || 0), 0);
    const currency = selectedWorkflowSteps.find((step) => step.feeCurrency)?.feeCurrency || 'RWF';
    const nextStep = selectedWorkflowSteps.find((step) => step.dueAt >= new Date());
    const finalStep = selectedWorkflowSteps[selectedWorkflowSteps.length - 1];

    return {
      totalFee,
      currency,
      nextDueAt: nextStep?.dueAt,
      completionDate: finalStep?.dueAt,
      stepCount: selectedWorkflowSteps.length,
      stagesCount: new Set(selectedWorkflowSteps.map((step) => step.stageLabel)).size,
    };
  }, [selectedWorkflowSteps]);

  const workflowStageGroups = useMemo(() => {
    const groups = new Map<string, typeof selectedWorkflowSteps>();
    selectedWorkflowSteps.forEach((step) => {
      const stage = step.stageLabel || 'Stage';
      if (!groups.has(stage)) groups.set(stage, []);
      groups.get(stage)?.push(step);
    });
    return Array.from(groups.entries());
  }, [selectedWorkflowSteps]);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/cases')}
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Cases
        </button>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Create New Case</h1>
        <p className="text-gray-600">Follow the steps to set up a new case</p>
      </div>

      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center">
          {[1, 2, 3].map((stepNumber, index) => (
            <div key={stepNumber} className="flex items-center flex-1">
              <div className="flex items-center">
                <div
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center font-medium
                    ${
                      step > stepNumber
                        ? 'bg-gray-800 text-white'
                        : step === stepNumber
                          ? 'bg-gray-800 text-white'
                          : 'bg-gray-200 text-gray-500'
                    }
                  `}
                >
                  {step > stepNumber ? <Check className="w-5 h-5" /> : stepNumber}
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-900">
                    {stepNumber === 1 && 'Case Basics'}
                    {stepNumber === 2 && 'Workflow Setup'}
                    {stepNumber === 3 && 'Review & Confirm'}
                  </p>
                </div>
              </div>
              {index < 2 && (
                <div className={`flex-1 h-0.5 mx-4 ${step > stepNumber ? 'bg-gray-800' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Error/Success */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>
      )}
      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">{success}</div>
      )}
      {draftNotice && (
        <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded">{draftNotice}</div>
      )}

      {/* Form Content */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        {/* Step 1: Case Basics */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Case No. *</label>
              <input
                type="text"
                value={formData.caseNo}
                onChange={(e) => handleInputChange('caseNo', e.target.value)}
                placeholder="e.g., RS/SCP/RCOM 00388/2024/TC"
                className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Parties *</label>
              <input
                type="text"
                value={formData.parties}
                onChange={(e) => handleInputChange('parties', e.target.value)}
                placeholder="e.g., John vs Smith"
                className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>

            {/* ✅ Decision Tree */}
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div className="text-sm font-semibold text-gray-900 mb-3">Legal Service Classification *</div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {serviceLevels.map((level, index) => (
                  <div key={`${level.label}-${index}`}>
                    <label className="block text-sm font-medium text-gray-700 mb-2">{level.label}</label>
                    <select
                      value={level.value}
                      onChange={(e) => updateServicePathAtLevel(index, e.target.value)}
                      disabled={index > 0 && !servicePath[index - 1]}
                      className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 disabled:opacity-60"
                    >
                      <option value="">{index === 0 || servicePath[index - 1] ? 'Select...' : level.placeholder}</option>
                      {level.options.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* ✅ Computed Case Type (read-only, automatic) */}
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Computed Case Type</label>
                  <input
                    value={computedCaseType || ''}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-gray-100 text-gray-900"
                    placeholder="Select legal service to compute case type"
                  />
                  {!computedCaseType && (
                    <p className="text-xs text-red-600 mt-2">Please select a legal service path to continue.</p>
                  )}
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Workflow</div>
                  <div className="mt-2 text-sm font-semibold text-gray-900">{formData.workflow || '—'}</div>
                  <div className="mt-1 text-xs text-gray-500">Auto-selected from Legal Service path.</div>
                </div>
              </div>

              {formData.workflow ? (
                <p className="text-xs text-gray-600 mt-3">
                  Suggested matter type: <span className="font-medium">{formData.workflow}</span>
                </p>
              ) : null}

              {selectedServicePathLabel ? (
                <p className="text-xs text-gray-600 mt-2">
                  Selected path: <span className="font-medium">{selectedServicePathLabel}</span>
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Assigned To *</label>
              <select
                value={formData.assignedTo}
                onChange={(e) => handleInputChange('assignedTo', e.target.value)}
                disabled={loadingStaff}
                className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-60"
              >
                <option value="">{loadingStaff ? 'Loading staff...' : 'Select staff'}</option>
                {staffUsers.map((u) => (
                  <option key={u._id} value={u.name}>
                    {u.name} ({ROLE_DISPLAY_MAP[u.role] || u.role})
                  </option>
                ))}
              </select>
              {!loadingStaff && staffUsers.length === 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  No active staff users found. Add users first in Administration → Users.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Case Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={4}
                placeholder="Brief description of the case..."
                className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>
          </div>
        )}

        {/* Step 2: Workflow Setup */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Workflow Start Date *</label>
                <input
                  type="date"
                  value={formData.workflowStartDate || ''}
                  onChange={(e) => handleInputChange('workflowStartDate', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
                <p className="text-xs text-gray-500 mt-2">Deadlines are calculated from this start date.</p>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Selected Workflow Template</div>
                  <div className="text-xs text-gray-600 mt-1">
                    {selectedWorkflowTemplate?.name ? `${selectedWorkflowTemplate?.name} • ` : null}
                    {selectedWorkflowTemplate?.matterType || (templatesLoading ? 'Loading…' : '—')}
                  </div>
                </div>
                {!selectedWorkflowTemplate ? (
                  <div className="text-xs text-red-600">
                    No workflow template matched the selected Legal Service path. Update the Legal Service selection.
                  </div>
                ) : null}
              </div>
            </div>

            {selectedWorkflowTemplate ? (
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Workflow Roadmap (Preview)</div>
                    <div className="text-xs text-gray-600 mt-1">
                      {selectedWorkflowTemplate.name ? `${selectedWorkflowTemplate.name} • ` : null}
                      {selectedWorkflowTemplate.matterType}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full md:w-auto">
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Workstream</div>
                      <div className="mt-2 text-sm font-semibold text-gray-900">{workflowSummary?.stepCount || 0} steps</div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Next deadline</div>
                      <div className="mt-2 text-sm font-semibold text-gray-900">
                        {workflowSummary?.nextDueAt ? workflowSummary.nextDueAt.toLocaleDateString() : 'TBD'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Planned value</div>
                      <div className="mt-2 text-sm font-semibold text-gray-900">
                        {workflowSummary ? formatCurrency(workflowSummary.totalFee, workflowSummary.currency) : 'RWF 0'}
                      </div>
                    </div>
                  </div>
                </div>

                {workflowStageGroups.length === 0 ? (
                  <div className="text-sm text-gray-500">This template has no steps yet.</div>
                ) : (
                  <div className="space-y-5">
                    {workflowStageGroups.map(([stage, steps]) => (
                      <div key={stage} className="space-y-3">
                        <div className="text-sm font-semibold text-gray-900">{stage}</div>
                        <div className="space-y-3">
                          {steps.map((step) => (
                            <div key={step.key} className="rounded-xl border border-gray-200 bg-white p-4">
                              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Step {step.stepIndex}</div>
                                  <div className="text-base font-semibold text-gray-900 mt-1">{step.title}</div>
                                  <div className="text-sm text-gray-600 mt-2">
                                    {step.responsibleRole ? `Responsible: ${step.responsibleRole}` : 'Responsible role not set'}
                                  </div>
                                  <div className="mt-2 text-sm text-gray-600">
                                    {step.slaLabel ? `Expected duration: ${step.slaLabel}` : 'Duration not defined'}
                                  </div>
                                </div>

                                <div className="flex flex-col items-start gap-2 text-right">
                                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${getUrgencyStyle(step.dueAt)}`}>
                                    {formatRelativeDue(step.dueAt)}
                                  </span>
                                  <div className="text-xs text-gray-500">Due {step.dueAt.toLocaleDateString()}</div>
                                  <div className="text-sm font-semibold text-gray-900">
                                    {step.feeAmount ? formatCurrency(step.feeAmount, step.feeCurrency) : step.feeText || 'No fee set'}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-sm font-semibold text-gray-900 mb-3">Workflow settings</div>
              <div className="text-sm text-gray-600">
                A workflow template will automatically generate deadlines, task handovers, and billing value for this case. You only need to select the start date and template.
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-sm font-semibold text-gray-900 mb-3">Billing setup</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Payment mode</label>
                  <select
                    value={formData.billingSettings?.paymentMode || 'postpaid'}
                    onChange={(e) => {
                      const paymentMode = e.target.value === 'prepaid' ? 'prepaid' : 'postpaid';
                      setFormData((prev) => {
                        const currency = prev.billingSettings?.currency || 'RWF';
                        const prepaidTotal = Number(prev.billingSettings?.prepaidTotal) || 0;
                        return {
                          ...prev,
                          billingSettings: {
                            ...(prev.billingSettings || {}),
                            paymentMode,
                            currency,
                            prepaidTotal: paymentMode === 'prepaid' ? prepaidTotal : 0,
                            prepaidRemaining: paymentMode === 'prepaid' ? prepaidTotal : 0,
                            accruedUnbilled: 0,
                          },
                        };
                      });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900"
                  >
                    <option value="postpaid">Client pays later (postpaid)</option>
                    <option value="prepaid">Client pays first (prepaid)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-2">
                    Prepaid will decrement as checklist items are completed. Postpaid will accrue unbilled fees.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Currency</label>
                  <input
                    value={formData.billingSettings?.currency || 'RWF'}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        billingSettings: {
                          ...(prev.billingSettings || {}),
                          currency: e.target.value.toUpperCase(),
                        },
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900"
                    placeholder="RWF"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Prepaid amount</label>
                  <input
                    value={String(formData.billingSettings?.prepaidTotal ?? '')}
                    onChange={(e) => {
                      const value = Number(String(e.target.value).replace(/[^\d.]/g, ''));
                      setFormData((prev) => {
                        const paymentMode = prev.billingSettings?.paymentMode || 'postpaid';
                        const prepaidTotal = Number.isFinite(value) && value > 0 ? value : 0;
                        return {
                          ...prev,
                          billingSettings: {
                            ...(prev.billingSettings || {}),
                            prepaidTotal,
                            prepaidRemaining: paymentMode === 'prepaid' ? prepaidTotal : 0,
                          },
                        };
                      });
                    }}
                    disabled={(formData.billingSettings?.paymentMode || 'postpaid') !== 'prepaid'}
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 disabled:opacity-60"
                    placeholder="0"
                  />
                  <p className="text-xs text-gray-500 mt-2">Only used for prepaid clients.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Review & Confirm */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-4">Review Case Details</h3>
              <div className="space-y-4">
                {[
                  ['Case No.', formData.caseNo],
                  ['Parties', formData.parties],
                  ['Legal Service Path', formData.legalServicePath?.map((item) => item.label).join(' -> ') || 'Not selected'],
                  ['Case Type (computed)', formData.caseType],
                  ['Assigned To', formData.assignedTo],
                  ['Workflow Template', selectedWorkflowTemplate?.name || selectedWorkflowTemplate?.matterType || 'Not selected'],
                  ['Workflow Start Date', formData.workflowStartDate || 'Not set'],
                  ['Next expected deadline', workflowSummary?.nextDueAt ? workflowSummary.nextDueAt.toLocaleDateString() : 'TBD'],
                  ['Estimated completion', workflowSummary?.completionDate ? workflowSummary.completionDate.toLocaleDateString() : 'TBD'],
                  ['Planned workflow value', workflowSummary ? formatCurrency(workflowSummary.totalFee, workflowSummary.currency) : 'RWF 0'],
                  ['Payment mode', formData.billingSettings?.paymentMode === 'prepaid' ? 'Prepaid' : 'Postpaid'],
                  [
                    'Prepaid amount',
                    formData.billingSettings?.paymentMode === 'prepaid'
                      ? formatCurrency(Number(formData.billingSettings?.prepaidTotal) || 0, formData.billingSettings?.currency || 'RWF')
                      : '—',
                  ],
                ].map(([k, v]) => (
                  <div key={k} className="grid grid-cols-3 gap-4 py-3 border-b border-gray-200">
                    <span className="text-sm text-gray-600">{k}:</span>
                    <span className="col-span-2 text-sm font-medium text-gray-900">{v}</span>
                  </div>
                ))}

                {formData.description && (
                  <div className="py-3">
                    <span className="text-sm text-gray-600 block mb-2">Description:</span>
                    <p className="text-sm text-gray-900">{formData.description}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleBack}
          className={`inline-flex items-center px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 transition-colors ${
            step === 1 ? 'invisible' : ''
          }`}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </button>

        <div className="flex gap-3">
          <button
            onClick={() => navigate('/cases')}
            className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={saveDraft}
            className="px-4 py-2 rounded border border-blue-200 bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Save
          </button>

          {step < 3 ? (
            <button
              onClick={handleNext}
              disabled={!canProceed()}
              className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <ArrowRight className="w-4 h-4 ml-2" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 transition-colors"
            >
              {loading ? (
                'Creating...'
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Create Case
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const ROLE_DISPLAY_MAP: Record<string, string> = {
  managing_director: 'Managing Director',
  lawyer: 'Lawyer',
  associate: 'Associate',
  junior_associate: 'Junior Associate',
  assistant: 'Assistant',
  executive_assistant: 'Executive Assistant',
  intern: 'Intern',
};
