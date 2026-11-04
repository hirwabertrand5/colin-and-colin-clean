import { FormEvent, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { LockKeyhole, X } from 'lucide-react';
import { CaseData } from '../../services/caseService';
import { listActiveWorkflowTemplates, WorkflowTemplate } from '../../services/workflowService';
import { getRoleSuggestions } from '../../constants/partyRoles';
import { formatCaseAssignedTo } from '../../utils/caseAssignments';
import { StructuredFormField } from '../ui/StructuredForm';

const SERVICE_LEVEL_LABELS = ['Legal Service', 'Category', 'Practice Area', 'Service Line', 'Sub-category', 'Detail'];
const ASSIGNMENT_FIELDS = [
  { key: 'initiator', label: 'Initiator', hint: 'Intern / Junior' },
  { key: 'reviewer', label: 'Reviewer', hint: 'Associate / Senior Associate' },
  { key: 'signerApprover', label: 'Signer / Approver', hint: 'Managing Partner' },
] as const;

type StaffUser = { _id: string; name: string };
type Props = {
  matter: CaseData;
  templateName?: string;
  staffUsers: StaffUser[];
  staffLoading: boolean;
  staffError: string;
  onClose: () => void;
  onSave: (payload: Partial<CaseData>) => Promise<void>;
};

const toDateInput = (value?: string) => value ? new Date(value).toISOString().slice(0, 10) : '';
const contractValue = (matter: CaseData) => String(matter.workflowProgress?.plannedValue?.amount ?? matter.budget ?? '');

export default function EditCaseDialog({ matter, templateName, staffUsers, staffLoading, staffError, onClose, onSave }: Props) {
  const [form, setForm] = useState(() => ({
    caseNo: matter.caseNo,
    parties: matter.parties,
    description: matter.description || '',
    caseAssignments: {
      initiator: matter.caseAssignments?.initiator || matter.assignedTo || '',
      reviewer: matter.caseAssignments?.reviewer || '',
      signerApprover: matter.caseAssignments?.signerApprover || '',
    },
    budget: contractValue(matter),
    workflowStartDate: toDateInput(matter.workflowStartDate),
    workflowTemplateId: '',
  }));
  const [structuredParties, setStructuredParties] = useState(false);
  const [parties, setParties] = useState([{ name: matter.parties, role: '' }]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const closed = matter.status.toLowerCase() === 'closed' || matter.workflowProgress?.status === 'Completed';
  const canSelectTemplate = !matter.workflowTemplateId && !closed;

  // Existing matters keep their exact template, including inactive or older versions.
  // Only historical matters with no template need the active template catalogue.
  useEffect(() => {
    if (!canSelectTemplate) return;
    let cancelled = false;
    setTemplatesLoading(true);
    listActiveWorkflowTemplates()
      .then(data => { if (!cancelled) setTemplates(Array.isArray(data) ? data : []); })
      .catch(err => { if (!cancelled) setTemplatesError(err.message || 'Failed to load workflow templates.'); })
      .finally(() => { if (!cancelled) setTemplatesLoading(false); });
    return () => { cancelled = true; };
  }, [canSelectTemplate]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError('');
    const finalParties = structuredParties
      ? parties.filter(party => party.name.trim()).map(party => party.role ? `${party.name} (${party.role})` : party.name).join(' ; ')
      : form.parties;
    if (!finalParties.trim()) { setError('Enter at least one party.'); return; }
    const amount = Number(form.budget.replace(/,/g, '').trim());
    const changedValue = form.budget !== contractValue(matter);
    if (changedValue && (!Number.isFinite(amount) || amount <= 0)) {
      setError('Enter a contract value greater than zero.');
      return;
    }
    // Send editable fields explicitly. Classification and existing workflow linkage
    // never enter the update payload, even if the catalogue has changed since creation.
    const payload: Partial<CaseData> = {
      caseNo: form.caseNo,
      parties: finalParties,
      description: form.description,
      caseAssignments: form.caseAssignments,
      assignedTo: formatCaseAssignedTo({ caseAssignments: form.caseAssignments }),
      ...(changedValue ? {
        budget: String(amount),
        workflowProgress: { plannedValue: { amount, currency: 'RWF' } },
      } : {}),
      ...(!closed && form.workflowStartDate !== toDateInput(matter.workflowStartDate)
        ? { workflowStartDate: form.workflowStartDate } : {}),
      ...(canSelectTemplate && form.workflowTemplateId ? { workflowTemplateId: form.workflowTemplateId } : {}),
    };
    try {
      setSaving(true);
      await onSave(payload);
    } catch (err: any) {
      setError(err.message || 'Failed to update case.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !saving) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="retainer-modal-backdrop" />
        <Dialog.Content className="retainer-modal-card retainer-form case-edit-dialog" onEscapeKeyDown={event => { if (saving) event.preventDefault(); }} onPointerDownOutside={event => { if (saving) event.preventDefault(); }}>
          <form onSubmit={save} aria-busy={saving}>
            <header className="retainer-form-header">
              <div>
                <span className="retainer-form-eyebrow">Matter details</span>
                <Dialog.Title asChild><h2>Edit Case</h2></Dialog.Title>
                <Dialog.Description asChild><p>Update case details, assignments, and financial information.</p></Dialog.Description>
              </div>
              <button type="button" onClick={onClose} disabled={saving} className="retainer-icon-close" aria-label="Close edit case form"><X size={18} /></button>
            </header>

            <section className="retainer-form-section">
              <div className="retainer-section-heading"><h3>Case details</h3><p>Keep the case reference and parties up to date.</p></div>
              <div className="retainer-form-grid">
                {matter.caseType !== 'Transactional Cases' && <StructuredFormField label="Case No." required>
                  <input className="retainer-form-control" required value={form.caseNo} onChange={event => setForm(current => ({ ...current, caseNo: event.target.value }))} />
                </StructuredFormField>}
                <StructuredFormField label="Case Type"><input className="retainer-form-control case-edit-readonly" readOnly value={matter.caseType} /></StructuredFormField>
                <div className="case-edit-parties">
                  <label className="case-edit-structured-toggle"><input type="checkbox" checked={structuredParties} onChange={event => setStructuredParties(event.target.checked)} /> Enter parties separately</label>
                  {!structuredParties ? <StructuredFormField label="Parties" required>
                    <input className="retainer-form-control" required value={form.parties} onChange={event => setForm(current => ({ ...current, parties: event.target.value }))} />
                  </StructuredFormField> : <div className="case-edit-party-list">
                    {parties.map((party, index) => <div className="case-edit-party-row" key={index}>
                      <StructuredFormField label={`Party ${index + 1}`} required><input className="retainer-form-control" required value={party.name} onChange={event => setParties(current => current.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /></StructuredFormField>
                      <StructuredFormField label="Role"><select className="retainer-form-control" value={party.role} onChange={event => setParties(current => current.map((item, i) => i === index ? { ...item, role: event.target.value } : item))}>
                        <option value="">Select role...</option>
                        {getRoleSuggestions({ caseType: matter.caseType, sectorLabel: matter.legalServicePath?.[0]?.label, matterType: matter.workflow }).map(role => <option key={role} value={role}>{role}</option>)}
                      </select></StructuredFormField>
                      <button type="button" className="retainer-button retainer-button-secondary" aria-label={`Remove party ${index + 1}`} disabled={parties.length === 1} onClick={() => setParties(current => current.filter((_, i) => i !== index))}>Remove</button>
                    </div>)}
                    <button type="button" className="retainer-button retainer-button-secondary" onClick={() => setParties(current => [...current, { name: '', role: '' }])}>Add party</button>
                  </div>}
                </div>
              </div>
            </section>

            <section className="retainer-form-section" aria-labelledby="case-edit-classification-title">
              <div className="retainer-section-heading">
                <h3 id="case-edit-classification-title" className="case-edit-locked-heading">Legal Service Classification <span><LockKeyhole size={13} aria-hidden="true" /> Read only</span></h3>
                <p>Saved when this case was created. Classification is locked and cannot be changed.</p>
              </div>
              {matter.legalServicePath?.length ? <div className="retainer-form-grid">
                {matter.legalServicePath.map((item, index) => <StructuredFormField key={`${index}-${item.id}`} label={SERVICE_LEVEL_LABELS[index] || `Level ${index + 1}`}>
                  <input className="retainer-form-control case-edit-readonly" readOnly value={item.label || item.id} />
                </StructuredFormField>)}
              </div> : <div className="retainer-readonly-note"><strong>No classification was saved for this case.</strong><span>The existing workflow remains linked to the case.</span></div>}
            </section>

            <section className="retainer-form-section">
              <div className="retainer-section-heading"><h3>Assigned To</h3><p>Choose the initiator, reviewer, and signer/approver for this case.</p></div>
              <div className="retainer-form-grid case-edit-assignment-grid">
                {ASSIGNMENT_FIELDS.map(field => {
                  const currentValue = form.caseAssignments[field.key];
                  return <StructuredFormField key={field.key} label={field.label} hint={field.hint} required>
                    <select className="retainer-form-control" required disabled={staffLoading} value={currentValue} onChange={event => setForm(current => ({ ...current, caseAssignments: { ...current.caseAssignments, [field.key]: event.target.value } }))}>
                      <option value="">{staffLoading ? 'Loading staff...' : 'Select staff'}</option>
                      {currentValue && !staffUsers.some(user => user.name === currentValue) && <option value={currentValue}>{currentValue}</option>}
                      {staffUsers.map(user => <option key={user._id} value={user.name}>{user.name}</option>)}
                    </select>
                  </StructuredFormField>;
                })}
              </div>
              {staffError && <p role="alert" className="case-edit-error">{staffError}</p>}
            </section>

            <section className="retainer-form-section retainer-financial-section">
              <div className="retainer-section-heading"><h3>Financial setup</h3><p>Set the contract value used to calculate workflow earnings.</p></div>
              <StructuredFormField label="Contract Value (RWF)"><div className="retainer-money-input"><span>RWF</span><input className="retainer-form-control" inputMode="decimal" value={form.budget} onChange={event => setForm(current => ({ ...current, budget: event.target.value }))} placeholder="1000000" /></div></StructuredFormField>
            </section>

            <section className="retainer-form-section">
              <div className="retainer-section-heading"><h3>Workflow</h3><p>{closed ? 'This matter is completed.' : 'The workflow template is locked after creation. Changing the start date will reschedule the existing workflow steps.'}</p></div>
              <div className="retainer-form-grid">
                <StructuredFormField label="Workflow Template">
                  {canSelectTemplate ? <select className="retainer-form-control" value={form.workflowTemplateId} disabled={templatesLoading} onChange={event => setForm(current => ({ ...current, workflowTemplateId: event.target.value }))}>
                    <option value="">{templatesLoading ? 'Loading templates...' : 'Select workflow template'}</option>
                    {templates.map(template => <option key={template._id} value={template._id}>{template.matterType}</option>)}
                  </select> : <input className="retainer-form-control case-edit-readonly" readOnly value={templateName || matter.matterType || matter.workflow || 'No workflow template saved'} />}
                </StructuredFormField>
                <StructuredFormField label="Workflow Start Date"><input className="retainer-form-control" type="date" readOnly={closed} required={Boolean(matter.workflowStartDate)} value={form.workflowStartDate} onChange={event => setForm(current => ({ ...current, workflowStartDate: event.target.value }))} /></StructuredFormField>
                <StructuredFormField label="Workflow status" wide><input className="retainer-form-control case-edit-readonly" readOnly value={matter.workflowProgress?.status === 'Completed' ? 'Completed' : matter.workflowProgress?.currentStepTitle || 'In Progress'} /></StructuredFormField>
              </div>
              {templatesError && <p role="alert" className="case-edit-error">{templatesError}</p>}
            </section>

            <section className="retainer-form-section">
              <div className="retainer-section-heading"><h3>Case Summary</h3><p>Provide context for the team working on this matter.</p></div>
              <StructuredFormField label="Case Summary"><textarea className="retainer-form-control retainer-form-textarea" rows={3} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></StructuredFormField>
            </section>
            {error && <p role="alert" className="case-edit-error case-edit-save-error">{error}</p>}
            <footer className="retainer-form-footer">
              <button type="button" onClick={onClose} disabled={saving} className="retainer-button retainer-button-secondary">Cancel</button>
              <button type="submit" disabled={saving || staffLoading} className="retainer-button retainer-button-primary">{saving ? 'Saving...' : 'Save Changes'}</button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
