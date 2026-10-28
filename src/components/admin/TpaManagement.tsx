import { useCallback, useEffect, useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, CalendarClock, CheckCircle2, History, Loader2, Percent, X } from 'lucide-react';
import { StructuredFormChoice, StructuredFormField as Field } from '../ui/StructuredForm';
import './tpa-management.css';

type Kind = 'normal' | 'special' | 'stop';
type Rate = { _id: string; kind: 'normal' | 'special'; rate: number; from: string; until: string | null; reason?: string };
type Configuration = { history: Rate[]; revision: number; currentRate: number; defaultRate: number; timeZone: string; serverNow: string };
type Change = { kind: Kind; rate: number; from: string; until: string | null; reason: string; specialId: string; revision: number; confirmBackdated: boolean };
type Impact = { affectedActivities: number; preservedSnapshots: number; savedEarningsAffected: number; unpricedActivities: number;
  financialImpact: Record<string, { proposedDelta: number; appliedDelta: number }>; message: string };
const actions: { kind: Kind; title: string; description: string }[] = [
  { kind: 'normal', title: 'Normal TPA', description: 'Set the ongoing allocation from a date you choose.' },
  { kind: 'special', title: 'Special TPA', description: 'Apply a temporary override, now or in the future.' },
  { kind: 'stop', title: 'Stop special TPA', description: 'End an existing override and restore the normal rate.' },
];
const wallTime = (date: Date, zone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
};
/** Interpret the selected wall-clock time in the firm timezone. */
const toInstant = (value: string, zone: string) => {
  const desired = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(desired)) throw new Error('Choose a valid start date and time.');
  let instant = desired;
  for (let attempt = 0; attempt < 3; attempt++) instant += desired - Date.parse(`${wallTime(new Date(instant), zone)}:00Z`);
  if (wallTime(new Date(instant), zone) !== value) throw new Error('That local time does not exist in the configured timezone.');
  return new Date(instant).toISOString();
};

