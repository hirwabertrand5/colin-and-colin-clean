import { StructuredFormField as RetainerFormField } from '../ui/StructuredForm';
import { Dispatch, FormEvent, SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { RetainerPayload } from '../../services/retainerService';

export function RetainerFormDialog({ form, setForm, editing, saving, error, onClose, onSubmit }: { form: RetainerPayload; setForm: Dispatch<SetStateAction<RetainerPayload>>; editing: boolean; saving: boolean; error?: string; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  const update = (field: keyof RetainerPayload, value: any) => setForm((current) => ({
    ...current, [field]: value, ...(field === 'monthlyFee' ? { billingModel: 'monthly' as const } : {}),
  }));

  return createPortal(
    <div className="retainer-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="retainer-form-title" className="retainer-modal-card retainer-form">
        <header className="retainer-form-header"><div><span className="retainer-form-eyebrow">Retainer agreement</span><h2 id="retainer-form-title">{editing ? 'Edit retainer agreement' : 'Create retainer agreement'}</h2><p>Record the retainer client’s fixed monthly fee and link the matters and services handled during each month.</p></div><button type="button" onClick={onClose} disabled={saving} className="retainer-icon-close" aria-label="Close retainer form">×</button></header>
        {error && <p role="alert" className="retainer-page-alert is-error">{error}</p>}

        <section className="retainer-form-section"><div className="retainer-section-heading"><h3>Retainer agreement</h3><p>Identify the retainer client and retainer agreement.</p></div><div className="retainer-form-grid"><RetainerFormField label="Retainer agreement" required><input className="retainer-form-control" required value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g., Acme Retainer Agreement" /></RetainerFormField><RetainerFormField label="Retainer client" required><input className="retainer-form-control" required value={form.clientName} onChange={(event) => update('clientName', event.target.value)} placeholder="e.g., Acme Ltd" /></RetainerFormField></div></section>

        <section className="retainer-form-section"><div className="retainer-section-heading"><h3>Term and status</h3><p>Only an active, in-term agreement can be selected when creating a case.</p></div><div className="retainer-form-grid retainer-form-grid-four"><RetainerFormField label="Status"><select className="retainer-form-control" value={form.status} onChange={(event) => update('status', event.target.value)}><option value="Draft">Draft</option><option value="Active">Active</option><option value="Paused">Paused</option><option value="Closed">Closed</option></select></RetainerFormField><RetainerFormField label="Start date" required><input className="retainer-form-control" required type="date" value={form.startDate} onChange={(event) => update('startDate', event.target.value)} /></RetainerFormField><RetainerFormField label="End date" hint="Optional for open-ended agreements."><input className="retainer-form-control" type="date" value={form.endDate || ''} onChange={(event) => update('endDate', event.target.value)} /></RetainerFormField><RetainerFormField label="Renewal review" hint="Optional internal reminder."><input className="retainer-form-control" type="date" value={form.renewalDate || ''} onChange={(event) => update('renewalDate', event.target.value)} /></RetainerFormField></div></section>

        <section className="retainer-form-section retainer-financial-section"><div className="retainer-section-heading"><h3>Fixed monthly fee</h3><p>The retainer client pays the same fixed monthly fee each month under the retainer agreement. The ordinary professional fees of services handled during the month are recorded separately.</p></div><div className="retainer-form-grid"><RetainerFormField label="Fixed monthly fee" required hint="The retainer contract value payable each month."><div className="retainer-money-input"><span>RWF</span><input className="retainer-form-control" required min="1" step="1" inputMode="numeric" type="number" value={form.monthlyFee || ''} onChange={(event) => update('monthlyFee', Number(event.target.value))} placeholder="0" /></div></RetainerFormField><RetainerFormField label="Billing day" hint="Choose a calendar day from 1 to 28."><input className="retainer-form-control" min="1" max="28" type="number" value={form.billingDay || 1} onChange={(event) => update('billingDay', Number(event.target.value))} /></RetainerFormField></div></section>

        <section className="retainer-form-section"><div className="retainer-section-heading"><h3>Services covered</h3><p>Record the services covered by the retainer agreement and its agreed scope limits.</p></div><div className="retainer-form-grid"><RetainerFormField label="Services covered" wide><textarea className="retainer-form-control retainer-form-textarea" rows={3} value={form.scope || ''} onChange={(event) => update('scope', event.target.value)} placeholder="Services covered and agreed scope limits" /></RetainerFormField><RetainerFormField label="Internal notes" wide><textarea className="retainer-form-control retainer-form-textarea" rows={2} value={form.notes || ''} onChange={(event) => update('notes', event.target.value)} /></RetainerFormField></div></section>

        <footer className="retainer-form-footer"><button type="button" onClick={onClose} disabled={saving} className="retainer-button retainer-button-secondary">Cancel</button><button disabled={saving} className="retainer-button retainer-button-primary">{saving ? 'Saving…' : editing ? 'Save changes' : 'Create retainer'}</button></footer>
      </form>
    </div>,
    document.body
  );
}
