import { useState } from 'react';
import { X } from 'lucide-react';
import { intakeRequest } from '../../services/digitalIntakeService';

export default function IntakeSettingsDialog({ settings, onSaved, onClose }: { settings: any; onSaved: () => void; onClose: () => void }) {
  const [value, setValue] = useState({ ...settings, notificationEmail: settings.notificationEmail || 'info@colinandcolin.com' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const patch = (key: string, next: unknown) => setValue((old: any) => ({ ...old, [key]: next }));
  return <div className="intake-modal-backdrop"><section className="intake-modal intake-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="intake-settings-title">
    <div className="intake-modal-heading"><div><p className="intake-eyebrow">Client intake</p><h2 id="intake-settings-title">Intake settings</h2></div><button type="button" className="intake-icon-button" disabled={busy} onClick={onClose} aria-label="Close intake settings"><X /></button></div>
    <form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { await intakeRequest('/configuration', 'PUT', value); onSaved(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }}>
      <fieldset disabled={busy}><h3>Email delivery</h3>
        <div className="intake-field"><label htmlFor="intake-notification-mail">Submission notification mailbox *</label><input id="intake-notification-mail" className="intake-input" type="email" required value={value.notificationEmail} onChange={e => patch('notificationEmail', e.target.value)} /></div>
        <p className="intake-muted">Completed forms and document lists are emailed to this firm mailbox. Invitations and receipts go to the client. Assigned staff also receive a notification in the application.</p>
        <h3>Client information notice</h3>
        <div className="intake-field"><label htmlFor="intake-notice-text">Notice text *</label><textarea id="intake-notice-text" className="intake-input" rows={6} required maxLength={15000} value={value.noticeText || ''} onChange={e => patch('noticeText', e.target.value)} /></div>
        <div className="intake-grid">{[['noticeVersion', 'Notice version'], ['privacyContact', 'Privacy contact'], ['retentionPolicy', 'Retention statement']].map(([key, label]) => <div className="intake-field" key={key}><label htmlFor={`settings-${key}`}>{label} *</label><input id={`settings-${key}`} className="intake-input" required value={value[key] || ''} maxLength={key === 'noticeVersion' ? 100 : key === 'retentionPolicy' ? 3000 : 500} onChange={e => patch(key, e.target.value)} /></div>)}<div className="intake-field"><label htmlFor="settings-expiry">Default link expiry (days) *</label><input id="settings-expiry" className="intake-input" type="number" min={1} max={30} required value={value.defaultExpiryDays || 7} onChange={e => patch('defaultExpiryDays', Number(e.target.value))} /></div></div>
        <label className="intake-checkbox"><input type="checkbox" checked={value.noticeApproved === true} onChange={e => patch('noticeApproved', e.target.checked)} /><span>Approve this notice for new client invitations</span></label>
        <p className="intake-muted">Use a new notice version when changing approved wording. Existing invitations keep their original notice.</p>
      </fieldset>{error && <p className="intake-error" role="alert">{error}</p>}<div className="intake-row"><button type="button" className="intake-button secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="intake-button" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
    </form>
  </section></div>;
}
