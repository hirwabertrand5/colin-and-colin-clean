import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Award, CheckCircle2, ClipboardCheck, Clock, FileText, Paperclip, Send, Stamp, Trash2, Upload, UserCheck } from 'lucide-react';
import {
  getCaseManagement,
  requestReview,
  requestApproval,
  approveKeyAction,
  saveCaseQualityScore,
  CaseManagementState,
  CaseManagementStep,
} from '../../services/caseManagementService';
import { toggleWorkflowStepAction } from '../../services/workflowInstanceService';
import { getDocumentsForCase, addDocumentToCase, deleteDocument, CaseDocument } from '../../services/documentService';
import { formatDeadlineDateTime } from '../../utils/workflowDeadline';

const API_URL = import.meta.env.VITE_API_URL || '';
const BACKEND_URL = String(API_URL || '').replace(/\/api\/?$/, '');

type Props = {
  caseId: string;
  currentUserName?: string;
  currentUserEmail?: string;
  onWorkflowChanged?: () => void | Promise<void>;
  /** Optional Key Action to highlight when arriving from the Case Workspace. */
  focusStepKey?: string;
};

const DASH = '_';

const formatMoney = (amount: number | null | undefined, currency?: string) => {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return DASH;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: String(currency || 'RWF'),
    maximumFractionDigits: 0,
  }).format(Number(amount));
};

const STATUS_CHIP: Record<string, string> = {
  'Not Started': 'border border-gray-300 bg-gray-50 text-gray-600',
  'In Progress': 'border border-blue-200 bg-blue-50 text-blue-700',
  'Awaiting Review': 'border border-amber-200 bg-amber-50 text-amber-800',
  'Awaiting Approval': 'border border-violet-200 bg-violet-50 text-violet-700',
  Completed: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
};

