import { useEffect, useState } from 'react';
import { CalendarPlus, Plus, Pencil, Trash2, X } from 'lucide-react';
import {
  getWorkflowForCase,
  completeWorkflowStep,
  reopenWorkflowStep,
  amendWorkflowStepDeadline,
  toggleWorkflowStepAction,
  addWorkflowStepAction,
  updateWorkflowStepAction,
  deleteWorkflowStepAction,
  WorkflowInstance,
} from '../../services/workflowInstanceService';
import { getWorkflowTemplateById, WorkflowTemplate } from '../../services/workflowService';
import {
  formatDueCountdown,
  getUrgencyClass,
  getUrgencyColorForDueDate,
} from '../../utils/workflowDeadline';

type Props = {
  caseId: string;
  canCompleteSteps: boolean;
  canUpload: boolean;
  onWorkflowChanged?: () => void | Promise<void>;
};

const formatWorkflowStepFee = (step: WorkflowInstance['steps'][number]) => {
  const currency = step.feeCurrency || 'RWF';
  if (typeof step.feeRangeMin === 'number' && typeof step.feeRangeMax === 'number') {
    return `${currency} ${Math.round(step.feeRangeMin).toLocaleString()} - ${Math.round(step.feeRangeMax).toLocaleString()}`;
  }
  if (typeof step.feeAmount === 'number') {
    return `${currency} ${Math.round(step.feeAmount).toLocaleString()}`;
  }
  return step.feeText || 'No fee set';
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const formatDateInputValue = (value?: string | Date | null) => {
  if (!value) return '';
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dateInputValueToUtcMs = (value: string) => {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (![year, month, day].every(Number.isFinite)) return NaN;
  return Date.UTC(year, month - 1, day);
};

export default function CaseWorkflowTab({ caseId, canCompleteSteps, canUpload, onWorkflowChanged }: Props) {
  void canUpload;
  const [wf, setWf] = useState<WorkflowInstance | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [busyKey, setBusyKey] = useState<string>('');
  const [template, setTemplate] = useState<WorkflowTemplate | null>(null);
  const [actionEditor, setActionEditor] = useState<{
    stepKey: string;
    stepTitle: string;
    mode: 'add' | 'edit';
    index?: number;
    text: string;
  } | null>(null);

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
    } catch (e: any) {
      setErr(e.message || 'Failed to load workflow');
      setWf(null);
      setTemplate(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [caseId]);

  const toggleAction = async (stepKey: string, index: number) => {
    if (!canCompleteSteps) return;
    try {
      setBusyKey(`action:${stepKey}:${index}`);
      setErr('');
      const updated = await toggleWorkflowStepAction(caseId, stepKey, index);
      setWf(updated);
      await onWorkflowChanged?.();
    } catch (e: any) {
      setErr(e.message || 'Failed to update key action');
    } finally {
      setBusyKey('');
    }
  };

  const openAddAction = (stepKey: string, stepTitle: string) => {
    setActionEditor({ stepKey, stepTitle, mode: 'add', text: '' });
  };

  const openEditAction = (stepKey: string, stepTitle: string, index: number, text: string) => {
    setActionEditor({ stepKey, stepTitle, mode: 'edit', index, text });
  };

  const submitActionEditor = async () => {
    if (!actionEditor) return;
    const text = actionEditor.text.trim();
    if (!text) {
      setErr('Action text is required.');
      return;
    }

    try {
      setBusyKey(`${actionEditor.mode}:${actionEditor.stepKey}:${actionEditor.index ?? 'new'}`);
      setErr('');
      const updated =
        actionEditor.mode === 'add'
          ? await addWorkflowStepAction(caseId, actionEditor.stepKey, text)
          : await updateWorkflowStepAction(caseId, actionEditor.stepKey, Number(actionEditor.index), { text });
      setWf(updated);
      await onWorkflowChanged?.();
      setActionEditor(null);
    } catch (e: any) {
      setErr(e.message || 'Failed to save key action');
    } finally {
      setBusyKey('');
    }
  };

  const removeAction = async (stepKey: string, index: number) => {
    if (!window.confirm('Delete this key action?')) return;
    try {
      setBusyKey(`delete:${stepKey}:${index}`);
      setErr('');
      const updated = await deleteWorkflowStepAction(caseId, stepKey, index);
      setWf(updated);
      await onWorkflowChanged?.();
    } catch (e: any) {
      setErr(e.message || 'Failed to delete key action');
    } finally {
      setBusyKey('');
    }
  };

  const onCompleteStep = async (stepKey: string) => {
    if (!canCompleteSteps) return;
    try {
      setBusyKey(`complete:${stepKey}`);
      setErr('');
      const updated = await completeWorkflowStep(caseId, stepKey);
      setWf(updated);
      await onWorkflowChanged?.();
    } catch (e: any) {
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
      await onWorkflowChanged?.();
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
      setErr('Please choose a new due date.');
      return;
    }
    try {
      const currentDueDate = formatDateInputValue(step.dueAt);
      const currentDueMs = dateInputValueToUtcMs(currentDueDate);
      const selectedMs = dateInputValueToUtcMs(amendDate);

      if (!Number.isFinite(currentDueMs) || !Number.isFinite(selectedMs)) {
        setErr('Please choose a valid date.');
        return;
      }

      const days = Math.round((selectedMs - currentDueMs) / MS_PER_DAY);
      if (!Number.isFinite(days)) {
        setErr('Please choose a valid date.');
        return;
      }

      setBusyKey(`amend:${stepKey}`);
      setErr('');
      const updated = await amendWorkflowStepDeadline(caseId, stepKey, days, amendReason);
      setWf(updated);
      await onWorkflowChanged?.();
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
  const orderedActionRefs = steps.flatMap((step) => {
    const stepActions = (step.actions && step.actions.length ? step.actions : undefined) || undefined;
    const derivedActions = !stepActions
      ? (() => {
          const templateStep = template?.steps?.find((ts) => ts.key === step.stepKey);
          const keyActions = templateStep?.actions || [];
          return keyActions.map((text: string) => ({ text, done: false }));
        })()
      : stepActions;
    return (derivedActions || []).map((action: any, idx: number) => ({ stepKey: step.stepKey, idx, done: Boolean(action?.done) }));
  });

  const canCheckAction = (stepKey: string, idx: number) => {
    const currentIndex = orderedActionRefs.findIndex((action) => action.stepKey === stepKey && action.idx === idx);
    if (currentIndex <= 0) return true;
    return orderedActionRefs.slice(0, currentIndex).every((action) => action.done);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-500">Workflow status</div>
            <div className="text-lg font-semibold text-gray-900">{wf.status}</div>
          </div>
          <div className="text-sm text-gray-600">
            Current step: <span className="font-medium text-gray-900">{wf.currentStepKey || '—'}</span>
          </div>
        </div>
        <div className="mt-3">{templatePill}</div>
      </div>

      {steps.map((s, index, arr) => {
        // Check if previous step is completed (or this is the first step)
        const previousStepCompleted = index === 0 || (arr[index - 1]?.status === 'Completed');

        // Determine if checkbox should be disabled for completing
        const isCompleted = s.status === 'Completed';
        const isLoading = busyKey === `complete:${s.stepKey}`;

        const stepActions = (s.actions && s.actions.length ? s.actions : undefined) || undefined;
        const derivedActions = !stepActions
          ? (() => {
              const templateStep = template?.steps?.find((ts) => ts.key === s.stepKey);
              const keyActions = templateStep?.actions || [];
              return keyActions.map((text: string) => ({ text, done: false }));
            })()
          : stepActions;

        const hasActions = (derivedActions || []).length > 0;
        const allActionsDone = !hasActions || (derivedActions || []).every((a) => a.done);
        const cannotComplete = !isCompleted && (!previousStepCompleted || !allActionsDone);
        const extensionHistory = Array.isArray(s.extensionHistory) ? s.extensionHistory : [];
        const latestExtension = extensionHistory[extensionHistory.length - 1];
        
        // Build tooltip message
        let tooltipMessage = '';
        if (isCompleted) {
          tooltipMessage = 'Click to reopen step';
        } else if (!previousStepCompleted) {
          tooltipMessage = 'Complete previous steps first';
        } else if (!allActionsDone) {
          tooltipMessage = 'Complete all key actions first';
        } else {
          tooltipMessage = 'Click to mark as complete';
        }

        const keyActions = derivedActions || [];
        const canManageActions = canCompleteSteps && s.status !== 'Completed';

        return (
        <div key={s.stepKey} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="flex-1">
              <div className="text-xs text-gray-500 dark:text-gray-400">{s.stepKey}</div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">{s.title}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Status: {s.status}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${getUrgencyClass(
                    getUrgencyColorForDueDate(s.dueAt, s.startAt)
                  )}`}
                  title={s.dueAt ? `Due: ${new Date(s.dueAt).toLocaleString()}` : 'No due date'}
                >
                  {formatDueCountdown(s.dueAt)}
                </span>
                {!previousStepCompleted && !isCompleted && (
                  <span className="text-xs text-gray-500 dark:text-gray-400" title="Previous steps must be completed first">
                    ← Complete previous steps first
                  </span>
                )}
                {!allActionsDone && !isCompleted && hasActions && (
                  <span className="text-xs text-amber-600 dark:text-amber-400" title="Pending key actions">
                    ⏳ Key actions pending
                  </span>
                )}
                {latestExtension ? (
                  <span
                    className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800"
                    title={
                      `Extension granted${latestExtension.days ? ` ${latestExtension.days > 0 ? `+${latestExtension.days}` : latestExtension.days}d` : ''}` +
                      `${latestExtension.reason ? ` • ${latestExtension.reason}` : ''}` +
                      `${latestExtension.grantedBy ? ` • by ${latestExtension.grantedBy}` : ''}` +
                      `${latestExtension.newDueAt ? ` • due ${new Date(latestExtension.newDueAt).toLocaleDateString()}` : ''}`
                    }
                  >
                    Extension granted: {latestExtension.days > 0 ? '+' : ''}
                    {latestExtension.days}d
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Grey vertical line separator */}
              <div className="h-16 w-px bg-gray-300 dark:bg-gray-600" />

              {/* Fee section on the right side */}
              <div className="flex flex-col items-end gap-1 pl-4">
                {s.dueAt ? (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Due {new Date(s.dueAt).toLocaleDateString()}</span>
                ) : null}
                <span className="text-xs text-gray-700 dark:text-gray-300 font-medium">
                  Fee / range: {formatWorkflowStepFee(s)}
                </span>
                {s.slaMinutes ? (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Duration: {Math.round(s.slaMinutes / 60)}h</span>
                ) : s.slaText ? (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Duration: {s.slaText}</span>
                ) : null}
              </div>

              {canAmendDeadlines && s.status !== 'Completed' && (
                <button
                  type="button"
                  onClick={() => {
                    if (amendOpenFor === s.stepKey) {
                      setAmendOpenFor('');
                      setAmendDate('');
                    } else {
                      setAmendOpenFor(s.stepKey);
                      setAmendDate(formatDateInputValue(s.dueAt));
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
                  disabled={isLoading || cannotComplete}
                  onClick={() => {
                    if (isCompleted) {
                      onReopenStep(s.stepKey);
                    } else {
                      onCompleteStep(s.stepKey);
                    }
                  }}
                  className="flex items-center justify-center w-10 h-10 rounded-lg bg-green-50 dark:bg-gray-700 border-2 border-green-600 dark:border-green-400 shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  title={tooltipMessage}
                >
                  {isCompleted ? (
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

          {/* Key Actions section below the step header */}
          {keyActions.length > 0 ? (
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Key Actions</div>
                {canManageActions ? (
                  <button
                    type="button"
                    onClick={() => openAddAction(s.stepKey, s.title)}
                    className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add key action
                  </button>
                ) : null}
              </div>
              <ul className="space-y-2">
                {keyActions.map((action: any, idx: number) => {
                  const isBusy = busyKey === `action:${s.stepKey}:${idx}` || busyKey === `delete:${s.stepKey}:${idx}`;
                  const isDone = Boolean(action?.done);
                  const label = typeof action === 'string' ? action : String(action?.text || '');
                  return (
                    <li key={idx} className="flex items-start gap-3">
                      {canCompleteSteps ? (
                        <button
                          type="button"
                          onClick={() => toggleAction(s.stepKey, idx)}
                          disabled={isBusy || (!isDone && (!previousStepCompleted || !canCheckAction(s.stepKey, idx)))}
                          className={`mt-0.5 h-5 w-5 rounded border flex items-center justify-center ${
                            isDone ? 'bg-green-600 border-green-600' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600'
                          } disabled:opacity-60`}
                          title={
                            !isDone && !canCheckAction(s.stepKey, idx)
                              ? 'Complete the previous key action first'
                              : !previousStepCompleted
                                ? 'Complete previous steps first'
                                : 'Toggle key action'
                          }
                        >
                          {isDone ? <span className="text-white text-xs">✓</span> : null}
                        </button>
                      ) : (
                        <div
                          className={`mt-0.5 h-5 w-5 rounded border flex items-center justify-center ${
                            isDone ? 'bg-green-600 border-green-600' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600'
                          }`}
                        >
                          {isDone ? <span className="text-white text-xs">✓</span> : null}
                        </div>
                      )}
                      <div className={`min-w-0 flex-1 text-sm ${isDone ? 'text-gray-500 line-through' : 'text-gray-700 dark:text-gray-200'}`}>
                        {label}
                      </div>
                      {canManageActions ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditAction(s.stepKey, s.title, idx, label)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                            title="Edit key action"
                            disabled={busyKey === `edit:${s.stepKey}:${idx}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeAction(s.stepKey, idx)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-300 bg-white text-gray-600 hover:bg-red-50 hover:text-red-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-red-900/20"
                            title="Delete key action"
                            disabled={busyKey === `delete:${s.stepKey}:${idx}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : canManageActions ? (
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Key Actions</div>
                <button
                  type="button"
                  onClick={() => openAddAction(s.stepKey, s.title)}
                  className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add key action
                </button>
              </div>
              <div className="rounded-lg border border-dashed border-gray-300 bg-white px-3 py-4 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                No key actions configured for this step.
              </div>
            </div>
          ) : null}

          {amendOpenFor === s.stepKey && canAmendDeadlines ? (
            <div className="px-5 py-4 border-b border-gray-200 bg-gray-50">
              <div className="text-sm font-semibold text-gray-900">Amend deadline</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">New due date</label>
                  <input
                    value={amendDate}
                    onChange={(e) => setAmendDate(e.target.value)}
                    type="date"
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
                        from {new Date(extension.previousDueAt).toLocaleDateString()} to{' '}
                        {new Date(extension.newDueAt).toLocaleDateString()}
                      </span>
                    ) : null}
                    {extension.reason ? <span> • {extension.reason}</span> : null}
                    {extension.grantedBy ? <span> • granted by {extension.grantedBy}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="p-5">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Documents and deliverables are managed in the <span className="font-medium text-gray-900 dark:text-gray-100">Documents</span> tab.
            </div>
          </div>
        </div>
        );
      })}

      {actionEditor ? (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="Close key action editor"
            className="absolute inset-0 bg-gray-900/50"
            onClick={() => setActionEditor(null)}
          />
          <div className="relative ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-gray-900">
            <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                  {actionEditor.mode === 'add' ? 'Add key action' : 'Edit key action'}
                </div>
                <h3 className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{actionEditor.stepTitle}</h3>
              </div>
              <button
                type="button"
                onClick={() => setActionEditor(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                  Action text
                </label>
                <textarea
                  value={actionEditor.text}
                  onChange={(e) => setActionEditor((curr) => (curr ? { ...curr, text: e.target.value } : curr))}
                  rows={5}
                  className="mt-2 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  placeholder="Enter a key action"
                />
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {actionEditor.mode === 'add'
                    ? 'This will append to the step’s key action list.'
                    : 'Update the action text without changing its completion status.'}
                </p>
              </div>
            </div>

            <div className="border-t border-gray-200 px-5 py-4 dark:border-gray-800">
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActionEditor(null)}
                  className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitActionEditor}
                  disabled={
                    busyKey === `${actionEditor.mode}:${actionEditor.stepKey}:${actionEditor.index ?? 'new'}` ||
                    !String(actionEditor.text || '').trim()
                  }
                  className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busyKey === `${actionEditor.mode}:${actionEditor.stepKey}:${actionEditor.index ?? 'new'}`
                    ? 'Saving…'
                    : actionEditor.mode === 'add'
                      ? 'Add key action'
                      : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