export function TpaManagementDialog({ user, onClose }: { user: { _id: string; name: string; email?: string }; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="retainer-modal-backdrop">
      <Dialog.Content className="retainer-modal-card retainer-form tpa-management-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
        <header className="retainer-form-header">
          <div><span className="retainer-form-eyebrow">Staff earnings</span><Dialog.Title asChild><h2>TPA Management</h2></Dialog.Title>
            <Dialog.Description asChild><p>Manage {user.name}&apos;s rates, effective dates and allocation history.</p></Dialog.Description>
            {user.email && <span className="tpa-staff-email">{user.email}</span>}
          </div>
          <Dialog.Close asChild><button type="button" disabled={busy} className="retainer-icon-close" aria-label="Close TPA management"><X size={18} /></button></Dialog.Close>
        </header>
        <TpaManagement userId={user._id} onClose={onClose} onBusyChange={setBusy} />
      </Dialog.Content>
    </Dialog.Overlay></Dialog.Portal>
  </Dialog.Root>;
}

export default function TpaManagement({ userId, onClose, onBusyChange }: { userId: string; onClose?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const [data, setData] = useState<Configuration | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<Kind>('normal');
  const [rate, setRate] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [fixedEnd, setFixedEnd] = useState(false);
  const [reason, setReason] = useState('');
  const [specialId, setSpecialId] = useState('');
  const [confirmation, setConfirmation] = useState<{ body: Change; preview: Impact } | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [historyKind, setHistoryKind] = useState('all');
  const [historyStatus, setHistoryStatus] = useState('all');
  const editorRef = useRef<HTMLElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const serverOffset = useRef(0);
  const generation = useRef(0);
  const titleId = useId();
  const call = useCallback(async (body?: unknown) => {
    const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/users/${userId}/tpa`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await res.json();
    if (!res.ok) throw new Error(value.message || 'TPA request failed');
    return value;
  }, [userId]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    const current = ++generation.current;
    setBusy(false); setData(null); setConfirmation(null); setError(''); setSuccess(''); setReason(''); setUntil(''); setRate(''); setSpecialId(''); setKind('normal'); setFixedEnd(false); setHistoryKind('all'); setHistoryStatus('all');
    const load = async (initial = false) => {
      try {
        const value: Configuration = await call();
        if (generation.current !== current) return;
        serverOffset.current = Date.parse(value.serverNow) - Date.now();
        setData(value); setClock(Date.parse(value.serverNow));
        if (initial) {
          setFrom(wallTime(new Date(Date.parse(value.serverNow) + 60000), value.timeZone));
          const active = value.history.find(r => r.kind === 'normal' && Date.parse(r.from) <= Date.parse(value.serverNow) && (!r.until || Date.parse(r.until) > Date.parse(value.serverNow)));
          setRate(String(active?.rate ?? value.defaultRate));
        }
      } catch (e: any) { if (generation.current === current) setError(e.message); }
    };
    void load(true);
    const refresh = window.setInterval(() => { void load(); }, 30000);
    const tick = window.setInterval(() => setClock(Date.now() + serverOffset.current), 1000);
    return () => { generation.current++; window.clearInterval(refresh); window.clearInterval(tick); };
  }, [call]);
  useEffect(() => {
    if (confirmation) { reviewRef.current?.focus(); reviewRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }, [confirmation]);
  useEffect(() => {
    if (error || success) { feedbackRef.current?.focus(); feedbackRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }, [error, success]);

  const format = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: data?.timeZone || 'Africa/Kigali', dateStyle: 'medium', timeStyle: 'short' });
  const status = (r: Rate) => Date.parse(r.from) > clock ? 'Scheduled' : r.until && Date.parse(r.until) <= clock ? 'Inactive' : 'Active';
  const normal = data?.history.find(r => r.kind === 'normal' && status(r) === 'Active');
  const special = data?.history.find(r => r.kind === 'special' && status(r) === 'Active');
  const scheduled = data?.history.filter(r => r.kind === 'special' && status(r) === 'Scheduled').sort((a,b) => Date.parse(a.from) - Date.parse(b.from))[0];
  const availableSpecials = data?.history.filter(r => r.kind === 'special' && status(r) !== 'Inactive') || [];
  const displayedSpecial = special || scheduled;
  const since = (r?: Rate) => r && Date.parse(r.from) > 0 ? format(r.from) : 'Legacy allocation — start not recorded';
  const chooseAction = (next: Kind, scroll = false) => {
    if (busy || confirmation) return;
    setKind(next); setError(''); setSuccess('');
    if (next === 'normal') setRate(String(normal?.rate ?? data?.defaultRate ?? ''));
    if (next === 'special') setRate('');
    if (next === 'stop') setSpecialId(availableSpecials[0]?._id || '');
    if (scroll) editorRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const reset = () => {
    setKind('normal'); setRate(String(normal?.rate ?? data?.defaultRate ?? '')); setUntil(''); setFixedEnd(false); setReason(''); setSpecialId(''); setConfirmation(null); setError(''); setSuccess('');
    if (data) setFrom(wallTime(new Date(Date.now() + serverOffset.current + 60000), data.timeZone));
  };
  const prepare = async () => {
    if (!data || busy) return;
    const current = generation.current;
    setError(''); setSuccess(''); setBusy(true);
    try {
      if (!reason.trim()) throw new Error('Add a reason for this rate change.');
      if (kind !== 'stop' && (rate === '' || !Number.isFinite(Number(rate)) || Number(rate) < 0 || Number(rate) > 100)) throw new Error('Enter a rate between 0 and 100%.');
      if (kind === 'stop' && !specialId) throw new Error('Choose the special rate to stop.');
      if (kind === 'special' && fixedEnd && !until) throw new Error('Choose an end date or select Until stopped.');
      const body: Change = { kind, rate: Number(rate), from: toInstant(from, data.timeZone), until: kind === 'special' && fixedEnd ? toInstant(until, data.timeZone) : null, reason: reason.trim(), specialId, revision: data.revision, confirmBackdated: true };
      if (body.until && body.until <= body.from) throw new Error('The end date must be after the start date.');
      const preview: Impact = await call({ ...body, preview: true });
      if (generation.current === current) setConfirmation({ body, preview });
    } catch (e: any) { if (generation.current === current) setError(e.message); } finally { if (generation.current === current) setBusy(false); }
  };
  const save = async () => {
    if (!confirmation || busy || confirmation.preview.savedEarningsAffected) return;
    const current = generation.current;
    setBusy(true); setError('');
    try {
      await call(confirmation.body);
      if (generation.current !== current) return;
      setConfirmation(null); setSuccess('TPA updated. Your effective dates and rate history have been saved.'); setReason('');
      const fresh = await call();
      if (generation.current === current) setData(fresh);
    } catch (e: any) { if (generation.current === current) { setError(e.message); setConfirmation(null); } } finally { if (generation.current === current) setBusy(false); }
  };
  const canReview = !!data && !!from && !!reason.trim() && (kind === 'stop' ? !!specialId : rate !== '') && (kind !== 'special' || !fixedEnd || !!until);
  const history = [...(data?.history || [])].filter(r => (historyKind === 'all' || r.kind === historyKind) && (historyStatus === 'all' || status(r) === historyStatus)).sort((a,b) => Date.parse(b.from) - Date.parse(a.from));

  return <section className={`tpa-management ${onClose ? '' : 'tpa-management--embedded'}`} aria-label="TPA and earnings configuration" aria-busy={busy}>
    {!onClose && <div className="retainer-section-heading tpa-embedded-heading"><span className="retainer-form-eyebrow">Staff earnings</span><h3>TPA &amp; Earnings Configuration</h3><p>Set allocations and their effective periods independently of account details.</p></div>}
    {(error || success) && <div ref={feedbackRef} tabIndex={-1} className={`tpa-feedback ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'}>{error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<span>{error || success}</span></div>}
    {!data ? <div className="retainer-form-section tpa-loading"><Loader2 className="animate-spin" size={20} /><span>{error ? 'Rate configuration could not be loaded.' : 'Loading rate configuration…'}</span></div> : <>
      <section className="retainer-form-section">
        <div className="retainer-section-heading"><h3>Current allocation</h3><p>View the normal rate and any special adjustment before making a change.</p></div>
        <div className="tpa-summary-grid">
          <article className="tpa-summary-card"><div className="tpa-summary-heading"><span>Normal TPA</span><Percent size={16} aria-hidden="true" /></div><strong className="tpa-rate-value">{normal?.rate ?? data.defaultRate}<small>%</small></strong><p>Effective since: {since(normal)}</p><button type="button" className="tpa-text-button" disabled={busy || !!confirmation} onClick={() => chooseAction('normal', true)}>Update normal rate</button></article>
          <article className="tpa-summary-card"><div className="tpa-summary-heading"><span>Special TPA</span><span className={`tpa-badge is-${special ? 'active' : scheduled ? 'scheduled' : 'inactive'}`}>{special ? 'Active' : scheduled ? 'Scheduled' : 'Inactive'}</span></div>{displayedSpecial ? <><strong className="tpa-rate-value">{displayedSpecial.rate}<small>%</small></strong><p>Starts from: {format(displayedSpecial.from)}<br />Until: {displayedSpecial.until ? format(displayedSpecial.until) : 'Until stopped'}</p></> : <><strong className="tpa-empty-rate">No special adjustment</strong><p>The normal rate applies until a special adjustment starts.</p></>}<button type="button" className="tpa-text-button" disabled={busy || !!confirmation} onClick={() => chooseAction(displayedSpecial ? 'stop' : 'special', true)}>{displayedSpecial ? 'Manage stop date' : 'Add special adjustment'}</button></article>
        </div>
        <div className="tpa-effective-note"><CheckCircle2 size={16} aria-hidden="true" /><span>Current effective rate: <strong>{special?.rate ?? normal?.rate ?? data.defaultRate}%</strong></span><span className="tpa-timezone"><CalendarClock size={14} aria-hidden="true" />{data.timeZone}</span></div>
      </section>

      <fieldset disabled={busy || !!confirmation} className="tpa-editor">
        <section className="retainer-form-section" ref={editorRef}>
          <div className="retainer-section-heading"><h3>Choose a change</h3><p>Select the type of allocation you want to manage.</p></div>
          <div className="retainer-model-grid" role="radiogroup" aria-label="TPA action">{actions.map(action => <StructuredFormChoice key={action.kind} title={action.title} description={action.description} selected={kind === action.kind} onSelect={() => chooseAction(action.kind)} />)}</div>
        </section>
        <section className="retainer-form-section retainer-financial-section">
          <div className="retainer-section-heading"><h3>{kind === 'stop' ? 'Stop date and rate' : 'Rate and effective period'}</h3><p>{kind === 'normal' ? 'This rate applies from your selected date. An active special rate takes precedence until it ends.' : kind === 'special' ? 'The special rate overrides the normal rate only during its effective period.' : 'The latest applicable normal rate resumes at the stop time. The special configuration remains in history.'}</p></div>
          <div className="retainer-form-grid">
            {kind !== 'stop' ? <Field label="Rate (%)" required hint="Enter the exact allocation, from 0 to 100%."><div className="retainer-money-input"><span aria-hidden="true">%</span><input aria-required="true" className="retainer-form-control" inputMode="decimal" type="number" min="0" max="100" step="0.01" value={rate} onChange={e => setRate(e.target.value)} placeholder="Enter a percentage" /></div></Field> : <Field label="Special rate" required hint="Select the adjustment whose effective period should end."><select aria-required="true" className="retainer-form-control" value={specialId} onChange={e => setSpecialId(e.target.value)}><option value="">Select a special rate</option>{availableSpecials.map(r => <option key={r._id} value={r._id}>{r.rate}% · from {format(r.from)}</option>)}</select></Field>}
            <Field label={kind === 'stop' ? 'Stop effective at' : 'Starts from — date and time'} required hint={`All selected dates use ${data.timeZone}.`}><input aria-required="true" className="retainer-form-control" type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} /></Field>
            {kind === 'special' && <><Field label="End condition" hint="Keep the override open or schedule when normal TPA resumes."><select className="retainer-form-control" value={fixedEnd ? 'fixed' : 'open'} onChange={e => setFixedEnd(e.target.value === 'fixed')}><option value="open">Until stopped</option><option value="fixed">On a selected date</option></select></Field>{fixedEnd && <Field label="Effective until" required hint="The normal rate resumes exactly at this time."><input aria-required="true" className="retainer-form-control" type="datetime-local" value={until} onChange={e => setUntil(e.target.value)} /></Field>}</>}
          </div>
          {kind === 'stop' && !availableSpecials.length && <div className="retainer-readonly-note tpa-inline-note"><strong>No active or scheduled special rates</strong><span>Choose Special TPA to create an adjustment first.</span></div>}
          <div className="tpa-date-shortcuts"><button type="button" className="tpa-text-button" onClick={() => setFrom(wallTime(new Date(Date.now() + serverOffset.current), data.timeZone))}>Use current date and time</button><span>Past dates require a backdated impact review.</span></div>
        </section>
        <section className="retainer-form-section"><div className="retainer-section-heading"><h3>Reason for change</h3><p>Give the team a clear explanation for this compensation adjustment.</p></div><Field label="Reason" required hint="Saved with the administrative audit record."><textarea aria-required="true" className="retainer-form-control retainer-form-textarea" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe the approved adjustment and why it is needed." /></Field></section>
      </fieldset>

      {confirmation && <div ref={reviewRef} tabIndex={-1} role="alertdialog" aria-labelledby={titleId} className="retainer-form-section tpa-review">
        <div className="retainer-section-heading"><span className="retainer-form-eyebrow">Review before saving</span><h3 id={titleId}>Confirm {confirmation.body.kind === 'stop' ? 'stopping special TPA' : `${confirmation.body.kind} TPA at ${confirmation.body.rate}%`}</h3><p>Starts from: {format(confirmation.body.from)}{confirmation.body.until ? ` · Until: ${format(confirmation.body.until)}` : ''}</p></div>
        {Date.parse(confirmation.body.from) < clock && <span className="tpa-badge is-scheduled">Backdated adjustment</span>}
        <p className="tpa-review-message">{confirmation.preview.savedEarningsAffected ? 'This adjustment would affect recorded earnings. An approved financial correction is required.' : 'Existing activities keep their recorded rates. Backdated changes apply only where an activity has no recorded rate.'}</p>
        <div className="tpa-impact-grid"><div><span>Potentially affected activities</span><strong>{confirmation.preview.affectedActivities}</strong></div><div><span>Activities keeping their original rate</span><strong>{confirmation.preview.preservedSnapshots}</strong></div><div><span>Saved earnings requiring correction</span><strong>{confirmation.preview.savedEarningsAffected}</strong></div></div>
        {Object.entries(confirmation.preview.financialImpact).map(([currency, amount]) => <div className="retainer-readonly-note tpa-inline-note" key={currency}><strong>{currency} · Financial impact</strong><span>Proposed difference: {amount.proposedDelta.toLocaleString()}. Change to earnings without a recorded rate: {amount.appliedDelta.toLocaleString()}.</span></div>)}
        {confirmation.preview.unpricedActivities > 0 && <p className="tpa-review-message">{confirmation.preview.unpricedActivities} activities cannot yet be priced reliably because collection or scoring inputs are incomplete.</p>}
        {!confirmation.preview.affectedActivities && <p className="tpa-review-message">No recorded activities are affected. Future activities will use the selected effective periods.</p>}
        {confirmation.preview.savedEarningsAffected > 0 && <div role="note" className="tpa-feedback is-error"><AlertCircle size={18} /><span>This change is blocked. An explicit financial correction is required before saved earnings can change.</span></div>}
      </div>}

      <section className="retainer-form-section tpa-history">
        <div className="retainer-section-heading"><h3><History size={16} aria-hidden="true" /> TPA History <span className="tpa-history-count">{data.history.length}</span></h3><p>Actual stored rates and effective periods. End times are exclusive.</p></div>
        {data.history.length > 0 && <div className="retainer-form-grid tpa-history-filters"><Field label="Rate type"><select className="retainer-form-control" value={historyKind} onChange={e => setHistoryKind(e.target.value)}><option value="all">All rates</option><option value="normal">Normal</option><option value="special">Special</option></select></Field><Field label="History status"><select className="retainer-form-control" value={historyStatus} onChange={e => setHistoryStatus(e.target.value)}><option value="all">All statuses</option>{['Active', 'Scheduled', 'Inactive'].map(value => <option key={value}>{value}</option>)}</select></Field></div>}
        {history.length ? <div className="tpa-history-table"><table><caption className="sr-only">TPA history in {data.timeZone}</caption><thead><tr><th>Type / rate</th><th>Effective from</th><th>Effective until</th><th>Status</th><th>Reason</th></tr></thead><tbody>{history.map(r => <tr key={r._id}><td><strong>{r.rate}%</strong><span className="tpa-history-type">{r.kind}</span></td><td>{since(r)}</td><td>{r.until ? format(r.until) : r.kind === 'special' ? 'Until stopped' : 'Open-ended'}</td><td><span className={`tpa-badge is-${status(r).toLowerCase()}`}>{status(r)}</span></td><td>{r.reason || 'Not recorded'}</td></tr>)}</tbody></table></div> : <div className="tpa-history-empty"><History size={24} /><strong>{data.history.length ? 'No matching rate records' : 'No individual adjustments yet'}</strong><p>{data.history.length ? 'Choose another type or status to see more history.' : 'The existing role allocation applies. Your first change will start the individual rate history.'}</p></div>}
      </section>
    </>}
    <footer className="retainer-form-footer tpa-form-footer"><span className="tpa-footer-note">{confirmation ? 'Review the impact before confirming.' : 'Changes are reviewed before they are saved.'}</span>
      {confirmation ? <><button type="button" disabled={busy} className="retainer-button retainer-button-secondary" onClick={() => setConfirmation(null)}>Back to editing</button><button type="button" disabled={busy || confirmation.preview.savedEarningsAffected > 0} className="retainer-button retainer-button-primary" onClick={save}>{busy ? <><Loader2 className="animate-spin" size={15} /> Saving…</> : 'Confirm Change'}</button></> : <><button type="button" disabled={busy} className="retainer-button retainer-button-secondary" onClick={onClose || reset}>{onClose ? 'Close' : 'Reset'}</button><button type="button" disabled={busy || !canReview} className="retainer-button retainer-button-primary" onClick={prepare}>{busy ? <><Loader2 className="animate-spin" size={15} /> Reviewing…</> : 'Review TPA Change'}</button></>}
    </footer>
  </section>;
}
