import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
  FileText, Folder, UsersRound, UserRoundCheck, ChevronDown, ArrowRight,
  ClipboardList, ClipboardCheck, ListChecks, BadgeDollarSign, Timer, Info,
  Save, Check, LockKeyhole,
} from 'lucide-react';
import { toast } from 'sonner';
import { UserRole } from '../../App';
import usePageTitle from '../../hooks/usePageTitle';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import './IndependentTaskWorkspace.css';
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
  IndependentTaskStatus,
  listIndependentTaskAttachments,
  listIndependentTaskComments,
  performIndependentTaskCaseLifecycle,
  returnIndependentTaskCaseWork,
  transitionIndependentTask,
  uploadIndependentTaskAttachment,
  deleteIndependentTask,
  getIndependentTaskDisplayStatus,
  canDeleteIndependentTask,
} from '../../services/independentTaskService';
import { uploadedFileUrl } from '../../services/apiConfig';

const WORKFLOW_STATUSES: IndependentTaskStatus[] = [
  'Created',
  'Assigned',
  'Acknowledged',
  'In Progress',
  'Awaiting Review',
  'Awaiting External Action',
  'Completed',
  'Closed',
  'Cancelled',
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
  Cancelled: [],
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

const formatMoney = (value: number | null | undefined, currency = 'RWF') => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en-RW', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value));
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
  const navigate = useNavigate();

  const currentUser = useMemo(() => getActorUser(), []);
  const isAdmin = ADMIN_ROLES.includes(userRole);

  const [task, setTask] = useState<IndependentTask | null>(null);
  const [history, setHistory] = useState<IndependentTaskHistory[]>([]);
  const [comments, setComments] = useState<IndependentTaskComment[]>([]);
  const [attachments, setAttachments] = useState<IndependentTaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'key-actions' | 'timeline' | 'comments' | 'attachments' | 'activity'>('overview');
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [showWorkEditor, setShowWorkEditor] = useState(false);
  const [workDraft, setWorkDraft] = useState('');
  const [progressSaving, setProgressSaving] = useState(false);

  const [statusBusy, setStatusBusy] = useState<IndependentTaskStatus | null>(null);
  const [caseLifecycleBusy, setCaseLifecycleBusy] = useState(false);
  const [returnStepKey, setReturnStepKey] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);

  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentNote, setAttachmentNote] = useState('');
  const [uploading, setUploading] = useState(false);

  usePageTitle(task ? `${task.taskNumber} • Independent Tasks` : 'Independent Task Detail');

  const canEdit = Boolean(
    task && !['Closed', 'Cancelled'].includes(task.status) && (isAdmin || currentUser?.name === task.createdBy || currentUser?.name === task.assignee || currentUser?.name === task.supervisor)
  );
  const canAct = Boolean(
    task && (isAdmin || currentUser?.name === task.assignee || currentUser?.name === task.supervisor)
  );
  const canComment = Boolean(task && !['Closed', 'Cancelled'].includes(task.status) && (canAct || currentUser?.name === task.createdBy));
  const canRemoveAttachment = Boolean(task && !['Closed', 'Cancelled'].includes(task.status) && (isAdmin || currentUser?.name === task.createdBy || currentUser?.name === task.supervisor));

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
    setActiveTab('overview');
    setExpandedAction(null);
    setWorkDraft('');
    setShowWorkEditor(false);
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
    if (['Closed', 'Cancelled'].includes(task.status)) return [];
    if (task.caseRole) return [];
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

  const caseLifecycleLabel = task?.caseRole === 'Initiator'
    ? (task.caseWork?.lifecycleStatus === 'Changes Requested' ? 'Resubmit to Reviewer' : 'Submit to Reviewer')
    : task?.caseRole === 'Reviewer'
      ? 'Submit to Signer / Approver'
      : 'Approve & Complete';

  const performCaseLifecycle = async () => {
    if (!task) return;
    try {
      setCaseLifecycleBusy(true);
      const updated = await performIndependentTaskCaseLifecycle(task._id);
      toast.success(
        updated.caseLifecycleStatus === 'Approved'
          ? 'Key Action approved and completed.'
          : `${updated.caseLifecycleStatus || 'Case lifecycle updated.'}`
      );
      await refreshTask();
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit delegated case work.');
    } finally {
      setCaseLifecycleBusy(false);
    }
  };

  const startDelegatedWork = async () => {
    if (!task) return;
    await handleTransition('In Progress');
  };
  const returnForCorrections = async (event: FormEvent) => {
    event.preventDefault();
    if (!task || !returnStepKey || !returnReason.trim()) return;
    setCaseLifecycleBusy(true);
    try {
      await returnIndependentTaskCaseWork(task._id, returnStepKey, returnReason);
      setReturnStepKey('');
      setReturnReason('');
      toast.success('Work returned to its contributor for corrections.');
      await refreshTask();
    } catch (error: any) { toast.error(error.message || 'Failed to return work.'); }
    finally { setCaseLifecycleBusy(false); }
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

  const deleteTaskRecord = async () => {
    if (!task) return;
    const protectedWork = Boolean(task.caseRole && (task.caseLifecycleCompletedAt || ['In Progress', 'Completed', 'Closed'].includes(task.status)));
    if (!window.confirm(protectedWork
      ? 'Cancel this delegated task? Shared matter documents, approvals and financial history will be preserved.'
      : 'Permanently delete this task, its comments, private attachments, history and notifications? Shared matter documents are preserved.')) return;
    try {
      const result = await deleteIndependentTask(task._id);
      toast.success(result.cancelled ? 'Task cancelled; matter records preserved.' : 'Task and private records deleted.');
      navigate('/matters/independent-tasks');
    } catch (error: any) { toast.error(error.message || 'Failed to delete task.'); }
  };

  const delegated = Boolean(task?.caseRole && task.relatedMatterId);
  const locked = Boolean(task && ['Closed', 'Cancelled'].includes(task.status));
  const displayStatus = task ? getIndependentTaskDisplayStatus(task) : '';
  const actions = task?.caseWork?.selectedKeyActions || [];
  const approved = actions.filter((action) => action.completed).length;
  const progress = actions.length ? Math.round(approved / actions.length * 100) : 0;
  const weight = actions.reduce((sum, action) => sum + (action.percentage || 0), 0);
  const assignments = task?.relatedMatter?.caseAssignments;
  const team = [
    { role: 'Initiator', name: assignments?.initiator || task?.relatedMatter?.assignedTo },
    { role: 'Reviewer', name: assignments?.reviewer },
    { role: 'Signer/Approver', name: assignments?.signerApprover },
  ];
  const contributorCanAct = currentUser?.name === task?.assignee && !locked;
  const canStart = delegated && contributorCanAct && Boolean(task && ['Assigned', 'Acknowledged'].includes(task.status));
  const canSubmit = delegated && contributorCanAct && Boolean(task && ['In Progress', 'Awaiting Review'].includes(task.status)) && actions.some((action) =>
    task?.caseRole === 'Initiator' ? ['Not Started', 'In Progress'].includes(action.status)
      : action.status === (task?.caseRole === 'Reviewer' ? 'Awaiting Review' : 'Awaiting Approval'));
  const standardNext = task && !delegated && !locked ? WORKFLOW_FLOW[task.status]?.[0] : undefined;
  const busy = Boolean(statusBusy || caseLifecycleBusy || progressSaving);
  const stage = actions.length && approved === actions.length ? 3 : actions.some((action) => action.status === 'Awaiting Approval') ? 2 : actions.some((action) => action.status === 'Awaiting Review') ? 1 : 0;
  const standardStage = task && ['Completed', 'Closed'].includes(task.status) ? 3 : task?.status === 'Awaiting Review' ? 2 : ['In Progress', 'Awaiting External Action'].includes(task?.status || '') ? 1 : 0;
  const dueDays = task?.dueDate ? Math.ceil((new Date(task.dueDate).getTime() - Date.now()) / 86400000) : NaN;
  const dueLabel = !Number.isFinite(dueDays) ? '' : dueDays < 0 ? Math.abs(dueDays) + ' days overdue' : dueDays === 0 ? 'Due today' : dueDays + ' days left';
  const avatar = (name?: string, small = false) => <span className={'it-avatar' + (small ? ' it-avatar-small' : '')} aria-hidden="true">{(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>;
  const badge = (value: string) => <span className="it-badge" data-tone={['Completed', 'Approved'].includes(value) ? 'green' : ['Closed', 'Cancelled'].includes(value) ? 'neutral' : ['Changes Requested', 'Awaiting Review', 'Awaiting Approval'].includes(value) ? 'amber' : 'blue'}>{value}</span>;
  const switchTab = (value: typeof activeTab) => { setActiveTab(value); setReturnStepKey(''); };
  const saveProgress = async () => {
    if (!task || !canComment) return;
    if (!workDraft.trim()) { setShowWorkEditor(true); setActiveTab('overview'); return; }
    setProgressSaving(true);
    try {
      await addIndependentTaskComment(task._id, { body: workDraft.trim() });
      setWorkDraft(''); setShowWorkEditor(false);
      toast.success('Work progress saved to the task discussion.');
      await refreshTask();
    } catch (error: any) { toast.error(error.message || 'Failed to save progress.'); }
    finally { setProgressSaving(false); }
  };
  const primaryAction = canStart
    ? <button className="it-button it-primary" disabled={busy} onClick={startDelegatedWork}>{busy ? <Loader2 className="it-spin" /> : <CheckCircle2 />}Start Work</button>
    : canSubmit ? <button className="it-button it-primary" disabled={busy} onClick={performCaseLifecycle}>{busy ? <Loader2 className="it-spin" /> : <Send />}{caseLifecycleLabel}</button>
      : standardNext && canAct ? <button className="it-button it-primary" disabled={busy} onClick={() => handleTransition(standardNext)}><CheckCircle2 />{getTransitionLabel(standardNext)}</button> : null;
  const renderComment = (comment: CommentNode, depth = 0): ReactNode => (
    <div className={'it-comment-thread' + (depth ? ' it-comment-reply' : '')} key={comment._id}>
      <article className="it-comment">{avatar(comment.authorName, true)}<div className="it-comment-body">
        <div className="it-comment-byline"><strong>{comment.authorName}</strong><time>{formatDateTime(comment.createdAt)}</time></div><p>{comment.body}</p>
        {canComment && <button className="it-text-button" onClick={() => { setReplyParentId(comment._id); setActiveTab('comments'); }}><Reply />Reply</button>}
      </div></article>{comment.replies.map((reply) => renderComment(reply, depth + 1))}
    </div>
  );
  const documentsTable = (recent = false) => attachments.length ? <div className="it-table-scroll"><table className="it-documents-table">
    <thead><tr><th>Name</th>{delegated && <th>Linked work</th>}<th>Uploaded by</th><th>Date</th><th>Size</th><th><span className="it-sr-only">Actions</span></th></tr></thead>
    <tbody>{(recent ? attachments.slice(0, 3) : attachments).map((file) => <tr key={file._id}>
      <td><span className="it-file-name"><FileText /><span>{file.fileName}{!recent && file.note && <small>{file.note}</small>}</span></span></td>
      {delegated && <td><span className="it-document-tag">{actions.length === 1 ? actions[0].title : 'Selected Key Actions'}</span></td>}
      <td>{file.uploadedBy}</td><td>{formatDate(file.uploadedDate)}</td><td>{file.fileSize}</td><td><div className="it-row-actions">
        <a className="it-icon-button" aria-label={'Download ' + file.fileName} href={uploadedFileUrl(file.url)} target="_blank" rel="noreferrer"><Download /></a>
        {!recent && canRemoveAttachment && <button className="it-icon-button it-danger" aria-label={'Delete ' + file.fileName} onClick={() => removeAttachment(file._id)}><Trash2 /></button>}
      </div></td></tr>)}</tbody>
    </table></div> : <div className="it-empty"><Paperclip /><p>No documents yet.</p><span>{canEdit ? 'Upload supporting files from the Documents tab.' : 'Task documents will appear here.'}</span></div>;
  const keyActionsPanel = <section className="it-card">
    <div className="it-card-heading"><div><h2><ClipboardList />Delegated Key Actions</h2><p>Selected actions from the linked matter workflow.</p></div><span className="it-count">{actions.length}</span></div>
    {returnStepKey && <form onSubmit={returnForCorrections} className="it-feedback-form">
      <label htmlFor="it-correction-feedback">Required correction feedback</label><textarea id="it-correction-feedback" required maxLength={5000} rows={3} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} />
      <div className="it-row-actions"><button className="it-button it-primary" type="submit" disabled={caseLifecycleBusy || !returnReason.trim()}>Return to contributor</button><button className="it-button" type="button" disabled={caseLifecycleBusy} onClick={() => setReturnStepKey('')}>Cancel</button></div>
    </form>}
    <div className="it-action-list">{actions.length ? actions.map((action, index) => {
      const open = expandedAction === action.key;
      const canReturn = contributorCanAct && Boolean(task && ['In Progress', 'Awaiting Review'].includes(task.status)) && ((task?.caseRole === 'Reviewer' && action.status === 'Awaiting Review') || (task?.caseRole === 'Signer/Approver' && action.status === 'Awaiting Approval'));
      return <article className="it-action" key={action.key}>
        <div className="it-action-title"><span className="it-action-number">{index + 1}</span><h3>{action.title}</h3><div className="it-row-actions">
          {canReturn && <button className="it-button it-button-small" disabled={busy} onClick={() => { setReturnStepKey(action.key); setReturnReason(''); }}>Return for corrections</button>}
          {contributorCanAct && <button className="it-button it-primary it-button-small" disabled={busy} onClick={() => { if (canStart) void startDelegatedWork(); else setExpandedAction(open ? null : action.key); }}>{canStart ? 'Start Work' : action.completed ? 'View Work' : 'Continue Work'}</button>}
          <button className="it-icon-button" aria-label={(open ? 'Collapse ' : 'Expand ') + action.title} aria-expanded={open} aria-controls={'it-action-' + index} onClick={() => setExpandedAction(open ? null : action.key)}><ChevronDown className={open ? 'it-rotate' : ''} /></button>
        </div></div>
        <div className="it-action-metadata">
          <div><span>Workflow stage</span><strong className="it-stage-tag">{action.stageTitle || 'Not recorded'}</strong></div>
          <div><span>Status</span>{badge(action.correctionRequest && !action.correctionRequest.resolvedAt ? 'Changes Requested' : action.status)}</div>
          <div><span>Deadline</span><strong><CalendarDays />{action.dueAt ? formatDeadlineDateTime(action.dueAt) : 'Not set'}</strong></div>
          <div><span>Contribution</span><strong>{action.percentage == null ? 'Not allocated' : action.percentage + '%'}</strong></div>
          <div><span>Original role</span><strong>{action.originalResponsibleRole || task?.caseRole || 'Not recorded'}</strong></div>
        </div>
        {action.correctionRequest && !action.correctionRequest.resolvedAt && <div className="it-notice" data-tone="amber"><MessageSquare /><div><strong>Changes requested by {action.correctionRequest.requestedBy}</strong><p>{action.correctionRequest.reason}</p></div></div>}
        {open && <div className="it-action-expanded" id={'it-action-' + index}><h4>Instructions & requirements</h4>
          {action.instructions?.length || action.requirements?.length ? <ul>{(action.instructions || []).map((item, i) => <li key={'i' + i}>{item}</li>)}{(action.requirements || []).map((item, i) => <li key={'r' + i}>{item.name}{item.required ? ' (required deliverable)' : ''}</li>)}</ul> : <p>No additional instructions were recorded. Follow the task description and review feedback.</p>}
          <div className="it-row-actions"><button className="it-text-button" onClick={() => switchTab('attachments')}><Paperclip />Supporting documents</button><button className="it-text-button" onClick={() => switchTab('comments')}><MessageSquare />Work notes & comments</button></div>
          {action.reviewHistory?.length ? <div className="it-review-history"><h4>Submission & review history</h4>{action.reviewHistory.map((entry, i) => <div key={i}><strong>{entry.action}</strong><span>{entry.actorName} · {formatDateTime(entry.at)}</span>{entry.reason && <p>{entry.reason}</p>}</div>)}</div> : <p className="it-muted">No returns or resubmissions recorded.</p>}
        </div>}
      </article>;
    }) : <div className="it-empty"><ClipboardList /><p>Key Actions are unavailable.</p><span>Refresh to retrieve the latest matter workflow.</span></div>}</div>
  </section>;
  const tabs: Array<{ value: typeof activeTab; label: string; icon: typeof History }> = [
    { value: 'overview', label: 'Overview', icon: ClipboardList },
    ...(delegated ? [{ value: 'key-actions' as const, label: 'Key Actions (' + actions.length + ')', icon: ListChecks }] : []),
    { value: 'attachments', label: 'Documents (' + attachments.length + ')', icon: FileText },
    { value: 'comments', label: 'Comments (' + comments.length + ')', icon: MessageSquare },
    { value: 'activity', label: 'Activity History', icon: History },
    ...(!delegated ? [{ value: 'timeline' as const, label: 'Timeline', icon: Clock3 }] : []),
  ];
  if (!id) return <div className="it-workspace"><div className="it-notice" data-tone="amber">Task id is required.</div></div>;
  if (loading && !task) return <div className="it-workspace" aria-busy="true"><div className="it-loading-heading" /><div className="it-loading-summary" /><div className="it-loading-grid"><div /><div /></div><span className="it-sr-only">Loading task workspace</span></div>;
  if (!task) return <div className="it-workspace"><Link to="/matters/independent-tasks" className="it-back"><ArrowLeft />Back to Independent Tasks</Link><div className="it-notice" data-tone="amber">{error || 'Task not found.'}</div><button className="it-button" onClick={() => void refreshTask()}><RefreshCw />Try again</button></div>;
  return <div className="it-workspace">
    <header className="it-page-header"><Link to="/matters/independent-tasks" className="it-back"><ArrowLeft />Back to Independent Tasks</Link>
      <div className="it-title-row"><h1>{task.title}</h1><div className="it-header-actions">
        <DropdownMenu><DropdownMenuTrigger asChild><button className="it-button">More Actions<ChevronDown /></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="it-workspace-menu">
          <DropdownMenuItem onSelect={() => void refreshTask()}><RefreshCw />Refresh task</DropdownMenuItem><DropdownMenuItem onSelect={() => switchTab('activity')}><History />View activity history</DropdownMenuItem>
          {!delegated && !locked && canAct && allowedTransitions.filter((next) => next !== standardNext && next !== 'Cancelled').map((next) => <DropdownMenuItem key={next} disabled={busy} onSelect={() => void handleTransition(next)}>{getTransitionLabel(next)}</DropdownMenuItem>)}
        </DropdownMenuContent></DropdownMenu>
        {canDeleteIndependentTask(task, { ...currentUser, role: userRole }) && <button type="button" className="it-button it-delete-button" disabled={busy} onClick={() => void deleteTaskRecord()}><Trash2 />Delete Task</button>}
        {canComment && <button className="it-button" disabled={busy} onClick={() => void saveProgress()}>{progressSaving ? <Loader2 className="it-spin" /> : <Save />}Save Progress</button>}{primaryAction}
      </div></div>
      <div className="it-header-meta"><span className="it-badge" data-tone={delegated ? 'green' : 'neutral'}>{delegated ? <UsersRound /> : <ClipboardList />}{delegated ? 'Delegated Case Work' : 'Independent Task'}</span><span>Task Ref: {task.taskNumber}</span>{badge(displayStatus)}<span className="it-badge" data-tone={['Critical', 'High'].includes(task.priority) ? 'amber' : 'neutral'}>{task.priority} Priority</span><span className="it-due-inline"><CalendarDays />Due {formatDeadlineDateTime(task.dueDate)}</span></div>
    </header>
    {locked && <div className="it-notice" data-tone="neutral"><LockKeyhole /><div><strong>{task.status === 'Closed' ? 'This task is closed and locked for editing.' : 'This task has been cancelled.'}</strong><p>{delegated ? 'Matter Key Action states and recorded contributions remain available below.' : 'Task details, documents and activity remain available for reference.'}</p></div></div>}
    <section className="it-summary-strip" aria-label="Task summary">
      {task.relatedMatterId && <div className="it-summary-item"><span className="it-summary-icon"><Folder /></span><div><span className="it-label">Linked Matter</span><strong className="it-link-color">{task.relatedMatter?.caseNo && task.relatedMatter.caseNo !== 'N/A' ? task.relatedMatter.caseNo : 'Linked matter'}</strong><p>{task.relatedMatter?.parties || task.relatedMatterLabel || 'Matter details not recorded'}</p>{task.relatedClient && <small>Client: {task.relatedClient}</small>}</div></div>}
      {delegated && <div className="it-summary-item"><span className="it-summary-icon it-green"><UsersRound /></span><div><span className="it-label">Your Acting Role</span><strong>Acting as {task.caseRole}</strong><small>Original {task.caseRole}: {team.find((member) => member.role === task.caseRole)?.name || 'Not recorded'}</small><span className="it-badge" data-tone="blue">Delegated Contributor</span></div></div>}
      <div className="it-summary-item"><div><span className="it-label">Created By</span><div className="it-person">{avatar(task.createdBy)}<div><strong>{task.createdBy || 'Not recorded'}</strong><small>Task creator</small><small>{formatDateTime(task.createdAt)}</small></div></div></div></div>
      <div className="it-summary-item"><div><span className="it-label">Assigned To</span><div className="it-person">{avatar(task.assignee)}<div><strong>{task.assignee}</strong><small>{delegated ? 'Delegated contributor' : 'Task assignee'}</small><small>Supervisor: {task.supervisor}</small></div></div></div></div>
      <div className="it-summary-item"><div><span className="it-label">Start Date</span><strong className="it-date"><CalendarDays />{formatDate(task.startDate)}</strong></div></div>
      <div className="it-summary-item"><div><span className="it-label">Due Date</span><strong className="it-date"><CalendarDays />{formatDeadlineDateTime(task.dueDate)}</strong>{!locked && dueLabel && <small className={dueDays < 0 ? 'it-danger' : 'it-muted'}>{dueLabel}</small>}</div></div>
    </section>
    <nav className="it-tabs" role="tablist" aria-label="Task workspace sections">{tabs.map(({ value, label, icon: Icon }) => <button key={value} role="tab" id={'it-tab-' + value} aria-selected={activeTab === value} aria-controls={'it-panel-' + value} tabIndex={activeTab === value ? 0 : -1} onClick={() => switchTab(value)} onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const index = tabs.findIndex((tab) => tab.value === value);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      switchTab(tabs[next].value); document.getElementById('it-tab-' + tabs[next].value)?.focus();
    }}><Icon />{label}</button>)}</nav>
    <div role="tabpanel" id={'it-panel-' + activeTab} aria-labelledby={'it-tab-' + activeTab}>
      {activeTab === 'overview' && <div className="it-layout"><main className="it-main-column">
        <section className="it-card it-description"><div><h2><FileText />Task Description</h2><p className={'it-description-text' + (!descriptionExpanded ? ' it-clamp' : '')}>{task.description || 'No description has been added to this task.'}</p>
          {task.description && task.description.length > 220 && <button className="it-text-button" aria-expanded={descriptionExpanded} onClick={() => setDescriptionExpanded(!descriptionExpanded)}>{descriptionExpanded ? 'Show less' : 'Show more'}<ChevronDown /></button>}
          {!delegated && !task.relatedMatterId && task.relatedClient && <p className="it-muted">Client: {task.relatedClient}</p>}
        </div>{delegated && <aside className="it-instructions"><h3><Info />Instructions & Requirements</h3><p>Follow the selected action requirements, add supporting documents and submit your work for the next review stage.</p><button className="it-text-button" onClick={() => switchTab('key-actions')}>View action requirements<ArrowRight /></button></aside>}
          {showWorkEditor && canComment && <form className="it-work-editor" onSubmit={(event) => { event.preventDefault(); void saveProgress(); }}><label htmlFor="it-work-draft">Work progress</label><textarea id="it-work-draft" autoFocus rows={4} value={workDraft} onChange={(event) => setWorkDraft(event.target.value)} placeholder="Describe completed work, updates or next steps…" required /><p className="it-muted">Saved updates appear in this task’s comments.</p><div className="it-row-actions"><button className="it-button it-primary" type="submit" disabled={progressSaving || !workDraft.trim()}>Save Progress</button><button className="it-button" type="button" onClick={() => setShowWorkEditor(false)}>Cancel</button></div></form>}
        </section>
        {delegated && keyActionsPanel}
        <section className="it-card"><div className="it-card-heading"><h2><FileText />Recent Documents</h2><button className="it-text-button" onClick={() => switchTab('attachments')}>View All Documents<ArrowRight /></button></div>{documentsTable(true)}</section>
        <section className="it-card"><div className="it-card-heading"><h2><MessageSquare />Recent Comments</h2><button className="it-text-button" onClick={() => switchTab('comments')}>View All Comments<ArrowRight /></button></div>{commentsTree.length ? commentsTree.slice(-2).map((comment) => renderComment(comment)) : <div className="it-empty"><MessageSquare /><p>No comments yet.</p><span>Work updates and discussion will appear here.</span></div>}</section>
      </main><aside className="it-sidebar">
        <section className="it-card"><h2><Timer />{delegated ? 'Overall Progress' : 'Task Progress'}</h2>{delegated ? <><p className="it-progress-caption">{approved} of {actions.length} actions approved and completed</p><div className="it-progress-row"><div className="it-progress-track" role="progressbar" aria-label="Approved Key Actions" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: progress + '%' }} /></div><strong>{progress}%</strong></div></> : <><p className="it-progress-caption">Current task status</p>{badge(task.status)}</>}</section>
        <section className="it-card"><h2><ClipboardCheck />Current Step</h2><ol className="it-steps">{(delegated ? ['In Progress', 'Submitted for Review', 'Awaiting Approval', 'Approved'] : ['Assigned', 'In Progress', 'Awaiting Review', 'Completed']).map((label, index) => <li key={label} data-active={index <= (delegated ? stage : standardStage)} aria-current={index === (delegated ? stage : standardStage) ? 'step' : undefined}><span>{index <= (delegated ? stage : standardStage) ? <Check /> : null}</span><small>{label}</small></li>)}</ol>{displayStatus === 'Changes Requested' && <p className="it-muted">Corrections are required before this work can move forward.</p>}{!delegated && task.status === 'Awaiting External Action' && <p className="it-muted">Paused while awaiting external action.</p>}</section>
        {delegated && <section className="it-card"><h2><BadgeDollarSign />Financial Summary <small>(This Task)</small></h2><div className="it-financial-grid">
          <div><span>Contribution Weight</span><strong>{weight}%</strong><small>{actions.length} Key Actions</small></div>
          <div><span>TPA</span><strong>{task.caseWork?.tpaPercent ? task.caseWork.tpaPercent + '%' : 'Pending'}</strong><small>Role allocation</small></div>
          <div><span>Timeliness</span><strong>{task.caseWork?.timelinessScore == null ? 'Pending' : task.caseWork.timelinessScore + '%'}</strong><small>Submission timing</small></div>
          <div><span>Quality</span><strong>{task.caseWork?.qualityScore == null ? 'Pending' : task.caseWork.qualityScore + '%'}</strong><small>Authorized review</small></div>
          <div><span>Earned Fee</span><strong>{task.caseWork?.earnedFee == null ? 'Pending' : formatMoney(task.caseWork.earnedFee, task.caseWork.currency)}</strong><small>Approved, collected work</small></div>
        </div><div className="it-collected-base"><span>Collected base</span><strong>{task.caseWork ? formatMoney(task.caseWork.collectedBase, task.caseWork.currency) : 'Pending calculation'}</strong></div><div className="it-notice" data-tone="blue"><Info /><p>Earnings follow approved Key Actions, collected fees and performance scores. Action weight is not a direct share of client revenue.</p></div></section>}
        {delegated && <section className="it-card"><h2><UsersRound />Original Matter Team</h2><div className="it-team">{team.map((member) => <div className="it-team-member" key={member.role}>{avatar(member.name, true)}<div><strong>{member.name || 'Not recorded'}</strong><small>{member.role}</small><span className="it-badge" data-tone="blue">Original Assignee</span></div></div>)}</div></section>}
        {delegated && <section className="it-card"><h2><UserRoundCheck />Delegated Contributor</h2><div className="it-person it-contributor">{avatar(task.assignee)}<div><strong>{task.assignee}</strong><p>Acting as {task.caseRole} <span className="it-badge" data-tone="blue">Delegated</span></p><small>Performing {actions.length} Key Actions ({weight}% weight)</small></div></div></section>}
        <section className="it-card"><details className="it-record-details"><summary>Task record & dates</summary><dl>{[['Created', formatDateTime(task.createdAt)], ['Updated', formatDateTime(task.updatedAt)], ['Completed', formatDateTime(task.completedAt)], ['Closed', formatDateTime(task.closedAt)], ['Last action by', task.lastActionBy || 'Not recorded']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details></section>
      </aside></div>}
      {activeTab === 'key-actions' && delegated && keyActionsPanel}
      {activeTab === 'attachments' && <div className="it-layout it-support-layout"><section className="it-card"><div className="it-card-heading"><h2><Paperclip />Documents</h2><span className="it-count">{attachments.length}</span></div>{documentsTable()}</section><aside className="it-card"><h2><Upload />Upload Document</h2>{canEdit ? <form className="it-form" onSubmit={submitAttachment}>
        <label htmlFor="it-file-name">Display name</label><input id="it-file-name" value={attachmentName} onChange={(event) => setAttachmentName(event.target.value)} placeholder="Use the original file name" disabled={uploading} />
        <label htmlFor="it-file-note">Optional note</label><textarea id="it-file-note" rows={3} value={attachmentNote} onChange={(event) => setAttachmentNote(event.target.value)} disabled={uploading} />
        <label htmlFor="it-file-upload">Choose a file</label><input id="it-file-upload" type="file" onChange={(event) => setAttachmentFile(event.target.files?.[0] || null)} disabled={uploading} />
        {delegated && <p className="it-muted">This upload will also appear in the linked matter.</p>}<button className="it-button it-primary" type="submit" disabled={uploading || !attachmentFile}>{uploading ? <Loader2 className="it-spin" /> : <Upload />}Upload Document</button>
      </form> : <p className="it-muted">{locked ? 'This task is read-only.' : 'You do not have permission to upload documents.'}</p>}</aside></div>}
      {activeTab === 'comments' && <div className="it-layout it-support-layout"><section className="it-card"><div className="it-card-heading"><h2><MessageSquare />Discussion</h2><span className="it-count">{comments.length}</span></div>{commentsTree.length ? commentsTree.map((comment) => renderComment(comment)) : <div className="it-empty"><MessageSquare /><p>No comments yet.</p><span>Add a work update or start a discussion.</span></div>}</section><aside className="it-card"><h2><Send />{replyParentId ? 'Reply to Comment' : 'Add Comment'}</h2>{replyParentId && <div className="it-notice" data-tone="blue">Replying to a comment.<button className="it-text-button" onClick={() => setReplyParentId(null)}>Cancel reply</button></div>}<form className="it-form" onSubmit={submitComment}><label htmlFor="it-comment-body">Your comment</label><textarea id="it-comment-body" rows={6} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Write a work update, question or instruction…" required disabled={!canComment || commentSaving} /><button className="it-button it-primary" type="submit" disabled={!canComment || commentSaving || !commentBody.trim()}>{commentSaving ? <Loader2 className="it-spin" /> : <Send />}Post Comment</button></form></aside></div>}
      {activeTab === 'activity' && <section className="it-card"><h2><History />Activity History</h2><div className="it-activity-list">{history.length ? [...history].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((item) => <article key={item._id}>{avatar(item.actorName, true)}<div><h3>{item.message}</h3>{item.detail && <p>{item.detail}</p>}<small>{item.actorName} · {formatDateTime(item.createdAt)}</small></div></article>) : <div className="it-empty"><History /><p>No activity recorded yet.</p></div>}</div></section>}
      {activeTab === 'timeline' && !delegated && <section className="it-card"><h2><Clock3 />Task Timeline</h2><p className="it-muted">Standard Independent Task workflow and recorded status changes.</p><div className="it-standard-timeline">{WORKFLOW_STATUSES.filter((status) => status !== 'Cancelled').map((status) => <div key={status} data-current={task.status === status}>{badge(status)}{task.status === status && <span>Current status</span>}</div>)}</div><div className="it-activity-list">{history.filter((item) => /STATUS|COMPLETED|CLOSED|REVIEW|EXTERNAL/.test(item.action)).map((item) => <article key={item._id}><History /><div><h3>{item.message}</h3><p>{item.detail}</p><small>{formatDateTime(item.createdAt)} · {item.actorName}</small></div></article>)}</div></section>}
    </div>
  </div>;
}
