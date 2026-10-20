import { Dispatch, FormEvent, ReactNode, SetStateAction, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { BriefcaseBusiness, CalendarDays, ClipboardList, Pencil, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react';
import { CaseData, getAllCases } from '../../services/caseService';
import {
  adjustRetainerContractValue,
  createRetainer,
  deleteRetainer,
  getRetainerActivity,
  getRetainerCases,
  listRetainers,
  Retainer,
  RetainerActivity,
  RetainerCase,
  RetainerCaseSummary,
  RetainerPayload,
  setCaseRetainer,
  updateRetainer,
} from '../../services/retainerService';

const money = (amount?: number) => `RWF ${Math.max(0, Number(amount) || 0).toLocaleString()}`;
const today = () => new Date().toISOString().slice(0, 10);
const emptySummary = (): RetainerCaseSummary => ({ caseCount: 0, contractValue: 0, totalBilled: 0, totalCollected: 0, outstanding: 0, directMatterCosts: 0, grossProfit: 0, profitableCases: 0, lossMakingCases: 0 });
const emptyForm = (): RetainerPayload => ({ name: '', clientName: '', billingModel: 'prepaid', status: 'Draft', startDate: today(), endDate: '', renewalDate: '', billingDay: 1, monthlyFee: 0, contractValue: 0, scope: '', responsiblePartner: '', notes: '' });
const toForm = (retainer: Retainer): RetainerPayload => ({ name: retainer.name, clientName: retainer.clientName, billingModel: retainer.billingModel, status: retainer.status, startDate: retainer.startDate, endDate: retainer.endDate || '', renewalDate: retainer.renewalDate || '', billingDay: retainer.billingDay || 1, monthlyFee: retainer.monthlyFee || 0, contractValue: retainer.contractValue || 0, scope: retainer.scope || '', responsiblePartner: retainer.responsiblePartner || '', notes: retainer.notes || '' });

export default function RetainerManagement() {
  const [retainers, setRetainers] = useState<Retainer[]>([]);
  const [selected, setSelected] = useState<Retainer | null>(null);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [linkedCases, setLinkedCases] = useState<RetainerCase[]>([]);
  const [caseSummary, setCaseSummary] = useState<RetainerCaseSummary>(emptySummary());
  const [activity, setActivity] = useState<RetainerActivity[]>([]);
  const [form, setForm] = useState<RetainerPayload>(emptyForm());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentNote, setAdjustmentNote] = useState('');
  const [caseToLink, setCaseToLink] = useState('');

  const load = async (keepSelected = true) => {
    setLoading(true);
    setError('');
    try {
      const data = await listRetainers({ status: statusFilter === 'all' ? '' : statusFilter, q: search });
      setRetainers(data);
      if (keepSelected && selected) setSelected(data.find((item) => item._id === selected._id) || null);
    } catch (err: any) {
      setError(err.message || 'Failed to load retainers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(false);
    void getAllCases().then(setCases).catch(() => undefined);
    // Filters deliberately apply when the user presses Apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSelected = async (retainer: Retainer) => {
    setSelected(retainer);
    setCaseToLink('');
    setError('');
    try {
      const [caseData, activityData] = await Promise.all([getRetainerCases(retainer._id), getRetainerActivity(retainer._id)]);
      setLinkedCases(caseData.cases);
      setCaseSummary(caseData.summary);
      setActivity(activityData);
    } catch (err: any) {
      setError(err.message || 'Failed to load retainer details.');
    }
  };

  const totals = useMemo(() => ({
    active: retainers.filter((item) => item.effectiveStatus === 'Active').length,
    contractValue: retainers.reduce((sum, item) => sum + (Number(item.contractValue) || 0), 0),
    cases: retainers.reduce((sum, item) => sum + (Number(item.linkedCaseCount) || 0), 0),
    monthly: retainers.filter((item) => item.billingModel !== 'prepaid').reduce((sum, item) => sum + (Number(item.monthlyFee) || 0), 0),
  }), [retainers]);
  const linkableCases = useMemo(() => cases.filter((caseItem) => !caseItem.retainerId || caseItem.retainerId === selected?._id), [cases, selected]);

  const openCreate = () => {
    setForm(emptyForm());
    setEditingId(null);
    setShowForm(true);
    setError('');
  };
  const openEdit = (retainer = selected) => {
    if (!retainer) return;
    setForm(toForm(retainer));
    setEditingId(retainer._id);
    setShowForm(true);
    setError('');
  };
  const closeForm = () => {
    if (!saving) {
      setShowForm(false);
      setEditingId(null);
    }
  };

  const submitRetainer = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const saved = editingId ? await updateRetainer(editingId, form) : await createRetainer(form);
      setNotice(editingId ? 'Retainer updated.' : 'Retainer created.');
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm());
      await load(false);
      await loadSelected(saved);
    } catch (err: any) {
      setError(err.message || 'Failed to save retainer.');
    } finally {
      setSaving(false);
    }
  };

  const adjustContractValue = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const updated = await adjustRetainerContractValue(selected._id, Number(adjustmentAmount), adjustmentNote);
      setAdjustmentAmount('');
      setAdjustmentNote('');
      setNotice('Retainer contract value adjusted.');
      await load(false);
      await loadSelected(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to adjust retainer contract value.');
    } finally {
      setSaving(false);
    }
  };

  const linkCase = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !caseToLink) return;
    setSaving(true);
    setError('');
    try {
      await setCaseRetainer(caseToLink, selected._id);
      setNotice('Case linked to this retainer subscription.');
      setCases(await getAllCases());
      await load(false);
      await loadSelected({ ...selected });
    } catch (err: any) {
      setError(err.message || 'Failed to link case.');
    } finally {
      setSaving(false);
    }
  };

  const unlinkCase = async (caseId: string) => {
    if (!selected || !window.confirm('Remove this case from the retainer subscription? Its case workflow and financial records will remain unchanged.')) return;
    setSaving(true);
    setError('');
    try {
      await setCaseRetainer(caseId);
      setNotice('Case removed from this retainer subscription.');
      setCases(await getAllCases());
      await load(false);
      await loadSelected({ ...selected });
    } catch (err: any) {
      setError(err.message || 'Failed to remove case.');
    } finally {
      setSaving(false);
    }
  };

  const removeRetainer = async (retainer: Retainer) => {
    if (retainer.status !== 'Draft' || (retainer.linkedCaseCount || 0) > 0) {
      setError('Only a draft retainer with no linked cases can be deleted. Close any active or historical agreement instead.');
      return;
    }
    if (!window.confirm(`Delete draft retainer “${retainer.name}”? This cannot be undone.`)) return;
    setSaving(true);
    setError('');
    try {
      await deleteRetainer(retainer._id);
      if (selected?._id === retainer._id) {
        setSelected(null);
        setLinkedCases([]);
        setCaseSummary(emptySummary());
        setActivity([]);
      }
      setNotice('Draft retainer deleted.');
      await load(false);
    } catch (err: any) {
      setError(err.message || 'Failed to delete retainer.');
    } finally {
      setSaving(false);
    }
  };

  return <>
    <RetainerOverview
      retainers={retainers}
      selected={selected}
      linkedCases={linkedCases}
      caseSummary={caseSummary}
      activity={activity}
      linkableCases={linkableCases}
      totals={totals}
      loading={loading}
      saving={saving}
      error={error}
      notice={notice}
      search={search}
      statusFilter={statusFilter}
      adjustmentAmount={adjustmentAmount}
      adjustmentNote={adjustmentNote}
      caseToLink={caseToLink}
      onSearchChange={setSearch}
      onStatusChange={setStatusFilter}
      onAdjustmentAmountChange={setAdjustmentAmount}
      onAdjustmentNoteChange={setAdjustmentNote}
      onCaseToLinkChange={setCaseToLink}
      onApply={() => void load(false)}
      onSelect={(retainer) => void loadSelected(retainer)}
      onCreate={openCreate}
      onEdit={openEdit}
      onDelete={removeRetainer}
      onAdjustContractValue={adjustContractValue}
      onLinkCase={linkCase}
      onUnlink={unlinkCase}
    />
    {showForm && <RetainerFormDialog form={form} setForm={setForm} editing={Boolean(editingId)} saving={saving} onClose={closeForm} onSubmit={submitRetainer} />}
  </>;
}

