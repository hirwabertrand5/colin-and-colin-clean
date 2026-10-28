import { StructuredFormField as RetainerFormField, StructuredFormChoice } from '../ui/StructuredForm';
import { Dispatch, FormEvent, SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { RetainerPayload } from '../../services/retainerService';

export function RetainerFormDialog({ form, setForm, editing, saving, onClose, onSubmit }: { form: RetainerPayload; setForm: Dispatch<SetStateAction<RetainerPayload>>; editing: boolean; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  const update = (field: keyof RetainerPayload, value: any) => setForm((current) => ({ ...current, [field]: value }));
  const selectBillingModel = (billingModel: RetainerPayload['billingModel']) => setForm((current) => ({
    ...current,
    billingModel,
    ...(billingModel === 'monthly' ? { contractValue: 0 } : {}),
    ...(billingModel === 'prepaid' ? { monthlyFee: 0 } : {}),
  }));
  const hasSubscriptionValue = form.billingModel === 'prepaid' || form.billingModel === 'hybrid';
  const hasMonthlyFee = form.billingModel === 'monthly' || form.billingModel === 'hybrid';
  const modelDescription = form.billingModel === 'prepaid'
    ? 'The subscription contract value is shared across every linked case.'
    : form.billingModel === 'monthly'
      ? 'The agreement is charged as a recurring monthly service fee.'
      : 'The agreement combines a monthly service fee with a shared subscription contract value.';

  return createPortal(
    <div className="retainer-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="retainer-form-title" className="retainer-modal-card retainer-form">
        <header className="retainer-form-header"><div><span className="retainer-form-eyebrow">Client agreement</span><h2 id="retainer-form-title">{editing ? 'Edit retainer' : 'Create a retainer'}</h2><p>Set up the agreement, then link cases that sit under the client subscription.</p></div><button type="button" onClick={onClose} disabled={saving} className="retainer-icon-close" aria-label="Close retainer form">×</button></header>

        <section className="retainer-form-section"><div className="retainer-section-heading"><h3>Agreement details</h3><p>Identify the client and agreement clearly for your team.</p></div><div className="retainer-form-grid"><RetainerFormField label="Agreement name" required hint="Use a clear, searchable agreement name."><input className="retainer-form-control" required value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g., Acme Corporate Advisory Retainer" /></RetainerFormField><RetainerFormField label="Client" required hint="Client, organisation, or group name."><input className="retainer-form-control" required value={form.clientName} onChange={(event) => update('clientName', event.target.value)} placeholder="e.g., Acme Ltd" /></RetainerFormField></div></section>

        <section className="retainer-form-section"><div className="retainer-section-heading"><h3>Billing structure</h3><p>{modelDescription}</p></div><div className="retainer-model-grid" role="radiogroup" aria-label="Billing model"><RetainerBillingOption value="prepaid" title="Subscription contract" description="Use a shared contract value across linked cases." selected={form.billingModel === 'prepaid'} onSelect={selectBillingModel} /><RetainerBillingOption value="monthly" title="Monthly service agreement" description="Set a fixed recurring service fee." selected={form.billingModel === 'monthly'} onSelect={selectBillingModel} /><RetainerBillingOption value="hybrid" title="Hybrid agreement" description="Use both a monthly fee and shared contract value." selected={form.billingModel === 'hybrid'} onSelect={selectBillingModel} /></div></section>

        <section className="retainer-form-section"><div className="retainer-section-heading"><h3>Term and status</h3><p>Only an active, in-term agreement can be selected when creating a case.</p></div><div className="retainer-form-grid retainer-form-grid-four"><RetainerFormField label="Status"><select className="retainer-form-control" value={form.status} onChange={(event) => update('status', event.target.value)}><option value="Draft">Draft</option><option value="Active">Active</option><option value="Paused">Paused</option><option value="Closed">Closed</option></select></RetainerFormField><RetainerFormField label="Start date" required><input className="retainer-form-control" required type="date" value={form.startDate} onChange={(event) => update('startDate', event.target.value)} /></RetainerFormField><RetainerFormField label="End date" hint="Optional for open-ended agreements."><input className="retainer-form-control" type="date" value={form.endDate || ''} onChange={(event) => update('endDate', event.target.value)} /></RetainerFormField><RetainerFormField label="Renewal review" hint="Optional internal reminder."><input className="retainer-form-control" type="date" value={form.renewalDate || ''} onChange={(event) => update('renewalDate', event.target.value)} /></RetainerFormField></div></section>

        <section className="retainer-form-section retainer-financial-section"><div className="retainer-section-heading"><h3>Financial setup</h3><p>Use the same contract-value terminology used throughout case management.</p></div><div className="retainer-form-grid">{hasSubscriptionValue && !editing && <RetainerFormField label="Contract value" required hint="Shared subscription value. It does not limit or deduct individual case contract values."><div className="retainer-money-input"><span>RWF</span><input className="retainer-form-control" required min="1" inputMode="numeric" type="number" value={form.contractValue || ''} onChange={(event) => update('contractValue', Number(event.target.value))} placeholder="0" /></div></RetainerFormField>}{hasSubscriptionValue && editing && <div className="retainer-readonly-note"><strong>Contract value</strong><span>Use Adjust contract value after saving to record an approved amendment.</span></div>}{hasMonthlyFee && <RetainerFormField label="Monthly service fee" required><div className="retainer-money-input"><span>RWF</span><input className="retainer-form-control" required min="1" inputMode="numeric" type="number" value={form.monthlyFee || ''} onChange={(event) => update('monthlyFee', Number(event.target.value))} placeholder="0" /></div></RetainerFormField>}{hasMonthlyFee && <RetainerFormField label="Billing day" hint="Choose a calendar day from 1 to 28."><input className="retainer-form-control" min="1" max="28" type="number" value={form.billingDay || 1} onChange={(event) => update('billingDay', Number(event.target.value))} /></RetainerFormField>}</div></section>

        <section className="retainer-form-section"><div className="retainer-section-heading"><h3>Scope and ownership</h3><p>Give case teams enough context to decide whether a case belongs under this agreement.</p></div><div className="retainer-form-grid"><RetainerFormField label="Responsible partner" hint="Optional internal owner."><input className="retainer-form-control" value={form.responsiblePartner || ''} onChange={(event) => update('responsiblePartner', event.target.value)} placeholder="Name of responsible partner" /></RetainerFormField><RetainerFormField label="Internal notes" hint="Not client-facing."><input className="retainer-form-control" value={form.notes || ''} onChange={(event) => update('notes', event.target.value)} placeholder="Optional operational note" /></RetainerFormField><RetainerFormField label="Scope / included services" wide hint="Include covered work, limits, exclusions, or hourly caps."><textarea className="retainer-form-control retainer-form-textarea" rows={3} value={form.scope || ''} onChange={(event) => update('scope', event.target.value)} placeholder="e.g., Corporate advisory and contract review; litigation excluded." /></RetainerFormField></div></section>

        <footer className="retainer-form-footer"><button type="button" onClick={onClose} disabled={saving} className="retainer-button retainer-button-secondary">Cancel</button><button disabled={saving} className="retainer-button retainer-button-primary">{saving ? 'Saving…' : editing ? 'Save changes' : 'Create retainer'}</button></footer>
      </form>
    </div>,
    document.body
  );
}

function RetainerBillingOption({ value, title, description, selected, onSelect }: { value: RetainerPayload['billingModel']; title: string; description: string; selected: boolean; onSelect: (value: RetainerPayload['billingModel']) => void }) {
  return <StructuredFormChoice title={title} description={description} selected={selected} onSelect={() => onSelect(value)} />;
}
