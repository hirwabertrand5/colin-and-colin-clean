import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { createCase, CaseData, CaseType } from '../../services/caseService';
import { findMatchingWorkflowTemplate, listActiveWorkflowTemplates, WorkflowTemplate } from '../../services/workflowService';
import { getAssignmentUsers } from '../../services/userService';
import { LEGAL_SERVICES_TREE, ServiceNode } from '../../constants/legalServicesTree';
import { getRoleSuggestions } from '../../constants/partyRoles';
import { formatCaseAssignedTo, setCaseAssignmentSlot } from '../../utils/caseAssignments';
import { formatDeadlineDateTime, resolveDeadlineDateTime } from '../../utils/workflowDeadline';

type StaffUser = {
  _id: string;
  name: string;
  email: string;
  role: string;
};

const SERVICE_LEVEL_LABELS = ['Legal Service', 'Category', 'Practice Area', 'Service Line', 'Sub-category', 'Detail'];
const DEFAULT_CREATE_CASE_DRAFT_KEY = 'createCaseDraft:v1';

type PreviewWorkflowStep = {
  key: string;
  title: string;
  stageLabel: string;
  responsibleRole?: string;
  percentage?: number;
  progressValue: number;
  slaLabel: string;
  dueAt: Date;
  stepIndex: number;
  actions: string[];
};

type MatterTiming = 'new';

const CASE_ASSIGNMENT_ROLE_OPTIONS: Record<'initiator' | 'reviewer' | 'signerApprover', string[]> = {
  initiator: ['intern', 'trainee_associate', 'associate'],
  reviewer: ['associate', 'senior_associate'],
  signerApprover: ['managing_partner', 'executive_managing_partner'],
};

interface CreateCaseProps {
  initialStatus?: string;
  pageTitle?: string;
  pageSubtitle?: string;
  backHref?: string;
  backLabel?: string;
  successNavigateTo?: string;
  successMessage?: string;
  submitLabel?: string;
  draftKey?: string;
}