const LIFECYCLE_LABEL: Record<string, string> = {
  'Not Started': 'Not started',
  'In Progress': 'In progress',
  'Awaiting Review': 'Awaiting review',
  'Awaiting Approval': 'Awaiting approval',
  Completed: 'Completed',
};
export default function CaseManagementTab({ caseId, currentUserName, currentUserEmail, onWorkflowChanged, focusStepKey }: Props) {
  void currentUserName;
  void currentUserEmail;
  const [state, setState] = useState<CaseManagementState | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [qualityDraft, setQualityDraft] = useState('');
  const [qualitySaving, setQualitySaving] = useState(false);
  const [documents, setDocuments] = useState<CaseDocument[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [docBusy, setDocBusy] = useState(false);
  const [docError, setDocError] = useState('');
  const [newDocName, setNewDocName] = useState('');
  const [newDocFile, setNewDocFile] = useState<File | null>(null);

  const reloadDocuments = async () => {
    setDocLoading(true);
    setDocError('');
    try {
      setDocuments(await getDocumentsForCase(caseId));
    } catch (e: any) {
      setDocError(e.message || 'Failed to load documents.');
    } finally {
      setDocLoading(false);
    }
  };

  const uploadDocument = async (category?: string) => {
    if (!newDocFile) {
      setDocError('Choose a file to upload.');
      return;
    }
    setDocBusy(true);
    setDocError('');
    try {
      const name = (newDocName.trim() || newDocFile.name);
      await addDocumentToCase(caseId, { name, file: newDocFile, ...(category ? { category } : {}) });
      setNewDocName('');
      setNewDocFile(null);
      await reloadDocuments();
    } catch (e: any) {
      setDocError(e.message || 'Failed to upload document.');
    } finally {
      setDocBusy(false);
    }
  };

  const uploadAppeal = async () => {
    if (!newDocFile) {
      setDocError('Choose the appeal document to upload.');
      return;
    }
    setDocBusy(true);
    setDocError('');
    try {
      const name = newDocName.trim() || 'Appeal document';
      await addDocumentToCase(caseId, { name, file: newDocFile, category: 'Appeal' });
      setNewDocName('');
      setNewDocFile(null);
      await reloadDocuments();
    } catch (e: any) {
      setDocError(e.message || 'Failed to upload the appeal document.');
    } finally {
      setDocBusy(false);
    }
  };

  const removeDocument = async (docId: string) => {
    if (!docId) return;
    setDocBusy(true);
    setDocError('');
    try {
      await deleteDocument(docId);
      await reloadDocuments();
    } catch (e: any) {
      setDocError(e.message || 'Failed to delete document.');
    } finally {
      setDocBusy(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await getCaseManagement(caseId);
      setState(data);
      setQualityDraft(data.qualityScore == null ? '' : String(data.qualityScore));
      void reloadDocuments();
    } catch (e: any) {
      setErr(e.message || 'Failed to load Case Management.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line
  }, [caseId]);

  const myRole = state?.myRole || 'none';
  const isMember = myRole === 'initiator' || myRole === 'reviewer' || myRole === 'approver' || myRole === 'admin';

  const canToggleStep = (step: CaseManagementStep) =>
    isMember && step.status !== 'Completed';

  const canRequestReview = (step: CaseManagementStep) =>
    (myRole === 'initiator' || myRole === 'admin') &&
    step.status !== 'Completed' &&
    step.status !== 'Awaiting Review' &&
    step.actions.every((a) => a.done);

  const canRequestApproval = (step: CaseManagementStep) =>
    (myRole === 'reviewer' || myRole === 'admin') &&
    step.status !== 'Completed' &&
    step.status !== 'Awaiting Approval' &&
    (step.status === 'Awaiting Review' || step.status === 'In Progress');

  const canApprove = (step: CaseManagementStep) =>
    (myRole === 'approver' || myRole === 'admin') &&
    step.status !== 'Completed' &&
    (step.status === 'Awaiting Approval' || step.status === 'Awaiting Review');

  const refresh = (next: CaseManagementState) => {
    setState(next);
    setQualityDraft(next.qualityScore == null ? '' : String(next.qualityScore));
    void onWorkflowChanged?.();
  };

  const toggleAction = async (step: CaseManagementStep, index: number) => {
    if (!canToggleStep(step)) return;
    setBusy(`toggle:${step.stepKey}:${index}`);
    setErr('');
    try {
      await toggleWorkflowStepAction(caseId, step.stepKey, index, false);
      refresh(await getCaseManagement(caseId));
    } catch (e: any) {
      setErr(e.message || 'Failed to update key action.');
    } finally {
      setBusy('');
    }
  };

  const doRequestReview = async (step: CaseManagementStep) => {
    if (!canRequestReview(step)) return;
    setBusy(`review:${step.stepKey}`);
    setErr('');
    try {
      refresh(await requestReview(caseId, step.stepKey));
    } catch (e: any) {
      setErr(e.message || 'Failed to request review.');
    } finally {
      setBusy('');
    }
  };

  const doRequestApproval = async (step: CaseManagementStep) => {
    if (!canRequestApproval(step)) return;
    setBusy(`approval:${step.stepKey}`);
    setErr('');
    try {
      refresh(await requestApproval(caseId, step.stepKey));
    } catch (e: any) {
      setErr(e.message || 'Failed to request approval.');
    } finally {
      setBusy('');
    }
  };

  const doApprove = async (step: CaseManagementStep) => {
    if (!canApprove(step)) return;
    setBusy(`approve:${step.stepKey}`);
    setErr('');
    try {
      refresh(await approveKeyAction(caseId, step.stepKey));
    } catch (e: any) {
      setErr(e.message || 'Failed to approve key action.');
    } finally {
      setBusy('');
    }
  };

  const doSaveQualityScore = async () => {
    const score = Number(qualityDraft);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setErr('Quality Score must be a number between 0 and 100.');
      return;
    }
    setQualitySaving(true);
    setErr('');
    try {
      refresh(await saveCaseQualityScore(caseId, Math.round(score)));
    } catch (e: any) {
      setErr(e.message || 'Failed to save the Quality Score.');
    } finally {
      setQualitySaving(false);
    }
  };
const earned = state?.earnedFees;
  const memberByKey = useMemo(() => {
    const map = new Map<string, any>();
    for (const member of earned?.team || []) map.set(member.key, member);
    return map;
  }, [earned]);

  if (loading && !state) return <div className="py-8 text-sm text-gray-500 dark:text-gray-400">Loading Case Management…</div>;
  if (!state) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="text-sm text-gray-600 dark:text-gray-300">Case Management is not available for this matter.</div>
        {err ? <div className="mt-2 text-sm text-red-600 dark:text-red-400">{err}</div> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {loading ? <div className="text-xs text-gray-500 dark:text-gray-400">Refreshing…</div> : null}
      {err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          {err}
        </div>
      ) : null}

      <CaseLifecycleBanner state={state} />

      <AssignedMembersCard state={state} memberByKey={memberByKey} />

      <QualityScorePanel state={state} qualityDraft={qualityDraft} onDraft={setQualityDraft} onSave={doSaveQualityScore} saving={qualitySaving} />

      <KeyActionsList
        state={state}
        busy={busy}
        canToggleStep={canToggleStep}
        canRequestReview={canRequestReview}
        canRequestApproval={canRequestApproval}
        canApprove={canApprove}
        onToggle={toggleAction}
        onRequestReview={doRequestReview}
        onRequestApproval={doRequestApproval}
        onApprove={doApprove}
        focusStepKey={focusStepKey}
      />

      <DocumentsSection
        caseId={caseId}
        documents={documents}
        docLoading={docLoading}
        docBusy={docBusy}
        docError={docError}
        newDocName={newDocName}
        newDocFile={newDocFile}
        onDocName={setNewDocName}
        onDocFile={setNewDocFile}
        canUpload={isMember}
        canDelete={myRole === 'admin'}
        onUpload={() => void uploadDocument()}
        onAppeal={() => void uploadAppeal()}
        onDelete={(id) => void removeDocument(id)}
      />

      <EarnedFeesSection state={state} />
    </div>
  );
}
function CaseLifecycleBanner({ state }: { state: CaseManagementState }) {
  const steps = state.steps;
  const total = steps.length;
  const completed = steps.filter((s) => s.status === 'Completed').length;
  const firstOpen = steps.find((s) => s.status !== 'Completed');
  const current = firstOpen ? LIFECYCLE_LABEL[firstOpen.status] || firstOpen.status : 'Completed';
  const phases = ['Created', 'Initiator works', 'Review', 'Approval', 'Key Action completed'];
  const activeIndex =
    completed >= total
      ? 4
      : firstOpen?.status === 'Awaiting Approval'
        ? 3
        : firstOpen?.status === 'Awaiting Review'
          ? 2
          : firstOpen && completed === 0
            ? 1
            : 2;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Case Management</div>
          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {state.caseNo} • {state.parties}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Workflow status</div>
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{state.workflowStatus}</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {phases.map((phase, index) => (
          <React.Fragment key={phase}>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
                index === activeIndex
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : index < activeIndex
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border border-gray-300 bg-gray-50 text-gray-500'
              }`}
            >
              {index < activeIndex ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
              {phase}
            </span>
            {index < phases.length - 1 ? <span className="text-gray-400">→</span> : null}
          </React.Fragment>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
        <span>
          {completed}/{total} Key Action{total === 1 ? '' : 's'} completed • Current stage: <span className="font-medium text-gray-900 dark:text-gray-100">{current}</span>
        </span>
        {state.myRole !== 'none' ? (
          <span className="ml-1">
            • Your role on this matter: <span className="font-medium text-gray-900 dark:text-gray-100">
              {state.myRole === 'initiator' ? 'Case Initiator' : state.myRole === 'reviewer' ? 'Reviewer' : state.myRole === 'approver' ? 'Signer/Approver' : state.myRole === 'admin' ? 'Administrator' : '_'}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AssignedMembersCard({ state, memberByKey }: { state: CaseManagementState; memberByKey: Map<string, any> }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center gap-2">
        <UserCheck className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Assigned Members</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-gray-50 dark:bg-gray-900 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Team member</th>
              <th className="px-3 py-2 text-right font-medium">TPA</th>
              <th className="px-3 py-2 text-right font-medium">Timeliness</th>
              <th className="px-3 py-2 text-right font-medium">Quality</th>
              <th className="px-3 py-2 text-right font-medium">Earned fee</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {state.members.map((member) => {
              const row = memberByKey.get(member.key);
              return (
                <tr key={member.key} className="bg-white dark:bg-gray-800">
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{member.role}</td>
                  <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                    {member.name || DASH}
                    {member.userRole ? <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">({member.userRole})</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{member.tpaPercent > 0 ? `${member.tpaPercent}%` : DASH}</td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{row && row.timelinessScore != null ? `${row.timelinessScore}%` : DASH}</td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{row && row.qualityScore != null ? `${row.qualityScore}%` : DASH}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">
                    {row && row.earnedFee != null ? formatMoney(row.earnedFee, state.earnedFees.currency) : DASH}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function QualityScorePanel({ state, qualityDraft, onDraft, onSave, saving }: { state: CaseManagementState; qualityDraft: string; onDraft: (v: string) => void; onSave: () => void; saving: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Award className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Quality Score</div>
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Matter-level quality, entered by the Reviewer or the Signer/Approver through Case Management.
            </div>
          </div>
        </div>
        <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{state.qualityScore == null ? DASH : `${state.qualityScore}%`}</div>
      </div>
      {state.qualityScoredBy ? (
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Recorded by {state.qualityScoredBy}
          {state.qualityScoredAt ? ` • ${new Date(state.qualityScoredAt).toLocaleString()}` : ''}
        </div>
      ) : null}
      {state.canEnterQualityScore ? (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={qualityDraft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder="Enter 0-100"
            aria-label="Quality Score"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 sm:max-w-[180px] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            {saving ? 'Saving…' : 'Save Quality Score'}
          </button>
        </div>
      ) : null}
      {state.qualityScore == null && !state.canEnterQualityScore ? (
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Not yet scored.</div>
      ) : null}
    </div>
  );
}
function KeyActionsList(props: {
  state: CaseManagementState;
  busy: string;
  canToggleStep: (step: CaseManagementStep) => boolean;
  canRequestReview: (step: CaseManagementStep) => boolean;
  canRequestApproval: (step: CaseManagementStep) => boolean;
  canApprove: (step: CaseManagementStep) => boolean;
  onToggle: (step: CaseManagementStep, index: number) => void;
  onRequestReview: (step: CaseManagementStep) => void;
  onRequestApproval: (step: CaseManagementStep) => void;
  onApprove: (step: CaseManagementStep) => void;
  focusStepKey?: string;
}) {
  const {
    state,
    busy,
    canToggleStep,
    canRequestReview,
    canRequestApproval,
    canApprove,
    onToggle,
    onRequestReview,
    onRequestApproval,
    onApprove,
    focusStepKey,
  } = props;
  const missingPercentages = state.earnedFees.missingKeyActionPercentages || [];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Key Actions</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            The workflow template&apos;s Key Actions, completed by the three assigned members.
          </div>
        </div>
      </div>

      {missingPercentages.length > 0 ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {missingPercentages.length} Key Action percentage{missingPercentages.length === 1 ? '' : 's'} missing. Those actions remain worth 0 until a percentage is set in the workflow.
        </div>
      ) : null}

      <div className="space-y-3">
        {state.steps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
            No Key Actions configured for this matter.
          </div>
        ) : null}
        {state.steps.map((step) => {
          const chipClass = STATUS_CHIP[step.status] || STATUS_CHIP['Not Started'];
          const isFocused = focusStepKey && step.stepKey === focusStepKey;
          const allDone = step.actions.every((a) => a.done);
          return (
            <div
              key={step.stepKey}
              className={[
                'rounded-lg border overflow-hidden transition-shadow',
                isFocused ? 'border-gray-900 shadow-md dark:border-gray-300' : 'border-gray-200 dark:border-gray-700',
              ].join(' ')}
            >
              <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-gray-500 dark:text-gray-400">{step.stepKey}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{step.title}</span>
                    <span
                      className="inline-flex items-center rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-xs font-semibold text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300"
                      title="Key Action percentage from the workflow template"
                    >
                      {step.percentage}%
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">{step.stageTitle}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${chipClass}`}>{LIFECYCLE_LABEL[step.status] || step.status}</span>
                  {step.actions.length > 0 ? (
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                        allDone
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300'
                      }`}
                      title={allDone ? 'All Key Actions under this Step are completed' : 'Some Key Actions under this Step are still incomplete'}
                    >
                      {allDone ? 'Step: Done' : 'Step: In Progress'}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 px-5 py-3 text-xs text-gray-600 dark:text-gray-400 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <span className="font-medium text-gray-500 dark:text-gray-400">Started:</span>{' '}
                  {formatDeadlineDateTime(step.startAt)}
                </div>
                <div>
                  <span className="font-medium text-gray-500 dark:text-gray-400">Due:</span>{' '}
                  {formatDeadlineDateTime(step.dueAt)}
                </div>
                <div>
                  <span className="font-medium text-gray-500 dark:text-gray-400">Timeliness:</span>{' '}
                  {step.timelinessScore == null ? DASH : `${step.timelinessScore}%`}
                </div>
                {step.submittedAt ? (
                  <div>
                    <span className="font-medium text-gray-500 dark:text-gray-400">Submitted for review:</span>{' '}
                    {formatDeadlineDateTime(step.submittedAt)}
                  </div>
                ) : null}
                {step.reviewedAt ? (
                  <div>
                    <span className="font-medium text-gray-500 dark:text-gray-400">Reviewed:</span>{' '}
                    {formatDeadlineDateTime(step.reviewedAt)}
                  </div>
                ) : null}
                {step.completedAt ? (
                  <div>
                    <span className="font-medium text-gray-500 dark:text-gray-400">Completed:</span>{' '}
                    {formatDeadlineDateTime(step.completedAt)}
                  </div>
                ) : null}
              </div>
<div className="border-t border-gray-100 px-5 py-3 dark:border-gray-700">
                {step.actions.length === 0 ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400">No key actions configured for this step.</div>
                ) : (
                  <div className="space-y-1.5">
                    {step.actions.map((action, index) => {
                      const canToggle = canToggleStep(step);
                      return (
                        <label key={`${step.stepKey}-${index}`} className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={action.done}
                            onChange={() => canToggle && onToggle(step, index)}
                            disabled={!canToggle || busy === `toggle:${step.stepKey}:${index}`}
                            className="mt-0.5 h-4 w-4 rounded border-gray-300"
                          />
                          <span className="text-sm text-gray-900 dark:text-gray-100">
                            {action.text}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {(canRequestReview(step) || canRequestApproval(step) || canApprove(step)) && (
                <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-700">
                  {canRequestReview(step) && (
                    <button
                      type="button"
                      onClick={() => onRequestReview(step)}
                      disabled={busy === `review:${step.stepKey}` || !allDone}
                      title={allDone ? 'Send the completed work to the Reviewer' : 'Complete all key actions first'}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" /> Send to Reviewer
                    </button>
                  )}
                  {canRequestApproval(step) && (
                    <button
                      type="button"
                      onClick={() => onRequestApproval(step)}
                      disabled={busy === `approval:${step.stepKey}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" /> Send to Signer / Approver
                    </button>
                  )}
                  {canApprove(step) && (
                    <button
                      type="button"
                      onClick={() => onApprove(step)}
                      disabled={busy === `approve:${step.stepKey}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      <Stamp className="h-3.5 w-3.5" /> Approve &amp; Complete
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
function EarnedFeesSection({ state }: { state: CaseManagementState }) {
  const earned = state.earnedFees;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-1 flex items-center gap-2">
        <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Earned Fees</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Completed Key Actions are valued from the contract and capped by Paid invoice collections before TPA, timeliness and quality.
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
          <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Eligible collected value</div>
          <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{formatMoney(earned.earnedValue, earned.currency)}</div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
          <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Contract Value</div>
          <div className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">{formatMoney(earned.contractValue, earned.currency)}</div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
          <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Workflow Completed</div>
          <div className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">{earned.completedPercent}%</div>
          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {earned.completedKeyActions ?? 0} completed Key Action{earned.completedKeyActions === 1 ? '' : 's'} weighted by percentage
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
          <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Completed Action Value</div>
          <div className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">{formatMoney(earned.completedValue, earned.currency)}</div>
          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Progress value covered so far</div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
          <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Collected / Eligible</div>
          <div className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">{formatMoney(earned.eligibleCollectedValue, earned.currency)}</div>
          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            Paid: {formatMoney(earned.collectedAmount, earned.currency)} — staff earnings remain 0 until collections arrive
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
          <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Staff Earned Fees</div>
          <div className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
            {earned.staffEarnedTotal == null ? DASH : formatMoney(earned.staffEarnedTotal, earned.currency)}
          </div>
          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Earned by the assigned members</div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
          <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Remaining Firm Fee</div>
          <div className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
            {earned.firmFee == null ? DASH : formatMoney(earned.firmFee, earned.currency)}
          </div>
          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Eligible collected value after staff earned fees</div>
        </div>
      </div>
{earned.team.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Team member</th>
                <th className="px-3 py-2 text-right font-medium">TPA</th>
                <th className="px-3 py-2 text-right font-medium">Timeliness</th>
                <th className="px-3 py-2 text-right font-medium">Quality</th>
                <th className="px-3 py-2 text-right font-medium">Collected base</th>
                <th className="px-3 py-2 text-right font-medium">Earned fee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {earned.team.map((member) => (
                <tr key={member.key} className="bg-white dark:bg-gray-800">
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{member.role}</td>
                  <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{member.name}</td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{member.tpaPercent > 0 ? `${member.tpaPercent}%` : DASH}</td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{member.timelinessScore != null ? `${member.timelinessScore}%` : DASH}</td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{member.qualityScore != null ? `${member.qualityScore}%` : DASH}</td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{formatMoney(member.taskFeeCollected, earned.currency)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">{member.earnedFee != null ? formatMoney(member.earnedFee, earned.currency) : DASH}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          No team assignments yet — assign an initiator, reviewer and signer/approver to this matter to see earned fees.
        </div>
      )}
    </div>
  );
}
function DocumentsSection(props: {
  caseId: string;
  documents: CaseDocument[];
  docLoading: boolean;
  docBusy: boolean;
  docError: string;
  newDocName: string;
  newDocFile: File | null;
  onDocName: (v: string) => void;
  onDocFile: (f: File | null) => void;
  canUpload: boolean;
  canDelete: boolean;
  onUpload: () => void;
  onAppeal: () => void;
  onDelete: (docId: string) => void;
}) {
  const { documents, docLoading, docBusy, docError, newDocName, newDocFile, onDocName, onDocFile, canUpload, canDelete, onUpload, onAppeal, onDelete } = props;
  void props.caseId;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-1 flex items-center gap-2">
        <Paperclip className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Documents</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Case documents associated with this matter. Use “Submit Appeal” to attach an appeal document when the workflow requires one.
          </div>
        </div>
      </div>

      {docError ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          {docError}
        </div>
      ) : null}

      {canUpload ? (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Document name (optional)</span>
            <input
              type="text"
              value={newDocName}
              onChange={(e) => onDocName(e.target.value)}
              placeholder="e.g. Client signed contract"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            />
          </label>
          <div className="flex-1">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">File</span>
            <input
              type="file"
              onChange={(e) => onDocFile(e.target.files?.[0] || null)}
              className="mt-1 w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-50 dark:text-gray-300 dark:file:bg-gray-800 dark:file:text-gray-200"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onUpload}
              disabled={docBusy || !newDocFile}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              <Upload className="h-3.5 w-3.5" /> Upload
            </button>
            <button
              type="button"
              onClick={onAppeal}
              disabled={docBusy || !newDocFile}
              title="Attach this file as an appeal document"
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileText className="h-3.5 w-3.5" /> Submit Appeal
            </button>
          </div>
        </div>
      ) : null}
<div className="mt-4">
        {docLoading ? (
          <div className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">Loading documents…</div>
        ) : documents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
            No documents uploaded for this matter yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Uploaded by</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 text-right font-medium">Size</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {documents.map((doc) => (
                  <tr key={doc._id || `${doc.name}-${doc.uploadedDate}`}>
                    <td className="px-3 py-2">
                      <a
                        href={doc.url ? `${BACKEND_URL}${doc.url}` : '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-gray-900 hover:underline dark:text-gray-100"
                      >
                        {doc.name}
                      </a>
                      {doc.version && doc.version > 1 ? <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">v{doc.version}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {doc.category ? (
                        <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
                          {doc.category}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500 dark:text-gray-400">General</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{doc.uploadedBy || DASH}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{doc.uploadedDate || DASH}</td>
                    <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{doc.size || DASH}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={doc.url ? `${BACKEND_URL}${doc.url}` : '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
                          title="Open"
                        >
                          <FileText className="h-4 w-4" />
                        </a>
                        {canDelete && doc._id ? (
                          <button
                            type="button"
                            onClick={() => onDelete(String(doc._id))}
                            className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                            title="Delete document"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
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
  );
}