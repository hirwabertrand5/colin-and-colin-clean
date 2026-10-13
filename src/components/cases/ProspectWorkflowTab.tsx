import { useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  Circle,
  ListChecks,
  Loader2,
  Send,
  User as UserIcon,
  History,
  Scale,
} from 'lucide-react';
import {
  Prospect,
  recordProspectFollowUp,
  toggleProspectChecklistItem,
  updateProspect,
} from '../../services/prospectService';
import { formatDueCountdown, getUrgencyClass, formatDeadlineDateTime } from '../../utils/workflowDeadline';
import {
  computeProspectWorkflow,
  resolveStageChecklist,
  getStageConfig,
  isTerminalStage,
  type ProspectWaitingOn,
  type ProspectWorkflowSummary,
} from '../../utils/prospectStageConfig';

interface Props {
  prospect: Prospect;
  currentUser: { id?: string; _id?: string; name?: string; email?: string; role?: string };
  onChanged?: () => void | Promise<void>;
}

const STAGE_STATUS_BADGE: Record<string, string> = {
  'Not Started': 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  'In Progress': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  Completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  Blocked: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const STAGE_GATE_BADGE: Record<string, string> = {
  Complete: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  'In Progress': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Blocked: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const WAITING_ON_OPTIONS: ProspectWaitingOn[] = ['Firm', 'Client', 'Third Party', 'None'];

const formatDate = (value?: string | Date | null) => {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const STAGE_GLYPH: Record<string, string> = {
  Complete: '✓',
  'In Progress': '→',
  Blocked: '⛔',
};

export default function ProspectWorkflowTab({ prospect, currentUser, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpOutcome, setFollowUpOutcome] = useState('');
  const [savingField, setSavingField] = useState<string>('');
  // Local drafts so typing never fights the server round-trip / cursor position.
  const [outstandingDraft, setOutstandingDraft] = useState(prospect.outstandingRequirement || '');
  const [delayDraft, setDelayDraft] = useState(prospect.delayReason || '');

  const wf: ProspectWorkflowSummary = useMemo(() => computeProspectWorkflow(prospect), [prospect]);
  const checklist = useMemo(() => resolveStageChecklist(prospect), [prospect]);
  const config = getStageConfig(prospect.stage);
  const terminal = isTerminalStage(prospect.stage);
  const stageHistory = Array.isArray(prospect.stageHistory) ? prospect.stageHistory : [];

  // Follow-ups are only meaningful while the next action depends on a client or
  // third party — keep the control visible in those stages.
  const showFollowUp = !terminal;

  const patchProspect = async (payload: Record<string, unknown>, field: string) => {
    setBusy(true);
    setSavingField(field);
    try {
      await updateProspect(prospect._id, payload as any);
      await onChanged?.();
    } catch (err) {
      console.error('Failed to update prospect workflow control', err);
    } finally {
      setBusy(false);
      setSavingField('');
    }
  };

  const handleToggleChecklist = async (key: string, label: string, done: boolean) => {
    setBusy(true);
    setSavingField(key);
    try {
      await toggleProspectChecklistItem(prospect._id, {
        key,
        label,
        done,
        doneBy: currentUser?.name || currentUser?.email,
      });
      await onChanged?.();
    } catch (err) {
      console.error('Failed to toggle key action', err);
    } finally {
      setBusy(false);
      setSavingField('');
    }
  };

  const handleWaitingOnChange = async (waitingOn: ProspectWaitingOn) => {
    await patchProspect({ waitingOn }, `waitingOn-${waitingOn}`);
  };

  const handleStageStatusChange = async (stageStatus: 'Not Started' | 'In Progress' | 'Completed' | 'Blocked') => {
    await patchProspect({ stageStatus }, `stageStatus-${stageStatus}`);
  };

  const handleRecordFollowUp = async () => {
    setBusy(true);
    try {
      await recordProspectFollowUp(prospect._id, {
        nextFollowUpDate: followUpDate ? new Date(followUpDate).toISOString() : undefined,
        outcome: followUpOutcome || undefined,
        waitingOn: (wf.waitingOn as ProspectWaitingOn) || 'Client',
        clientResponseReceived: false,
      });
      setFollowUpDate('');
      setFollowUpOutcome('');
      await onChanged?.();
    } catch (err) {
      console.error('Failed to record follow-up', err);
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="space-y-6">
      {/* Workflow-control summary (mirrors the Case Workspace overview header) */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-gray-700 dark:text-gray-300" />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Workflow Checklist</h2>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Key Actions are listed for the current stage, each with its own SLA, due date and completion record. The stage-gate only clears once every mandatory action is done.
            </p>
          </div>
          <div className="min-w-52 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
              <span>Stage-gate</span>
              <span>{wf.checklistTotal > 0 ? `${wf.checklistDone}/${wf.checklistTotal}` : '—'}</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-2 rounded-full bg-gray-900 dark:bg-gray-100"
                style={{ width: `${wf.checklistTotal > 0 ? Math.min(100, (wf.checklistDone / wf.checklistTotal) * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ControlTile label="Current Stage" value={wf.currentStage} hint={wf.docStage} />
          <ControlTile
            label="Stage Status"
            value={
              <select
                value={wf.stageStatus}
                disabled={busy}
                onChange={(e) => handleStageStatusChange(e.target.value as any)}
                className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm font-semibold text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                {['Not Started', 'In Progress', 'Completed', 'Blocked'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            }
          />
          <ControlTile label="Responsible Person" value={wf.responsiblePerson || '—'} icon={<UserIcon className="h-3.5 w-3.5" />} />
          <ControlTile label="Start Date" value={formatDate(wf.startAt)} />
          <ControlTile label="Turnaround Time" value={wf.slaLabel || '—'} />
          <ControlTile
            label="Due Date"
            value={
              wf.dueAt && !terminal ? (
                <div>
                  <div className="text-sm text-gray-700 dark:text-gray-300">{formatDeadlineDateTime(wf.dueAt)}</div>
                  <div className={`mt-1 inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${getUrgencyClass(wf.urgencyColor)}`}>
                    {formatDueCountdown(wf.dueAt)}
                  </div>
                </div>
              ) : (
                <span className="text-gray-400">—</span>
              )
            }
          />
          <ControlTile
            label="Waiting On"
            value={
              <select
                value={wf.waitingOn}
                disabled={busy}
                onChange={(e) => handleWaitingOnChange(e.target.value as ProspectWaitingOn)}
                className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm font-semibold text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                {WAITING_ON_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            }
          />
          <ControlTile label="Next Stage" value={wf.nextStage || (terminal ? 'Closed' : '—')} />
          <ControlTile
            label="Stage-Gate Status"
            value={
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STAGE_GATE_BADGE[wf.stageGate]}`}>
                {STAGE_GLYPH[wf.stageGate] || '→'} {wf.stageGate}
              </span>
            }
          />
          <ControlTile label="Completed By" value={prospect.stageCompletedBy || '—'} />
          <ControlTile label="Completed Date/Time" value={formatDate(prospect.stageCompletedAt)} />
        </div>

        {/* Outstanding requirement + delay reason */}
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Outstanding Requirement</label>
            <div className="flex gap-2">
              <input
                value={outstandingDraft}
                onChange={(e) => setOutstandingDraft(e.target.value)}
                onBlur={() => patchProspect({ outstandingRequirement: outstandingDraft }, 'outstanding')}
                placeholder="e.g. Signed acceptance of quotation"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
              {savingField === 'outstanding' && <Loader2 className="mt-2 h-4 w-4 animate-spin text-gray-400" />}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Delay Reason {wf.stageStatus === 'Blocked' ? '(required)' : '(if SLA missed)'}</label>
            <input
              value={delayDraft}
              onChange={(e) => setDelayDraft(e.target.value)}
              onBlur={() => patchProspect({ delayReason: delayDraft }, 'delay')}
              placeholder="Reason the SLA was missed"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
        </div>
      </div>

      {/* Mandatory Key Actions checklist for the current stage */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              Mandatory Key Actions — {config?.docStage || wf.currentStage}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {config?.slaLabel ? `Indicative TAT: ${config.slaLabel}` : 'No fixed SLA for this stage.'}
            </p>
          </div>
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STAGE_STATUS_BADGE[wf.stageStatus]}`}>
            {wf.stageStatus}
          </span>
        </div>
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {checklist.length === 0 && (
            <li className="px-5 py-6 text-sm text-gray-500 dark:text-gray-400">No mandatory actions configured for this stage.</li>
          )}
          {checklist.map((item) => {
            const isBusy = savingField === item.key;
            return (
              <li key={item.key} className="flex items-start gap-3 px-5 py-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleToggleChecklist(item.key, item.label, !item.done)}
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-gray-300 transition hover:border-gray-900 disabled:opacity-50 dark:border-gray-600"
                  title={item.done ? 'Mark as not done' : 'Mark as done'}
                >
                  {item.done ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  ) : (
                    <Circle className="h-4 w-4 text-gray-300" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium ${item.done ? 'text-gray-400 line-through dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}`}>
                    {item.label}
                  </div>
                  {item.done && (item.doneBy || item.doneAt) && (
                    <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {item.doneBy ? `By ${item.doneBy}` : ''}{item.doneBy && item.doneAt ? ' · ' : ''}{item.doneAt ? formatDate(item.doneAt) : ''}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>


      {/* Follow-up control (client / third-party dependent next action) */}
      {showFollowUp && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-gray-700 dark:text-gray-300" />
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Follow-Up Control</h3>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Track the next action while you wait on a client or third party. A follow-up is recorded to the audit trail and advances the follow-up clock.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FollowUpStat label="Last Contact" value={formatDate(prospect.lastContactDate)} />
            <FollowUpStat label="Last Follow-Up" value={formatDate(prospect.lastFollowUpDate)} />
            <FollowUpStat label="Next Follow-Up" value={formatDate(prospect.nextFollowUpDate)} />
            <FollowUpStat label="Follow-Ups Sent" value={String(prospect.followUpCount || 0)} />
            <FollowUpStat
              label="Client Response"
              value={prospect.clientResponseReceived ? 'Received' : 'Awaiting'}
              tone={prospect.clientResponseReceived ? 'text-green-600' : 'text-orange-600'}
            />
            <FollowUpStat label="Days Awaiting Response" value={daysAwaiting(prospect.lastFollowUpDate)} />
            <FollowUpStat label="Escalation Due" value={formatDate(prospect.escalationRequiredAt)} />
            <FollowUpStat label="Follow-Up Outcome" value={prospect.followUpOutcome || '—'} />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Next follow-up date</label>
              <input
                type="datetime-local"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Outcome / note</label>
              <input
                value={followUpOutcome}
                onChange={(e) => setFollowUpOutcome(e.target.value)}
                placeholder="e.g. Emailed client, awaiting signed quote"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <button
              type="button"
              onClick={handleRecordFollowUp}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-700 disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Record follow-up
            </button>
          </div>
        </div>
      )}


      {/* Legal Opinion / Diagnostic mini-matter (optional sub-service) */}
      {prospect.legalOpinion && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-gray-700 dark:text-gray-300" />
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Legal Opinion / Diagnostic (mini-matter)</h3>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            A billable sub-service inside the same prospect record — never a duplicate client or matter.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FollowUpStat label="Reference No" value={prospect.legalOpinion.referenceNo || '—'} />
            <FollowUpStat label="Fee" value={typeof prospect.legalOpinion.fee === 'number' ? `RWF ${prospect.legalOpinion.fee.toLocaleString()}` : '—'} />
            <FollowUpStat label="Payment" value={prospect.legalOpinion.paymentStatus || '—'} />
            <FollowUpStat label="Outcome" value={prospect.legalOpinion.outcome || '—'} />
            <FollowUpStat label="Scope" value={prospect.legalOpinion.scope || '—'} />
            <FollowUpStat label="Opened" value={formatDate(prospect.legalOpinion.openedAt)} />
            <FollowUpStat label="Completed" value={formatDate(prospect.legalOpinion.completedAt)} />
            <FollowUpStat label="Closed" value={formatDate(prospect.legalOpinion.closedAt)} />
          </div>
        </div>
      )}

      {/* Audit trail of stage transitions + follow-ups */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <History className="h-5 w-5 text-gray-700 dark:text-gray-300" />
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Audit Trail</h3>
        </div>
        {stageHistory.length === 0 ? (
          <div className="px-5 py-6 text-sm text-gray-500 dark:text-gray-400">No stage history recorded yet.</div>
        ) : (
          <ol className="divide-y divide-gray-100 dark:divide-gray-700">
            {stageHistory
              .slice()
              .reverse()
              .map((entry, idx) => (
                <li key={`${entry.stage}-${idx}-${entry.recordedAt}`} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                      {entry.stage}
                    </span>
                    {entry.status && <span className="text-xs text-gray-500 dark:text-gray-400">{entry.status}</span>}
                    {entry.waitingOn && <span className="text-xs text-gray-500 dark:text-gray-400">· Waiting on {entry.waitingOn}</span>}
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Recorded {formatDate(entry.recordedAt)}
                    {entry.dueAt ? ` · due ${formatDate(entry.dueAt)}` : ''}
                    {entry.completedBy ? ` · completed by ${entry.completedBy}` : ''}
                    {entry.delayReason ? ` · delay: ${entry.delayReason}` : ''}
                  </div>
                  {entry.outstandingRequirement && (
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">Outstanding: {entry.outstandingRequirement}</div>
                  )}
                </li>
              ))}
          </ol>
        )}
      </div>
    </div>
  );
}


/** Whole days between the last follow-up and now (for "Days Awaiting Response"). */
const daysAwaiting = (value?: string | Date | null): string => {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const ms = Date.now() - d.getTime();
  if (ms < 0) return '0';
  return String(Math.floor(ms / (1000 * 60 * 60 * 24)));
};

function ControlTile({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</div>}
    </div>
  );
}

function FollowUpStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone || 'text-gray-900 dark:text-gray-100'}`}>{value}</div>
    </div>
  );
}

