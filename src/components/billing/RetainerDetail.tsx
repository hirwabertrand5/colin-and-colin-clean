import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { CaseData, getAllCases } from '../../services/caseService';
import {
  getRetainer,
  getRetainerActivity,
  getRetainerCases,
  Retainer,
  RetainerActivity,
  RetainerCase,
  RetainerPayload,
  setCaseRetainer,
  updateRetainer,
} from '../../services/retainerService';
import { RetainerFormDialog } from './RetainerFormDialog';
import { RetainerMonthlyStatement } from './RetainerMonthlyStatement';

const money = (value?: number) => `RWF ${Number(value || 0).toLocaleString()}`;
const today = () => new Date().toISOString().slice(0, 10);

const toForm = (retainer: Retainer): RetainerPayload => ({
  name: retainer.name,
  clientName: retainer.clientName,
  billingModel: 'monthly',
  status: retainer.status,
  startDate: retainer.startDate?.slice(0, 10) || today(),
  endDate: retainer.endDate?.slice(0, 10) || '',
  renewalDate: retainer.renewalDate?.slice(0, 10) || '',
  monthlyFee: retainer.monthlyFee || 0,
  billingDay: retainer.billingDay || 1,
  scope: retainer.scope || '',
  responsiblePartner: retainer.responsiblePartner || '',
  notes: retainer.notes || '',
  excludedServices: retainer.excludedServices || '',
  additionalWorkChargeable: retainer.additionalWorkChargeable || false,
  scopeApprovalRequired: retainer.scopeApprovalRequired !== false,
  utilisationThreshold: retainer.utilisationThreshold || 150,
});

const activityLabel = (type: RetainerActivity['type']) => ({
  CONTRACT_VALUE_SET: 'Initial contract value',
  CONTRACT_VALUE_ADJUSTED: 'Contract value adjusted',
  CASE_LINKED: 'Case linked',
  CASE_UNLINKED: 'Case unlinked',
  OPENING_BALANCE: 'Initial contract value',
  TOP_UP: 'Contract value adjusted',
  CASE_RESERVED: 'Historic case allocation',
  CASE_RELEASED: 'Historic allocation released',
  ADJUSTMENT: 'Adjustment',
}[type]);

function StatusBadge({ status }: { status: string }) {
  return <span className={`retainer-status-badge is-${status.toLowerCase().replace(/\s+/g, '-')}`}>{status}</span>;
}