function RetainerOverview({
  retainers, selected, linkedCases, caseSummary, activity, linkableCases, totals, loading, saving, error, notice, search, statusFilter, adjustmentAmount, adjustmentNote, caseToLink,
  onSearchChange, onStatusChange, onAdjustmentAmountChange, onAdjustmentNoteChange, onCaseToLinkChange, onApply, onSelect, onCreate, onEdit, onDelete, onAdjustContractValue, onLinkCase, onUnlink,
}: {
  retainers: Retainer[];
  selected: Retainer | null;
  linkedCases: RetainerCase[];
  caseSummary: RetainerCaseSummary;
  activity: RetainerActivity[];
  linkableCases: CaseData[];
  totals: { active: number; contractValue: number; cases: number; monthly: number };
  loading: boolean;
  saving: boolean;
  error: string;
  notice: string;
  search: string;
  statusFilter: string;
  adjustmentAmount: string;
  adjustmentNote: string;
  caseToLink: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onAdjustmentAmountChange: (value: string) => void;
  onAdjustmentNoteChange: (value: string) => void;
  onCaseToLinkChange: (value: string) => void;
  onApply: () => void;
  onSelect: (retainer: Retainer) => void;
  onCreate: () => void;
  onEdit: (retainer?: Retainer | null) => void;
  onDelete: (retainer: Retainer) => void;
  onAdjustContractValue: (event: FormEvent) => void;
  onLinkCase: (event: FormEvent) => void;
  onUnlink: (caseId: string) => void;
}) {
  const isSubscription = selected?.billingModel === 'prepaid' || selected?.billingModel === 'hybrid';

  return <div className="retainer-page">
    <header className="retainer-page-header">
      <div><span className="retainer-page-eyebrow">Matter finance</span><h1>Retainers</h1><p>Manage client subscriptions and track the normal cases, billing, collections, and profitability under each agreement.</p></div>
      <button type="button" onClick={onCreate} className="retainer-primary-action"><Plus className="h-4 w-4" /> New retainer</button>
    </header>

    {(error || notice) && <div className={`retainer-page-alert ${error ? 'is-error' : 'is-success'}`}>{error || notice}</div>}

    <section className="retainer-overview-grid" aria-label="Retainer overview">
      <OverviewMetric icon={<BriefcaseBusiness />} label="Active retainers" value={String(totals.active)} helper="Active agreements available for new cases" />
      <OverviewMetric icon={<Wallet />} label="Contract value" value={money(totals.contractValue)} helper="Value across subscription-based agreements" />
      <OverviewMetric icon={<ClipboardList />} label="Cases under retainers" value={String(totals.cases)} helper="Cases continue through the normal lifecycle" />
      <OverviewMetric icon={<CalendarDays />} label="Monthly service fees" value={money(totals.monthly)} helper="Recurring fees across current agreements" />
    </section>

    <div className="retainer-page-workspace">
      <section className="retainer-portfolio-card">
        <div className="retainer-portfolio-header"><div><h2>Retainer portfolio</h2><p>Select a retainer to review its cases and financial performance.</p></div></div>
        <div className="retainer-filter-bar">
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search client, agreement or reference" className="retainer-page-input" />
          <select value={statusFilter} onChange={(event) => onStatusChange(event.target.value)} className="retainer-page-input retainer-filter-select"><option value="all">All statuses</option><option value="Active">Active</option><option value="Draft">Draft</option><option value="Paused">Paused</option><option value="Closed">Closed</option></select>
          <button type="button" onClick={onApply} className="retainer-filter-button"><RefreshCw className="h-4 w-4" /> Apply</button>
        </div>
        <div className="retainer-table-wrap">
          <table className="retainer-table">
            <thead><tr><th>#</th><th>Agreement / client</th><th>Billing model</th><th>Status</th><th>Cases</th><th>Term</th><th>Actions</th></tr></thead>
            <tbody>{loading ? <tr><td colSpan={7} className="retainer-table-message">Loading retainers…</td></tr> : retainers.length === 0 ? <tr><td colSpan={7} className="retainer-table-message">No retainers match this view. Create a client agreement to begin.</td></tr> : retainers.map((retainer, index) => { const canDelete = retainer.status === 'Draft' && (retainer.linkedCaseCount || 0) === 0; return <tr key={retainer._id} tabIndex={0} onClick={() => onSelect(retainer)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(retainer); } }} className={selected?._id === retainer._id ? 'is-selected' : ''}><td className="retainer-row-number">{index + 1}</td><td><strong>{retainer.name}</strong><span>{retainer.clientName} · {retainer.retainerNo}</span></td><td><span>{labelForModel(retainer.billingModel)}</span>{retainer.billingModel !== 'monthly' ? <small>Contract value {money(retainer.contractValue)}</small> : <small>{money(retainer.monthlyFee)} monthly</small>}</td><td><StatusBadge status={retainer.effectiveStatus} /></td><td><strong>{retainer.linkedCaseCount || 0}</strong><span>linked case{retainer.linkedCaseCount === 1 ? '' : 's'}</span></td><td><span>{retainer.startDate}</span><small>{retainer.endDate ? `Ends ${retainer.endDate}` : 'Open-ended'}</small></td><td><div className="retainer-row-actions"><button type="button" onClick={(event) => { event.stopPropagation(); onEdit(retainer); }} title="Edit retainer" aria-label={`Edit ${retainer.name}`}><Pencil /></button><button type="button" disabled={!canDelete || saving} onClick={(event) => { event.stopPropagation(); onDelete(retainer); }} title={canDelete ? 'Delete draft retainer' : 'Only an unused draft retainer can be deleted'} aria-label={`Delete ${retainer.name}`}><Trash2 /></button></div></td></tr>; })}</tbody>
          </table>
        </div>
      </section>

      <aside className="retainer-detail-card">
        {!selected ? <div className="retainer-empty-state"><ClipboardList /><h2>Choose a retainer</h2><p>Select an agreement to see its cases, case contract values, billing, collections, and profit.</p></div> : <>
          <div className="retainer-detail-header"><div><span>{selected.retainerNo}</span><h2>{selected.name}</h2><p>{selected.clientName}</p></div><button type="button" onClick={onEdit} className="retainer-edit-button">Edit</button></div>
          <div className="retainer-detail-metrics"><DetailMetric label="Contract value" value={isSubscription ? money(selected.contractValue) : 'N/A'} /><DetailMetric label="Cases" value={String(caseSummary.caseCount)} /><DetailMetric label="Total billed" value={money(caseSummary.totalBilled)} /><DetailMetric label="Total collected" value={money(caseSummary.totalCollected)} /></div>
          {selected.scope && <div className="retainer-scope"><strong>Included scope</strong><p>{selected.scope}</p></div>}

          <section className="retainer-detail-section retainer-financial-summary"><h3>Case financial summary</h3><div className="retainer-case-summary-grid"><DetailMetric label="Case contract value" value={money(caseSummary.contractValue)} /><DetailMetric label="Outstanding" value={money(caseSummary.outstanding)} /><DetailMetric label="Direct case costs" value={money(caseSummary.directMatterCosts)} /><DetailMetric label="Gross result" value={money(Math.abs(caseSummary.grossProfit))} tone={caseSummary.grossProfit > 0 ? 'profit' : caseSummary.grossProfit < 0 ? 'loss' : 'neutral'} /></div><p className="retainer-summary-note">{caseSummary.profitableCases} profitable case{caseSummary.profitableCases === 1 ? '' : 's'} · {caseSummary.lossMakingCases} loss-making case{caseSummary.lossMakingCases === 1 ? '' : 's'}. Billing and collections can exceed the retainer contract value because every case keeps its own financial records.</p></section>

          {isSubscription && <form onSubmit={onAdjustContractValue} className="retainer-action-panel"><h3>Adjust contract value</h3><p>Record an approved increase to this subscription’s contract value. It remains shared across all linked cases.</p><div className="retainer-inline-fields"><input required min="1" inputMode="numeric" type="number" value={adjustmentAmount} onChange={(event) => onAdjustmentAmountChange(event.target.value)} placeholder="Additional value (RWF)" className="retainer-page-input" /><button disabled={saving} className="retainer-action-button">Adjust value</button></div><input value={adjustmentNote} onChange={(event) => onAdjustmentNoteChange(event.target.value)} placeholder="Amendment or reference (optional)" className="retainer-page-input" /></form>}

          <form onSubmit={onLinkCase} className="retainer-action-panel retainer-link-panel"><h3>Link an existing case</h3><p>The case keeps its own contract value, invoices, collections, and normal workflow.</p><select required value={caseToLink} onChange={(event) => onCaseToLinkChange(event.target.value)} className="retainer-page-input"><option value="">Choose a case…</option>{linkableCases.map((caseItem) => <option key={caseItem._id} value={caseItem._id}>{caseItem.caseNo} — {caseItem.parties}</option>)}</select><button disabled={saving || !caseToLink} className="retainer-action-button">Link case</button></form>

          <section className="retainer-detail-section"><h3>Case performance <span>{linkedCases.length}</span></h3>{linkedCases.length === 0 ? <p className="retainer-muted-copy">No cases are linked yet.</p> : <div className="retainer-case-performance"><table><thead><tr><th>Case</th><th>Contract value</th><th>Billed</th><th>Collected</th><th>Result</th><th aria-label="Case action" /></tr></thead><tbody>{linkedCases.map((caseItem) => <tr key={caseItem._id}><td><Link to={`/cases/${caseItem._id}`}><strong>{caseItem.caseNo}</strong><span>{caseItem.parties}</span><small>{caseItem.status}</small></Link></td><td>{money(caseItem.contractValue)}</td><td>{money(caseItem.totalBilled)}</td><td>{money(caseItem.totalCollected)}</td><td><span className={`retainer-profit-badge is-${caseItem.profitStatus.toLowerCase().replace('-', '')}`}>{caseItem.profitStatus === 'Loss' ? `Loss ${money(Math.abs(caseItem.grossProfit))}` : caseItem.profitStatus === 'Profitable' ? `Profit ${money(caseItem.grossProfit)}` : 'Break-even'}</span></td><td><button type="button" onClick={() => onUnlink(caseItem._id)}>Unlink</button></td></tr>)}</tbody></table></div>}</section>

          <section className="retainer-detail-section"><h3>Recent activity</h3>{activity.length === 0 ? <p className="retainer-muted-copy">No retainer activity yet.</p> : <div className="retainer-activity-list">{activity.map((item) => <div key={item._id}><div><strong>{activityLabel(item.type)}</strong><span>{new Date(item.createdAt).toLocaleDateString()}</span></div><b>{item.amount ? money(item.amount) : '—'}</b><small>{item.note || `Contract value after: ${money(item.balanceAfter)}`}</small></div>)}</div>}</section>
        </>}
      </aside>
    </div>
  </div>;
}

