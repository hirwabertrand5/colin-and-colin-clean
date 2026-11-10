import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import { CaseData, getAllCases } from '../../services/caseService';
import {
  getRetainer,
  getRetainerActivity,
  getRetainerCases,
  Retainer,
  RetainerActivity,
  RetainerCase,
  RetainerCaseSummary,
  RetainerPayload,
  setCaseRetainer,
  updateRetainer,
} from '../../services/retainerService';
import { RetainerFormDialog } from './RetainerFormDialog';
import { RetainerMonthlyStatement } from './RetainerMonthlyStatement';

const money = (value?: number) => `RWF ${Number(value || 0).toLocaleString()}`;
const today = () => new Date().toISOString().slice(0, 10);

const emptySummary: RetainerCaseSummary = {
  caseCount: 0,
  contractValue: 0,
  totalBilled: 0,
  totalCollected: 0,
  outstanding: 0,
  directMatterCosts: 0,
  grossProfit: 0,
  profitableCases: 0,
  lossMakingCases: 0,
};

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
  const [summary, setSummary] = useState<RetainerCaseSummary>(emptySummary);
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
      setSummary(caseData.summary || emptySummary);
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
      .filter((caseData) => !caseData.retainerId || caseData.retainerId === retainerId)
      .filter((caseData) => `${caseData.caseNo} ${caseData.parties}`.toLowerCase().includes(query))
      .slice(0, 25);
  }, [allCases, caseSearch, retainerId]);

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

  const profitClass = summary.grossProfit > 0 ? 'is-profit' : summary.grossProfit < 0 ? 'is-loss' : '';

  return (
    <>
      <div className="retainer-detail-page">
        <Link to="/matters/retainers" className="retainer-back-link"><ArrowLeft /> Retainer clients</Link>
        <header className="retainer-detail-page-header">
          <div>
            <span className="retainer-page-eyebrow">{retainer.retainerNo}</span>
            <h1>{retainer.name}</h1>
            <p>{retainer.clientName} · Fixed monthly fee: {retainer.monthlyFee > 0 ? money(retainer.monthlyFee) : 'Record the fixed monthly fee in the retainer agreement'}</p>
          </div>
          <div className="retainer-detail-header-actions"><StatusBadge status={retainer.effectiveStatus} /><button type="button" className="retainer-edit-button" onClick={() => { setForm(toForm(retainer)); setShowForm(true); }}><Pencil /> Edit agreement</button></div>
        </header>

        {(error || notice) && <div className={`retainer-page-alert ${error ? 'is-error' : 'is-success'}`}>{error || notice}</div>}

        {retainer.monthlyFee > 0 && <RetainerMonthlyStatement retainer={retainer} onAccountingChange={async () => { const financials = await getRetainerCases(retainer._id); setLinkedCases(financials.cases); setSummary(financials.summary || emptySummary); }} />}
        <section className="retainer-detail-card retainer-detail-overview">
          <div className="retainer-detail-metrics">
            <DetailMetric label="Fixed monthly fee" value={retainer.monthlyFee > 0 ? money(retainer.monthlyFee) : 'Fixed monthly fee required'} />
            <DetailMetric label="Number of matters handled" value={summary.caseCount} />

          </div>
          {retainer.scope && <div className="retainer-scope"><strong>Services covered</strong><p>{retainer.scope}</p></div>}
        </section>

        <div className="retainer-detail-layout">
          <main className="retainer-detail-card retainer-detail-main">
            <section className="retainer-financial-summary">
              <h2>Matters and services</h2>
              <p>The ordinary professional value of work performed and departmental revenue allocation are recorded separately. Actual revenue received is recorded once in the Monthly Retainer Statement.</p>
              <div className="retainer-case-summary-grid">
                <SummaryMetric label="Ordinary professional value of work performed" value={money(summary.ordinaryWorkValue)} />
                <SummaryMetric label="Outstanding" value={money(summary.outstanding)} />
                <SummaryMetric label="Direct case costs" value={money(summary.directMatterCosts)} />
                <SummaryMetric label="Revenue credit" value={money(summary.totalCollected)} />
              </div>
              <p className="retainer-summary-note">The fixed monthly fee and unutilised retainer revenue are shown in the Monthly Retainer Statement. Additional fees depend on the retainer agreement.</p>
            </section>

            <section className="retainer-detail-section">
              <h2>Matters handled <span>{linkedCases.length}</span></h2>
              {linkedCases.length === 0 ? <p className="retainer-muted-copy">No cases are linked yet. Use the panel on the right to find and link a case.</p> : <div className="retainer-case-performance"><table><thead><tr><th>Matter</th><th>Department</th><th>Ordinary professional value of work performed</th><th>Billed</th><th>Revenue credit</th><th>Costs</th><th>Result</th><th /></tr></thead><tbody>{linkedCases.map((caseData) => <tr key={caseData._id}><td><Link to={`/cases/${caseData._id}`}><strong>{caseData.caseNo}</strong><span>{caseData.parties}</span><small>{caseData.status}</small></Link></td><td>{caseData.department || 'Department required'}</td><td>{money(caseData.ordinaryWorkValue)}</td><td>{money(caseData.totalBilled)}</td><td>{money(caseData.totalCollected)}</td><td>{money(caseData.directMatterCosts)}</td><td><span className={`retainer-profit-badge ${caseData.profitStatus === 'Profitable' ? 'is-profitable' : caseData.profitStatus === 'Loss' ? 'is-loss' : ''}`}>{caseData.profitStatus}: {money(caseData.grossProfit)}</span></td><td><button type="button" onClick={() => unlinkCase(caseData)} disabled={saving}>Unlink</button></td></tr>)}</tbody></table></div>}
            </section>
          </main>

          <aside className="retainer-detail-card retainer-detail-sidebar">
            <form className="retainer-action-panel" onSubmit={linkCase}>
              <h2>Link a matter</h2>
              <p>Link the matter and record approved workflow tasks in the Monthly Retainer Statement. Services excluded and additional fees follow the retainer agreement.</p>
              <div className="retainer-case-picker">
                <input className="retainer-page-input" value={caseSearch} onChange={(event) => { setCaseSearch(event.target.value); setCaseToLink(''); }} placeholder="Search by case number or party name" />
                {caseSearch.trim().length < 2 ? <small className="retainer-case-picker-help">Type at least two characters to search cases.</small> : <select className="retainer-page-input" value={caseToLink} onChange={(event) => setCaseToLink(event.target.value)}><option value="">{linkableCases.length ? `Choose from ${linkableCases.length} matching case${linkableCases.length === 1 ? '' : 's'}` : 'No available matching cases'}</option>{linkableCases.map((caseData) => <option key={caseData._id} value={caseData._id}>{caseData.caseNo} — {caseData.parties}</option>)}</select>}
              </div>
              <button className="retainer-action-button" disabled={saving || !caseToLink}>Link matter</button>
            </form>

            <section className="retainer-detail-section">
              <h2>Recent activity <span>{activity.length}</span></h2>
              {activity.length === 0 ? <p className="retainer-muted-copy">No activity has been recorded yet.</p> : <div className="retainer-activity-list">{activity.slice(0, 8).map((item) => <div key={item._id}><strong>{activityLabel(item.type)}</strong><span>{new Date(item.createdAt).toLocaleDateString()}</span><b>{item.amount ? money(item.amount) : '—'}</b><small>{item.note || (item.case ? `${item.case.caseNo} — ${item.case.parties}` : 'Retainer agreement updated.')}</small></div>)}</div>}
            </section>
          </aside>
        </div>
      </div>

      {showForm && form && <RetainerFormDialog form={form} setForm={(updater) => setForm((current) => {
        if (!current) return current;
        return typeof updater === 'function' ? updater(current) : updater;
      })} editing saving={saving} onClose={() => { if (!saving) setShowForm(false); }} onSubmit={saveEdit} />}
    </>
  );
}

function DetailMetric({ label, value, tone = '' }: { label: string; value: string | number; tone?: string }) {
  return <div className={tone}><span>{label}</span><strong>{value}</strong></div>;
}

function SummaryMetric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div className={tone}><span>{label}</span><strong>{value}</strong></div>;
}