export default function RetainerDetail() {
  const { retainerId = '' } = useParams();
  const [retainer, setRetainer] = useState<Retainer | null>(null);
  const [linkedCases, setLinkedCases] = useState<RetainerCase[]>([]);
  const [activity, setActivity] = useState<RetainerActivity[]>([]);
  const [allCases, setAllCases] = useState<CaseData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RetainerPayload | null>(null);
  const [caseSearch, setCaseSearch] = useState('');
  const [caseToLink, setCaseToLink] = useState('');
  const [showLinkForm, setShowLinkForm] = useState(false);

  const load = async () => {
    if (!retainerId) return;
    setLoading(true);
    setError('');
    try {
      const [retainerData, caseData, activityData, cases] = await Promise.all([
        getRetainer(retainerId),
        getRetainerCases(retainerId),
        getRetainerActivity(retainerId),
        getAllCases(),
      ]);
      setRetainer(retainerData);
      setLinkedCases(caseData.cases);
      setActivity(activityData);
      setAllCases(cases);
    } catch (loadError: any) {
      setError(loadError.message || 'Unable to load this retainer.');
      setRetainer(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [retainerId]);

  const linkableCases = useMemo(() => {
    const query = caseSearch.trim().toLowerCase();
    if (query.length < 2) return [];
    return allCases
      .filter((caseData) => !caseData.retainerId && !linkedCases.some((linked) => linked._id === caseData._id))
      .filter((caseData) => `${caseData.caseNo} ${caseData.parties}`.toLowerCase().includes(query))
      .slice(0, 25);
  }, [allCases, caseSearch, linkedCases]);

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!retainer || !form) return;
    setSaving(true);
    setError('');
    try {
      await updateRetainer(retainer._id, form);
      setNotice('Retainer updated successfully.');
      setShowForm(false);
      await load();
    } catch (saveError: any) {
      setError(saveError.message || 'Unable to update retainer.');
    } finally {
      setSaving(false);
    }
  };

  const linkCase = async (event: FormEvent) => {
    event.preventDefault();
    if (!caseToLink || !retainer) return;
    setSaving(true);
    setError('');
    try {
      await setCaseRetainer(caseToLink, retainer._id);
      setCaseToLink('');
      setCaseSearch('');
      setShowLinkForm(false);
      setNotice('Matter linked. Record approved workflow tasks in the Monthly Retainer Statement.');
      await load();
    } catch (linkError: any) {
      setError(linkError.message || 'Unable to link the case.');
    } finally {
      setSaving(false);
    }
  };

  const unlinkCase = async (caseData: RetainerCase) => {
    if (!window.confirm(`Unlink ${caseData.caseNo} from this retainer?`)) return;
    setSaving(true);
    setError('');
    try {
      await setCaseRetainer(caseData._id);
      setNotice('Case unlinked from this retainer.');
      await load();
    } catch (unlinkError: any) {
      setError(unlinkError.message || 'Unable to unlink the case.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !retainer) {
    return <div className="retainer-detail-page"><p className="retainer-loading-copy">Loading retainer...</p></div>;
  }

  if (!retainer) {
    return <div className="retainer-detail-page"><Link to="/matters/retainers" className="retainer-back-link"><ArrowLeft /> Retainer clients</Link><div className="retainer-page-alert is-error">{error || 'This retainer could not be found.'}</div></div>;
  }

  return (
    <>
      <div className="retainer-detail-page">
        <Link to="/matters/retainers" className="retainer-back-link"><ArrowLeft /> Retainer clients</Link>
        <header className="retainer-detail-page-header">
          <div>
            <span className="retainer-page-eyebrow">{retainer.retainerNo}</span>
            <h1>{retainer.name}</h1>
            <p>{retainer.clientName} · Fixed monthly fee: {retainer.monthlyFee > 0 ? money(retainer.monthlyFee) : 'Set the fee in Edit agreement'}</p>
          </div>
          <div className="retainer-detail-header-actions"><StatusBadge status={retainer.effectiveStatus} /><button type="button" className="retainer-edit-button" onClick={() => { setForm(toForm(retainer)); setShowForm(true); }}><Pencil /> Edit agreement</button></div>
        </header>

        {(error || notice) && <div role={error ? 'alert' : 'status'} className={`retainer-page-alert ${error ? 'is-error' : 'is-success'}`}>{error || notice}</div>}

        <RetainerMonthlyStatement retainer={retainer} linkedCases={linkedCases} />

        <section className="retainer-accounting retainer-linked-matters" aria-label="Linked matters">
          <div className="ra-section-heading"><div><h2>Linked matters <span className="ra-section-count">{linkedCases.length}</span></h2><p>Matters covered by this agreement. Monthly work and earnings appear in the statement above.</p></div><button type="button" aria-expanded={showLinkForm} aria-controls="retainer-link-form" onClick={() => setShowLinkForm((current) => !current)}><Plus size={16} /> {showLinkForm ? 'Hide matter search' : 'Link a matter'}</button></div>
          {showLinkForm && <form id="retainer-link-form" className="ra-entry-form" onSubmit={linkCase}>
            <label className="ra-wide">Find a matter<input value={caseSearch} onChange={(event) => { setCaseSearch(event.target.value); setCaseToLink(''); }} placeholder="Search by case number or party name" autoFocus /></label>
            {caseSearch.trim().length < 2 ? <p>Type at least two characters to search available matters.</p> : <label className="ra-wide">Matching matters<select required value={caseToLink} onChange={(event) => setCaseToLink(event.target.value)}><option value="">{linkableCases.length ? 'Select a matter to link' : 'No available matching matters'}</option>{linkableCases.map((caseData) => <option key={caseData._id} value={caseData._id}>{caseData.caseNo && caseData.caseNo !== 'N/A' ? `${caseData.caseNo} — ` : ''}{caseData.parties}</option>)}</select></label>}
            <div className="ra-form-actions ra-wide"><button type="button" disabled={saving} onClick={() => setShowLinkForm(false)}>Cancel</button><button disabled={saving || !caseToLink}>{saving ? 'Linking…' : 'Link matter'}</button></div>
          </form>}
          {linkedCases.length === 0 ? <div className="ra-summary-empty">No matters linked yet. Use “Link a matter” to add the cases covered by this agreement.</div> : <div className="ra-table-wrap"><table><thead><tr><th scope="col">Matter</th><th scope="col">Department</th><th scope="col">Status</th><th scope="col"><span className="ra-sr-only">Actions</span></th></tr></thead><tbody>{linkedCases.map((caseData) => <tr key={caseData._id}><td><Link to={`/cases/${caseData._id}`} className="ra-matter-name">{caseData.parties || 'View matter'}</Link>{caseData.caseNo && caseData.caseNo !== 'N/A' && <small>{caseData.caseNo}</small>}</td><td>{caseData.department || 'Department required'}</td><td><span className="ra-status">{caseData.status}</span></td><td className="ra-number"><button type="button" aria-label={`Unlink ${caseData.parties || caseData.caseNo}`} onClick={() => unlinkCase(caseData)} disabled={saving}>Unlink</button></td></tr>)}</tbody></table></div>}
        </section>

        <section className="retainer-accounting retainer-supporting-details" aria-label="Agreement details and activity">
          <details className="ra-register"><summary>Agreement details</summary><dl className="ra-agreement-grid">
            <div><dt>Services covered</dt><dd>{retainer.scope || 'Not specified'}</dd></div>
            <div><dt>Services excluded</dt><dd>{retainer.excludedServices || 'Not specified'}</dd></div>
            <div><dt>Agreement term</dt><dd>{retainer.startDate.slice(0, 10)}{retainer.endDate ? ` to ${retainer.endDate.slice(0, 10)}` : ' · Ongoing'}</dd></div>
            <div><dt>Responsible partner</dt><dd>{retainer.responsiblePartner || 'Not assigned'}</dd></div>
            <div><dt>Additional work</dt><dd>{retainer.additionalWorkChargeable ? 'Separately chargeable under the agreement' : 'No separate charges under the agreement'}<small>Excess work does not create invoices automatically.</small></dd></div>
            <div><dt>Scope controls</dt><dd>{retainer.scopeApprovalRequired !== false ? 'Approval required for work outside scope' : 'No scope approval required'}<small>Management alert above {retainer.utilisationThreshold || 150}% utilisation.</small></dd></div>
            {retainer.notes && <div><dt>Notes</dt><dd>{retainer.notes}</dd></div>}
          </dl></details>
          <details className="ra-register"><summary>Recent activity <span>{activity.length} entries</span></summary>
            {activity.length === 0 ? <p>No activity has been recorded yet.</p> : <div className="retainer-activity-list">{activity.slice(0, 8).map((item) => <div key={item._id}><strong>{activityLabel(item.type)}</strong><span>{new Date(item.createdAt).toLocaleDateString()}</span><b>{item.amount ? money(item.amount) : '—'}</b><small>{item.note || (item.case ? `${item.case.caseNo} — ${item.case.parties}` : 'Retainer agreement updated.')}</small></div>)}</div>}
          </details>
        </section>
      </div>

      {showForm && form && <RetainerFormDialog form={form} setForm={(updater) => setForm((current) => {
        if (!current) return current;
        return typeof updater === 'function' ? updater(current) : updater;
      })} editing saving={saving} onClose={() => { if (!saving) setShowForm(false); }} onSubmit={saveEdit} />}
    </>
  );
}
