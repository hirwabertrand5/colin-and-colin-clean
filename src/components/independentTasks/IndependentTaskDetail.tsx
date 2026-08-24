import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  History,
  Loader2,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Reply,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { UserRole } from '../../App';
import usePageTitle from '../../hooks/usePageTitle';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { formatDeadlineDateTime } from '../../utils/workflowDeadline';
import {
  addIndependentTaskComment,
  deleteIndependentTaskAttachment,
  getIndependentTask,
  getIndependentTaskHistory,
  IndependentTask,
  IndependentTaskAttachment,
  IndependentTaskComment,
  IndependentTaskHistory,
  IndependentTaskPriority,
  IndependentTaskStatus,
  listIndependentTaskAttachments,
  listIndependentTaskComments,
  transitionIndependentTask,
  uploadIndependentTaskAttachment,
} from '../../services/independentTaskService';

const BACKEND_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api\/?$/, '');

const WORKFLOW_STATUSES: IndependentTaskStatus[] = [
  'Created',
  'Assigned',
  'Acknowledged',
  'In Progress',
  'Awaiting Review',
  'Awaiting External Action',
  'Completed',
  'Closed',
];

const WORKFLOW_FLOW: Record<IndependentTaskStatus, IndependentTaskStatus[]> = {
  Created: ['Assigned'],
  Assigned: ['Acknowledged'],
  Acknowledged: ['In Progress'],
  'In Progress': ['Awaiting Review', 'Awaiting External Action'],
  'Awaiting Review': ['Completed'],
  'Awaiting External Action': ['In Progress'],
  Completed: ['Closed'],
  Closed: [],
};

const ADMIN_ROLES: UserRole[] = [
  'managing_director',
  'managing_partner',
  'executive_managing_partner',
  'senior_partner',
  'partner',
  'executive_partner',
  'associate_partner',
  'executive_associate_partner',
  'senior_executive_assistant',
  'executive_assistant',
  'originating_attorney',
];

const statusTone: Record<IndependentTaskStatus, string> = {
  Created: 'bg-gray-100 text-gray-700 border-gray-200',
  Assigned: 'bg-blue-50 text-blue-700 border-blue-100',
  Acknowledged: 'bg-sky-50 text-sky-700 border-sky-100',
  'In Progress': 'bg-indigo-50 text-indigo-700 border-indigo-100',
  'Awaiting Review': 'bg-amber-50 text-amber-700 border-amber-100',
  'Awaiting External Action': 'bg-orange-50 text-orange-700 border-orange-100',
  Completed: 'bg-green-50 text-green-700 border-green-100',
  Closed: 'bg-gray-900 text-white border-gray-900',
};

const priorityTone: Record<IndependentTaskPriority, string> = {
  Low: 'bg-green-50 text-green-700 border-green-100',
  Medium: 'bg-yellow-50 text-yellow-800 border-yellow-100',
  High: 'bg-red-50 text-red-700 border-red-100',
  Critical: 'bg-rose-600 text-white border-rose-600',
};

const formatDateTime = (value?: string | Date) => {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

const formatDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
};

const getActorUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null') as { id?: string; name?: string; role?: UserRole } | null;
  } catch {
    return null;
  }
};

type CommentNode = IndependentTaskComment & { replies: CommentNode[] };

interface IndependentTaskDetailProps {
  userRole: UserRole;
}

