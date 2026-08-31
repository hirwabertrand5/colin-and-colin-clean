import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  User as UserIcon,
  Upload,
  Eye,
  Trash2,
  FileText,
  X,
} from 'lucide-react';
import { UserRole } from '../../App';

import {
  getTaskById,
  TaskData,
  TaskChecklistItem,
  submitTaskForApproval,
  approveTask,
  rejectTask,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
  updateTask,
  TASK_WORKFLOW_STAGES,
  TaskWorkflowStage,
} from '../../services/taskService';

import { getCaseById, CaseData } from '../../services/caseService';
import { getInvoicesForCase, Invoice } from '../../services/invoiceService';
import { getDocumentsForCase, CaseDocument } from '../../services/documentService';
import { getAuditForCase, AuditLogItem } from '../../services/auditService';
import {
  getWorkflowForCase,
  toggleWorkflowStepAction,
  WorkflowInstance,
} from '../../services/workflowInstanceService';

import {
  listTaskAttachments,
  uploadTaskAttachment,
  deleteTaskAttachment,
  TaskAttachment,
} from '../../services/taskAttachmentService';
import { formatDeadlineDateTime } from '../../utils/workflowDeadline';

interface TaskDetailProps {
  userRole: UserRole;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const BACKEND_URL = API_URL.replace(/\/api\/?$/, '');

const inferWorkflowStageFromStatus = (status?: string): TaskWorkflowStage => {
  if (status === 'Completed') return 'Completed';
  if (status === 'In Progress') return 'In Progress';
  return 'Assigned';
};

const getWorkflowStageColor = (stage: string) => {
  switch (stage) {
    case 'Created':
      return 'bg-gray-100 text-gray-700';
    case 'Assigned':
      return 'bg-blue-100 text-blue-700';
    case 'Acknowledged':
      return 'bg-sky-100 text-sky-700';
    case 'In Progress':
      return 'bg-indigo-100 text-indigo-700';
    case 'Awaiting Review':
      return 'bg-amber-100 text-amber-700';
    case 'Awaiting External Action':
      return 'bg-orange-100 text-orange-700';
    case 'Completed':
      return 'bg-green-100 text-green-700';
    case 'Closed':
      return 'bg-gray-900 text-white';
    default:
      return 'bg-gray-100 text-gray-700';
  }
};

const normalizeIdentity = (value?: string | null) => String(value || '').trim().toLowerCase();

const getStageStatusColor = (status?: string) => {
  switch (status) {
    case 'Completed':
      return 'bg-green-100 text-green-700';
    case 'In Progress':
      return 'bg-blue-100 text-blue-700';
    case 'Cancelled':
      return 'bg-rose-100 text-rose-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
};

const getStagePrimaryActionLabel = (role?: string) => {
  switch (role) {
    case 'Initiator':
      return 'Send to Reviewer';
    case 'Reviewer':
      return 'Send to Signer / Approver';
    case 'Signer':
    case 'Approver':
    case 'Signer/Approver':
      return 'Approve & Complete';
    default:
      return 'Mark Completed';
  }
};

type DerivedChecklistItem = {
  id: string;
  item: string;
  completed: boolean;
  stepKey?: string;
  stepTitle?: string;
  actionIndex?: number;
};

export default function TaskDetail({ userRole }: TaskDetailProps) {
  const { id } = useParams();
  const navigate = useNavigate();

  const [task, setTask] = useState<TaskData | null>(null);
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [workflowInstance, setWorkflowInstance] = useState<WorkflowInstance | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [documents, setDocuments] = useState<CaseDocument[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [relatedCaseMessage, setRelatedCaseMessage] = useState('');

  // Task attachments
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attError, setAttError] = useState('');

  const [showUploadAttModal, setShowUploadAttModal] = useState(false);
  const [attName, setAttName] = useState('');
  const [attNote, setAttNote] = useState('');
  const [attFile, setAttFile] = useState<File | null>(null);
  const [attUploading, setAttUploading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Approval modal
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject' | null>(null);
  const [comments, setComments] = useState('');
  const [approvalLoading, setApprovalLoading] = useState(false);

  // Checklist
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [qualityScoreDraft, setQualityScoreDraft] = useState('');
  const [qualityScoreLoading, setQualityScoreLoading] = useState(false);

  // Update status modal
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [newWorkflowStage, setNewWorkflowStage] = useState<TaskWorkflowStage>('Assigned');
  const [confirmCompletion, setConfirmCompletion] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  const isManagingDirector = userRole === 'managing_director';

  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null') as
        | { id: string; name: string; email: string; role: string }
        | null;
    } catch {
      return null;
    }
  }, []);

  const isApprovedLocked = useMemo(() => {
    return Boolean(task?.workflowStage === 'Closed' || (task?.requiresApproval && task?.approvalStatus === 'Approved'));
  }, [task?.workflowStage, task?.requiresApproval, task?.approvalStatus]);

  const sortedTaskStages = useMemo(
    () => [...(task?.taskStages || [])].sort((a, b) => (a.sequence || 0) - (b.sequence || 0)),
    [task?.taskStages]
  );

