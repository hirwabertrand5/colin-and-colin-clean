import { useEffect, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import {
  getWorkflowForCase,
  completeWorkflowStep,
  reopenWorkflowStep,
  extendWorkflowStepDeadline,
  toggleWorkflowStepAction,
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

export default function CaseWorkflowTab({ caseId, canCompleteSteps, canUpload, onWorkflowChanged }: Props) {
  void canUpload;
  const [wf, setWf] = useState<WorkflowInstance | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [busyKey, setBusyKey] = useState<string>('');
  const [template, setTemplate] = useState<WorkflowTemplate | null>(null);

  const canExtendDeadlines = canCompleteSteps;
  const [extendOpenFor, setExtendOpenFor] = useState<string>('');
  const [extendDays, setExtendDays] = useState<string>('1');
  const [extendReason, setExtendReason] = useState<string>('');

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

  const onExtendDeadline = async (stepKey: string) => {
    if (!canExtendDeadlines) return;
    const days = Number(extendDays);
    if (!Number.isFinite(days) || days <= 0) {
      setErr('Provide a valid number of days to extend.');
      return;
    }
    try {
      setBusyKey(`extend:${stepKey}`);
      setErr('');
      const updated = await extendWorkflowStepDeadline(caseId, stepKey, days, extendReason);
      setWf(updated);
      await onWorkflowChanged?.();
      setExtendOpenFor('');
      setExtendDays('1');
      setExtendReason('');
    } catch (e: any) {
      setErr(e.message || 'Failed to extend deadline');
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
                {typeof s.feeAmount === 'number' ? (
                  <span className="text-xs text-gray-700 dark:text-gray-300 font-medium">Fee: {`${s.feeCurrency || 'RWF'} ${Math.round(s.feeAmount).toLocaleString()}`}</span>
                ) : s.feeText ? (
                  <span className="text-xs text-gray-700 dark:text-gray-300 font-medium">Fee: {s.feeText}</span>
                ) : null}
                {s.slaMinutes ? (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Duration: {Math.round(s.slaMinutes / 60)}h</span>
                ) : s.slaText ? (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Duration: {s.slaText}</span>
                ) : null}
              </div>

              {canExtendDeadlines && s.status !== 'Completed' && (
                <button
                  type="button"
                  onClick={() => setExtendOpenFor((k) => (k === s.stepKey ? '' : s.stepKey))}
                  className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                  title="Extend deadline"
                >
                  <CalendarPlus className="w-4 h-4" />
                  Extend
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
          {keyActions.length > 0 && (
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">Key Actions</div>
              <ul className="space-y-2">
                {keyActions.map((action: any, idx: number) => {
                  const isBusy = busyKey === `action:${s.stepKey}:${idx}`;
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
                      <div className={`text-sm ${isDone ? 'text-gray-500 line-through' : 'text-gray-700 dark:text-gray-200'}`}>
                        {label}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {extendOpenFor === s.stepKey && canExtendDeadlines ? (
            <div className="px-5 py-4 border-b border-gray-200 bg-gray-50">
              <div className="text-sm font-semibold text-gray-900">Extend deadline</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Add days</label>
                  <input
                    value={extendDays}
                    onChange={(e) => setExtendDays(e.target.value)}
                    type="number"
                    min={1}
                    max={365}
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Reason (optional)</label>
                  <input
                    value={extendReason}
                    onChange={(e) => setExtendReason(e.target.value)}
                    placeholder="e.g., Awaiting client documents"
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setExtendOpenFor('');
                    setExtendDays('1');
                    setExtendReason('');
                  }}
                  className="px-3 py-2 border border-gray-300 rounded text-gray-700 hover:bg-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => onExtendDeadline(s.stepKey)}
                  disabled={busyKey === `extend:${s.stepKey}`}
                  className="px-3 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-60"
                >
                  {busyKey === `extend:${s.stepKey}` ? 'Extending…' : 'Extend deadline'}
                </button>
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
    </div>
  );
}
