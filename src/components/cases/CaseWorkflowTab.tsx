import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { TaskData } from '../../services/taskService';
import {
  getWorkflowForCase,
  completeWorkflowStep,
  reopenWorkflowStep,
  amendWorkflowStepDeadline,
  getCaseEarnedFees,
  CaseEarnedFees,
  WorkflowInstance,
} from '../../services/workflowInstanceService';
import { getWorkflowTemplateById, WorkflowTemplate } from '../../services/workflowService';
import {
  formatDeadlineDateTime,
  formatDueCountdown,
  getUrgencyClass,
  getUrgencyColorForDueDate,
  isStepWorkDone,
  toDateTimeLocalValue,
} from '../../utils/workflowDeadline';

type Props = {
  caseId: string;
  canCompleteSteps: boolean;
  canToggleActions: boolean;
  canUpload: boolean;
  onWorkflowChanged?: () => void | Promise<void>;
  tasks?: TaskData[];
  currentUserName?: string;
  currentUserEmail?: string;
  /** Kept for backwards-compatible callers; ticking stays in the Overview. */
  onOpenCaseManagement?: (stepKey?: string) => void;
};

const formatMoney = (amount: number | null | undefined, currency?: string) => {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return '_';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: String(currency || 'RWF'),
    maximumFractionDigits: 0,
  }).format(Number(amount));
};