  // We now enforce read-only after Approved for everyone:
  const canWorkOnTask = useMemo(() => {
    if (!task) return false;
    if (isApprovedLocked) return false;
    if (isManagingDirector) return true;
    const meName = normalizeIdentity(currentUser?.name);
    const meEmail = normalizeIdentity(currentUser?.email);
    const assignee = normalizeIdentity(task.assignee);
    const supervisor = normalizeIdentity(task.supervisor);
    const stageMatch = sortedTaskStages.some((stage) => {
      const staffMember = normalizeIdentity(stage.staffMember);
      return Boolean(staffMember && (staffMember === meName || staffMember === meEmail));
    });
    return Boolean([assignee, supervisor].some((value) => value && (value === meName || value === meEmail)) || stageMatch);
  }, [sortedTaskStages, task, isManagingDirector, currentUser?.email, currentUser?.name, isApprovedLocked]);

  const isTaskSupervisor = useMemo(() => {
    if (!task) return false;
    const meName = normalizeIdentity(currentUser?.name);
    const meEmail = normalizeIdentity(currentUser?.email);
    const supervisor = normalizeIdentity(task.supervisor);
    return Boolean(supervisor && (supervisor === meName || supervisor === meEmail));
  }, [task, currentUser?.email, currentUser?.name]);

  const canToggleChecklist = useMemo(() => {
    if (!task) return false;
    if (isApprovedLocked) return false;
    if (isManagingDirector) return true;
    const meName = normalizeIdentity(currentUser?.name);
    const meEmail = normalizeIdentity(currentUser?.email);
    const assignee = normalizeIdentity(task.assignee);
    const supervisor = normalizeIdentity(task.supervisor);
    const stageMatch = sortedTaskStages.some((stage) => {
      const staffMember = normalizeIdentity(stage.staffMember);
      return Boolean(staffMember && (staffMember === meName || staffMember === meEmail));
    });
    return Boolean([assignee, supervisor].some((value) => value && (value === meName || value === meEmail)) || stageMatch);
  }, [sortedTaskStages, task, isManagingDirector, currentUser?.email, currentUser?.name, isApprovedLocked]);

  const canSetQualityScore = useMemo(() => {
    if (!task) return false;
    if (isApprovedLocked && task.qualityScore == null) return true;
    return Boolean(isManagingDirector || currentUser?.role === 'executive_assistant' || isTaskSupervisor);
  }, [task, isManagingDirector, currentUser?.role, isTaskSupervisor, isApprovedLocked]);

  const relatedCaseLabel = useMemo(() => {
    if (caseData) return caseData.parties || caseData.caseNo || '—';
    return task?.relatedClient || 'Case unavailable';
  }, [caseData, task?.relatedClient]);

  const billingCurrency = useMemo(
    () => caseData?.billingSettings?.currency || caseData?.workflowProgress?.plannedValue?.currency || 'RWF',
    [caseData?.billingSettings?.currency, caseData?.workflowProgress?.plannedValue?.currency]
  );

  const workflowStage = useMemo(
    () => task?.workflowStage || inferWorkflowStageFromStatus(task?.status),
    [task?.workflowStage, task?.status]
  );

  const workflowStageIndex = TASK_WORKFLOW_STAGES.indexOf(workflowStage);
  const completionDateLabel = task?.completedAt ? new Date(task.completedAt).toLocaleDateString() : '—';

  // Submit visible only if requiresApproval AND Draft/Rejected AND not locked AND not MD
  const showSubmitForApproval =
    !!task?.requiresApproval &&
    !isManagingDirector &&
    !isApprovedLocked &&
    (task.approvalStatus === 'Draft' || task.approvalStatus === 'Rejected');

  const showApproveReject =
    !!task?.requiresApproval &&
    isManagingDirector &&
    !isApprovedLocked &&
    task.approvalStatus === 'Pending';

  const workflowChecklistItems = useMemo<DerivedChecklistItem[]>(() => {
    if (!workflowInstance?.steps?.length) return [];

    return workflowInstance.steps.flatMap((step) =>
      (step.actions || []).map((action, actionIndex) => ({
        id: `${step.stepKey}-${actionIndex}`,
        item: action.text,
        completed: Boolean(action.done),
        stepKey: step.stepKey,
        stepTitle: step.title,
        actionIndex,
      }))
    );
  }, [workflowInstance]);

  const manualChecklistItems = task?.checklist || [];

  const checklistCompletionPercentage = useMemo(() => {
    if (workflowChecklistItems.length > 0) {
      const done = workflowChecklistItems.filter((c) => c.completed).length;
      return Math.round((done / workflowChecklistItems.length) * 100);
    }

    if (!manualChecklistItems.length) return 0;
    const done = manualChecklistItems.filter((c) => c.completed).length;
    return Math.round((done / manualChecklistItems.length) * 100);
  }, [manualChecklistItems, workflowChecklistItems]);

  const workflowProgressPercentage = useMemo(() => {
    const caseWorkflowPercent = caseData?.workflowProgress?.percent;
    if (caseWorkflowPercent !== null && caseWorkflowPercent !== undefined) {
      const parsed = Number(caseWorkflowPercent);
      return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    }

    return checklistCompletionPercentage;
  }, [caseData?.workflowProgress?.percent, checklistCompletionPercentage]);

  const matterCollectedFee = useMemo(() => {
    const paidInvoices = invoices.filter((invoice) => invoice.status === 'Paid');
    return paidInvoices.reduce((sum, invoice) => sum + (Number(invoice.amount) || 0), 0);
  }, [invoices]);

