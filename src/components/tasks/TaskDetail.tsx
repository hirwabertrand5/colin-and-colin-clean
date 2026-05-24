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
  submitTaskForApproval,
  approveTask,
  rejectTask,
  getTimeLogsForTask,
  addTimeLogToTask,
  TimeLog,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
  updateTask,
} from '../../services/taskService';

import { getCaseById, CaseData } from '../../services/caseService';
import { getDocumentsForCase, CaseDocument } from '../../services/documentService';
import { getAuditForCase, AuditLogItem } from '../../services/auditService';

import {
  listTaskAttachments,
  uploadTaskAttachment,
  deleteTaskAttachment,
  TaskAttachment,
} from '../../services/taskAttachmentService';

interface TaskDetailProps {
  userRole: UserRole;
}

const API_URL = import.meta.env.VITE_API_URL;
const BACKEND_URL = API_URL ? API_URL.replace(/\/api\/?$/, '') : '';

export default function TaskDetail({ userRole }: TaskDetailProps) {
  const { id } = useParams();
  const navigate = useNavigate();

  const [task, setTask] = useState<TaskData | null>(null);
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [documents, setDocuments] = useState<CaseDocument[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);

  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [totalHours, setTotalHours] = useState<number>(0);

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

  // Log hours modal
  const [showLogHours, setShowLogHours] = useState(false);
  const [hoursValue, setHoursValue] = useState<string>('');
  const [hoursNote, setHoursNote] = useState<string>('');
  const [hoursLoading, setHoursLoading] = useState(false);

  // Checklist
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [checklistLoading, setChecklistLoading] = useState(false);

  // Update status modal
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState<'Not Started' | 'In Progress' | 'Completed'>('Not Started');
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
    return Boolean(task?.requiresApproval && task?.approvalStatus === 'Approved');
  }, [task?.requiresApproval, task?.approvalStatus]);

  // We now enforce read-only after Approved for everyone:
  const canWorkOnTask = useMemo(() => {
    if (!task) return false;
    if (isApprovedLocked) return false;
    if (isManagingDirector) return true;
    return currentUser?.name && task.assignee === currentUser.name;
  }, [task, isManagingDirector, currentUser, isApprovedLocked]);

  const relatedCaseLabel = useMemo(() => {
    if (!caseData) return '—';
    return caseData.parties || caseData.caseNo || '—';
  }, [caseData]);

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

  const completionPercentage = useMemo(() => {
    const list = task?.checklist || [];
    if (!list.length) return 0;
    const done = list.filter((c) => c.completed).length;
    return Math.round((done / list.length) * 100);
  }, [task?.checklist]);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'High':
        return 'bg-red-100 text-red-700';
      case 'Medium':
        return 'bg-yellow-100 text-yellow-700';
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
    try {
      const t = await getTaskById(id);
      setTask(t);

      const [c, docs, audit, time] = await Promise.all([
        getCaseById(t.caseId),
        getDocumentsForCase(t.caseId),
        getAuditForCase(t.caseId),
        getTimeLogsForTask(id),
      ]);

      setCaseData(c);
      setDocuments(docs);

      // ✅ Only show latest 6 activity logs
      setAuditLogs((audit || []).slice(0, 6));

      setTimeLogs(time.logs);
      setTotalHours(time.totalHours);

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
    setNewStatus(task.status);
    setShowStatusModal(true);
  };

  const saveStatus = async () => {
    if (!task?._id) return;
    try {
      setStatusLoading(true);
      await updateTask(task._id, { status: newStatus });
      setShowStatusModal(false);
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
  const onToggleChecklist = async (itemId: string) => {
    if (!task?._id) return;
    try {
      setChecklistLoading(true);
      const updated = await toggleChecklistItem(task._id, itemId);
      setTask(updated);
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

  // --------------------
  // Time logs
  // --------------------
  const openLogHours = () => {
    setHoursValue('');
    setHoursNote('');
    setShowLogHours(true);
  };

  const submitHours = async () => {
    if (!task?._id) return;
    const num = Number(hoursValue);
    if (!Number.isFinite(num) || num <= 0) {
      setError('Hours must be a positive number.');
      return;
    }

    try {
      setHoursLoading(true);
      await addTimeLogToTask(task._id, { hours: num, note: hoursNote });
      setShowLogHours(false);
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Failed to log hours');
    } finally {
      setHoursLoading(false);
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

              <span className={`px-2 py-1 text-xs rounded ${getPriorityColor(task.priority)}`}>
                {task.priority}
              </span>

              <span className={`px-2 py-1 text-xs rounded ${getStatusColor(task.status)}`}>
                {task.status}
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

            {/* ✅ Locked banner */}
            {isApprovedLocked && (
              <div className="mt-3 bg-gray-50 border border-gray-200 text-gray-700 px-4 py-3 rounded text-sm">
                This task has been <span className="font-semibold">Approved</span> and is now{' '}
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
              <UserIcon className="w-4 h-4 mr-2" />
              <span className="text-xs">Assigned To</span>
            </div>
            <p className="text-sm font-medium text-gray-900">{task.assignee}</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center text-gray-600 mb-1">
              <Clock className="w-4 h-4 mr-2" />
              <span className="text-xs">Due Date</span>
            </div>
            <p className="text-sm font-medium text-gray-900">{task.dueDate}</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center text-gray-600 mb-1">
              <Clock className="w-4 h-4 mr-2" />
              <span className="text-xs">Actual Hours</span>
            </div>
            <p className="text-sm font-medium text-gray-900">{totalHours.toFixed(1)}h</p>
          </div>
        </div>
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Task Checklist</h2>
              <span className="text-sm text-gray-600">{completionPercentage}% Complete</span>
            </div>

            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-gray-800 transition-all"
                style={{ width: `${completionPercentage}%` }}
              />
            </div>

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
              {(task.checklist || []).length === 0 ? (
                <div className="text-sm text-gray-500">No checklist items yet.</div>
              ) : (
                task.checklist!.map((item) => (
                  <div
                    key={item._id}
                    className="flex items-center gap-3 py-2 hover:bg-gray-50 rounded px-2"
                  >
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={() => onToggleChecklist(item._id)}
                      disabled={!canWorkOnTask || checklistLoading}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span
                      className={`text-sm flex-1 ${
                        item.completed ? 'line-through text-gray-500' : 'text-gray-900'
                      }`}
                    >
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
                onClick={openLogHours}
                type="button"
                disabled={!canWorkOnTask}
              >
                Log Hours
              </button>

              <button
                className="w-full px-4 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                onClick={openUpdateStatus}
                type="button"
                disabled={!canWorkOnTask}
              >
                Update Status
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

          {/* Time Logs list */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Time Logs</h3>
            <div className="space-y-3">
              {timeLogs.length === 0 ? (
                <div className="text-sm text-gray-500">No hours logged yet.</div>
              ) : (
                timeLogs.slice(0, 8).map((log) => (
                  <div key={log._id} className="text-sm">
                    <p className="font-medium text-gray-900">{log.userName}</p>
                    <p className="text-gray-600">Logged {log.hours} hours</p>
                    {log.note ? <p className="text-gray-500">{log.note}</p> : null}
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date((log as any).loggedAt || (log as any).createdAt).toLocaleString()}
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

      {/* ✅ Update Status Modal (your requested format) */}
      {showStatusModal && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full flex flex-col" style={{ maxHeight: '90vh' }}>
            {/* Header */}
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Update Status</h3>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto space-y-4 p-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as any)}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  disabled={statusLoading}
                >
                  <option value="Not Started">Not Started</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowStatusModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                  disabled={statusLoading}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={saveStatus}
                  className="flex-1 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 disabled:opacity-60"
                  disabled={statusLoading}
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

      {/* ✅ Log Hours Modal (same format) */}
      {showLogHours && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full flex flex-col" style={{ maxHeight: '90vh' }}>
            {/* Header */}
            <div className="p-6 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Log Hours</h3>
              <button
                type="button"
                onClick={() => setShowLogHours(false)}
                className="text-gray-500 hover:text-gray-700"
                title="Close"
                disabled={hoursLoading}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto space-y-4 p-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hours *</label>
                <input
                  value={hoursValue}
                  onChange={(e) => setHoursValue(e.target.value)}
                  placeholder="e.g. 2.5"
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  inputMode="decimal"
                  disabled={hoursLoading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
                <textarea
                  value={hoursNote}
                  onChange={(e) => setHoursNote(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  disabled={hoursLoading}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowLogHours(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                  disabled={hoursLoading}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={submitHours}
                  disabled={hoursLoading}
                  className="flex-1 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 disabled:opacity-60"
                >
                  {hoursLoading ? 'Saving...' : 'Log Hours'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}