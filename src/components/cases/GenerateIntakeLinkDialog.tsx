import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Check, CheckCircle2, ChevronDown, Clock3, Copy, ExternalLink, FileText, Link2, Loader2, LockKeyhole, Mail, RefreshCw, ShieldCheck, UserRound, UsersRound, X } from 'lucide-react';
import type { User } from '../../services/userService';

export type IntakeInvitation = {
  clientName: string; clientEmail: string; serviceId: string; questionnaireId: string;
  assignedTo: string; responsiblePartner: string; responsibleAssociate: string;
  expiryDays: number | string; introduction: string;
};
export type IntakeLinkConfiguration = {
  settings: { noticeApproved: boolean; defaultExpiryDays?: number };
  services: Array<{ id: string; label: string; path: Array<{ id: string; label: string }> }>;
  canManage: boolean;
  delivery?: { email: { configured: boolean; message: string }; publicUrl: { configured: boolean; origin?: string; message: string } };
};
type Props = {
  configuration: IntakeLinkConfiguration | null;
  configurationLoading: boolean; configurationError: string;
  staff: User[]; staffLoading: boolean; staffError: string;
  invitation: IntakeInvitation; generated: any; busy: boolean; error: string;
  hidden?: boolean;
  onChange: (patch: Partial<IntakeInvitation>) => void;
  onGenerate: () => void; onClose: () => void; onCopy: () => Promise<boolean>;
  onSend: () => void; onCreateAnother: () => void;
  onReviewNotice: () => void; onReloadConfiguration: () => void; onReloadStaff: () => void;
};
const STAFF_FIELDS = [
  ['responsiblePartner', 'Responsible partner'],
  ['responsibleAssociate', 'Responsible associate'],
  ['assignedTo', 'Assigned staff member'],
] as const;
const validEmail = (value: string) => !value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export default function GenerateIntakeLinkDialog(props: Props) {
  const { configuration, configurationLoading, configurationError, staff, staffLoading, staffError, invitation, generated, busy, error } = props;
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [customExpiry, setCustomExpiry] = useState(![3, 7, 14, 30].includes(Number(invitation.expiryDays)));
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (![3, 7, 14, 30].includes(Number(invitation.expiryDays))) setCustomExpiry(true); }, [invitation.expiryDays]);
  useEffect(() => { setCopied(false); setFieldErrors({}); if (generated?.url) document.getElementById('generated-intake-url')?.focus(); else setCustomExpiry(![3, 7, 14, 30].includes(Number(invitation.expiryDays))); }, [generated?.url]);
  const service = configuration?.services.find(item => item.id === invitation.serviceId);
  const supportsArticles = service?.path.some(item => item.id === 'company_incorporation');
  const emailConfigured = configuration?.delivery?.email.configured !== false;
  const emailSent = generated?.link.emailStatus === 'Sent';
  const publicAddressError = configuration?.delivery?.publicUrl.configured === false ? configuration.delivery.publicUrl.message : '';
  const noticeReady = configuration?.settings.noticeApproved === true;
  const ready = !!configuration && noticeReady && !configurationLoading && !configurationError && !publicAddressError;
  const expiry = Number(invitation.expiryDays);
  const expiryValid = Number.isInteger(expiry) && expiry >= 1 && expiry <= 30;
  const expiresOn = expiryValid ? new Date(Date.now() + expiry * 86400000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Choose a valid duration';
  const update = (patch: Partial<IntakeInvitation>) => {
    props.onChange(patch);
    setFieldErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => !(key in patch))));
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !ready) return;
    const errors: Record<string, string> = {};
    if (!validEmail(invitation.clientEmail)) errors.clientEmail = 'Enter a valid email address, or leave this blank to share the link yourself.';
    if (!expiryValid) errors.expiryDays = 'Choose a whole number between 1 and 30 days.';
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      if (errors.expiryDays) setCustomExpiry(true);
      requestAnimationFrame(() => document.getElementById(errors.clientEmail ? 'invite-email' : 'invite-expiry')?.focus());
      return;
    }
    props.onGenerate();
  };
  const copyLink = async () => { if (await props.onCopy()) setCopied(true); };
  const groupedServices = new Map<string, NonNullable<Props['configuration']>['services']>();
  for (const item of configuration?.services || []) {
    const group = item.path[0]?.label || 'Legal services';
    groupedServices.set(group, [...(groupedServices.get(group) || []), item]);
  }

  return <div className="intake-modal-backdrop intake-invite-backdrop" style={props.hidden ? { display: 'none' } : undefined}>
    <section className={`intake-modal intake-invite-dialog${generated ? ' intake-invite-created' : ''}`} role="dialog" aria-modal="true" aria-labelledby="intake-generate-title" aria-describedby="intake-generate-description">
      <header className="intake-invite-heading">
        <div className="intake-invite-title"><span className={`intake-invite-heading-icon${generated ? ' is-success' : ''}`}>{generated ? <CheckCircle2 size={23} /> : <Link2 size={23} />}</span><div><p className="intake-eyebrow">Client intake</p><h2 id="intake-generate-title">{generated ? 'Your invitation is ready' : 'Generate intake link'}</h2><p id="intake-generate-description">{generated ? 'Copy the secure link or email it directly to your client.' : 'Create a private invitation for your client’s first enquiry.'}</p></div></div>
        <button type="button" className="intake-icon-button" aria-label="Close link dialog" onClick={props.onClose} disabled={busy}><X size={19} /></button>
      </header>

      {generated ? <>
        <div className="intake-invite-success-body">
          <div className="intake-invite-success-banner" role="status"><ShieldCheck size={22} /><div><strong>Secure link created successfully</strong><p>{generated.link.clientName || invitation.clientName || 'Your client'} can complete their enquiry using this invitation.</p></div></div>
          <label className="intake-invite-label" htmlFor="generated-intake-url">Client intake link</label>
          <div className="intake-invite-copy"><input className="intake-input" id="generated-intake-url" value={generated.url} readOnly onFocus={event => event.target.select()} /><button type="button" className="intake-button" onClick={() => void copyLink()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy link'}</button></div>
          <div className="intake-invite-success-meta"><span><Clock3 size={15} /> Expires {new Date(generated.link.expiresAt).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><span><LockKeyhole size={15} /> No client account required</span></div>
          <div className="intake-invite-email-card"><Mail size={21} /><div><strong>{generated.link.clientEmail ? 'Send the invitation by email' : 'Share the link directly'}</strong><p>{generated.link.clientEmail || 'Copy the link and share it through your preferred channel.'}</p></div>{generated.link.clientEmail && <button type="button" className="intake-button secondary" disabled={busy || !emailConfigured || emailSent} onClick={props.onSend}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}{busy ? 'Sending...' : emailSent ? 'Email sent' : emailConfigured ? 'Send via email' : 'Email unavailable'}</button>}</div>
          <a className="intake-text-button intake-invite-open-link" href={generated.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Open client form</a>
          {configuration?.delivery?.email.configured === false && <div className="intake-warning" role="status"><strong>Email setup required</strong><p>{configuration.delivery.email.message}</p><button type="button" className="intake-text-button" disabled={configurationLoading} onClick={props.onReloadConfiguration}><RefreshCw size={14} /> Recheck email setup</button></div>}
          <p className="intake-invite-security-note"><LockKeyhole size={15} /><span>Share only with the intended client. Copy it before leaving; you can regenerate a new link later if needed.</span></p>
          {error && <div ref={errorRef} tabIndex={-1} role="alert" className="intake-error"><AlertCircle size={17} />{error}</div>}
        </div>
        <footer className="intake-invite-footer"><button type="button" className="intake-text-button" disabled={busy} onClick={props.onCreateAnother}><Link2 size={15} /> Create another invitation</button><button type="button" className="intake-button" disabled={busy} onClick={props.onClose}>Done <Check size={16} /></button></footer>
      </> : <form className="intake-invite-form" noValidate onSubmit={submit}>
        <div className="intake-invite-body">
          <div className="intake-invite-main">
            {configurationLoading && <div className="intake-invite-status" role="status"><Loader2 size={18} className="animate-spin" /><span>Loading invitation settings. You can start filling in the client details.</span></div>}
            {publicAddressError && <div className="intake-error intake-invite-blocker" role="alert"><AlertCircle size={19} /><div><strong>The public intake address needs attention</strong><p>{publicAddressError}</p><button type="button" className="intake-text-button" onClick={props.onReloadConfiguration}><RefreshCw size={14} /> Recheck address</button></div></div>}
            {configurationError && <div className="intake-error intake-invite-blocker" role="alert"><AlertCircle size={19} /><div><strong>Invitation settings could not load</strong><p>{configurationError}</p><button type="button" className="intake-text-button" onClick={props.onReloadConfiguration}><RefreshCw size={14} /> Retry settings</button></div></div>}
            {configuration && !noticeReady && <div className="intake-warning intake-invite-blocker" role="status"><ShieldCheck size={21} /><div><strong>Privacy approval is needed before generating a link</strong><p>{configuration.canManage ? 'Review the firm’s privacy notice, contact and retention statement. Your invitation details will stay here while you complete setup.' : 'Ask a managing partner or authorized manager to approve the intake privacy notice. Your invitation details can stay here while setup is completed.'}</p><button type="button" className="intake-button secondary" onClick={configuration.canManage ? props.onReviewNotice : props.onReloadConfiguration}>{configuration.canManage ? <ShieldCheck size={15} /> : <RefreshCw size={15} />}{configuration.canManage ? 'Review privacy notice' : 'Check approval status'}</button></div></div>}

            <section className="intake-invite-section" aria-labelledby="invite-client-heading">
              <div className="intake-invite-section-heading"><span><UserRound size={18} /></span><div><h3 id="invite-client-heading">Client & enquiry</h3><p>Personalize the invitation, or let the client provide these details.</p></div><small>Optional</small></div>
              <div className="intake-grid">
                <div className="intake-field"><label htmlFor="invite-name">Client or organization name</label><input className="intake-input" id="invite-name" autoComplete="off" placeholder="e.g. Client or company name" value={invitation.clientName} maxLength={300} disabled={busy} onChange={event => update({ clientName: event.target.value })} /></div>
                <div className="intake-field"><label htmlFor="invite-email">Client email address</label><input className="intake-input" id="invite-email" type="email" autoComplete="off" placeholder="client@example.com" value={invitation.clientEmail} maxLength={254} disabled={busy} aria-invalid={!!fieldErrors.clientEmail} aria-describedby={fieldErrors.clientEmail ? 'invite-email-error' : 'invite-email-help'} onChange={event => update({ clientEmail: event.target.value })} />{fieldErrors.clientEmail ? <small className="intake-field-error" id="invite-email-error" role="alert">{fieldErrors.clientEmail}</small> : <small className="intake-field-help" id="invite-email-help">Add an email to send directly, or copy the link to share.</small>}</div>
                <div className="intake-field intake-field-wide"><label htmlFor="invite-service">Legal service</label><select className="intake-input" id="invite-service" value={invitation.serviceId} disabled={busy || !configuration} onChange={event => update({ serviceId: event.target.value, questionnaireId: '' })}><option value="">Let the client choose a legal service</option>{Array.from(groupedServices, ([group, services]) => <optgroup key={group} label={group}>{services.map(item => <option key={item.id} value={item.id}>{item.path.length > 1 ? item.path.slice(1).map(part => part.label).join(' / ') : item.label}</option>)}</optgroup>)}</select><small className="intake-field-help">Select a service to tailor the client’s form.</small></div>
              </div>
              {supportsArticles && <label className="intake-invite-questionnaire"><input type="checkbox" checked={!!invitation.questionnaireId} disabled={busy} onChange={event => update({ questionnaireId: event.target.checked ? 'articles-of-association-v1' : '' })} /><span><strong>Include Articles of Association</strong><small>Add questions about share capital, shareholders and corporate governance.</small></span><FileText size={19} /></label>}
            </section>

            <section className="intake-invite-section" aria-labelledby="invite-ownership-heading">
              <div className="intake-invite-section-heading"><span><UsersRound size={18} /></span><div><h3 id="invite-ownership-heading">Internal ownership</h3><p>Visible to your team. Assignments can also be confirmed during review.</p></div><small>Optional</small></div>
              {staffError && <div className="intake-invite-staff-warning" role="status"><AlertCircle size={16} /><div><p>Staff members could not load. You can still generate a link and assign the team during review.</p><button type="button" className="intake-text-button" onClick={props.onReloadStaff}><RefreshCw size={13} /> Reload staff</button></div></div>}
              <div className="intake-grid intake-invite-staff-grid">{STAFF_FIELDS.map(([key, label]) => <div className="intake-field" key={key}><label htmlFor={`invite-${key}`}>{label}</label><select className="intake-input" id={`invite-${key}`} value={invitation[key]} disabled={busy || staffLoading || !!staffError} onChange={event => update({ [key]: event.target.value })}><option value="">{staffLoading ? 'Loading team…' : 'Assign later'}</option>{staff.map(user => <option key={user._id} value={user._id}>{user.name} ({user.role.replace(/_/g, ' ')})</option>)}</select></div>)}</div>
            </section>

            <section className="intake-invite-section" aria-labelledby="invite-preferences-heading">
              <div className="intake-invite-section-heading"><span><Clock3 size={18} /></span><div><h3 id="invite-preferences-heading">Link preferences</h3><p>Choose how long the invitation stays available.</p></div></div>
              <fieldset className="intake-invite-duration" disabled={busy}><legend>Link validity</legend><div className="intake-invite-duration-options">{[3, 7, 14, 30].map(days => <label key={days} className={!customExpiry && expiry === days ? 'selected' : ''}><input type="radio" name="invite-validity" value={days} checked={!customExpiry && expiry === days} onChange={() => { setCustomExpiry(false); update({ expiryDays: days }); }} /><span>{days} days</span>{days === 7 && <small>Standard</small>}</label>)}<label className={customExpiry ? 'selected' : ''}><input type="radio" name="invite-validity" value="custom" checked={customExpiry} onChange={() => setCustomExpiry(true)} /><span>Custom</span><ChevronDown size={13} /></label></div></fieldset>
              {customExpiry && <div className="intake-field intake-invite-custom-expiry"><label htmlFor="invite-expiry">Expiry in days <span aria-label="required">*</span></label><input className="intake-input" id="invite-expiry" type="number" min={1} max={30} step={1} inputMode="numeric" value={invitation.expiryDays} disabled={busy} aria-invalid={!!fieldErrors.expiryDays} aria-describedby="invite-expiry-help" onChange={event => update({ expiryDays: event.target.value })} /><small id="invite-expiry-help" className={fieldErrors.expiryDays ? 'intake-field-error' : 'intake-field-help'}>{fieldErrors.expiryDays || 'Choose between 1 and 30 days.'}</small></div>}
              <div className="intake-field intake-invite-message"><label htmlFor="invite-intro">Message to your client <span className="intake-label-optional">Optional</span></label><textarea className="intake-input" id="invite-intro" rows={3} maxLength={2000} placeholder="A short welcome or any instructions for completing the form…" value={invitation.introduction} disabled={busy} onChange={event => update({ introduction: event.target.value })} /><small className="intake-field-help">This message appears on the client’s form and invitation email.</small></div>
            </section>
          </div>

          <aside className="intake-invite-summary" aria-label="Invitation summary">
            <span className="intake-invite-summary-icon"><Mail size={24} /></span><p className="intake-eyebrow">Invitation summary</p><h3>{invitation.clientName.trim() || 'Your next client starts here'}</h3><p>A simple, secure first step. Your client can complete the form from any device.</p>
            <dl><div><dt>Legal service</dt><dd>{service?.path.slice(-1)[0]?.label || 'Client chooses'}</dd></div><div><dt>Available until</dt><dd>{expiresOn}{expiryValid && <small>{expiry} {expiry === 1 ? 'day' : 'days'} from generation</small>}</dd></div><div><dt>Share by</dt><dd>{invitation.clientEmail.trim() ? <><Mail size={14} /> Email or copied link</> : <><Copy size={14} /> Copied link</>}</dd></div><div><dt>Internal team</dt><dd>{STAFF_FIELDS.filter(([key]) => invitation[key]).length ? `${STAFF_FIELDS.filter(([key]) => invitation[key]).length} team assignments` : 'Confirm during review'}</dd></div></dl>
            <div className="intake-invite-summary-note"><LockKeyhole size={17} /><span>Private invitation<br /><small>No client account required</small></span></div>
          </aside>
        </div>

        <footer className="intake-invite-footer">
          <div className="intake-invite-footer-status">{configurationLoading ? <><Loader2 size={16} className="animate-spin" /><span>Loading settings…</span></> : ready ? <><ShieldCheck size={16} /><span>Ready to generate and share</span></> : <><AlertCircle size={16} /><span>{configurationError ? 'Reload settings to continue' : publicAddressError ? 'Public intake address needs attention' : 'Privacy approval required'}</span></>}</div>
          {error && <div ref={errorRef} tabIndex={-1} role="alert" className="intake-error intake-invite-submit-error"><AlertCircle size={17} /><span>{error}</span></div>}
          <div className="intake-invite-footer-actions"><button type="button" className="intake-button secondary" onClick={props.onClose} disabled={busy}>Cancel</button><button type="submit" className="intake-button" disabled={busy || !ready} aria-busy={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}{busy ? 'Generating…' : 'Generate secure link'}{!busy && <ArrowRight size={15} />}</button></div>
        </footer>
      </form>}
    </section>
  </div>;
}