  const taskFeeCollected = useMemo(
    () => Math.round((matterCollectedFee * workflowProgressPercentage) / 100),
    [matterCollectedFee, workflowProgressPercentage]
  );

  const formatMoney = (amount: number) =>
    `${billingCurrency} ${Math.round((Number(amount) || 0) * 100) / 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'High':
        return 'bg-red-100 text-red-700';
      case 'Medium':
        return 'bg-yellow-400 text-black';
      case 'Low':
        return 'bg-green-100 text-green-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed':
        return 'bg-green-100 text-green-700';
      case 'In Progress':
        return 'bg-blue-100 text-blue-700';
      case 'Not Started':
        return 'bg-gray-100 text-gray-600';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const loadAttachments = async (taskId: string) => {
    try {
      setAttLoading(true);
      setAttError('');
      const data = await listTaskAttachments(taskId);
      setAttachments(data);
    } catch (e: any) {
      setAttError(e.message || 'Failed to load attachments');
      setAttachments([]);
    } finally {
      setAttLoading(false);
    }
  };

  const loadAll = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    setRelatedCaseMessage('');
    try {
      const t = await getTaskById(id);
      setTask(t);
      setQualityScoreDraft(t.qualityScore == null ? '' : String(t.qualityScore));

      const [caseResult, docsResult, auditResult] = await Promise.allSettled([
        getCaseById(t.caseId),
        getDocumentsForCase(t.caseId),
        getAuditForCase(t.caseId),
      ]);

      if (caseResult.status === 'fulfilled') {
        setCaseData(caseResult.value);
      } else {
        setCaseData(null);
        setRelatedCaseMessage('The related case record is missing or was deleted. You can still review the task details below.');
      }

      setDocuments(docsResult.status === 'fulfilled' ? docsResult.value : []);
      setWorkflowInstance(null);
      setInvoices([]);

      // ✅ Only show latest 6 activity logs
      setAuditLogs(auditResult.status === 'fulfilled' ? (auditResult.value || []).slice(0, 6) : []);

      const [workflowResult, invoicesResult] = await Promise.allSettled([
        getWorkflowForCase(t.caseId),
        getInvoicesForCase(t.caseId),
      ]);

      setWorkflowInstance(workflowResult.status === 'fulfilled' ? workflowResult.value : null);
      setInvoices(invoicesResult.status === 'fulfilled' ? invoicesResult.value : []);

      await loadAttachments(id);
    } catch (err: any) {
      setError(err.message || 'Failed to load task');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // --------------------
  // Approval
  // --------------------
  const openApproval = (action: 'approve' | 'reject') => {
    setApprovalAction(action);
    setComments('');
    setShowApprovalModal(true);
  };

  const confirmApproval = async () => {
    if (!task?._id || !approvalAction) return;
    try {
      setApprovalLoading(true);
      if (approvalAction === 'approve') {
        await approveTask(task._id, comments);
      } else {
        await rejectTask(task._id, comments);
      }
      setShowApprovalModal(false);
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Approval action failed');
    } finally {
      setApprovalLoading(false);
    }
  };

  const submitAction = async () => {
    if (!task?._id) return;

    try {
      setApprovalLoading(true);

      if (task.requiresApproval) {
        if (!(task.approvalStatus === 'Draft' || task.approvalStatus === 'Rejected')) {
          setError(`Cannot submit when approval status is ${task.approvalStatus}`);
          return;
        }
        await submitTaskForApproval(task._id);
      } else {
        // No approval required → submit means complete
        await updateTask(task._id, { status: 'Completed' });
      }

      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Failed to submit task');
    } finally {
      setApprovalLoading(false);
    }
  };

  // --------------------
  // Status update
  // --------------------
  const openUpdateStatus = () => {
    if (!task) return;
    setNewWorkflowStage(task.workflowStage || inferWorkflowStageFromStatus(task.status));
    setConfirmCompletion(false);
    setShowWorkflowModal(true);
  };

  const saveStatus = async () => {
    if (!task?._id) return;
    try {
      setStatusLoading(true);
      await updateTask(task._id, {
        workflowStage: newWorkflowStage,
        confirmCompletion: confirmCompletion,
      } as any);
      setShowWorkflowModal(false);
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Failed to update status');
    } finally {
      setStatusLoading(false);
    }
  };

  // --------------------
  // Checklist
  // --------------------
  const refreshWorkflowContext = async (caseId: string) => {
    const [workflowResult, invoicesResult] = await Promise.allSettled([
      getWorkflowForCase(caseId),
      getInvoicesForCase(caseId),
    ]);

    if (workflowResult.status === 'fulfilled') {
      setWorkflowInstance(workflowResult.value);
    }

    if (invoicesResult.status === 'fulfilled') {
      setInvoices(invoicesResult.value);
    }
  };

  const onToggleChecklist = async (item: DerivedChecklistItem | TaskChecklistItem) => {
    if (!task?._id) return;
    try {
      setChecklistLoading(true);
      if (workflowChecklistItems.length > 0 && caseData?._id && 'stepKey' in item && item.stepKey && typeof item.actionIndex === 'number') {
        await toggleWorkflowStepAction(caseData._id, item.stepKey, item.actionIndex);
        await refreshWorkflowContext(task.caseId);
      } else if ('_id' in item) {
        const updated = await toggleChecklistItem(task._id, item._id);
        setTask(updated);
      }

      window.dispatchEvent(new CustomEvent('task-report-updated', { detail: { taskId: task._id } }));
    } catch (err: any) {
      setError(err.message || 'Failed to update checklist');
    } finally {
      setChecklistLoading(false);
    }
  };

  const onAddChecklistItem = async () => {
    if (!task?._id) return;
    if (!newChecklistItem.trim()) return;
    try {
      setChecklistLoading(true);
      const updated = await addChecklistItem(task._id, newChecklistItem.trim());
      setTask(updated);
      setNewChecklistItem('');
    } catch (err: any) {
      setError(err.message || 'Failed to add checklist item');
    } finally {
      setChecklistLoading(false);
    }
  };

  const onDeleteChecklistItem = async (itemId: string) => {
    if (!task?._id) return;
    if (!confirm('Delete this checklist item?')) return;
    try {
      setChecklistLoading(true);
      const updated = await deleteChecklistItem(task._id, itemId);
      setTask(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to delete checklist item');
    } finally {
      setChecklistLoading(false);
    }
  };

  const saveQualityScore = async () => {
    if (!task?._id) return;
    const trimmed = qualityScoreDraft.trim();
    if (!trimmed) {
      setError('Please enter a quality score between 0 and 100.');
      return;
    }

    const score = Number(trimmed);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setError('Quality score must be between 0 and 100.');
      return;
    }

    try {
      setQualityScoreLoading(true);
      setError('');
      await updateTask(task._id, { qualityScore: Math.round(score) });
      await loadAll();
      window.dispatchEvent(new CustomEvent('task-report-updated', { detail: { taskId: task._id } }));
    } catch (err: any) {
      setError(err.message || 'Failed to update quality score');
    } finally {
      setQualityScoreLoading(false);
    }
  };

  const updateStageStatus = async (stageIndex: number, status: 'Assigned' | 'In Progress' | 'Completed' | 'Cancelled') => {
    if (!task?._id) return;

    try {
      setStatusLoading(true);
      const nextStages = sortedTaskStages.map((stage, index) =>
        index === stageIndex
          ? {
              ...stage,
              status,
              assignedAt: stage.assignedAt || new Date().toISOString(),
              ...(status === 'Completed' ? { completedAt: new Date().toISOString() } : {}),
            }
          : stage
      );
      const isComplete = nextStages.length > 0 && nextStages.every((stage) => !stage.required || stage.status === 'Completed');

      await updateTask(task._id, {
        workflowMode: 'STAGED',
        taskStages: nextStages,
        status: isComplete ? 'Completed' : 'In Progress',
        workflowStage: isComplete ? 'Completed' : 'In Progress',
        ...(isComplete ? { completedAt: new Date().toISOString() } : {}),
      } as any);

      await loadAll();
      window.dispatchEvent(new CustomEvent('task-report-updated', { detail: { taskId: task._id } }));
    } catch (err: any) {
      setError(err.message || 'Failed to update task stage');
    } finally {
      setStatusLoading(false);
    }
  };

  // --------------------
  // Attachments
  // --------------------
  const openUploadAttachment = () => {
    setAttName('');
    setAttNote('');
    setAttFile(null);
    setAttError('');
    setShowUploadAttModal(true);
  };

  const submitAttachment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    if (!attFile) {
      setAttError('Please choose a file.');
      return;
    }

    try {
      setAttUploading(true);
      setAttError('');
      await uploadTaskAttachment(id, {
        name: attName.trim() || undefined,
        note: attNote.trim() || undefined,
        file: attFile,
      });
      setShowUploadAttModal(false);
      await loadAll();
    } catch (err: any) {
      setAttError(err.message || 'Failed to upload attachment');
    } finally {
      setAttUploading(false);
    }
  };

  const canDeleteAttachment = (att: TaskAttachment) => {
    // when approved locked -> no deletes by anyone
    if (isApprovedLocked) return false;
    if (isManagingDirector) return true;
    return currentUser?.name && att.uploadedBy === currentUser.name;
  };

  const onDeleteAttachment = async (att: TaskAttachment) => {
    if (!confirm('Delete this attachment?')) return;
    try {
      setAttError('');
      await deleteTaskAttachment(att._id);
      await loadAttachments(String(task?._id || id));
    } catch (e: any) {
      setAttError(e.message || 'Failed to delete attachment');
    }
  };

  // --------------------
  // Render guards
  // --------------------
  if (loading) return <div className="py-12 text-center text-gray-500">Loading task...</div>;
  if (error) return <div className="py-12 text-center text-red-600">{error}</div>;
  if (!task) return <div className="py-12 text-center text-gray-500">Task not found.</div>;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/tasks')}
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Tasks
        </button>

        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-gray-900">{task.title}</h1>

              <span className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700 font-medium">
                {task.taskNo || 'Task'}
              </span>

              <span className={`px-2 py-1 text-xs rounded ${getPriorityColor(task.priority)}`}>
                {task.priority}
              </span>

              <span className={`px-2 py-1 text-xs rounded ${getStatusColor(task.status)}`}>
                {task.status}
              </span>

              <span className={`px-2 py-1 text-xs rounded ${getWorkflowStageColor(workflowStage)}`}>
                {workflowStage}
              </span>

              <span
                className={`px-2 py-1 text-xs rounded font-medium ${
                  task.workflowMode === 'STAGED' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {task.workflowMode === 'STAGED' ? 'Staged workflow' : 'Legacy workflow'}
              </span>

              {task.requiresApproval && task.approvalStatus === 'Draft' && (
                <span className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700">Draft</span>
              )}

              {task.requiresApproval && task.approvalStatus === 'Pending' && (
                <span className="px-2 py-1 text-xs rounded bg-purple-100 text-purple-700">
                  Approval Pending
                </span>
              )}

              {task.requiresApproval && task.approvalStatus === 'Approved' && (
                <span className="px-2 py-1 text-xs rounded bg-green-100 text-green-700">Approved</span>
              )}

              {task.requiresApproval && task.approvalStatus === 'Rejected' && (
                <span className="px-2 py-1 text-xs rounded bg-red-100 text-red-700">Rejected</span>
              )}
            </div>

            <p className="text-sm text-gray-600">
              Related to: <span className="text-gray-900 font-medium">{relatedCaseLabel}</span>
            </p>

            <p className="text-sm text-gray-600 mt-1">
              Related client: <span className="text-gray-900 font-medium">{task.relatedClient || relatedCaseLabel}</span>
            </p>

            {relatedCaseMessage ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {relatedCaseMessage}
              </div>
            ) : null}

            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
                <span>Workflow</span>
                <span>{workflowStageIndex + 1} / {TASK_WORKFLOW_STAGES.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                {TASK_WORKFLOW_STAGES.map((stage, index) => {
                  const active = index <= workflowStageIndex;
                  const current = stage === workflowStage;
                  return (
                    <div
                      key={stage}
                      className={`rounded-md border px-2 py-2 text-[11px] font-semibold leading-tight ${
                        current
                          ? 'border-gray-900 bg-gray-900 text-white'
                          : active
                            ? 'border-gray-300 bg-white text-gray-700'
                            : 'border-dashed border-gray-200 bg-white text-gray-400'
                      }`}
                    >
                      <div className="truncate">{stage}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ✅ Locked banner */}
            {isApprovedLocked && (
              <div className="mt-3 bg-gray-50 border border-gray-200 text-gray-700 px-4 py-3 rounded text-sm">
                This task has been <span className="font-semibold">finalized</span> and is now{' '}
                <span className="font-semibold">locked (view-only)</span>.
              </div>
            )}
          </div>

          {showApproveReject && (
            <div className="flex gap-2">
              <button
                onClick={() => openApproval('approve')}
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60"
                disabled={approvalLoading || isApprovedLocked}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Approve
              </button>
              <button
                onClick={() => openApproval('reject')}
                className="inline-flex items-center px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-60"
                disabled={approvalLoading || isApprovedLocked}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Reject
              </button>
            </div>
          )}
        </div>

        {/* Key Info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center text-gray-600 mb-1">
              <FileText className="w-4 h-4 mr-2" />
              <span className="text-xs">Task Number</span>
            </div>
            <p className="text-sm font-medium text-gray-900">{task.taskNo || '—'}</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center text-gray-600 mb-1">
              <UserIcon className="w-4 h-4 mr-2" />
              <span className="text-xs">Assigned To</span>
            </div>
            <p className="text-sm font-medium text-gray-900">{task.assignee}</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center text-gray-600 mb-1">
              <UserIcon className="w-4 h-4 mr-2" />
              <span className="text-xs">Supervisor</span>
            </div>
            <p className="text-sm font-medium text-gray-900">{task.supervisor || '—'}</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center text-gray-600 mb-1">
              <Clock className="w-4 h-4 mr-2" />
              <span className="text-xs">Due Date</span>
            </div>
            <p className="text-sm font-medium text-gray-900">{formatDeadlineDateTime(task.dueDate)}</p>
          </div>
        </div>

        {task.workflowMode === 'STAGED' && sortedTaskStages.length > 0 && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-gray-900">Staged Contributors</h2>
                <p className="text-sm text-gray-500">Each stage can be completed separately by the assigned staff member.</p>
              </div>
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
                {sortedTaskStages.filter((stage) => stage.status === 'Completed').length} / {sortedTaskStages.length} completed
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {sortedTaskStages.map((stage, index) => {
                const meName = normalizeIdentity(currentUser?.name);
                const meEmail = normalizeIdentity(currentUser?.email);
                const staffMember = normalizeIdentity(stage.staffMember);
                const isMine = Boolean(staffMember && (staffMember === meName || staffMember === meEmail));
                const priorStagesComplete = sortedTaskStages
                  .slice(0, index)
                  .every((prev) => !prev.required || prev.status === 'Completed');
                const canActOnStage = isMine && priorStagesComplete && stage.status !== 'Completed' && canWorkOnTask;

                return (
                  <div key={`${task._id}-${stage.sequence}-${stage.role}`} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
                          {stage.sequence}. {stage.role}
                        </div>
                        <div className="mt-1 text-sm font-medium text-gray-900">{stage.staffMember || 'Unassigned'}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          Due: {stage.dueAt ? formatDeadlineDateTime(stage.dueAt) : '—'}
                        </div>
                      </div>
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStageStatusColor(stage.status)}`}>
                        {stage.status}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      {stage.completedAt ? <span>Completed: {new Date(stage.completedAt).toLocaleDateString()}</span> : <span>Not completed yet</span>}
                      {stage.qualityScore != null ? <span>Quality: {stage.qualityScore}%</span> : null}
                    </div>

                    {canActOnStage ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => updateStageStatus(index, 'In Progress')}
                          disabled={statusLoading}
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                        >
                          Begin {stage.role}
                        </button>
                        <button
                          type="button"
                          onClick={() => updateStageStatus(index, 'Completed')}
                          disabled={statusLoading}
                          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                        >
                          {getStagePrimaryActionLabel(stage.role)}
                        </button>
                      </div>
                    ) : isMine && !priorStagesComplete && stage.status !== 'Completed' ? (
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        Waiting for the earlier stage to be completed before you can act on this one.
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="font-semibold text-gray-900 mb-3">Description</h2>
            <p className="text-sm text-gray-600 whitespace-pre-line">{task.description || '—'}</p>
          </div>

          {/* Attachments */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">
                  Task Attachments{' '}
                  <span className="text-gray-500 font-medium">({attachments.length})</span>
                </h2>
                <p className="text-sm text-gray-500">
                  Upload documents specifically for this task. (Also visible under Case Documents)
                </p>
              </div>

              <button
                type="button"
                onClick={openUploadAttachment}
                disabled={!canWorkOnTask}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-60"
              >
                <Upload className="w-4 h-4" />
                Upload
              </button>
            </div>

            {attError && (
              <div className="px-6 py-3 text-sm text-red-700 bg-red-50 border-b border-red-100">
                {attError}
              </div>
            )}

            {attLoading ? (
              <div className="px-6 py-10 text-gray-500">Loading attachments...</div>
            ) : attachments.length === 0 ? (
              <div className="px-6 py-10 text-gray-500">No attachments uploaded for this task yet.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {attachments.map((att, idx) => (
                  <div key={att._id} className="px-6 py-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="w-7 text-sm text-gray-400 font-medium pt-0.5">{idx + 1}.</div>
                      <FileText className="w-5 h-5 text-gray-600 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-900 truncate">{att.name}</div>
                        <div className="text-sm text-gray-500 mt-1">
                          Uploaded by <span className="font-medium">{att.uploadedBy}</span> on{' '}
                          <span className="font-medium">{att.uploadedDate}</span> • {att.size}
                        </div>
                        {att.note ? <div className="text-sm text-gray-600 mt-2">{att.note}</div> : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={BACKEND_URL + att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                        title="View"
                      >
                        <Eye className="w-4 h-4" />
                        <span className="hidden sm:inline">View</span>
                      </a>

                      <a
                        href={BACKEND_URL + att.url}
                        download
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                        title="Download"
                      >
                        Download
                      </a>

                      {canDeleteAttachment(att) && (
                        <button
                          type="button"
                          onClick={() => onDeleteAttachment(att)}
                          className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-red-200 rounded text-red-700 hover:bg-red-50"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span className="hidden sm:inline">Delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Checklist */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
              <div>
                <h2 className="font-semibold text-gray-900">Task Checklist</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {workflowChecklistItems.length > 0
                    ? 'Auto-synced from the workflow key actions.'
                    : 'Manual checklist for tasks without workflow actions.'}
                </p>
              </div>
              <span className="text-sm text-gray-600">{workflowProgressPercentage}% Complete</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Workflow Progress</div>
                <div className="mt-2 text-lg font-semibold text-gray-900">{workflowProgressPercentage}%</div>
                <div className="text-xs text-gray-500">Checked key actions from the workflow</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Collected</div>
                <div className="mt-2 text-lg font-semibold text-gray-900">{formatMoney(matterCollectedFee)}</div>
                <div className="text-xs text-gray-500">Total paid on this matter</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Task Fee Collected</div>
                <div className="mt-2 text-lg font-semibold text-green-700">{formatMoney(taskFeeCollected)}</div>
                <div className="text-xs text-gray-500">Collected x workflow progress</div>
              </div>
            </div>

            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
              <div className="h-full bg-gray-800 transition-all" style={{ width: `${workflowProgressPercentage}%` }} />
            </div>

            {workflowChecklistItems.length > 0 ? (
              <div className="space-y-2">
                {workflowChecklistItems.map((item) => (
                  <div key={item.id} className="rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={() => onToggleChecklist(item)}
                        disabled={!canToggleChecklist || checklistLoading}
                        className="mt-1 h-4 w-4 rounded border-gray-300"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-sm font-medium ${item.completed ? 'text-gray-500' : 'text-gray-900'}`}>
                            {item.item}
                          </span>
                          {item.completed && (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                              Checked
                            </span>
                          )}
                        </div>
                        {item.stepTitle && <div className="mt-1 text-xs text-gray-500">{item.stepTitle}</div>}
                      </div>
                    </label>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="flex gap-2 mb-4">
                  <input
                    value={newChecklistItem}
                    onChange={(e) => setNewChecklistItem(e.target.value)}
                    placeholder="Add checklist item..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded"
                    disabled={!canWorkOnTask || checklistLoading}
                  />
                  <button
                    type="button"
                    onClick={onAddChecklistItem}
                    disabled={!canWorkOnTask || checklistLoading || !newChecklistItem.trim()}
                    className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-60"
                  >
                    Add
                  </button>
                </div>

                <div className="space-y-2">
                  {manualChecklistItems.length === 0 ? (
                    <div className="text-sm text-gray-500">No checklist items yet.</div>
                  ) : (
                    manualChecklistItems.map((item) => (
                      <div key={item._id} className="flex items-center gap-3 py-2 hover:bg-gray-50 rounded px-2">
                        <input
                          type="checkbox"
                          checked={item.completed}
                          onChange={() => onToggleChecklist(item)}
                          disabled={!canToggleChecklist || checklistLoading}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <span className={`text-sm flex-1 ${item.completed ? 'text-gray-500' : 'text-gray-900'}`}>
                          {item.item}
                        </span>

                        {canWorkOnTask && (
                          <button
                            type="button"
                            onClick={() => onDeleteChecklistItem(item._id)}
                            className="text-xs text-red-600 hover:text-red-800"
                            disabled={checklistLoading}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* Quality Score */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="font-semibold text-gray-900">Quality Score</h2>
                <p className="text-sm text-gray-500">
                  {isTaskSupervisor || isManagingDirector || currentUser?.role === 'executive_assistant'
                    ? 'Assigned supervisors can update this score.'
                    : 'Supervisor review score.'}
                </p>
              </div>
              <div className="text-lg font-semibold text-gray-900">
                {task.qualityScore == null ? '—' : `${task.qualityScore}%`}
              </div>
            </div>

            {canSetQualityScore ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={qualityScoreDraft}
                  onChange={(e) => setQualityScoreDraft(e.target.value)}
                  placeholder="Enter 0-100"
                  className="w-full sm:max-w-[180px] px-3 py-2 border border-gray-300 rounded"
                  disabled={qualityScoreLoading}
                />
                <button
                  type="button"
                  onClick={saveQualityScore}
                  disabled={qualityScoreLoading}
                  className="inline-flex items-center justify-center px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-60"
                >
                  {qualityScoreLoading ? 'Saving…' : 'Save Quality Score'}
                </button>
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                {task.qualityScore == null ? 'Not yet scored.' : 'Read only.'}
              </div>
            )}
          </div>

          {/* Case Documents */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Case Documents</h2>
              <button
                className="text-sm text-gray-600 hover:text-gray-900"
                onClick={() => navigate(`/cases/${task.caseId}`)}
                type="button"
              >
                Open Case →
              </button>
            </div>

            <div className="space-y-2">
              {documents.length === 0 ? (
                <div className="text-sm text-gray-500">No documents uploaded for this case yet.</div>
              ) : (
                documents.map((doc) => (
                  <div
                    key={doc._id}
                    className="flex items-center justify-between p-3 border border-gray-200 rounded hover:bg-gray-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">{doc.name}</p>
                      <p className="text-xs text-gray-500">
                        {doc.size} • {doc.uploadedDate}
                      </p>
                    </div>
                    <a
                      href={BACKEND_URL + doc.url}
                      className="text-xs text-gray-600 hover:text-gray-900"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Task Info */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Task Information</h3>
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-gray-600">Task Number:</span>
                <p className="font-medium text-gray-900">{task.taskNo || '—'}</p>
              </div>
              <div>
                <span className="text-gray-600">Related Client:</span>
                <p className="font-medium text-gray-900">{task.relatedClient || relatedCaseLabel}</p>
              </div>
              <div>
                <span className="text-gray-600">Workflow Stage:</span>
                <p className="font-medium text-gray-900">{workflowStage}</p>
              </div>
              <div>
                <span className="text-gray-600">Supervisor:</span>
                <p className="font-medium text-gray-900">{task.supervisor || '—'}</p>
              </div>
              <div>
                <span className="text-gray-600">Start Date:</span>
                <p className="font-medium text-gray-900">{task.startDate || '—'}</p>
              </div>
              <div>
                <span className="text-gray-600">Due Date:</span>
                <p className="font-medium text-gray-900">{task.dueDate ? formatDeadlineDateTime(task.dueDate) : '—'}</p>
              </div>
              <div>
                <span className="text-gray-600">Completion Date:</span>
                <p className="font-medium text-gray-900">{completionDateLabel}</p>
              </div>
              <div>
                <span className="text-gray-600">Created:</span>
                <p className="font-medium text-gray-900">
                  {task.createdAt ? new Date(task.createdAt).toLocaleDateString() : '—'}
                </p>
              </div>
              <div>
                <span className="text-gray-600">Assigned By:</span>
                <p className="font-medium text-gray-900">{task.assignedBy || '—'}</p>
              </div>
              <div>
                <span className="text-gray-600">Requires Approval:</span>
                <p className="font-medium text-gray-900">{task.requiresApproval ? 'Yes' : 'No'}</p>
              </div>

              {task.requiresApproval && (
                <div>
                  <span className="text-gray-600">Approval Status:</span>
                  <p className="font-medium text-gray-900">{task.approvalStatus || 'Draft'}</p>
                </div>
              )}

              {task.approvedBy && (
                <div>
                  <span className="text-gray-600">Decision By:</span>
                  <p className="font-medium text-gray-900">{task.approvedBy}</p>
                </div>
              )}

              {/* ✅ Show feedback */}
              {task.approvalComment && (
                <div>
                  <span className="text-gray-600">Feedback / Note:</span>
                  <p className="font-medium text-gray-900 whitespace-pre-line">
                    {task.approvalComment}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Actions</h3>
            <div className="space-y-2">
              <button
                className="w-full px-4 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => navigate(`/cases/${task.caseId}`)}
                type="button"
              >
                View Case Details
              </button>

              <button
                className="w-full px-4 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                onClick={openUpdateStatus}
                type="button"
                disabled={!canWorkOnTask}
              >
                Update Workflow
              </button>

              {/* Submit */}
              <button
                className="w-full px-4 py-2 bg-gray-900 text-white rounded text-sm hover:bg-gray-800 disabled:opacity-60"
                onClick={submitAction}
                disabled={
                  !canWorkOnTask ||
                  approvalLoading ||
                  (task.requiresApproval && !(task.approvalStatus === 'Draft' || task.approvalStatus === 'Rejected'))
                }
                type="button"
              >
                {approvalLoading
                  ? 'Submitting...'
                  : task.requiresApproval
                    ? 'Submit for Approval'
                    : 'Submit Task'}
              </button>

              {/* If MD: approve/reject handled in top buttons */}
              {showSubmitForApproval && false && (
                <button
                  className="w-full px-4 py-2 bg-gray-900 text-white rounded text-sm hover:bg-gray-800 disabled:opacity-60"
                  onClick={submitTaskForApproval}
                  disabled={approvalLoading}
                  type="button"
                >
                  Submit for Approval
                </button>
              )}
            </div>
          </div>

          {/* Activity History (latest 6 only) */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Activity History</h3>
            <div className="space-y-3">
              {auditLogs.length === 0 ? (
                <div className="text-sm text-gray-500">No activity yet.</div>
              ) : (
                auditLogs.map((entry) => (
                  <div key={entry._id} className="text-sm">
                    <p className="font-medium text-gray-900">{entry.actorName}</p>
                    <p className="text-gray-600">{entry.message}</p>
                    {entry.detail ? <p className="text-gray-500">{entry.detail}</p> : null}
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Upload Attachment Modal (kept as you already have) */}
      {showUploadAttModal && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full flex flex-col" style={{ maxHeight: '90vh' }}>
            {/* Header */}
            <div className="p-6 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Upload Task Attachment</h3>
              <button
                type="button"
                onClick={() => setShowUploadAttModal(false)}
                className="text-gray-500 hover:text-gray-700"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={submitAttachment} className="flex-1 overflow-y-auto space-y-4 p-6">
              {attError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
                  {attError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Document Name (optional)</label>
                <input
                  value={attName}
                  onChange={(e) => setAttName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="e.g., Draft Submissions PDF"
                  disabled={attUploading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
                <textarea
                  value={attNote}
                  onChange={(e) => setAttNote(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  disabled={attUploading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">File *</label>
                <input
                  type="file"
                  required
                  onChange={(e) => setAttFile(e.target.files?.[0] || null)}
                  className="w-full"
                  disabled={attUploading}
                />
              </div>

              {/* Footer */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUploadAttModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                  disabled={attUploading}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={attUploading}
                  className="flex-1 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 disabled:opacity-60"
                >
                  {attUploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Workflow update modal */}
      {showWorkflowModal && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full flex flex-col" style={{ maxHeight: '90vh' }}>
            {/* Header */}
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Update Task Workflow</h3>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto space-y-4 p-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Workflow Stage</label>
                <select
                  value={newWorkflowStage}
                  onChange={(e) => {
                    setNewWorkflowStage(e.target.value as TaskWorkflowStage);
                    setConfirmCompletion(false);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  disabled={statusLoading}
                >
                  {TASK_WORKFLOW_STAGES.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                </select>
              </div>

              {newWorkflowStage === 'Closed' && (
                <label className="flex items-start gap-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={confirmCompletion}
                    onChange={(e) => setConfirmCompletion(e.target.checked)}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    Confirm that the task has been completed and is ready to close.
                  </span>
                </label>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowWorkflowModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                  disabled={statusLoading}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={saveStatus}
                  className="flex-1 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 disabled:opacity-60"
                  disabled={statusLoading || (newWorkflowStage === 'Closed' && !confirmCompletion)}
                >
                  {statusLoading ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Approval Modal (your requested format) */}
      {showApprovalModal && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full flex flex-col" style={{ maxHeight: '90vh' }}>
            {/* Header */}
            <div className="p-6 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {approvalAction === 'approve' ? 'Approve Task' : 'Reject Task'}
              </h3>
              <button
                type="button"
                onClick={() => setShowApprovalModal(false)}
                className="text-gray-500 hover:text-gray-700"
                title="Close"
                disabled={approvalLoading}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto space-y-4 p-6">
              <p className="text-sm text-gray-600">
                {approvalAction === 'approve'
                  ? 'Confirm approval of this task. You can add optional comments below.'
                  : 'Please provide feedback on why this task is being rejected.'}
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Comment / Feedback
                </label>
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="Write feedback here..."
                  disabled={approvalLoading}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowApprovalModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                  disabled={approvalLoading}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={confirmApproval}
                  disabled={approvalLoading}
                  className={`flex-1 px-4 py-2 rounded text-white disabled:opacity-60 ${
                    approvalAction === 'approve'
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {approvalLoading ? 'Working...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
