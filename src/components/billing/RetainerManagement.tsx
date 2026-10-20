import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BriefcaseBusiness, CalendarDays, ClipboardList, Pencil, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react';
import {
  createRetainer,
  deleteRetainer,
  listRetainers,
  Retainer,
  RetainerPayload,
  updateRetainer,
} from '../../services/retainerService';
import { RetainerFormDialog } from './RetainerFormDialog';

const money = (value?: number) => `RWF ${Number(value || 0).toLocaleString()}`;
const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): RetainerPayload => ({
  name: '',
  clientName: '',
  billingModel: 'prepaid',
  status: 'Draft',
  startDate: today(),
  endDate: '',
  renewalDate: '',
  contractValue: 0,
  monthlyFee: 0,
  billingDay: 1,
  scope: '',
  responsiblePartner: '',
  notes: '',
});

const toForm = (retainer: Retainer): RetainerPayload => ({
  name: retainer.name,
  clientName: retainer.clientName,
  billingModel: retainer.billingModel,
  status: retainer.status,
  startDate: retainer.startDate?.slice(0, 10) || today(),
  endDate: retainer.endDate?.slice(0, 10) || '',
  renewalDate: retainer.renewalDate?.slice(0, 10) || '',
  monthlyFee: retainer.monthlyFee || 0,
  billingDay: retainer.billingDay || 1,
  scope: retainer.scope || '',
  responsiblePartner: retainer.responsiblePartner || '',
  notes: retainer.notes || '',
});

const billingModelLabel = (model: Retainer['billingModel']) => ({
  prepaid: 'Subscription contract',
  monthly: 'Monthly agreement',
  hybrid: 'Hybrid agreement',
}[model]);

function StatusBadge({ status }: { status: string }) {
  return <span className={`retainer-status-badge is-${status.toLowerCase().replace(/\s+/g, '-')}`}>{status}</span>;
}

