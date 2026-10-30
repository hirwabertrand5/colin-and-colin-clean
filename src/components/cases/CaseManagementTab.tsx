import ContributionBadge from '../ui/ContributionBadge';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Award, CheckCircle2, ClipboardCheck, FileText, Paperclip, Send, Stamp, Trash2, Upload, UserCheck } from 'lucide-react';
import {
  getCaseManagement,
  requestReview,
  requestApproval,
  approveKeyAction,
  returnKeyActionForCorrections,
  saveCaseQualityScore,
  CaseManagementState,
  CaseManagementStep,
} from '../../services/caseManagementService';
import { getDocumentsForCase, addDocumentToCase, deleteDocument, CaseDocument } from '../../services/documentService';
import { formatDeadlineDateTime } from '../../utils/workflowDeadline';
import { uploadedFileUrl } from '../../services/apiConfig';

type Props = {
  caseId: string;
  currentUserName?: string;
  currentUserEmail?: string;
  onWorkflowChanged?: () => void | Promise<void>;
  /** Keeps the Case Workspace Documents tab in sync after a shared upload. */
  onDocumentsChanged?: () => void | Promise<void>;
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
  // 'Done' = work ticked by the assigned member, still to be submitted for review.
  Done: 'border border-teal-200 bg-teal-50 text-teal-700',
  'Awaiting Review': 'border border-amber-200 bg-amber-50 text-amber-800',
  'Awaiting Approval': 'border border-violet-200 bg-violet-50 text-violet-700',
  Completed: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
};

const LIFECYCLE_LABEL: Record<string, string> = {
  'Not Started': 'Not started',
  'In Progress': 'In progress',
  Done: 'Done - awaiting submission',
  'Awaiting Review': 'Awaiting review',
  'Awaiting Approval': 'Awaiting approval',
  Completed: 'Completed',
};
export default function CaseManagementTab({ caseId, currentUserName, currentUserEmail, onWorkflowChanged, onDocumentsChanged, focusStepKey }: Props) {
  void currentUserName;
  void currentUserEmail;
  const [state, setState] = useState<CaseManagementState | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [returnStepKey, setReturnStepKey] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [qualityDraft, setQualityDraft] = useState('');
  const [qualitySaving, setQualitySaving] = useState(false);
  const [documents, setDocuments] = useState<CaseDocument[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [docBusy, setDocBusy] = useState(false);
  const [docError, setDocError] = useState('');
  const [newDocName, setNewDocName] = useState('');
  const [newDocFile, setNewDocFile] = useState<File | null>(null);
  const [docInputKey, setDocInputKey] = useState(0);

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

  const uploadDocument = async () => {
    if (!newDocFile) {
      setDocError('Choose a file to upload.');
      return;
    }
    setDocBusy(true);
    setDocError('');
    try {
      const name = (newDocName.trim() || newDocFile.name);
      await addDocumentToCase(caseId, { name, file: newDocFile });
      setNewDocName('');
      setNewDocFile(null);
      setDocInputKey((value) => value + 1);
      await reloadDocuments();
      void onDocumentsChanged?.();
    } catch (e: any) {
      setDocError(e.message || 'Failed to upload document.');
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
      void onDocumentsChanged?.();
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
    } catch (e: any) {
      setErr(e.message || 'Failed to load Case Management.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void reloadDocuments();
    // eslint-disable-next-line
  }, [caseId]);

  const myRole = state?.myRole || 'none';
  const isMember = myRole === 'initiator' || myRole === 'reviewer' || myRole === 'approver' || myRole === 'admin';

  // The Initiator submits work the assigned member has ticked as done. Ticking
  // records 'Done' - which is deliberately NOT an approval - so a ticked Key
  // Action can always be handed to the Reviewer instead of being locked as
  // already finished.
  const canRequestReview = (step: CaseManagementStep) =>
    (myRole === 'initiator' || myRole === 'admin') &&
    step.status === 'Done';

  // The Reviewer forwards reviewed work to the Signer/Approver.
  const canRequestApproval = (step: CaseManagementStep) =>
    (myRole === 'reviewer' || myRole === 'admin') &&
    step.status !== 'Completed' &&
    step.status !== 'Awaiting Approval' &&
    step.status === 'Awaiting Review';

  // The Signer/Approver is the only role that signs work off as 'Completed'.
  const canApprove = (step: CaseManagementStep) =>
    (myRole === 'approver' || myRole === 'admin') &&
    step.status !== 'Completed' &&
    step.status === 'Awaiting Approval';

  const refresh = (next: CaseManagementState) => {
    setState(next);
    setQualityDraft(next.qualityScore == null ? '' : String(next.qualityScore));
    void onWorkflowChanged?.();
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
  const doReturn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!returnStepKey || !returnReason.trim()) return;
    setBusy(`return:${returnStepKey}`);
    setErr('');
    try {
      refresh(await returnKeyActionForCorrections(caseId, returnStepKey, returnReason));
      setReturnStepKey('');
      setReturnReason('');
    } catch (error: any) {
      setErr(error.message || 'Failed to return work.');
    } finally { setBusy(''); }
  };
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

      <DocumentsSection
        documents={documents}
        docLoading={docLoading}
        docBusy={docBusy}
        docError={docError}
        newDocName={newDocName}
        newDocFile={newDocFile}
        fileInputKey={docInputKey}
        onDocName={setNewDocName}
        onDocFile={setNewDocFile}
        canUpload={isMember}
        canDelete={myRole === 'admin'}
        onUpload={() => void uploadDocument()}
        onDelete={(id) => void removeDocument(id)}
      />

      <CaseLifecycleBanner state={state} />

      <AssignedMembersCard state={state} />

      <QualityScorePanel state={state} qualityDraft={qualityDraft} onDraft={setQualityDraft} onSave={doSaveQualityScore} saving={qualitySaving} />

      {returnStepKey && (
        <form onSubmit={doReturn} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <label htmlFor="case-correction-feedback" className="block text-sm font-semibold text-amber-900">Return for corrections — required feedback</label>
          <textarea id="case-correction-feedback" required maxLength={5000} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} className="min-h-24 w-full rounded-lg border border-amber-200 bg-white p-3 text-sm" />
          <div className="flex gap-2">
            <button type="submit" disabled={Boolean(busy) || !returnReason.trim()} className="rounded-lg bg-amber-800 px-3 py-2 text-sm text-white disabled:opacity-50">Return to contributor</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => setReturnStepKey('')} className="rounded-lg border px-3 py-2 text-sm">Cancel</button>
          </div>
        </form>
      )}
      <KeyActionsList
        state={state}
        busy={busy}
        canRequestReview={canRequestReview}
        canRequestApproval={canRequestApproval}
        canApprove={canApprove}
        onRequestReview={doRequestReview}
        onRequestApproval={doRequestApproval}
        onApprove={doApprove}
        onReturn={(step) => { setReturnStepKey(step.stepKey); setReturnReason(''); }}
        focusStepKey={focusStepKey}
      />

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