export default function CreateCase({
  initialStatus = 'On Boarding',
  pageTitle = 'Create New Case',
  pageSubtitle = 'Follow the steps to set up a new case',
  backHref = '/cases',
  backLabel = 'Back to Cases',
  successNavigateTo = '/cases',
  successMessage = 'Case created successfully!',
  submitLabel = 'Create Case',
  draftKey = DEFAULT_CREATE_CASE_DRAFT_KEY,
}: CreateCaseProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateManuallySelected, setTemplateManuallySelected] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [draftNotice, setDraftNotice] = useState<string>('');
  const [matterTiming, setMatterTiming] = useState<MatterTiming>('new');

  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);

  const [servicePath, setServicePath] = useState<string[]>([]);

  // Parties structured UI state
  const [partiesStructured, setPartiesStructured] = useState(false);
  const [partiesList, setPartiesList] = useState<Array<{ name: string; role: string }>>([]);
  const [formData, setFormData] = useState<CaseData>({
    caseNo: '',
    parties: '',
    // ✅ will be auto-set by decision tree
    caseType: 'Transactional Cases' as CaseType,
    status: initialStatus,
    priority: 'Medium',
    assignedTo: '',
    caseAssignments: {
      initiator: '',
      reviewer: '',
      signerApprover: '',
    },
    description: '',
    legalServicePath: [],
    workflow: '',
    estimatedDuration: '',
    budget: '',
    matterTiming: 'new',
    workflowAutomation: true,
    workflowTemplateId: '',
    workflowStartDate: new Date().toISOString().slice(0, 10),

    billingSettings: {
      paymentMode: 'postpaid',
      currency: 'RWF',
      prepaidTotal: 0,
      prepaidRemaining: 0,
      accruedUnbilled: 0,
    },
    workflowProgress: {
      plannedValue: { amount: undefined, currency: 'RWF' },
      percent: 0,
      completedValue: { amount: 0, currency: 'RWF' },
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
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.formData) {
        const draftAssignments = parsed.formData.caseAssignments || {};
        setFormData((prev) => ({
          ...prev,
          ...parsed.formData,
          caseAssignments: {
            initiator: draftAssignments.initiator || '',
            reviewer: draftAssignments.reviewer || '',
            signerApprover: draftAssignments.signerApprover || '',
          },
          assignedTo: formatCaseAssignedTo(parsed.formData),
          status: parsed.formData.status || initialStatus,
          matterTiming: 'new',
          workflowAutomation: true,
        }));
      }
      if (Array.isArray(parsed?.servicePath)) setServicePath(parsed.servicePath);
      if (typeof parsed?.step === 'number') setStep(parsed.step);
      setMatterTiming('new');
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
        draftKey,
        JSON.stringify({
          step,
          matterTiming,
          servicePath,
          formData: {
            ...formData,
            assignedTo: formatCaseAssignedTo(formData),
            matterTiming: 'new',
            workflowAutomation: true,
          },
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
        const data: StaffUser[] = await getAssignmentUsers();
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

  const updateAssignmentSlot = (slot: 'initiator' | 'reviewer' | 'signerApprover', value: string) => {
    setFormData((prev) => {
      const caseAssignments = setCaseAssignmentSlot(prev.caseAssignments, slot, value);
      return {
        ...prev,
        caseAssignments,
        assignedTo: formatCaseAssignedTo({ caseAssignments, assignedTo: prev.assignedTo }),
      };
    });
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

  

  // Keep legalServicePath in sync with tree selection.
  // Workflow selection is fully manual via the dropdown (normal workflow lifecycle)
  // so we never overwrite workflow/workflowTemplateId here.
  useEffect(() => {
    const ct = resolveCaseTypeFromSelection(selectedServiceNodes);
    const legalServicePath = selectedServiceNodes.map((node) => ({ id: node.id, label: node.label }));

    setFormData((prev) => {
      // If the user already picked a workflow manually, its template is the
      // source of truth for caseType/workflow — don't override it when the
      // Legal Service path changes.
      if (prev.workflowTemplateId) {
        return {
          ...prev,
          legalServicePath,
        };
      }
      return {
        ...prev,
        caseType: ct || prev.caseType,
        legalServicePath,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServiceNodes]);

  const computedCaseType = useMemo(
    () => resolveCaseTypeFromSelection(selectedServiceNodes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedServiceNodes]
  );

  const suggestedMatterType = useMemo(
    () => resolveSuggestedMatterType(selectedServiceNodes),
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
      if (plannedValueAmount <= 0) {
        throw new Error('Enter the contract value before creating the case.');
      }

      const finalParties = partiesStructured ? partiesList.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join(' ; ') : formData.parties;

      // Ensure we send an explicit caseNo so the server does not auto-generate the CASE-YYYY-00001 format.
      // If the user left the field blank, send 'N/A' per requirements.
      const caseNoToSend = String(formData.caseNo || '').trim() || 'N/A';

      await createCase({
        ...formData,
        assignedTo: formatCaseAssignedTo(formData),
        legalServicePath: formData.legalServicePath || [],
        caseNo: caseNoToSend,
        parties: finalParties,
        matterTiming,
        workflowAutomation: true,
        workflowTemplateId: formData.workflowTemplateId,
        budget: plannedValueAmount > 0 ? String(plannedValueAmount) : formData.budget,
        workflowProgress: {
          ...(formData.workflowProgress || {}),
          percent: 0,
          plannedValue: { amount: plannedValueAmount, currency: plannedValueCurrency },
          completedValue: { amount: 0, currency: plannedValueCurrency },
        },
        billingSettings: {
          paymentMode: 'postpaid',
          currency: plannedValueCurrency,
          prepaidTotal: 0,
          prepaidRemaining: 0,
          accruedUnbilled: 0,
        },
      });
      setSuccess(successMessage);
      setTimeout(() => navigate(successNavigateTo), 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to create case');
    } finally {
      setLoading(false);
    }
  };

  const canProceed = () => {
    if (step === 1) {
      const hideCaseNo = (computedCaseType || formData.caseType) === 'Transactional Cases';
      const partiesOk = partiesStructured ? partiesList.length > 0 && partiesList.every((p) => p.name && p.name.trim()) : Boolean(formData.parties && String(formData.parties).trim());
      const caseNoOk = hideCaseNo ? true : Boolean(formData.caseNo && String(formData.caseNo).trim());
      const assignments = formData.caseAssignments || {};
      const assigneeOk = Boolean(assignments.initiator && assignments.reviewer && assignments.signerApprover);
      return Boolean(caseNoOk && partiesOk && assigneeOk && formData.assignedTo && isServiceSelectionValid() && formData.workflowTemplateId);
    }
    if (step === 2) {
      return Boolean(formData.workflowTemplateId && formData.workflowStartDate && plannedValueAmount > 0);
    }
    return true;
  };

  const parseMoneyInput = (value: unknown) => {
    const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const plannedValueAmount = parseMoneyInput(formData.workflowProgress?.plannedValue?.amount);
  // Single-currency policy: the whole system operates in RWF only.
  const plannedValueCurrency = 'RWF' as const;

  const selectedWorkflowTemplate = useMemo(
    () => templates.find((t) => t._id === formData.workflowTemplateId),
    [formData.workflowTemplateId, templates]
  );

  useEffect(() => {
    const currency = 'RWF' as const;
    setFormData((prev) => ({
      ...prev,
      billingSettings: {
        ...(prev.billingSettings || {}),
        paymentMode: 'postpaid',
        currency,
        prepaidTotal: 0,
        prepaidRemaining: 0,
        accruedUnbilled: Math.round((parseMoneyInput(prev.workflowProgress?.plannedValue?.amount) * (prev.workflowProgress?.percent || 0)) / 100),
      },
      budget: prev.workflowProgress?.plannedValue?.amount
        ? String(prev.workflowProgress.plannedValue.amount)
        : prev.budget,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannedValueCurrency]);

  // Default the workflow dropdown to the Legal Service suggestion on first load,
  // but never overwrite a manual user choice afterwards (normal workflow lifecycle).
  useEffect(() => {
    if (templatesLoading) return;
    if (templateManuallySelected) return;
    if (formData.workflowTemplateId) return;

    const suggested = resolveSuggestedMatterType(selectedServiceNodes);
    const ct = resolveCaseTypeFromSelection(selectedServiceNodes);

    if (!suggested || !ct) return;
    const match = findMatchingWorkflowTemplate(templates, suggested, ct);
    if (!match) return;

    setFormData((prev) => {
      if (prev.workflowTemplateId) return prev;
      return {
        ...prev,
        workflowTemplateId: match._id,
        caseType: match.caseType as CaseType,
        workflow: match.matterType,
      };
    });
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

  const selectedWorkflowSteps = useMemo<PreviewWorkflowStep[]>(() => {
    if (!selectedWorkflowTemplate || !formData.workflowStartDate) return [];

    const stages: Array<{ key: string; title?: string; name?: string }> = Array.isArray(
      (selectedWorkflowTemplate as any).stages
    )
      ? (selectedWorkflowTemplate as any).stages
      : [];
    const stageTitleByKey = new Map(stages.map((s) => [s.key, s.title || s.name || s.key]));

    const steps = Array.isArray((selectedWorkflowTemplate as any).steps)
      ? [...(selectedWorkflowTemplate as any).steps].sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
      : [];

    const start = resolveDeadlineDateTime(formData.workflowStartDate);
    if (!start) return [];
    let cursor = new Date(start);

    return steps.map((s: any, index: number) => {
      const minutes = toMinutesFromSla(s.sla);
      const stepStart = new Date(cursor);
      const dueAt = new Date(stepStart.getTime() + minutes * 60_000);
      cursor = new Date(dueAt);

      const percentage = typeof s?.percentage === 'number' && s.percentage >= 0 ? s.percentage : undefined;
      const slaLabel = typeof s?.sla?.max === 'number' && s?.sla?.unit ? `${s.sla.max} ${s.sla.unit}` : s?.sla?.text || '—';
      const actions = Array.isArray(s?.actions) ? s.actions.map((a: any) => String(a || '').trim()).filter(Boolean) : [];

      return {
        key: s.key,
        title: s.title,
        stageLabel: stageTitleByKey.get(s.stageKey) || s.stageKey || 'Stage',
        responsibleRole: s.responsibleRole,
        percentage,
        progressValue: Math.round(plannedValueAmount * ((percentage || 0) / 100)),
        slaLabel,
        dueAt,
        stepIndex: index + 1,
        actions,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkflowTemplate, formData.workflowStartDate, plannedValueAmount]);

  const workflowSummary = useMemo(() => {
    if (selectedWorkflowSteps.length === 0) return null;

    const nextStep = selectedWorkflowSteps.find((step) => step.dueAt >= new Date());
    const finalStep = selectedWorkflowSteps[selectedWorkflowSteps.length - 1];

    return {
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
          onClick={() => navigate(backHref)}
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          {backLabel}
        </button>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">{pageTitle}</h1>
        <p className="text-gray-600">{pageSubtitle}</p>
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
            {/* Note: Case No. and Parties are shown after the workflow / legal service selection below */}

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
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Workflow *</div>
                  <select
                    value={formData.workflowTemplateId || ''}
                    onChange={(e) => {
                      const templateId = e.target.value;
                      const match = templates.find((t) => t._id === templateId);
                      setTemplateManuallySelected(true);
                      setFormData((prev) => ({
                        ...prev,
                        workflowTemplateId: templateId,
                        ...(match
                          ? {
                              caseType: match.caseType as CaseType,
                              workflow: match.matterType,
                            }
                          : { workflow: '' }),
                      }));
                    }}
                    className="mt-2 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                  >
                    <option value="">Select a workflow…</option>
                    {templates.map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.name} — {t.matterType} ({t.caseType})
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-xs text-gray-500">
                    {templatesLoading
                      ? 'Loading workflows…'
                      : suggestedMatterType
                        ? `Suggested from Legal Service path: ${suggestedMatterType}. You can keep it or choose another.`
                        : 'Choose the workflow to drive tasks, deadlines and progress.'}
                  </div>
                  {templateManuallySelected && suggestedMatterType ? (
                    <button
                      type="button"
                      onClick={() => {
                        const match = findMatchingWorkflowTemplate(templates, suggestedMatterType, computedCaseType as WorkflowTemplate['caseType']);
                        setTemplateManuallySelected(false);
                        if (match) {
                          setFormData((prev) => ({
                            ...prev,
                            workflowTemplateId: match._id,
                            caseType: match.caseType as CaseType,
                            workflow: match.matterType,
                          }));
                        }
                      }}
                      className="mt-1 text-xs font-medium text-gray-700 underline hover:text-gray-900"
                    >
                      Reset to suggested workflow
                    </button>
                  ) : null}
                  {!formData.workflowTemplateId && (
                    <div className="mt-1 text-xs text-red-600">Please select a workflow to continue.</div>
                  )}
                </div>
              </div>

              {formData.workflow && selectedWorkflowTemplate ? (
                <p className="text-xs text-gray-600 mt-3">
                  Selected workflow: <span className="font-medium">{selectedWorkflowTemplate.name} — {formData.workflow}</span>
                </p>
              ) : null}

              {selectedServicePathLabel ? (
                <p className="text-xs text-gray-600 mt-2">
                  Selected path: <span className="font-medium">{selectedServicePathLabel}</span>
                </p>
              ) : null}
            </div>

            {/* --- Moved: Case No. & Parties (appear after workflow selection) --- */}
            <div>
              {/* Hide case number for transactional cases */}
              {((computedCaseType || formData.caseType) !== 'Transactional Cases') && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Case No. *</label>
                  <input
                    type="text"
                    value={formData.caseNo}
                    onChange={(e) => handleInputChange('caseNo', e.target.value)}
                    placeholder="e.g., RS/SCP/RCOM 00388/2024/TC"
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">Parties *</label>
                  <div className="text-xs text-gray-500">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" className="form-checkbox" checked={partiesStructured} onChange={(e) => setPartiesStructured(e.target.checked)} />
                      <span>Structured</span>
                    </label>
                  </div>
                </div>

                {!partiesStructured ? (
                  <input
                    type="text"
                    value={formData.parties}
                    onChange={(e) => handleInputChange('parties', e.target.value)}
                    placeholder="e.g., John vs Smith"
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                ) : (
                  <div className="space-y-3">
                    {partiesList.map((p, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                        <input
                          className="col-span-5 px-3 py-2 border border-gray-300 rounded"
                          placeholder="Party name"
                          value={p.name}
                          onChange={(e) => setPartiesList((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
                        />
                        <select
                          value={p.role}
                          onChange={(e) => setPartiesList((prev) => prev.map((x, i) => (i === idx ? { ...x, role: e.target.value } : x)))}
                          className="col-span-5 px-3 py-2 border border-gray-300 rounded bg-white"
                        >
                          {/* Role suggestions based on computed case type */}
                          <option value="">Select role...</option>
                          {getRoleSuggestions({ caseType: computedCaseType, sectorLabel: selectedServiceNodes[0]?.label, matterType: formData.workflow }).map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                        <div className="col-span-2">
                          <button
                            type="button"
                            onClick={() => setPartiesList((prev) => prev.filter((_, i) => i !== idx))}
                            className="px-3 py-2 border rounded text-sm text-red-600"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPartiesList((prev) => [...prev, { name: '', role: '' }])}
                        className="px-3 py-2 border rounded text-sm bg-gray-50"
                      >
                        Add party
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          // convert structured list into free-text preview
                          const preview = partiesList.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join(' ; ');
                          handleInputChange('parties', preview);
                        }}
                        className="px-3 py-2 border rounded text-sm bg-gray-50"
                      >
                        Save as text
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-sm font-semibold text-gray-900">Assigned To *</div>
              <p className="text-xs text-gray-500 mt-1">Choose the initiator, reviewer, and signer/approver for this matter.</p>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    key: 'initiator' as const,
                    label: 'Initiator',
                    hint: 'Intern / Junior',
                    roles: CASE_ASSIGNMENT_ROLE_OPTIONS.initiator,
                    placeholder: 'Select initiator',
                  },
                  {
                    key: 'reviewer' as const,
                    label: 'Reviewer',
                    hint: 'Associate / Senior Associate',
                    roles: CASE_ASSIGNMENT_ROLE_OPTIONS.reviewer,
                    placeholder: 'Select reviewer',
                  },
                  {
                    key: 'signerApprover' as const,
                    label: 'Signer / Approver',
                    hint: 'Managing Partner',
                    roles: CASE_ASSIGNMENT_ROLE_OPTIONS.signerApprover,
                    placeholder: 'Select approver',
                  },
                ].map((field) => {
                  const currentValue = formData.caseAssignments?.[field.key] || '';
                  const optionUsers = staffUsers;
                  return (
                    <div key={field.key}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                      <div className="mb-2 text-xs text-gray-500">{field.hint}</div>
                      <select
                        value={currentValue}
                        onChange={(e) => updateAssignmentSlot(field.key, e.target.value)}
                        disabled={loadingStaff}
                        className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-60"
                      >
                        <option value="">{loadingStaff ? 'Loading staff...' : field.placeholder}</option>
                        {optionUsers.map((u) => (
                          <option key={u._id} value={u.name}>
                            {u.name} ({ROLE_DISPLAY_MAP[u.role] || u.role})
                          </option>
                        ))}
                        {!optionUsers.length
                          ? staffUsers.map((u) => (
                              <option key={u._id} value={u.name}>
                                {u.name} ({ROLE_DISPLAY_MAP[u.role] || u.role})
                              </option>
                            ))
                          : null}
                      </select>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 text-xs text-gray-500">Selected: {formData.assignedTo || 'Not set'}</div>
              {!loadingStaff && staffUsers.length === 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  No active staff users found. Add users first in Administration → Users.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Case Summary</label>
              <textarea
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={4}
                placeholder="Brief summary of the case..."
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
                    Please select a workflow from the dropdown in Step 1 to continue.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Contract Value *</label>
                  <input
                    value={formData.workflowProgress?.plannedValue?.amount ?? ''}
                    onChange={(e) => {
                      const amount = parseMoneyInput(e.target.value);
                      setFormData((prev) => ({
                        ...prev,
                        budget: amount ? String(amount) : '',
                        workflowProgress: {
                          ...(prev.workflowProgress || {}),
                          plannedValue: {
                            amount: amount || undefined,
                            currency: 'RWF' as const,
                          },
                          completedValue: {
                            amount: Math.round((amount * (prev.workflowProgress?.percent || 0)) / 100),
                            currency: 'RWF' as const,
                          },
                        },
                        billingSettings: {
                          ...(prev.billingSettings || {}),
                          paymentMode: 'postpaid',
                          currency: 'RWF' as const,
                          prepaidTotal: 0,
                          prepaidRemaining: 0,
                          accruedUnbilled: Math.round((amount * (prev.workflowProgress?.percent || 0)) / 100),
                        },
                      }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                    placeholder="e.g., 790000"
                    inputMode="numeric"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    This is the contract value. Progress value is calculated from checked key actions.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Currency</label>
                  <input
                    value="RWF"
                    readOnly
                    disabled
                    aria-readonly="true"
                    title="RWF"
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-gray-100 text-gray-900 cursor-not-allowed"
                  />
                </div>
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
                        {workflowSummary?.nextDueAt ? formatDeadlineDateTime(workflowSummary.nextDueAt) : 'TBD'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Contract Value</div>
                      <div className="mt-2 text-sm font-semibold text-gray-900">
                        {plannedValueAmount > 0 ? formatCurrency(plannedValueAmount, plannedValueCurrency) : 'Enter value'}
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
                              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
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

                                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Progress value & deadlines</div>
                                  <div className="mt-3 space-y-3">
                                    <div>
                                      <div className="text-xs text-gray-500">Deadline</div>
                                      <span className={`mt-1 inline-flex rounded-full px-3 py-1 text-xs font-medium ${getUrgencyStyle(step.dueAt)}`}>
                                        {formatRelativeDue(step.dueAt)}
                                      </span>
                                      <div className="mt-1 text-xs text-gray-500">Due {formatDeadlineDateTime(step.dueAt)}</div>
                                    </div>
                                    <div>
                                      <div className="text-xs text-gray-500">Key Action percentage</div>
                                      {step.percentage != null ? (
                                        <><div className="mt-1 text-sm font-semibold text-gray-900">{step.percentage}%</div><div className="mt-1 text-xs text-gray-500">Progress value: {formatCurrency(step.progressValue, plannedValueCurrency)}</div></>
                                      ) : <div className="mt-1 text-sm font-semibold text-amber-700">Percentage missing</div>}
                                    </div>
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
                A workflow template automatically generates deadlines and Key Actions. Progress value is calculated from the contract value and the percentage of checked Key Actions; no manual workflow fees are used.
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
                  ['Next expected deadline', workflowSummary?.nextDueAt ? formatDeadlineDateTime(workflowSummary.nextDueAt) : 'TBD'],
                  ['Estimated completion', workflowSummary?.completionDate ? formatDeadlineDateTime(workflowSummary.completionDate) : 'TBD'],
                  ['Contract value', plannedValueAmount > 0 ? formatCurrency(plannedValueAmount, plannedValueCurrency) : 'Not entered'],
                ].map(([k, v]) => (
                  <div key={k} className="grid grid-cols-3 gap-4 py-3 border-b border-gray-200">
                    <span className="text-sm text-gray-600">{k}:</span>
                    <span className="col-span-2 text-sm font-medium text-gray-900">{v}</span>
                  </div>
                ))}

                {formData.description && (
                  <div className="py-3">
                    <span className="text-sm text-gray-600 block mb-2">Case Summary:</span>
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
            onClick={() => navigate(backHref)}
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
                  {submitLabel}
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
  managing_partner: 'Managing Partner',
  executive_managing_partner: 'Executive Managing Partner',
  senior_partner: 'Senior Partner',
  partner: 'Partner',
  executive_partner: 'Executive Partner',
  associate_partner: 'Associate Partner',
  executive_associate_partner: 'Executive Associate Partner',
  senior_associate: 'Senior Associate',
  senior_executive_assistant: 'Senior Executive Assistant',
  associate: 'Associate',
  trainee_associate: 'Trainee Associate',
  executive_assistant: 'Executive Assistant',
  originating_attorney: 'Originating Attorney',
  intern: 'Intern',
};