export default function IndependentTaskDetail({ userRole }: IndependentTaskDetailProps) {
  const { id } = useParams();

  const currentUser = useMemo(() => getActorUser(), []);
  const isAdmin = ADMIN_ROLES.includes(userRole);

  const [task, setTask] = useState<IndependentTask | null>(null);
  const [history, setHistory] = useState<IndependentTaskHistory[]>([]);
  const [comments, setComments] = useState<IndependentTaskComment[]>([]);
  const [attachments, setAttachments] = useState<IndependentTaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'comments' | 'attachments' | 'activity'>('overview');

  const [statusBusy, setStatusBusy] = useState<IndependentTaskStatus | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);

  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentNote, setAttachmentNote] = useState('');
  const [uploading, setUploading] = useState(false);

  usePageTitle(task ? `${task.taskNumber} • Independent Tasks` : 'Independent Task Detail');

  const canEdit = Boolean(task && (isAdmin || task.status !== 'Closed'));
  const canAct = Boolean(
    task && (isAdmin || currentUser?.name === task.assignee || currentUser?.name === task.supervisor)
  );
  const canComment = Boolean(task && task.status !== 'Closed' && (canAct || isAdmin));

  const loadData = async () => {
    if (!id) {
      setError('Task id is required.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    setTask(null);
    setHistory([]);
    setComments([]);
    setAttachments([]);
    try {
      const [taskData, historyData, commentsData, attachmentsData] = await Promise.all([
        getIndependentTask(id),
        getIndependentTaskHistory(id),
        listIndependentTaskComments(id),
        listIndependentTaskAttachments(id),
      ]);
      setTask(taskData);
      setHistory(historyData || []);
      setComments(commentsData || []);
      setAttachments(attachmentsData || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load task.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const commentsTree = useMemo(() => {
    const byParent = new Map<string, CommentNode[]>();
    const nodeMap = new Map<string, CommentNode>();

    comments.forEach((comment) => {
      nodeMap.set(comment._id, { ...comment, replies: [] });
    });

    nodeMap.forEach((node) => {
      const parentId = node.parentCommentId ? String(node.parentCommentId) : '';
      if (!parentId) return;
      const bucket = byParent.get(parentId) || [];
      bucket.push(node);
      byParent.set(parentId, bucket);
    });

    nodeMap.forEach((node) => {
      node.replies = byParent.get(node._id) || [];
    });

    return comments
      .filter((comment) => !comment.parentCommentId)
      .map((comment) => nodeMap.get(comment._id))
      .filter(Boolean) as CommentNode[];
  }, [comments]);

  const allowedTransitions = useMemo(() => {
    if (!task) return [];
    if (isAdmin) {
      return WORKFLOW_STATUSES.filter((status) => status !== task.status && !(status === 'Closed' && task.status !== 'Completed'));
    }
    return WORKFLOW_FLOW[task.status] || [];
  }, [isAdmin, task]);

  const getTransitionLabel = (next: IndependentTaskStatus) => {
    switch (next) {
      case 'Assigned':
        return 'Assign';
      case 'Acknowledged':
        return 'Acknowledge';
      case 'In Progress':
        return 'Resume';
      case 'Awaiting Review':
        return 'Request Review';
      case 'Awaiting External Action':
        return 'Await External Action';
      case 'Completed':
        return 'Mark Completed';
      case 'Closed':
        return 'Close Task';
      default:
        return next;
    }
  };

  const refreshTask = async () => {
    await loadData();
  };

  const handleTransition = async (nextStatus: IndependentTaskStatus) => {
    if (!task) return;
    try {
      setStatusBusy(nextStatus);
      await transitionIndependentTask(task._id, nextStatus);
      toast.success(`Task moved to ${nextStatus}.`);
      await refreshTask();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update workflow');
    } finally {
      setStatusBusy(null);
    }
  };

  const submitComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!task || !canComment) return;
    if (!commentBody.trim()) return toast.error('Comment is required.');

    try {
      setCommentSaving(true);
      await addIndependentTaskComment(task._id, {
        body: commentBody.trim(),
        parentCommentId: replyParentId || undefined,
      });
      toast.success(replyParentId ? 'Reply added.' : 'Comment added.');
      setCommentBody('');
      setReplyParentId(null);
      await refreshTask();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add comment');
    } finally {
      setCommentSaving(false);
    }
  };

  const submitAttachment = async (e: FormEvent) => {
    e.preventDefault();
    if (!task || !canEdit) return;
    if (!attachmentFile) return toast.error('Choose a file to upload.');

    try {
      setUploading(true);
      await uploadIndependentTaskAttachment(task._id, {
        file: attachmentFile,
        fileName: attachmentName.trim() || undefined,
        note: attachmentNote.trim() || undefined,
      });
      toast.success('Attachment uploaded.');
      setAttachmentFile(null);
      setAttachmentName('');
      setAttachmentNote('');
      await refreshTask();
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload attachment');
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (attachmentId: string) => {
    if (!window.confirm('Delete this attachment?')) return;
    try {
      await deleteIndependentTaskAttachment(attachmentId);
      toast.success('Attachment deleted.');
      await refreshTask();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete attachment');
    }
  };

  const renderComment = (comment: CommentNode, depth = 0) => (
    <div key={comment._id} className="space-y-3" style={{ marginLeft: depth * 18 }}>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">{comment.authorName}</span>
              <span className="text-xs text-gray-500">{formatDateTime(comment.createdAt)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{comment.body}</p>
          </div>
          {canComment && (
            <button
              type="button"
              onClick={() => {
                setReplyParentId(comment._id);
                setActiveTab('comments');
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Reply className="h-3.5 w-3.5" />
              Reply
            </button>
          )}
        </div>
      </div>
      {comment.replies.length > 0 && (
        <div className="space-y-3 border-l-2 border-dashed border-gray-200 pl-4">
          {comment.replies.map((reply) => renderComment(reply, depth + 1))}
        </div>
      )}
    </div>
  );

  if (!id) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Task id is required.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <Link to="/matters/independent-tasks" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
              <ArrowLeft className="h-4 w-4" />
              Back to Independent Tasks
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold text-gray-900">{task?.title || 'Independent Task'}</h1>
              {task && (
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone[task.status]}`}>
                  {task.status}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
              <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 font-medium text-gray-700">
                {task?.taskNumber || '—'}
              </span>
              {task?.priority && (
                <span className={`inline-flex rounded-full border px-3 py-1 font-semibold ${priorityTone[task.priority]}`}>
                  {task.priority}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                Due {formatDeadlineDateTime(task?.dueDate)}
              </span>
              {task?.relatedMatterLabel && <span>{task.relatedMatterLabel}</span>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => refreshTask()}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            {allowedTransitions.map((next) => (
              <button
                key={next}
                type="button"
                onClick={() => handleTransition(next)}
                disabled={statusBusy === next || !task || task.status === 'Closed'}
                className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {statusBusy === next ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {getTransitionLabel(next)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-gray-200 bg-white p-10 text-center text-gray-500">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-gray-400" />
          Loading independent task...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : task ? (
        <>
          {task.status === 'Closed' && (
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              This task is closed and locked for editing.
            </div>
          )}

          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="space-y-4">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-2xl bg-white p-2 shadow-sm md:grid-cols-5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="comments">Comments</TabsTrigger>
              <TabsTrigger value="attachments">Attachments</TabsTrigger>
              <TabsTrigger value="activity">Activity Log</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <div className="grid gap-4 xl:grid-cols-3">
                <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-2">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Task Details</div>
                      <dl className="mt-4 space-y-3 text-sm">
                        <div className="flex justify-between gap-4">
                          <dt className="text-gray-500">Title</dt>
                          <dd className="font-medium text-gray-900 text-right">{task.title}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-gray-500">Description</dt>
                          <dd className="max-w-[60%] text-right text-gray-700">{task.description || 'No description provided.'}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-gray-500">Matter</dt>
                          <dd className="text-right text-gray-700">{task.relatedMatterLabel || 'Not linked'}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-gray-500">Client</dt>
                          <dd className="text-right text-gray-700">{task.relatedClient || 'Not linked'}</dd>
                        </div>
                      </dl>
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Ownership</div>
                      <dl className="mt-4 space-y-3 text-sm">
                        <div className="flex justify-between gap-4">
                          <dt className="text-gray-500">Assignee</dt>
                          <dd className="font-medium text-gray-900 text-right">{task.assignee}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-gray-500">Supervisor</dt>
                          <dd className="font-medium text-gray-900 text-right">{task.supervisor}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-gray-500">Start Date</dt>
                          <dd className="text-right text-gray-700">{formatDate(task.startDate)}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-gray-500">Due Date</dt>
                          <dd className="text-right text-gray-700">{formatDeadlineDateTime(task.dueDate)}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Status Summary</div>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Created</span>
                        <span className="text-gray-900">{formatDateTime(task.createdAt)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Updated</span>
                        <span className="text-gray-900">{formatDateTime(task.updatedAt)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Completion</span>
                        <span className="text-gray-900">{formatDateTime(task.completedAt)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Closed</span>
                        <span className="text-gray-900">{formatDateTime(task.closedAt)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Last Action By</span>
                        <span className="text-gray-900">{task.lastActionBy || '—'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Quick Facts</div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">Attachments</div>
                        <div className="mt-1 text-lg font-semibold text-gray-900">{attachments.length}</div>
                      </div>
                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">Comments</div>
                        <div className="mt-1 text-lg font-semibold text-gray-900">{comments.length}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="timeline">
              <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-5 w-5 text-gray-500" />
                  <h2 className="text-lg font-semibold text-gray-900">Workflow Timeline</h2>
                </div>
                <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {WORKFLOW_STATUSES.map((status, index) => {
                    const currentIndex = WORKFLOW_STATUSES.indexOf(task.status);
                    const isActive = status === task.status;
                    const isComplete = currentIndex > index;
                    return (
                      <div
                        key={status}
                        className={`rounded-2xl border p-4 ${
                          isActive
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : isComplete
                              ? 'border-green-200 bg-green-50'
                              : 'border-gray-200 bg-gray-50'
                        }`}
                      >
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">
                          Step {index + 1}
                        </div>
                        <div className="mt-2 text-base font-semibold">{status}</div>
                        <p className="mt-2 text-sm opacity-80">
                          {status === 'Created' && 'Task record created.'}
                          {status === 'Assigned' && 'Owner assigned and task becomes actionable.'}
                          {status === 'Acknowledged' && 'Assignee confirmed receipt.'}
                          {status === 'In Progress' && 'Work is actively underway.'}
                          {status === 'Awaiting Review' && 'Supervisor review requested.'}
                          {status === 'Awaiting External Action' && 'Task paused pending outside input.'}
                          {status === 'Completed' && 'Task completed and ready to close.'}
                          {status === 'Closed' && 'Task fully closed and locked.'}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-8 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Status History</div>
                  <div className="mt-4 space-y-3">
                    {(history || []).filter((item) =>
                      ['TASK_STATUS_CHANGED', 'TASK_COMPLETED', 'TASK_CLOSED', 'TASK_REVIEW_REQUESTED', 'TASK_EXTERNAL_ACTION_REQUESTED'].includes(
                        item.action
                      )
                    ).length === 0 ? (
                      <div className="text-sm text-gray-500">No status transitions recorded yet.</div>
                    ) : (
                      (history || [])
                        .filter((item) =>
                          ['TASK_STATUS_CHANGED', 'TASK_COMPLETED', 'TASK_CLOSED', 'TASK_REVIEW_REQUESTED', 'TASK_EXTERNAL_ACTION_REQUESTED'].includes(
                            item.action
                          )
                        )
                        .map((item) => (
                          <div key={item._id} className="rounded-2xl border border-gray-200 bg-white p-3">
                            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                              <div className="font-medium text-gray-900">{item.message}</div>
                              <div className="text-xs text-gray-500">
                                {item.actorName} • {formatDateTime(item.createdAt)}
                              </div>
                            </div>
                            {item.detail && <div className="mt-1 text-sm text-gray-700">{item.detail}</div>}
                          </div>
                        ))
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="comments">
              <div className="grid gap-4 xl:grid-cols-3">
                <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-2">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-gray-500" />
                    <h2 className="text-lg font-semibold text-gray-900">Discussion Thread</h2>
                  </div>

                  <div className="mt-6 space-y-4">
                    {commentsTree.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
                        No comments yet. Add the first note to start the discussion.
                      </div>
                    ) : (
                      commentsTree.map((comment) => renderComment(comment))
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Send className="h-5 w-5 text-gray-500" />
                    <h3 className="text-lg font-semibold text-gray-900">{replyParentId ? 'Reply to Comment' : 'Add Comment'}</h3>
                  </div>
                  {replyParentId && (
                    <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                      Replying to an existing comment.
                      <button type="button" onClick={() => setReplyParentId(null)} className="ml-2 font-medium underline">
                        Cancel reply
                      </button>
                    </div>
                  )}
                  <form onSubmit={submitComment} className="mt-4 space-y-3">
                    <textarea
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      rows={8}
                      placeholder="Write a comment or instruction..."
                      disabled={!canComment || commentSaving}
                      className="w-full rounded-2xl border border-gray-300 px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:bg-gray-50"
                    />
                    <button
                      type="submit"
                      disabled={!canComment || commentSaving}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                    >
                      {commentSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Post Comment
                    </button>
                  </form>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="attachments">
              <div className="grid gap-4 xl:grid-cols-3">
                <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-2">
                  <div className="flex items-center gap-2">
                    <Paperclip className="h-5 w-5 text-gray-500" />
                    <h2 className="text-lg font-semibold text-gray-900">Uploaded Files</h2>
                  </div>
                  <div className="mt-6 space-y-3">
                    {attachments.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
                        No attachments uploaded yet.
                      </div>
                    ) : (
                      attachments.map((attachment) => (
                        <div key={attachment._id} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <div className="font-medium text-gray-900">{attachment.fileName}</div>
                              <div className="mt-1 text-xs text-gray-500">
                                {attachment.originalName} • {attachment.fileSize} • {attachment.uploadedBy} • {formatDateTime(attachment.createdAt)}
                              </div>
                              {attachment.note && <div className="mt-2 text-sm text-gray-700">{attachment.note}</div>}
                            </div>
                            <div className="flex gap-2">
                              <a
                                href={`${BACKEND_URL}${attachment.url}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                              >
                                <Download className="h-3.5 w-3.5" />
                                Download
                              </a>
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => removeAttachment(attachment._id)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Upload className="h-5 w-5 text-gray-500" />
                    <h3 className="text-lg font-semibold text-gray-900">Upload Attachment</h3>
                  </div>
                  <form onSubmit={submitAttachment} className="mt-4 space-y-3">
                    <input
                      value={attachmentName}
                      onChange={(e) => setAttachmentName(e.target.value)}
                      placeholder="Display file name"
                      disabled={!canEdit || uploading}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:bg-gray-50"
                    />
                    <textarea
                      value={attachmentNote}
                      onChange={(e) => setAttachmentNote(e.target.value)}
                      placeholder="Optional note"
                      rows={4}
                      disabled={!canEdit || uploading}
                      className="w-full rounded-2xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:bg-gray-50"
                    />
                    <input
                      type="file"
                      onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
                      disabled={!canEdit || uploading}
                      className="w-full rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={!canEdit || uploading}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                    >
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      Upload File
                    </button>
                  </form>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="activity">
              <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2">
                  <History className="h-5 w-5 text-gray-500" />
                  <h2 className="text-lg font-semibold text-gray-900">Activity Log</h2>
                </div>

                <div className="mt-6 space-y-4">
                  {(history || []).slice().reverse().length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
                      No activity logged yet.
                    </div>
                  ) : (
                    (history || [])
                      .slice()
                      .reverse()
                      .map((item) => (
                        <div key={item._id} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div>
                              <div className="font-medium text-gray-900">{item.message}</div>
                              {item.detail && <div className="mt-1 text-sm text-gray-700">{item.detail}</div>}
                            </div>
                            <div className="text-xs text-gray-500">
                              {item.actorName} • {formatDateTime(item.createdAt)}
                            </div>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}
