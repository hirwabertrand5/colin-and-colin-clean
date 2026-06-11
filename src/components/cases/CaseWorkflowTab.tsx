import { useEffect, useState } from 'react';
import { CalendarPlus, Plus } from 'lucide-react';
import {
  getWorkflowForCase,
  completeWorkflowStep,
  reopenWorkflowStep,
  extendWorkflowStepDeadline,
  toggleWorkflowStepAction,
  addWorkflowStep,
  addWorkflowStepAction,
  updateWorkflowStep,
  deleteWorkflowStep,
  updateWorkflowStepAction,
  deleteWorkflowStepAction,
  WorkflowInstance,
} from '../../services/workflowInstanceService';
import { getWorkflowTemplateById, WorkflowTemplate } from '../../services/workflowService';
import { formatDueCountdown, getDeadlinePillClass, getUrgencyColorForDueDate } from '../../utils/workflowDeadline';

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

export default function CaseWorkflowTab({ caseId, canCompleteSteps, canUpload, onWorkflowChanged }: Props) {
  void canUpload;
  const [wf, setWf] = useState<WorkflowInstance | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [busyKey, setBusyKey] = useState<string>('');
  const [showAddStep, setShowAddStep] = useState(false);
  const [newStepTitle, setNewStepTitle] = useState('');
  const [newStepActions, setNewStepActions] = useState('');
  const [addActionFor, setAddActionFor] = useState<string | null>(null);
  const [newActionText, setNewActionText] = useState('');
  const [editingStepKey, setEditingStepKey] = useState<string | null>(null);
  const [editingStepTitle, setEditingStepTitle] = useState('');
  const [editingActionFor, setEditingActionFor] = useState<{ stepKey: string; index: number } | null>(null);
  const [editingActionText, setEditingActionText] = useState('');
  const [template, setTemplate] = useState<WorkflowTemplate | null>(null);

  const canExtendDeadlines = canCompleteSteps;
  const [extendOpenFor, setExtendOpenFor] = useState<string>('');
  const [extendDate, setExtendDate] = useState<string>('');
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
    const step = wf?.steps?.find((x) => x.stepKey === stepKey);
    if (!step) {
      setErr('Step not found');
      return;
    }
    if (!step.dueAt) {
      setErr('Step has no current due date to extend.');
      return;
    }
    if (!extendDate) {
      setErr('Please choose a new due date.');
      return;
    }
    try {
      const currentDue = new Date(step.dueAt);
      const selected = new Date(`${extendDate}T00:00:00`);
      const diffMs = selected.getTime() - currentDue.getTime();
      const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (!Number.isFinite(days) || days <= 0) {
        setErr('Please choose a later date than the current due date.');
        return;
      }
      if (days > 365) {
        setErr('Extension must be 365 days or fewer.');
        return;
      }

      setBusyKey(`extend:${stepKey}`);
      setErr('');
      const updated = await extendWorkflowStepDeadline(caseId, stepKey, days, extendReason);
      setWf(updated);
      await onWorkflowChanged?.();
      setExtendOpenFor('');
      setExtendDate('');
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

  const onAddStep = async () => {
    if (!newStepTitle.trim()) return setErr('Please enter a step title');
    try {
      setBusyKey('add-step');
      setErr('');
      const actions = String(newStepActions || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const payload = { title: newStepTitle.trim(), actions };
      const updated = await addWorkflowStep(caseId, payload);
      setWf(updated);
      setShowAddStep(false);
      setNewStepTitle('');
      setNewStepActions('');
      await onWorkflowChanged?.();
    } catch (e: any) {
      setErr(e?.message || 'Failed to add step');
    } finally {
      setBusyKey('');
    }
  };

  const onAddKeyAction = async (stepKey: string) => {
    if (!newActionText.trim()) return setErr('Please enter action text');
    try {
      setBusyKey(`addaction:${stepKey}`);
      setErr('');
      const updated = await addWorkflowStepAction(caseId, stepKey, newActionText.trim());
      setWf(updated);
      setAddActionFor(null);
      setNewActionText('');
      await onWorkflowChanged?.();
    } catch (e: any) {
      setErr(e?.message || 'Failed to add key action');
    } finally {
      setBusyKey('');
    }
  };

  const onStartEditStep = (stepKey: string) => {
    const s = wf?.steps?.find((x) => x.stepKey === stepKey);
    if (!s) return;
    setEditingStepKey(stepKey);
    setEditingStepTitle(s.title || '');
  };

  const onSaveEditStep = async (stepKey: string) => {
    try {
      setBusyKey(`edit-step:${stepKey}`);
      setErr('');
      const updated = await updateWorkflowStep(caseId, stepKey, { title: editingStepTitle });
      setWf(updated);
      setEditingStepKey(null);
      setEditingStepTitle('');
      await onWorkflowChanged?.();
    } catch (e: any) {
      setErr(e?.message || 'Failed to update step');
    } finally {
      setBusyKey('');
    }
  };

  const onDeleteStepClicked = async (stepKey: string) => {
    if (!window.confirm('Delete this step? This cannot be undone.')) return;
    try {
      setBusyKey(`delete-step:${stepKey}`);
      setErr('');
      const updated = await deleteWorkflowStep(caseId, stepKey);
      setWf(updated);
      await onWorkflowChanged?.();
    } catch (e: any) {
      setErr(e?.message || 'Failed to delete step');
    } finally {
      setBusyKey('');
    }
  };

  const onStartEditAction = (stepKey: string, idx: number, currentText: string) => {
    setEditingActionFor({ stepKey, index: idx });
    setEditingActionText(currentText || '');
  };

  const onSaveEditAction = async () => {
    if (!editingActionFor) return;
    try {
      setBusyKey(`edit-action:${editingActionFor.stepKey}:${editingActionFor.index}`);
      setErr('');
      const updated = await updateWorkflowStepAction(caseId, editingActionFor.stepKey, editingActionFor.index, { text: editingActionText });
      setWf(updated);
      setEditingActionFor(null);
      setEditingActionText('');
      await onWorkflowChanged?.();
    } catch (e: any) {
      setErr(e?.message || 'Failed to update action');
    } finally {
      setBusyKey('');
    }
  };

  const onDeleteActionClicked = async (stepKey: string, idx: number) => {
    if (!window.confirm('Delete this key action?')) return;
    try {
      setBusyKey(`delete-action:${stepKey}:${idx}`);
      setErr('');
      const updated = await deleteWorkflowStepAction(caseId, stepKey, idx);
      setWf(updated);
      await onWorkflowChanged?.();
    } catch (e: any) {
      setErr(e?.message || 'Failed to delete action');
    } finally {
      setBusyKey('');
    }
  };

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
        {canCompleteSteps && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowAddStep((s) => !s)}
              className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
            >
              <Plus className="w-4 h-4" />
              Add Step
            </button>
            {showAddStep && (
              <div className="mt-3 border p-3 rounded bg-gray-50">
                <div className="grid grid-cols-1 gap-2">
                  <input value={newStepTitle} onChange={(e) => setNewStepTitle(e.target.value)} placeholder="Step title" className="px-3 py-2 border rounded" />
                  <textarea value={newStepActions} onChange={(e) => setNewStepActions(e.target.value)} placeholder="Key actions (one per line) - optional" rows={3} className="px-3 py-2 border rounded resize-y" />
                  <div className="flex items-center gap-2 justify-end">
                    <button type="button" onClick={() => { setShowAddStep(false); setNewStepTitle(''); setNewStepActions(''); }} className="px-3 py-2 border rounded text-gray-700">Cancel</button>
                    <button type="button" onClick={onAddStep} disabled={busyKey === 'add-step'} className="px-3 py-2 bg-gray-900 text-white rounded">{busyKey === 'add-step' ? 'Adding…' : 'Add Step'}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
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
                {(() => {
                  const stepCss = getDeadlinePillClass(s.dueAt, s.startAt);
                  const stepColor = getUrgencyColorForDueDate(s.dueAt, s.startAt);
                  return (
                    <span
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${stepCss}`}
                      data-urgency-color={stepColor}
                      title={s.dueAt ? `Due: ${new Date(s.dueAt).toLocaleString()}` : 'No due date'}
                    >
                      {formatDueCountdown(s.dueAt)}
                    </span>
                  );
                })()}
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
                <span className="text-xs text-gray-700 dark:text-gray-300 font-medium">
                  Fee / range: {formatWorkflowStepFee(s)}
                </span>
                {s.slaMinutes ? (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Duration: {Math.round(s.slaMinutes / 60)}h</span>
                ) : s.slaText ? (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Duration: {s.slaText}</span>
                ) : null}
              </div>

              {canExtendDeadlines && s.status !== 'Completed' && (
                <button
                  type="button"
                  onClick={() => {
                    if (extendOpenFor === s.stepKey) {
                      setExtendOpenFor('');
                      setExtendDate('');
                    } else {
                      setExtendOpenFor(s.stepKey);
                      setExtendDate(s.dueAt ? new Date(s.dueAt).toISOString().slice(0, 10) : '');
                    }
                  }}
                  className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                  title="Extend deadline"
                >
                  <CalendarPlus className="w-4 h-4" />
                  Extend
                </button>
              )}

              {/* Edit / Delete step controls */}
              {canCompleteSteps && (
                <div className="flex items-center gap-2">
                  {editingStepKey === s.stepKey ? (
                    <div className="flex items-center gap-2">
                      <input value={editingStepTitle} onChange={(e) => setEditingStepTitle(e.target.value)} className="px-2 py-1 border rounded" />
                      <button onClick={() => onSaveEditStep(s.stepKey)} className="px-2 py-1 bg-blue-600 text-white rounded">Save</button>
                      <button onClick={() => { setEditingStepKey(null); setEditingStepTitle(''); }} className="px-2 py-1 border rounded">Cancel</button>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => onStartEditStep(s.stepKey)} className="px-2 py-1 border rounded text-sm">Edit</button>
                      <button onClick={() => onDeleteStepClicked(s.stepKey)} className="px-2 py-1 border rounded text-sm text-red-600">Delete</button>
                    </>
                  )}
                </div>
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
                      <div className={`flex-1 flex items-center justify-between gap-3`}> 
                        {editingActionFor && editingActionFor.stepKey === s.stepKey && editingActionFor.index === idx ? (
                          <div className="flex-1 flex items-center gap-2">
                            <input value={editingActionText} onChange={(e) => setEditingActionText(e.target.value)} className="flex-1 px-2 py-1 border rounded" />
                            <button onClick={onSaveEditAction} className="px-2 py-1 bg-blue-600 text-white rounded">Save</button>
                            <button onClick={() => { setEditingActionFor(null); setEditingActionText(''); }} className="px-2 py-1 border rounded">Cancel</button>
                          </div>
                        ) : (
                          <>
                            <div className={`text-sm ${isDone ? 'text-gray-500 line-through' : 'text-gray-700 dark:text-gray-200'}`}>{label}</div>
                            {canCompleteSteps && (
                              <div className="flex items-center gap-2">
                                <button onClick={() => onStartEditAction(s.stepKey, idx, label)} className="px-2 py-1 border rounded text-xs">Edit</button>
                                <button onClick={() => onDeleteActionClicked(s.stepKey, idx)} className="px-2 py-1 border rounded text-xs text-red-600">Delete</button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {canCompleteSteps && (
            <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
              {addActionFor === s.stepKey ? (
                <div className="flex gap-2">
                  <input value={newActionText} onChange={(e) => setNewActionText(e.target.value)} placeholder="New key action" className="flex-1 px-3 py-2 border rounded" />
                  <button onClick={() => onAddKeyAction(s.stepKey)} disabled={busyKey === `addaction:${s.stepKey}`} className="px-3 py-2 bg-gray-900 text-white rounded">{busyKey === `addaction:${s.stepKey}` ? 'Adding…' : 'Add'}</button>
                  <button onClick={() => { setAddActionFor(null); setNewActionText(''); }} className="px-3 py-2 border rounded text-gray-700">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setAddActionFor(s.stepKey)} className="inline-flex items-center gap-2 px-3 py-2 border rounded text-sm text-gray-700 hover:bg-gray-50">
                  <Plus className="w-4 h-4" />
                  Add Key Action
                </button>
              )}
            </div>
          )}

          {extendOpenFor === s.stepKey && canExtendDeadlines ? (
            <div className="px-5 py-4 border-b border-gray-200 bg-gray-50">
              <div className="text-sm font-semibold text-gray-900">Extend deadline</div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">New due date</label>
                    <input
                      value={extendDate}
                      onChange={(e) => setExtendDate(e.target.value)}
                      type="date"
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
                    setExtendDate('');
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
