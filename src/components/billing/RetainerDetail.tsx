import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BriefcaseBusiness, CalendarDays, Pencil, Plus, RefreshCw, Scale, Wallet, X } from 'lucide-react';
import { CaseData, getAllCases } from '../../services/caseService';
import { getRetainer, getRetainerActivity, getRetainerCases, Retainer, RetainerActivity, RetainerCase, RetainerCaseSummary, RetainerPayload, setCaseRetainer, updateRetainer } from '../../services/retainerService';
import { RetainerFormDialog } from './RetainerFormDialog';
import { RetainerCaseTable, RetainerStaffTable } from './RetainerWorkspaceTables';
import { dateLabel, departmentSummary, money } from './retainerWorkspace';
import './retainer-workspace.css';

const emptySummary: RetainerCaseSummary = { caseCount: 0, contractValue: 0, totalBilled: 0, totalCollected: 0, outstanding: 0, directMatterCosts: 0, grossProfit: 0, profitableCases: 0, lossMakingCases: 0 };
const toForm = (retainer: Retainer): RetainerPayload => ({
  name: retainer.name, clientName: retainer.clientName, billingModel: 'monthly', status: retainer.status,
  startDate: retainer.startDate.slice(0, 10), endDate: retainer.endDate?.slice(0, 10) || '', renewalDate: retainer.renewalDate?.slice(0, 10) || '',
  monthlyFee: retainer.monthlyFee || 0, billingDay: retainer.billingDay || 1, scope: retainer.scope || '', notes: retainer.notes || '',
});
const activityLabels: Record<RetainerActivity['type'], string> = {
  CONTRACT_VALUE_SET: 'Agreement created', CONTRACT_VALUE_ADJUSTED: 'Agreement adjusted', CASE_LINKED: 'Case linked', CASE_UNLINKED: 'Case unlinked',
  OPENING_BALANCE: 'Agreement created', TOP_UP: 'Agreement adjusted', CASE_RESERVED: 'Historic case allocation', CASE_RELEASED: 'Historic allocation released', ADJUSTMENT: 'Adjustment',
};