export default function CaseWorkflowTab({ caseId, canCompleteSteps, canToggleActions, canUpload, onWorkflowChanged, tasks, currentUserName, currentUserEmail, onOpenCaseManagement }: Props) {
  void canUpload;
  void canToggleActions;
  void onOpenCaseManagement;
  const [wf, setWf] = useState<WorkflowInstance | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [busyKey, setBusyKey] = useState<string>('');
  const [template, setTemplate] = useState<WorkflowTemplate | null>(null);
  const [earned, setEarned] = useState<CaseEarnedFees | null>(null);

  const canAmendDeadlines = canCompleteSteps;
  const [amendOpenFor, setAmendOpenFor] = useState<string>('');
  const [amendDate, setAmendDate] = useState<string>('');
  const [amendReason, setAmendReason] = useState<string>('');

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await getWorkflowForCase(caseId);
      setWf(data);
      if (data?.templateId) {
        try {
          const t = await getWorkflowTemplateById(String(data.templateId));
          setTemplate(t);
        } catch {
          setTemplate(null);
        }
      } else {
        setTemplate(null);
      }
      void refreshEarned();
    } catch (e: any) {
      setErr(e.message || 'Failed to load workflow');
      setWf(null);
      setTemplate(null);
    } finally {
      setLoading(false);
    }
  };

  const refreshEarned = async () => {
    try {
      const data = await getCaseEarnedFees(caseId);
      setEarned(data);
    } catch {
      // Earned-fee projection is best-effort; never block the workflow tab on it.
    }
  };

  const notifyWorkflowChanged = () => {
    void onWorkflowChanged?.();
    void refreshEarned();
  };

  // Stage metadata from the template — used as a fallback so percentages / titles
  // render even for workflow instances created before percentages existed.
  const stageMetaByKey = useMemo(() => {
    const map = new Map<string, { title?: string; percentage?: number }>();
    for (const stage of template?.stages || []) {
      map.set(String(stage.key || ''), {
        title: stage.title || stage.name,
        percentage: stage.percentage,
      });
    }
    return map;
  }, [template]);

  const stageTitleOf = (step: { stageKey?: string; stageTitle?: string }): string => {
    if (step.stageTitle) return step.stageTitle;
    // Never fall back to the raw stage key (e.g. "BR2_INTAKE_KYC") in the UI.
    return stageMetaByKey.get(String(step.stageKey || ''))?.title || 'Stage';
  };
  const keyActionValueOf = (stepKey: string) =>
    earned?.keyActions?.find((action) => String(action.key) === String(stepKey));

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [caseId]);

  const onCompleteStep = async (stepKey: string) => {
    if (!canCompleteSteps) return;
    const snapshot = wf;
    // Optimistic: the tick must feel instant, so the card flips immediately.
    // Optimistically mirror the server's new state: a tick records 'Done'
    // (work finished), NOT 'Completed' (which only an approval may write).
    setErr('');
    setBusyKey(`complete:${stepKey}`);
    setWf((current) =>
      current
        ? {
            ...current,
            steps: current.steps.map((step) =>
              step.stepKey === stepKey
                ? { ...step, status: 'Done', completedAt: undefined }
                : step
            ),
          }
        : current
    );
    try {
      const updated = await completeWorkflowStep(caseId, stepKey);
      setWf(updated);
      notifyWorkflowChanged();
      // Stay on this checklist so staff can tick the rest of the Key Actions
      // without being sent away to Case Management after every action.
    } catch (e: any) {
      setWf(snapshot); // revert the optimistic tick if the server refused
      setErr(e.message || 'Failed to complete step');
    } finally {
      setBusyKey('');
    }
  };

  const onReopenStep = async (stepKey: string) => {
    if (!canCompleteSteps) return;
    try {
      setBusyKey(`complete:${stepKey}`);
      setErr('');
      const updated = await reopenWorkflowStep(caseId, stepKey);
      setWf(updated);
      notifyWorkflowChanged();
    } catch (e: any) {
      setErr(e.message || 'Failed to reopen step');
    } finally {
      setBusyKey('');
    }
  };

  const onAmendDeadline = async (stepKey: string) => {
    if (!canAmendDeadlines) return;
    const step = wf?.steps?.find((x) => x.stepKey === stepKey);
    if (!step) {
      setErr('Step not found');
      return;
    }
    if (!step.dueAt) {
      setErr('Step has no current due date to amend.');
      return;
    }
    if (!amendDate) {
      setErr('Please choose a new due date and time.');
      return;
    }
    try {
      const selected = new Date(amendDate);
      if (!Number.isFinite(selected.getTime())) {
        setErr('Please choose a valid date and time.');
        return;
      }

      setBusyKey(`amend:${stepKey}`);
      setErr('');
      const updated = await amendWorkflowStepDeadline(caseId, stepKey, selected.toISOString(), amendReason);
      setWf(updated);
      notifyWorkflowChanged();
      setAmendOpenFor('');
      setAmendDate('');
      setAmendReason('');
    } catch (e: any) {
      setErr(e.message || 'Failed to amend deadline');
    } finally {
      setBusyKey('');
    }
  };

  const templatePill = !wf?.templateId ? null : (
    <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700">
      <span className="font-semibold">Workflow</span>
      <span className="text-gray-700">{template?.matterType || template?.name || 'Template'}</span>
      <span className="text-gray-400">•</span>
      <span className="font-mono text-gray-500">{String(wf.templateId).slice(-8)}</span>
    </div>
  );

  if (loading) return <div className="py-8 text-gray-500">Loading workflow...</div>;
  if (err) return <div className="py-4 text-red-700 bg-red-50 border border-red-100 rounded px-4">{err}</div>;
  if (!wf) return <div className="py-8 text-gray-500">No workflow found for this case.</div>;

  const steps = [...wf.steps].sort((a, b) => a.order - b.order);

  /**
   * The workflow template is authoritative for the shape of the checklist: its
   * stages run in template order and each stage owns the Key Actions (steps)
   * that belong to it, in template order. Grouping the instance steps this way
   * keeps the Overview tab reading exactly like the workflow template — stage by
   * stage, each stage followed by its own Key Actions — instead of one flat list.
   *
   * Nothing is dropped: any instance step whose stage is missing from the
   * template (or has no stage at all) is kept in a trailing group so no work
   * disappears from the checklist.
   */
  const stageGroups = (() => {
    const templateStages = [...(template?.stages || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const grouped = new Map<string, { key: string; title: string; order: number; percentage: number | null; steps: typeof steps }>();

    for (const stage of templateStages) {
      const key = String(stage.key || '');
      if (!key) continue;
      grouped.set(key, {
        key,
        title: String(stage.title || stage.name || key),
        order: Number(stage.order ?? 0),
        percentage: typeof stage.percentage === 'number' ? stage.percentage : null,
        steps: [],
      });
    }

    const orphans: typeof steps = [];
    for (const step of steps) {
      const stageKey = String(step.stageKey || '');
      const group = grouped.get(stageKey);
      if (group) {
        group.steps.push(step);
      } else {
        orphans.push(step);
      }
    }

    const ordered = Array.from(grouped.values()).sort((a, b) => a.order - b.order);
    // Only render a stage heading when the stage actually owns Key Actions, so
    // an empty stage never appears as a blank section.
    const populated = ordered.filter((stage) => stage.steps.length > 0);
    const unassigned = orphans.length
      ? [{ key: '__unassigned__', title: 'Additional Key Actions', order: Number.MAX_SAFE_INTEGER, percentage: null, steps: orphans }]
      : [];
    return [...populated, ...unassigned];
  })();

  const totalStages = stageGroups.length;

  // Journey helpers: these drive the "where does the workflow start, where is it
  // now and where does it end" summary. They are presentation only - every value
  // comes from the same instance/template data the stage cards already render.
  // Progress reflects WORK DONE (ticked), not approval - so the journey and the
  // stage bars move the moment a Key Action is ticked, exactly like the tick.
  const completedSteps = steps.filter((s) => isStepWorkDone(s)).length;
  const overallPercent = steps.length ? Math.round((completedSteps / steps.length) * 100) : 0;
  const currentStepRef = steps.find((s) => s.stepKey === wf.currentStepKey) || null;
  const currentStageIndex = currentStepRef
    ? stageGroups.findIndex((group) => group.key === String(currentStepRef.stageKey || ''))
    : -1;
  const stageState = (stageGroup: (typeof stageGroups)[number], stageIndex: number) => {
    if (stageGroup.steps.length > 0 && stageGroup.steps.every((s) => isStepWorkDone(s))) return 'done';
    if (stageIndex === currentStageIndex) return 'current';
    if (stageGroup.steps.some((s) => s.status === 'In Progress' || s.status === 'Awaiting Review' || s.status === 'Awaiting Approval')) {
      return 'current';
    }
    return 'upcoming';
  };

  return (
    <div className="space-y-4">
      {/* Earned fees — contract value × workflow completion, productivity formula (TPA × timeliness × quality) */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Earned Fees</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Completed Key Actions are valued from the contract and capped by Paid invoice collections before TPA, timeliness and quality.
            </div>
            <div className="hidden">
              Contract value × workflow completed, then TPA × Timeliness × Quality per team member
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500 dark:text-gray-400">Eligible collected value</div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {formatMoney(earned?.earnedValue, earned?.currency)}
            </div>
          </div>
        </div>

        {(earned?.missingKeyActionPercentages?.length || 0) > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            {earned?.missingKeyActionPercentages?.length} Key Action percentage{earned?.missingKeyActionPercentages?.length === 1 ? '' : 's'} missing. Those actions remain worth 0 until a percentage is set in the workflow.
          </div>
        )}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
            Matter Quality Score:{' '}
            {earned?.qualityScore == null ? '_' : `${earned.qualityScore}%`}
          </span>
          {earned?.qualityScoredBy ? (
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
              Recorded by {earned.qualityScoredBy}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-400">
              Not yet scored - earned fees render '_' until the Quality Score is entered.
            </span>
          )}
        </div>


        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
            <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Contract Value</div>
            <div className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
              {formatMoney(earned?.contractValue, earned?.currency)}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
            <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Workflow Completed</div>
            <div className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
              {earned?.completedPercent ?? 0}%
            </div>
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {earned?.completedKeyActions ?? 0} completed Key Action{earned?.completedKeyActions === 1 ? '' : 's'} weighted by percentage
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
            <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Completed Action Value</div>
            <div className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
              {formatMoney(earned?.completedValue, earned?.currency)}
            </div>
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Progress value covered so far
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
            <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Collected / Eligible</div>
            <div className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
              {formatMoney(earned?.earnedValue, earned?.currency)}
            </div>
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Paid: {formatMoney(earned?.collectedAmount, earned?.currency)}{Number(earned?.collectedAmount || 0) <= 0 ? ' — staff earnings remain 0' : ''}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
            <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Staff Earned Fees</div>
            <div className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
              {earned?.staffEarnedTotal == null ? '_' : formatMoney(earned.staffEarnedTotal, earned.currency)}
            </div>
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Earned by the assigned members</div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
            <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Remaining Firm Fee</div>
            <div className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
              {earned?.firmFee == null ? '_' : formatMoney(earned.firmFee, earned.currency)}
            </div>
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Eligible collected value after staff earned fees</div>
          </div>
        </div>

        {earned && earned.team.length > 0 ? (
          <div className="overflow-hidden border border-gray-200 dark:border-gray-700 rounded-lg">
            <table className="w-full text-sm">
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
                {earned.team.map((member) => {
                  const fee = member.earnedFee;
                  const noScores = member.timelinessScore == null && member.qualityScore == null;
                  return (
                    <tr key={member.key} className="bg-white dark:bg-gray-800">
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{member.role}</td>
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{member.name}</td>
                      <td
                        className="px-3 py-2 text-right text-gray-600 dark:text-gray-300"
                        title={
                          member.tpaSource === 'none'
                            ? 'No user record matches this team member. Set their role in Users & Access so their TPA applies.'
                            : undefined
                        }
                      >
                        {member.tpaPercent > 0 ? `${member.tpaPercent}%` : '_'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">
                        {member.timelinessScore != null ? `${member.timelinessScore}%` : '_'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">
                        {member.qualityScore != null ? `${member.qualityScore}%` : '_'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">
                        {formatMoney(member.taskFeeCollected, earned.currency)}
                      </td>
                      <td
                        className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100"
                        title={noScores ? 'Timeliness/quality not scored yet — earned fee renders _ until the scores are entered.' : ''}
                      >
                        {fee != null ? formatMoney(fee, earned.currency) : '_'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            No team assignments yet — assign an initiator, reviewer and approver to this matter to see earned fees.
          </div>
        )}
      </div>

      {/* Journey header — answers at a glance: where does the workflow start,
          which stage am I in, and where does it end. */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
              Workflow journey
            </div>
            <h3 className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {currentStepRef ? currentStepRef.title : wf.status === 'Completed' ? 'Workflow completed' : 'Workflow not started yet'}
            </h3>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {wf.status === 'Completed'
                ? 'All Key Actions are done.'
                : currentStepRef
                  ? `Current Key Action • ${stageTitleOf(currentStepRef)}${currentStepRef.dueAt ? ` • due ${formatDeadlineDateTime(currentStepRef.dueAt)}` : ''}`
                  : 'No Key Action is in progress yet.'}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Overall progress</div>
              <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{overallPercent}%</div>
            </div>
            <div className="h-10 w-px bg-gray-200 dark:bg-gray-700" />
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Stages</div>
              <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                {stageGroups.filter((group) => group.steps.length > 0 && group.steps.every((s) => isStepWorkDone(s))).length}
                <span className="text-base font-normal text-gray-500 dark:text-gray-400"> / {totalStages}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Stage rail: scrollable on small screens, one node per stage in order. */}
        <div className="overflow-x-auto px-5 py-4">
          <ol className="flex min-w-max items-start gap-0">
            {stageGroups.map((stageGroup, stageIndex) => {
              const state = stageState(stageGroup, stageIndex);
              const done = stageGroup.steps.filter((s) => isStepWorkDone(s)).length;
              const isLast = stageIndex === stageGroups.length - 1;
              return (
                <li key={stageGroup.key} className="flex items-start">
                  <div className="flex w-40 shrink-0 flex-col items-center px-2 text-center">
                    <span
                      className={[
                        'inline-flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold border-2 transition-colors',
                        state === 'done'
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : state === 'current'
                            ? 'border-gray-900 bg-gray-900 text-white ring-4 ring-gray-900/10 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
                            : 'border-gray-300 bg-white text-gray-400 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-500',
                      ].join(' ')}
                      title={`Stage ${stageIndex + 1} of ${totalStages}`}
                    >
                      {state === 'done' ? '✓' : stageIndex + 1}
                    </span>
                    <span
                      className={[
                        'mt-2 line-clamp-2 text-xs font-medium leading-tight',
                        state === 'upcoming' ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100',
                      ].join(' ')}
                      title={stageGroup.title}
                    >
                      {stageGroup.title}
                    </span>
                    <span className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      {done}/{stageGroup.steps.length} done
                    </span>
                  </div>
                  {!isLast ? (
                    <span
                      className={[
                        'mt-[18px] h-0.5 w-6 shrink-0 rounded-full',
                        state === 'done' ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-700',
                      ].join(' ')}
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="border-t border-gray-200 px-5 py-3 dark:border-gray-700">{templatePill}</div>
      </div>

      {stageGroups.map((stageGroup, stageIndex) => {
        const stageDone = stageGroup.steps.filter((s) => isStepWorkDone(s)).length;
        const state = stageState(stageGroup, stageIndex);
        const stagePercent = stageGroup.steps.length ? Math.round((stageDone / stageGroup.steps.length) * 100) : 0;
        const stageWindow = stageGroup.steps.length
          ? `${formatDeadlineDateTime(stageGroup.steps[0]?.startAt)} → ${formatDeadlineDateTime(
              stageGroup.steps[stageGroup.steps.length - 1]?.dueAt
            )}`
          : '';
        return (
        <section
          key={stageGroup.key}
          className={[
            'overflow-hidden rounded-xl border bg-white dark:bg-gray-800',
            state === 'current'
              ? 'border-gray-900 ring-2 ring-gray-900/5 dark:border-gray-400 dark:ring-gray-400/10'
              : 'border-gray-200 dark:border-gray-700',
            state === 'upcoming' ? 'opacity-90' : '',
          ].join(' ')}
        >
          {/* Stage header — the visual boundary: what this stage is, when it
              runs, how far it has got, and what it is worth. */}
          <header
            className={[
              'flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4',
              state === 'current'
                ? 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40'
                : 'border-gray-200 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/30',
            ].join(' ')}
          >
            <div className="flex min-w-0 items-start gap-3">
              <span
                className={[
                  'mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  state === 'done'
                    ? 'bg-emerald-600 text-white'
                    : state === 'current'
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
                ].join(' ')}
              >
                {state === 'done' ? '✓' : stageIndex + 1}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                    Stage {stageIndex + 1} of {totalStages}
                  </span>
                  {state === 'current' ? (
                    <span className="inline-flex items-center rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-gray-100 dark:text-gray-900">
                      Current
                    </span>
                  ) : null}
                  {state === 'done' ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                      Completed
                    </span>
                  ) : null}
                </div>
                <h4 className="mt-0.5 text-base font-semibold text-gray-900 dark:text-gray-100" title={stageGroup.title}>
                  {stageGroup.title}
                </h4>
                {stageWindow ? (
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{stageWindow}</div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-4">
              {stageGroup.percentage != null ? (
                <span className="inline-flex items-center rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
                  {stageGroup.percentage}% of matter fee
                </span>
              ) : null}
              <div className="w-40">
                <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                  <span>
                    {stageDone} of {stageGroup.steps.length} Key Actions
                  </span>
                  <span className="font-semibold">{stagePercent}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-1.5 rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${stagePercent}%` }}
                  />
                </div>
              </div>
            </div>
          </header>
          <div className="space-y-4 p-4">
              {stageGroup.steps.map((s, actionIndex) => {
        // Overview ticks are intentionally independent: any Key Action can be
        // recorded as done here, while review and approval happen separately in
        // Case Management when the team is ready.
        const isTicked = isStepWorkDone(s);
        const isCompleted = s.status === 'Completed';
        const isLoading = busyKey === `complete:${s.stepKey}`;

        const extensionHistory = Array.isArray(s.extensionHistory) ? s.extensionHistory : [];
        const latestExtension = extensionHistory[extensionHistory.length - 1];

        const tooltipMessage = isTicked ? 'Click to reopen Key Action' : 'Click to mark Key Action as done';

        const keyActionValue = keyActionValueOf(s.stepKey);

        return (
        <div
          key={s.stepKey}
          className={[
            'flex overflow-hidden rounded-lg border bg-white dark:bg-gray-800',
            isTicked
              ? 'border-emerald-200 dark:border-emerald-900'
              : s.stepKey === wf.currentStepKey
                ? 'border-gray-900 ring-1 ring-gray-900/5 dark:border-gray-400'
                : 'border-gray-200 dark:border-gray-700',
          ].join(' ')}
        >
          {/* Left status rail — shows at a glance where this Key Action stands. */}
          <div
            className={[
              'w-1.5 shrink-0',
              isTicked
                ? 'bg-emerald-500'
                : s.status === 'In Progress'
                  ? 'bg-gray-900 dark:bg-gray-100'
                  : 'bg-gray-200 dark:bg-gray-700',
            ].join(' ')}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white dark:bg-gray-100 dark:text-gray-900">
                  {actionIndex + 1}
                </span>
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                  Key Action {actionIndex + 1} of {stageGroup.steps.length}
                </span>
                <span
                  className={[
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    isCompleted
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : isTicked
                        ? 'bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300'
                        : s.status === 'In Progress'
                          ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
                  ].join(' ')}
                >
                  {s.status}
                </span>
              </div>
              <div className="mt-1.5 font-semibold text-gray-900 dark:text-gray-100">{s.title}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${getUrgencyClass(
                    getUrgencyColorForDueDate(s.dueAt, s.startAt)
                  )}`}
                  title={s.dueAt ? `Due: ${formatDeadlineDateTime(s.dueAt)}` : 'No due date'}
                >
                  {formatDueCountdown(s.dueAt)}
                </span>
                {s.dueAt ? (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Due {formatDeadlineDateTime(s.dueAt)}</span>
                ) : null}
                {s.slaMinutes ? (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Duration: {Math.round(s.slaMinutes / 60)}h</span>
                ) : s.slaText ? (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Duration: {s.slaText}</span>
                ) : null}
                {latestExtension ? (
                  <span
                    className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800"
                    title={
                      `Extension granted${latestExtension.days ? ` ${latestExtension.days > 0 ? `+${latestExtension.days}` : latestExtension.days}d` : ''}` +
                      `${latestExtension.reason ? ` • ${latestExtension.reason}` : ''}` +
                      `${latestExtension.grantedBy ? ` • by ${latestExtension.grantedBy}` : ''}` +
                      `${latestExtension.newDueAt ? ` • due ${formatDeadlineDateTime(latestExtension.newDueAt)}` : ''}`
                    }
                  >
                    Extension granted: {latestExtension.days > 0 ? '+' : ''}
                    {latestExtension.days}d
                  </span>
                ) : null}
              </div>
            </div>

            {/* Action zone: amendment + complete/reopen, grouped so the tick is
                always the last thing the eye lands on. */}
            <div className="flex shrink-0 items-center gap-2">
              {canAmendDeadlines && !isCompleted && (
                <button
                  type="button"
                  onClick={() => {
                    if (amendOpenFor === s.stepKey) {
                      setAmendOpenFor('');
                      setAmendDate('');
                    } else {
                      setAmendOpenFor(s.stepKey);
                      setAmendDate(toDateTimeLocalValue(s.dueAt));
                    }
                  }}
                  className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                  title="Amend deadline"
                >
                  <CalendarPlus className="w-4 h-4" />
                  Amend
                </button>
              )}

              {canCompleteSteps && (
                <button
                  disabled={isLoading}
                  onClick={() => {
                    // Clicking a ticked Key Action reopens it; clicking an
                    // unticked one records the work as done. The tick state is
                    // "work done", which includes 'Done' - not just 'Completed'.
                    if (isTicked) {
                      onReopenStep(s.stepKey);
                    } else {
                      onCompleteStep(s.stepKey);
                    }
                  }}
                  className="flex items-center justify-center w-10 h-10 rounded-lg bg-green-50 dark:bg-gray-700 border-2 border-green-600 dark:border-green-400 shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  title={tooltipMessage}
                >
                  {isTicked ? (
                    <div className="w-6 h-6 bg-green-500 rounded flex items-center justify-center border-2 border-green-700 shadow-sm">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded bg-green-50 dark:bg-gray-600 border-2 border-green-500 dark:border-green-400 shadow-inner" />
                  )}
                </button>
              )}
            </div>
          </div>

          {amendOpenFor === s.stepKey && canAmendDeadlines ? (
                <div className="px-5 py-4 border-b border-gray-200 bg-gray-50">
              <div className="text-sm font-semibold text-gray-900">Amend deadline</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">New due date & time</label>
                  <input
                    value={amendDate}
                    onChange={(e) => setAmendDate(e.target.value)}
                    type="datetime-local"
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Reason (optional)</label>
                  <input
                    value={amendReason}
                    onChange={(e) => setAmendReason(e.target.value)}
                    placeholder="e.g., Awaiting client documents"
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAmendOpenFor('');
                    setAmendDate('');
                    setAmendReason('');
                  }}
                  className="px-3 py-2 border border-gray-300 rounded text-gray-700 hover:bg-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => onAmendDeadline(s.stepKey)}
                  disabled={busyKey === `amend:${s.stepKey}`}
                  className="px-3 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-60"
                >
                  {busyKey === `amend:${s.stepKey}` ? 'Amending…' : 'Amend deadline'}
                </button>
              </div>
            </div>
          ) : null}

          {extensionHistory.length > 0 ? (
            <div className="px-5 py-3 border-b border-amber-100 bg-amber-50">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">Extension history</div>
              <div className="mt-2 space-y-2">
                {extensionHistory.slice().reverse().map((extension, extIndex) => (
                  <div key={`${extension.grantedAt || extIndex}`} className="text-xs text-amber-900">
                    <span className="font-semibold">
                      {extension.days > 0 ? '+' : ''}
                      {extension.days} day{Math.abs(extension.days) === 1 ? '' : 's'}
                    </span>
                    {extension.previousDueAt && extension.newDueAt ? (
                      <span>
                        {' '}
                        from {formatDeadlineDateTime(extension.previousDueAt)} to {formatDeadlineDateTime(extension.newDueAt)}
                      </span>
                    ) : null}
                    {extension.reason ? <span> • {extension.reason}</span> : null}
                    {extension.grantedBy ? <span> • granted by {extension.grantedBy}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-700">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Documents and deliverables are managed in the <span className="font-medium text-gray-900 dark:text-gray-100">Documents</span> tab.
            </div>
          </div>
            </div>
        </div>
          );
          })}
          </div>
        </section>
        );
      })}

    </div>
  );
}

