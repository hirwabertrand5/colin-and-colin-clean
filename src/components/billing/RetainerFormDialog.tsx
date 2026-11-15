import { Dispatch, FormEvent, SetStateAction, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, FileText, Wallet, X } from 'lucide-react';
import { StructuredFormField as Field } from '../ui/StructuredForm';
import type { RetainerPayload } from '../../services/retainerService';
import './retainer-workspace.css';

export function RetainerFormDialog({ form, setForm, editing, saving, error, onClose, onSubmit }: {
  form: RetainerPayload; setForm: Dispatch<SetStateAction<RetainerPayload>>;
  editing: boolean; saving: boolean; error?: string; onClose: () => void; onSubmit: (event: FormEvent) => void;
}) {
  const titleId = useId(), formRef = useRef<HTMLFormElement>(null), closeRef = useRef(onClose);
  closeRef.current = onClose;
  const update = (field: keyof RetainerPayload, value: string | number) => setForm((current) => ({ ...current, [field]: value, billingModel: 'monthly' }));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && formRef.current?.dataset.saving !== 'true') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') || []);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);

  return createPortal(<div className="retainer-modal-backdrop rw-form-backdrop" onMouseDown={() => { if (!saving) onClose(); }}>
    <form ref={formRef} data-saving={saving} className="retainer-modal-card rw-form" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()} onSubmit={onSubmit}>
      <header className="rw-form-header"><div><span className="rw-eyebrow">Retainer agreement</span><h2 id={titleId}>{editing ? 'Edit retainer agreement' : 'Create retainer agreement'}</h2><p>Record the retainer client’s fixed monthly fee and link the matters and services handled during each month.</p></div><button type="button" className="rw-icon-button" aria-label="Close retainer form" disabled={saving} onClick={onClose}><X size={19} /></button></header>
      {error && <p role="alert" className="rw-alert is-error">{error}</p>}
      <div className="rw-form-body"><fieldset className="rw-form-fields" disabled={saving}>
        <section className="rw-form-section"><div className="rw-form-section-title"><span className="rw-step">01</span><div><h3>Retainer agreement</h3><p>Identify the retainer client and retainer agreement.</p></div><FileText size={19} /></div>
          <div className="retainer-form-grid"><Field label="Retainer agreement" required><input aria-label="Retainer agreement" className="retainer-form-control" required value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g., Annual legal services" /></Field><Field label="Retainer client" required><input aria-label="Retainer client" className="retainer-form-control" required value={form.clientName} onChange={(event) => update('clientName', event.target.value)} placeholder="Client or organisation name" /></Field></div>
        </section>
        <section className="rw-form-section"><div className="rw-form-section-title"><span className="rw-step">02</span><div><h3>Term and status</h3><p>Only an active, in-term agreement can be selected when creating a case.</p></div><CalendarDays size={19} /></div>
          <div className="retainer-form-grid rw-term-grid"><Field label="Status"><select aria-label="Status" className="retainer-form-control" value={form.status} onChange={(event) => update('status', event.target.value)}>{['Draft', 'Active', 'Paused', 'Closed'].map((status) => <option key={status}>{status}</option>)}</select></Field><Field label="Start date" required><input aria-label="Start date" className="retainer-form-control" type="date" required value={form.startDate} onChange={(event) => update('startDate', event.target.value)} /></Field><Field label="End date" hint="Optional for open-ended agreements."><input aria-label="End date" className="retainer-form-control" type="date" min={form.startDate} value={form.endDate || ''} onChange={(event) => update('endDate', event.target.value)} /></Field><Field label="Renewal review" hint="Optional internal reminder."><input aria-label="Renewal review" className="retainer-form-control" type="date" value={form.renewalDate || ''} onChange={(event) => update('renewalDate', event.target.value)} /></Field></div>
        </section>
        <section className="rw-form-section rw-fee-section"><div className="rw-form-section-title"><span className="rw-step">03</span><div><h3>Fixed monthly fee</h3><p>The retainer client pays the same fixed monthly fee each month under the retainer agreement. The ordinary professional fees of services handled during the month are recorded separately.</p></div><Wallet size={19} /></div>
          <div className="retainer-form-grid"><Field label="Fixed monthly fee" required hint="The retainer contract value payable each month."><div className="retainer-money-input"><span>RWF</span><input aria-label="Fixed monthly fee" className="retainer-form-control" required type="number" min="1" max="999999999999" step="1" inputMode="numeric" value={form.monthlyFee || ''} onChange={(event) => update('monthlyFee', Number(event.target.value))} placeholder="0" /></div></Field><Field label="Billing day" hint="Choose a calendar day from 1 to 28."><input aria-label="Billing day" className="retainer-form-control" type="number" required min="1" max="28" step="1" value={form.billingDay ?? 1} onChange={(event) => update('billingDay', Number(event.target.value))} /></Field></div>
        </section>
        <section className="rw-form-section"><div className="rw-form-section-title"><span className="rw-step">04</span><div><h3>Services covered</h3><p>Record the services covered by the retainer agreement and its agreed scope limits.</p></div></div>
          <div className="retainer-form-grid"><Field label="Services covered"><textarea aria-label="Services covered" className="retainer-form-control" rows={3} value={form.scope || ''} onChange={(event) => update('scope', event.target.value)} placeholder="Describe the agreed services" /></Field><Field label="Internal notes"><textarea aria-label="Internal notes" className="retainer-form-control" rows={3} value={form.notes || ''} onChange={(event) => update('notes', event.target.value)} placeholder="Internal agreement notes" /></Field></div>
        </section>
      </fieldset></div>
      <footer className="rw-form-footer"><button type="button" className="rw-button" disabled={saving} onClick={onClose}>Cancel</button><button className="rw-button is-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create retainer'}</button></footer>
    </form>
  </div>, document.body);
}