export default function RetainerDetail() {
  const { retainerId = '' } = useParams();
  const [retainer, setRetainer] = useState<Retainer | null>(null);
  const [linkedCases, setLinkedCases] = useState<RetainerCase[]>([]), [summary, setSummary] = useState(emptySummary);
  const [activity, setActivity] = useState<RetainerActivity[]>([]), [allCases, setAllCases] = useState<CaseData[]>([]);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [linkLoading, setLinkLoading] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false), [form, setForm] = useState<RetainerPayload | null>(null);
  const [showLink, setShowLink] = useState(false), [caseSearch, setCaseSearch] = useState(''), [caseToLink, setCaseToLink] = useState('');
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    try {
      const [agreement, details, events] = await Promise.all([getRetainer(retainerId), getRetainerCases(retainerId), getRetainerActivity(retainerId)]);
      if (current !== request.current) return;
      setRetainer(agreement); setLinkedCases(details.cases); setSummary(details.summary || emptySummary); setActivity(events);
    } catch (failure: any) {
      if (current === request.current) setError(failure.message || 'Unable to load this retainer.');
    } finally { if (current === request.current) setLoading(false); }
  }, [retainerId]);
  useEffect(() => { setRetainer(null); setError(''); setNotice(''); void load(); return () => { request.current++; }; }, [load]);
  useEffect(() => {
    const refresh = () => { if (!showForm && !saving && document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [load, showForm, saving]);
  const departments = useMemo(() => departmentSummary(linkedCases), [linkedCases]);
  const linkableCases = useMemo(() => {
    const query = caseSearch.trim().toLowerCase();
    if (query.length < 2) return [];
    return allCases.filter((matter) => !matter.retainerId && !linkedCases.some((linked) => linked._id === matter._id))
      .filter((matter) => (matter.caseNo + ' ' + matter.parties).toLowerCase().includes(query)).slice(0, 25);
  }, [allCases, caseSearch, linkedCases]);
  const openLink = async () => {
    setShowLink(true); setLinkLoading(true); setError('');
    try { setAllCases(await getAllCases()); } catch (failure: any) { setError(failure.message || 'Unable to search available cases.'); }
    finally { setLinkLoading(false); }
  };
  const saveEdit = async (event: FormEvent) => {
    event.preventDefault(); if (!retainer || !form) return;
    setSaving(true); setError('');
    try { await updateRetainer(retainer._id, form); setShowForm(false); setNotice('Retainer agreement updated.'); await load(); }
    catch (failure: any) { setError(failure.message || 'Unable to update this agreement.'); }
    finally { setSaving(false); }
  };
  const linkCase = async (event: FormEvent) => {
    event.preventDefault(); if (!retainer || !caseToLink) return;
    setSaving(true); setError('');
    try { await setCaseRetainer(caseToLink, retainer._id); setShowLink(false); setCaseToLink(''); setCaseSearch(''); setNotice('Case linked. Department and staff totals have been updated.'); await load(); }
    catch (failure: any) { setError(failure.message || 'Unable to link this case.'); }
    finally { setSaving(false); }
  };
  const unlinkCase = async (matter: RetainerCase) => {
    if (!window.confirm('Unlink ' + (matter.parties || matter.caseNo) + ' from this retainer?')) return;
    setSaving(true); setError('');
    try { await setCaseRetainer(matter._id); setNotice('Case unlinked. Department and staff totals have been updated.'); await load(); }
    catch (failure: any) { setError(failure.message || 'Unable to unlink this case.'); }
    finally { setSaving(false); }
  };

  if (!retainer) return <div className="retainer-detail-page retainer-workspace"><Link className="rw-back" to="/matters/retainers"><ArrowLeft size={16} /> Retainer portfolio</Link>{loading ? <p role="status" className="rw-empty">Loading retainer workspace…</p> : <div className="rw-alert is-error" role="alert">{error || 'Retainer not found.'}</div>}</div>;
  const pending = summary.pendingStaffCount || 0;
  const staffFees = summary.staffEarnedFees || 0;
  const net = summary.netAfterStaff ?? summary.grossProfit;
  return <div className="retainer-detail-page retainer-workspace" aria-busy={loading}>
    <Link className="rw-back" to="/matters/retainers"><ArrowLeft size={16} /> Back to retainer portfolio</Link>
    <header className="rw-page-header"><div><span className="rw-eyebrow">{retainer.retainerNo} · Retainer workspace</span><h1>{retainer.name}</h1><p>{retainer.clientName}</p></div><div className="rw-header-actions"><span className={'rw-status is-' + retainer.effectiveStatus.toLowerCase()}>{retainer.effectiveStatus}</span><button type="button" className="rw-icon-button" aria-label="Refresh retainer workspace" disabled={loading || saving} onClick={() => { setError(''); void load(); }}><RefreshCw size={17} className={loading ? 'rw-spinning' : ''} /></button><button className="rw-button" type="button" onClick={() => { setError(''); setForm(toForm(retainer)); setShowForm(true); }}><Pencil size={15} /> Edit agreement</button></div></header>
    {(error || notice) && <div role={error ? 'alert' : 'status'} className={'rw-alert ' + (error ? 'is-error' : 'is-success')}>{error || notice}</div>}

    <section className="rw-fee-hero" id="retainer-overview" aria-label="Fixed monthly retainer fee">
      <div className="rw-fee-value"><span><Wallet size={17} /> Fixed monthly fee</span><strong>{retainer.monthlyFee > 0 ? money(retainer.monthlyFee) : 'Fee not set'}</strong><p>{retainer.monthlyFee > 0 ? 'Agreed fee payable each month' : 'Use Edit agreement to enter the fixed monthly fee.'}</p></div>
      <dl className="rw-agreement-meta"><div><dt>Billing schedule</dt><dd>Day {retainer.billingDay || 1} of each month</dd></div><div><dt>Agreement term</dt><dd>{dateLabel(retainer.startDate)}<small>{retainer.endDate ? 'to ' + dateLabel(retainer.endDate) : 'Open-ended agreement'}</small></dd></div><div><dt>Renewal review</dt><dd>{dateLabel(retainer.renewalDate) || 'Not scheduled'}</dd></div></dl>
    </section>
    <nav className="rw-section-nav" aria-label="Retainer workspace sections"><a href="#retainer-overview">Overview</a><a href="#retainer-departments">Departments</a><a href="#retainer-staff">Staff earnings</a><a href="#retainer-cases">Linked cases</a><a href="#retainer-agreement">Agreement details</a></nav>
    <section className="rw-kpis" aria-label="Retainer case totals">
      <Metric label="Linked cases" value={String(linkedCases.length)} detail={(summary.staffCount || 0) + ' assigned and contributing staff'} />
      <Metric label="Case fees collected" value={money(summary.totalCollected)} detail={money(summary.outstanding) + ' outstanding'} />
      <Metric label="Staff fees earned" value={money(staffFees)} detail={pending ? pending + ' role rows awaiting scores' : 'Calculated in the case workspaces'} />
      <Metric label="Net contribution" value={money(net)} detail={pending ? 'Before pending staff fees and overheads' : 'After direct costs and calculated staff fees'} tone={net < 0 ? 'is-negative' : ''} />
    </section>
    <div className="rw-financial-strip"><span>Total billed <strong>{money(summary.totalBilled)}</strong></span><span>Direct case costs <strong>{money(summary.directMatterCosts)}</strong></span><span className="rw-period"><CalendarDays size={14} /> All linked cases · All time</span></div>

    <section id="retainer-departments" className="rw-departments" aria-label="Department performance">
      <div className="rw-section-heading"><div><span className="rw-eyebrow">Practice departments</span><h2>How each department is performing</h2><p>Collected case fees, staff earnings and contribution under this agreement.</p></div></div>
      <div className="rw-department-grid">{departments.map((department, index) => {
        const collection = department.billed ? Math.min(100, Math.round(department.collected / department.billed * 100)) : 0;
        return <article className={'rw-department-card ' + (index === 1 ? 'is-advisory' : '')} key={department.name} aria-label={department.name}>
          <header><span className="rw-department-icon">{index === 0 ? <Scale size={20} /> : <BriefcaseBusiness size={20} />}</span><div><h3>{department.name}</h3><span>{department.count} linked {department.count === 1 ? 'case' : 'cases'}</span></div></header>
          <div className="rw-department-revenue"><span>Case fees collected</span><strong>{money(department.collected)}</strong></div>
          <div className="rw-collection-label"><span>{money(department.billed)} billed</span><strong>{collection}% collected</strong></div><div className="rw-progress" role="progressbar" aria-label={department.name + ' collection rate'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={collection}><span style={{ width: collection + '%' }} /></div>
          <dl className="rw-department-figures"><div><dt>Staff fees earned</dt><dd>{money(department.staffFees)}</dd></div><div><dt>Direct case costs</dt><dd>{money(department.costs)}</dd></div><div className="rw-department-net"><dt>Net contribution</dt><dd>{money(department.net)}</dd></div></dl>
          {!!department.pending && <p className="rw-pending">{department.pending} staff role {department.pending === 1 ? 'row is' : 'rows are'} awaiting scores; net is provisional.</p>}
        </article>;
      })}</div>
      <p className="rw-footnote">The fixed monthly fee is the agreement amount. Department and case figures use recorded case invoices and earned fees; the agreement amount is not added to collected revenue.</p>
    </section>

    <div id="retainer-staff"><RetainerStaffTable cases={linkedCases} /></div>
    <div id="retainer-cases"><RetainerCaseTable key={retainerId} cases={linkedCases} saving={saving} onUnlink={unlinkCase} onLink={() => { void openLink(); }} /></div>

    {showLink && <section className="rw-panel rw-link-panel" aria-label="Link a case"><div className="rw-section-heading"><div><h2>Link an existing case</h2><p>Find a case covered by this agreement.</p></div><button className="rw-icon-button" type="button" aria-label="Close case search" onClick={() => setShowLink(false)}><X size={18} /></button></div>
      {!retainer.isUsable && <p className="rw-pending">Activate the agreement and check its dates before linking a case.</p>}
      <form onSubmit={linkCase}><label>Find a case<input autoFocus aria-label="Find a case" value={caseSearch} onChange={(event) => { setCaseSearch(event.target.value); setCaseToLink(''); }} placeholder="Case number or party name" /></label>
        {linkLoading ? <p role="status">Loading available cases…</p> : caseSearch.trim().length < 2 ? <p>Type at least two characters to search.</p> : <label>Matching cases<select aria-label="Matching cases" required value={caseToLink} onChange={(event) => setCaseToLink(event.target.value)}><option value="">{linkableCases.length ? 'Select a case' : 'No available cases match this search'}</option>{linkableCases.map((matter) => <option value={matter._id} key={matter._id}>{matter.caseNo + ' · ' + matter.parties}</option>)}</select></label>}
        <button type="submit" className="rw-button is-primary" disabled={saving || linkLoading || !caseToLink || !retainer.isUsable}><Plus size={15} />{saving ? 'Linking…' : 'Link case'}</button>
      </form>
    </section>}

    <section className="rw-panel rw-agreement-details" id="retainer-agreement" aria-label="Agreement details"><div className="rw-section-heading"><div><span className="rw-eyebrow">Agreement record</span><h2>Services & notes</h2></div></div><div className="rw-notes-grid"><div><h3>Services covered</h3><p>{retainer.scope || 'No services specified yet.'}</p></div><div><h3>Internal notes</h3><p>{retainer.notes || 'No internal notes.'}</p></div></div>
      <details className="rw-activity"><summary>Recent activity <span>{activity.length} entries</span></summary>{activity.length ? activity.slice(0, 8).map((event) => <div key={event._id}><strong>{activityLabels[event.type] || 'Agreement updated'}</strong><time>{new Date(event.createdAt).toLocaleDateString('en-GB', { timeZone: 'Africa/Kigali' })}</time><p>{event.note || (event.case ? event.case.caseNo + ' · ' + event.case.parties : 'Retainer agreement updated.')}</p></div>) : <p>No activity recorded yet.</p>}</details>
    </section>
    {showForm && form && <RetainerFormDialog form={form} setForm={(updater) => setForm((current) => current ? typeof updater === 'function' ? updater(current) : updater : current)} editing saving={saving} error={error} onClose={() => { if (!saving) setShowForm(false); }} onSubmit={saveEdit} />}
  </div>;
}

function Metric({ label, value, detail, tone = '' }: { label: string; value: string; detail: string; tone?: string }) {
  return <article className={'rw-kpi ' + tone}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