function OverviewMetric({ icon, label, value, helper }: { icon: ReactNode; label: string; value: string; helper: string }) {
  return <article className="retainer-overview-metric"><div>{icon}<span>{label}</span></div><strong>{value}</strong><small>{helper}</small></article>;
}

function DetailMetric({ label, value, tone }: { label: string; value: string; tone?: 'profit' | 'loss' | 'neutral' }) {
  return <div className={tone ? `is-${tone}` : ''}><span>{label}</span><strong>{tone === 'loss' ? `Loss ${value}` : tone === 'profit' ? `Profit ${value}` : value}</strong></div>;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = { Active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200', Draft: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200', Paused: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100', Closed: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-100', Expired: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${styles[status] || styles.Draft}`}>{status}</span>;
}

const labelForModel = (model: Retainer['billingModel']) => model === 'prepaid' ? 'Subscription contract' : model === 'monthly' ? 'Monthly service agreement' : 'Hybrid agreement';
const activityLabel = (type: RetainerActivity['type']) => ({ CONTRACT_VALUE_SET: 'Contract value set', CONTRACT_VALUE_ADJUSTED: 'Contract value adjusted', CASE_LINKED: 'Case linked', CASE_UNLINKED: 'Case unlinked', OPENING_BALANCE: 'Initial contract value', TOP_UP: 'Contract value adjustment', CASE_RESERVED: 'Historic case allocation', CASE_RELEASED: 'Historic allocation released', ADJUSTMENT: 'Contract adjustment' }[type] || 'Retainer activity');

function RetainerFormDialog({ form, setForm, editing, saving, onClose, onSubmit }: { form: RetainerPayload; setForm: Dispatch<SetStateAction<RetainerPayload>>; editing: boolean; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
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
  return <button type="button" role="radio" aria-checked={selected} onClick={() => onSelect(value)} className={`retainer-model-option ${selected ? 'is-selected' : ''}`}><span className="retainer-model-indicator" aria-hidden="true" /><span><strong>{title}</strong><small>{description}</small></span></button>;
}

function RetainerFormField({ label, children, required = false, hint, wide = false }: { label: string; children: ReactNode; required?: boolean; hint?: string; wide?: boolean }) {
  return <label className={`retainer-form-field ${wide ? 'is-wide' : ''}`}><span className="retainer-form-label">{label}{required && <em> *</em>}</span>{children}{hint && <small className="retainer-form-hint">{hint}</small>}</label>;
}