function AssignedMembersCard({ state }: { state: CaseManagementState }) {
  // This is the same live fee/assignment source used on Overview.  It retains
  // historical handovers alongside current assignees, rather than showing only
  // the current `state.members` assignments.
  const members = state.earnedFees.team;

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
            {members.map((member) => (
              <tr key={member.key} className="bg-white dark:bg-gray-800">
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{member.role}</td>
                  <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{member.name || DASH}</span>
                      {member.isCurrentAssignment === false ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">Handover record</span>
                      ) : null}
                      {member.isIndependentContributor ? (
                        <ContributionBadge kind="independent" />
                      ) : null}
                    </div>
                    {member.userRole ? <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">({member.userRole})</span> : null}
                    {member.isCurrentAssignment === false ? <div className="mt-1 text-xs font-normal text-gray-500 dark:text-gray-400">Completed work and earned fee retained.</div> : null}
                    {member.isIndependentContributor ? <div className="mt-1 text-xs font-normal text-blue-700 dark:text-blue-300">Delegated Key Actions: {member.performedKeyActions || 0} performed · {member.completedKeyActions || 0} approved</div> : null}
                  </td>
                  <td
                    className="px-3 py-2 text-right text-gray-600 dark:text-gray-300"
                    title={
                      member.tpaSource === 'none'
                        ? 'No user record matches this team member. Set their role in Users & Access so their TPA applies.'
                        : undefined
                    }
                  >
                    {member.tpaPercent > 0 ? `${member.tpaPercent}%` : DASH}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{member.timelinessScore != null ? `${member.timelinessScore}%` : DASH}</td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{member.qualityScore != null ? `${member.qualityScore}%` : DASH}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">
                    {member.earnedFee != null ? formatMoney(member.earnedFee, state.earnedFees.currency) : DASH}
                  </td>
              </tr>
            ))}
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
  canRequestReview: (step: CaseManagementStep) => boolean;
  canRequestApproval: (step: CaseManagementStep) => boolean;
  canApprove: (step: CaseManagementStep) => boolean;
  onRequestReview: (step: CaseManagementStep) => void;
  onRequestApproval: (step: CaseManagementStep) => void;
  onApprove: (step: CaseManagementStep) => void;
  onReturn: (step: CaseManagementStep) => void;
  focusStepKey?: string;
}) {
  const {
    state,
    busy,
    canRequestReview,
    canRequestApproval,
    canApprove,
    onRequestReview,
    onRequestApproval,
    onApprove,
    onReturn,
    focusStepKey,
  } = props;
  const missingPercentages = state.earnedFees.missingKeyActionPercentages || [];

  /**
   * The workflow template is authoritative for the shape of the checklist: its
   * stages run in template order and each stage owns the Key Actions (steps)
   * that belong to it. Grouping the steps this way makes Case Management read
   * exactly like the Overview tab and the workflow template — stage by stage,
   * each stage followed by its own Key Actions — instead of one flat list.
   *
   * Nothing is dropped: a step whose stage is missing (or blank) is kept in a
   * trailing group so no Key Action disappears from the checklist. Steps are
   * ordered by their template `order`, and each stage is placed by its earliest
   * step, which is the template's own stage sequence.
   */
  const stageRankOfStep = (s: CaseManagementStep) =>
    typeof (s as { stageOrder?: unknown }).stageOrder === 'number' &&
    Number.isFinite((s as { stageOrder?: number }).stageOrder as number)
      ? Number((s as { stageOrder?: number }).stageOrder)
      : Number(s.order ?? 0);
  const orderedSteps = useMemo(
    () => [...state.steps].sort((a, b) => stageRankOfStep(a) - stageRankOfStep(b) || (a.order ?? 0) - (b.order ?? 0)),
    [state.steps]
  );
  const stageGroups = useMemo(() => {
    const grouped = new Map<string, { key: string; title: string; order: number; percentage: number; steps: CaseManagementStep[] }>();

    for (const step of orderedSteps) {
      const key = String(step.stageKey || '');
      if (!key) continue;
      const existing = grouped.get(key);
      if (existing) {
        existing.steps.push(step);
        // The template stage percentage is carried on every step; keep the first
        // real value so a 0 on one step never hides the stage's own percentage.
        if (!existing.percentage && step.stagePercentage) existing.percentage = step.stagePercentage;
      } else {
        grouped.set(key, {
          key,
          title: step.stageTitle || key,
          order: stageRankOfStep(step),
          percentage: step.stagePercentage || 0,
          steps: [step],
        });
      }
    }

    const ordered = Array.from(grouped.values()).sort((a, b) => a.order - b.order);
    // Only show a stage heading when the stage actually owns Key Actions, so an
    // empty stage never renders as a blank section.
    const populated = ordered.filter((stage) => stage.steps.length > 0);
    const unassigned = orderedSteps.filter((step) => !String(step.stageKey || ''));
    const trailing = unassigned.length
      ? [{ key: '__unassigned__', title: 'Additional Key Actions', order: Number.MAX_SAFE_INTEGER, percentage: 0, steps: unassigned }]
      : [];
    const groups = [...populated, ...trailing];
    if (orderedSteps.some((step) => step.addedFromIndependentTask)) {
      for (const group of groups) {
        group.percentage = Math.round(group.steps.reduce((sum, step) => sum + (step.percentage || 0), 0) * 100) / 100;
      }
    }
    return groups;
  }, [orderedSteps]);
  const totalStages = stageGroups.length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-700">
        <div className="flex items-start gap-3">
          <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" />
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Key Actions by stage
            </h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              The workflow template&apos;s Key Actions, completed by the three assigned members, grouped stage by stage in workflow order.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Completed</div>
            <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {state.steps.filter((s) => s.status === 'Completed').length}
              <span className="text-base font-normal text-gray-500 dark:text-gray-400"> / {state.steps.length}</span>
            </div>
          </div>
          <div className="h-10 w-px bg-gray-200 dark:bg-gray-700" />
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Stages</div>
            <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {stageGroups.filter((g) => g.steps.length > 0 && g.steps.every((s) => s.status === 'Completed')).length}
              <span className="text-base font-normal text-gray-500 dark:text-gray-400"> / {totalStages}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5">
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
        {stageGroups.map((stageGroup, stageIndex) => {
          const stageCompleted = stageGroup.steps.filter((s) => s.status === 'Completed').length;
          const stagePercent = stageGroup.steps.length
            ? Math.round((stageCompleted / stageGroup.steps.length) * 100)
            : 0;
          const stageState = stageCompleted === stageGroup.steps.length && stageGroup.steps.length > 0 ? 'done' : 'open';
          return (
            <section
              key={stageGroup.key}
              className={[
                'overflow-hidden rounded-xl border bg-white dark:bg-gray-800',
                stageState === 'done' ? 'border-emerald-200 dark:border-emerald-900' : 'border-gray-200 dark:border-gray-700',
              ].join(' ')}
            >
              <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 bg-gray-50/60 px-5 py-4 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={[
                      'mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                      stageState === 'done'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900',
                    ].join(' ')}
                  >
                    {stageState === 'done' ? '✓' : stageIndex + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                        Stage {stageIndex + 1} of {totalStages}
                      </span>
                      {stageState === 'done' ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                          Completed
                        </span>
                      ) : null}
                    </div>
                    <h4 className="mt-0.5 text-base font-semibold text-gray-900 dark:text-gray-100" title={stageGroup.title}>
                      {stageGroup.title}
                    </h4>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {stageCompleted} of {stageGroup.steps.length} Key Actions completed
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {stageGroup.percentage ? (
                    <span className="inline-flex items-center rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
                      {stageGroup.percentage}% of matter fee
                    </span>
                  ) : null}
                  <div className="w-40">
                    <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                      <span>
                        {stageCompleted} of {stageGroup.steps.length}
                      </span>
                      <span className="font-semibold">{stagePercent}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                      <div className="h-1.5 rounded-full bg-emerald-500 transition-all" style={{ width: `${stagePercent}%` }} />
                    </div>
                  </div>
                </div>
              </header>
              <div className="space-y-3 p-4">
        {stageGroup.steps.map((step, actionIndex) => {
          const chipClass = STATUS_CHIP[step.status] || STATUS_CHIP['Not Started'];
          const isFocused = focusStepKey && step.stepKey === focusStepKey;
          return (
            <div
              key={step.stepKey}
              className={[
                'overflow-hidden rounded-lg border transition-shadow',
                isFocused
                  ? 'border-gray-900 ring-2 ring-gray-900/10 dark:border-gray-300 dark:ring-gray-300/20'
                  : step.status === 'Completed'
                    ? 'border-emerald-200 dark:border-emerald-900'
                    : 'border-gray-200 dark:border-gray-700',
              ].join(' ')}
            >
              <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white dark:bg-gray-100 dark:text-gray-900">
                      {actionIndex + 1}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                      Key Action {actionIndex + 1} of {stageGroup.steps.length}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{step.title}</span>
                    {step.addedFromIndependentTask && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                        Additional Key Action
                      </span>
                    )}
                    <span
                      className="inline-flex items-center rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-xs font-semibold text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300"
                      title="Key Action percentage for this matter"
                    >
                      {step.percentage}%
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${chipClass}`}>{LIFECYCLE_LABEL[step.status] || step.status}</span>
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

              {step.correctionRequest && !step.correctionRequest.resolvedAt && (
                <div className="mx-5 mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <div className="font-semibold">Changes requested by {step.correctionRequest.requestedBy}</div>
                  <p className="mt-1 whitespace-pre-wrap">{step.correctionRequest.reason}</p>
                </div>
              )}
              {(canRequestReview(step) || canRequestApproval(step) || canApprove(step)) && (
                <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-700">
                  {canRequestReview(step) && (
                    <button
                      type="button"
                      onClick={() => onRequestReview(step)}
                      disabled={busy === `review:${step.stepKey}`}
                      title="Send the completed work to the Reviewer"
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
                  {(canRequestApproval(step) || canApprove(step)) && (
                    <button type="button" onClick={() => onReturn(step)} disabled={Boolean(busy)} className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-900 disabled:opacity-50">Return for corrections</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
              </div>
            </section>
          );
        })}
      </div>
      </div>
    </div>
  );
}
function DocumentsSection(props: {
  documents: CaseDocument[];
  docLoading: boolean;
  docBusy: boolean;
  docError: string;
  newDocName: string;
  newDocFile: File | null;
  fileInputKey: number;
  onDocName: (v: string) => void;
  onDocFile: (f: File | null) => void;
  canUpload: boolean;
  canDelete: boolean;
  onUpload: () => void;
  onDelete: (docId: string) => void;
}) {
  const { documents, docLoading, docBusy, docError, newDocName, newDocFile, fileInputKey, onDocName, onDocFile, canUpload, canDelete, onUpload, onDelete } = props;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-1 flex items-center gap-2">
        <Paperclip className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Documents</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Shared case files for the initiator, reviewer and approver. Uploaded files also appear in this matter’s Documents tab.
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
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Document name <span className="font-normal">(optional)</span></span>
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
              key={fileInputKey}
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
                        href={doc.url ? uploadedFileUrl(doc.url) : '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-gray-900 hover:underline dark:text-gray-100"
                      >
                        {doc.name}
                      </a>
                      {doc.version && doc.version > 1 ? <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">v{doc.version}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{doc.uploadedBy || DASH}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{doc.uploadedDate || DASH}</td>
                    <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{doc.size || DASH}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={doc.url ? uploadedFileUrl(doc.url) : '#'}
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