export default function RetainerManagement() {
  const navigate = useNavigate();
  const [retainers, setRetainers] = useState<Retainer[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RetainerPayload>(emptyForm());

  const loadRetainers = async () => {
    setLoading(true);
    setError('');
    try {
      setRetainers(await listRetainers({ q: search.trim() || undefined, status: status || undefined }));
    } catch (loadError: any) {
      setError(loadError.message || 'Unable to load retainers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRetainers();
  }, []);

  const overview = useMemo(() => ({
    active: retainers.filter((retainer) => retainer.effectiveStatus === 'Active').length,
    contractValue: retainers.reduce((total, retainer) => total + Number(retainer.contractValue || 0), 0),
    cases: retainers.reduce((total, retainer) => total + Number(retainer.linkedCaseCount || 0), 0),
    monthly: retainers.reduce((total, retainer) => total + Number(retainer.monthlyFee || 0), 0),
  }), [retainers]);

  const openCreate = () => {
    setError('');
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (retainer: Retainer) => {
    setError('');
    setEditingId(retainer._id);
    setForm(toForm(retainer));
    setShowForm(true);
  };

  const closeForm = () => {
    if (saving) return;
    setShowForm(false);
    setEditingId(null);
  };

  const saveRetainer = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const saved = editingId
        ? await updateRetainer(editingId, form)
        : await createRetainer(form);
      setShowForm(false);
      setEditingId(null);
      setNotice(editingId ? 'Retainer updated successfully.' : 'Retainer created successfully.');
      await loadRetainers();
      if (!editingId) navigate(`/matters/retainers/${saved._id}`);
    } catch (saveError: any) {
      setError(saveError.message || 'Unable to save retainer.');
    } finally {
      setSaving(false);
    }
  };

  const removeRetainer = async (retainer: Retainer) => {
    if (retainer.linkedCaseCount) {
      setError('Unlink all cases before deleting this retainer.');
      return;
    }
    if (!window.confirm(`Delete retainer "${retainer.name}"? This cannot be undone.`)) return;
    setSaving(true);
    setError('');
    try {
      await deleteRetainer(retainer._id);
      setNotice('Retainer deleted successfully.');
      await loadRetainers();
    } catch (deleteError: any) {
      setError(deleteError.message || 'Unable to delete retainer.');
    } finally {
      setSaving(false);
    }
  };

  const openRetainer = (retainerId: string) => navigate(`/matters/retainers/${retainerId}`);

  return (
    <>
      <div className="retainer-page">
        <header className="retainer-page-header">
          <div>
            <span className="retainer-page-eyebrow">Matters</span>
            <h1>Retainer portfolio</h1>
            <p>Manage client agreements and open a retainer to review its cases, contract value, and financial progress.</p>
          </div>
          <button type="button" className="retainer-primary-action" onClick={openCreate}><Plus /> New retainer</button>
        </header>

        {(error || notice) && <div className={`retainer-page-alert ${error ? 'is-error' : 'is-success'}`}>{error || notice}</div>}

        <section className="retainer-overview-grid" aria-label="Retainer portfolio summary">
          <OverviewMetric icon={<BriefcaseBusiness />} label="Active agreements" value={overview.active} description="Agreements currently available to cases" />
          <OverviewMetric icon={<Wallet />} label="Contract value" value={money(overview.contractValue)} description="Combined shared subscription value" />
          <OverviewMetric icon={<ClipboardList />} label="Linked cases" value={overview.cases} description="Cases following normal case workflow" />
          <OverviewMetric icon={<CalendarDays />} label="Monthly service fees" value={money(overview.monthly)} description="Recurring fees across agreements" />
        </section>

        <section className="retainer-portfolio-card retainer-portfolio-card-full">
          <div className="retainer-portfolio-header">
            <h2>All retainers</h2>
            <p>Select any row or use Open to manage that agreement without crowding this portfolio.</p>
          </div>
          <form className="retainer-filter-bar" onSubmit={(event) => { event.preventDefault(); loadRetainers(); }}>
            <input className="retainer-page-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search agreement or client" aria-label="Search retainers" />
            <select className="retainer-page-input" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter retainers by status">
              <option value="">All statuses</option>
              <option value="Draft">Draft</option>
              <option value="Active">Active</option>
              <option value="Paused">Paused</option>
              <option value="Closed">Closed</option>
              <option value="Expired">Expired</option>
            </select>
            <button type="submit" className="retainer-filter-button" disabled={loading}><RefreshCw /> Refresh</button>
          </form>

          <div className="retainer-table-wrap">
            <table className="retainer-table">
              <thead><tr><th>#</th><th>Agreement / client</th><th>Billing model</th><th>Status</th><th>Cases</th><th>Term</th><th>Open</th><th>Actions</th></tr></thead>
              <tbody>
                {loading ? <tr className="retainer-table-message"><td colSpan={8}>Loading retainers...</td></tr> : retainers.length === 0 ? <tr className="retainer-table-message"><td colSpan={8}>No retainers found. Create one when a client agreement is approved.</td></tr> : retainers.map((retainer, index) => (
                  <tr key={retainer._id} onClick={() => openRetainer(retainer._id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openRetainer(retainer._id); } }} tabIndex={0} aria-label={`Open ${retainer.name}`}>
                    <td className="retainer-row-number">{index + 1}</td>
                    <td><strong>{retainer.name}</strong><span>{retainer.clientName}</span><small>{retainer.retainerNo}</small></td>
                    <td><strong>{billingModelLabel(retainer.billingModel)}</strong><small>{retainer.billingModel === 'monthly' ? `${money(retainer.monthlyFee)} / month` : `Contract value ${money(retainer.contractValue)}`}</small></td>
                    <td><StatusBadge status={retainer.effectiveStatus} /></td>
                    <td><strong>{retainer.linkedCaseCount || 0}</strong><small>linked case{retainer.linkedCaseCount === 1 ? '' : 's'}</small></td>
                    <td><strong>{retainer.startDate ? new Date(retainer.startDate).toLocaleDateString() : 'Not set'}</strong><small>{retainer.endDate ? `Ends ${new Date(retainer.endDate).toLocaleDateString()}` : 'Open-ended'}</small></td>
                    <td><button type="button" className="retainer-open-action" onClick={(event) => { event.stopPropagation(); openRetainer(retainer._id); }}>Open <ArrowRight /></button></td>
                    <td><div className="retainer-row-actions"><button type="button" title="Edit retainer" aria-label={`Edit ${retainer.name}`} onClick={(event) => { event.stopPropagation(); openEdit(retainer); }}><Pencil /></button><button type="button" title={retainer.linkedCaseCount ? 'Unlink cases before deleting' : 'Delete retainer'} aria-label={`Delete ${retainer.name}`} disabled={Boolean(retainer.linkedCaseCount) || saving} onClick={(event) => { event.stopPropagation(); removeRetainer(retainer); }}><Trash2 /></button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showForm && <RetainerFormDialog form={form} setForm={setForm} editing={Boolean(editingId)} saving={saving} onClose={closeForm} onSubmit={saveRetainer} />}
    </>
  );
}

function OverviewMetric({ icon, label, value, description }: { icon: ReactNode; label: string; value: string | number; description: string }) {
  return <article className="retainer-overview-metric"><div>{icon}{label}</div><strong>{value}</strong><small>{description}</small></article>;
}
