import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CheckCircle2, Download, Plus, Wallet } from 'lucide-react';
import { Retainer, RetainerCase } from '../../services/retainerService';
import { Department, RetainerPeriod, WorkCandidate, retainerAccounting } from '../../services/retainerAccountingService';
import { RetainerProductionSummary, summariseRetainerStaff } from './RetainerProductionSummary';
import './retainer-accounting.css';

export const retainerMoney = (n: number) => `RWF ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
type Staff = { _id: string; name: string; role: string };
type InvoiceOption = { _id: string; invoiceNo: string; amount: number };
export function RetainerMonthlyStatement({ retainer, linkedCases = [] }: { retainer: Retainer; linkedCases?: RetainerCase[] }) {
  const [periods, setPeriods] = useState<RetainerPeriod[]>([]), [staff, setStaff] = useState<Staff[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [period, setPeriod] = useState<RetainerPeriod | null>(null), [month, setMonth] = useState(today().slice(0, 7));
  const [candidates, setCandidates] = useState<WorkCandidate[]>([]), [candidateKey, setCandidateKey] = useState('');
  const [ordinaryFee, setOrdinaryFee] = useState(''), [department, setDepartment] = useState<Department | ''>('');
  const [contributors, setContributors] = useState([{ userId: '', share: 100 }]);
  const [outOfScope, setOutOfScope] = useState(false), [scopeApproval, setScopeApproval] = useState('');
  const [receipt, setReceipt] = useState({ amount: '', receivedOn: today(), reference: '', sourceInvoiceId: '' });
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<'service' | 'receipt' | null>(null);
  const base = `${retainer._id}/periods`;
  const refresh = async (selected?: string) => {
    const [meta, work] = await Promise.all([
      retainerAccounting<{ periods: RetainerPeriod[]; staff: Staff[]; invoices: InvoiceOption[] }>(base),
      retainerAccounting<WorkCandidate[]>(`${retainer._id}/service-candidates`),
    ]);
    setPeriods(meta.periods); setStaff(meta.staff); setInvoices(meta.invoices || []); setCandidates(work);
    const next = selected || meta.periods.find((item) => item.month === month)?._id;
    if (next) { const data = await retainerAccounting<RetainerPeriod>(`${base}/${next}`); setPeriod(data); setMonth(data.month); }
    else setPeriod(null);
  };
  const linkedCaseIds = linkedCases.map((matter) => matter._id).join(',');
  useEffect(() => { setLoading(true); refresh().catch((e) => setError(e.message)).finally(() => setLoading(false)); }, [retainer._id, linkedCaseIds]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const open = (e: FormEvent) => { e.preventDefault(); run(async () => {
    const opened = await retainerAccounting<RetainerPeriod>(base, { month }); await refresh(opened._id); setNotice('Fixed monthly fee recorded. Record actual revenue received and approved workflow tasks below.');
  }); };
  const selectMonth = (selectedMonth: string) => {
    setMonth(selectedMonth); setPeriod(null); setPanel(null); setError(''); setNotice('');
    setCandidateKey(''); setOrdinaryFee(''); setDepartment(''); setContributors([{ userId: '', share: 100 }]);
    setOutOfScope(false); setScopeApproval('');
    const existing = periods.find((item) => item.month === selectedMonth);
    if (existing) run(async () => { setPeriod(await retainerAccounting<RetainerPeriod>(`${base}/${existing._id}`)); });
  };
  const saveService = (e: FormEvent) => { e.preventDefault(); run(async () => {
    const work = candidates.find((w) => `${w.caseId}:${w.actionKey}` === candidateKey);
    if (!period || !work) throw new Error('Select approved work performed in this month.');
    await retainerAccounting(`${base}/${period._id}/services`, { caseId: work.caseId, actionKey: work.actionKey,
      ordinaryFee: Number(ordinaryFee), department, contributors, outOfScope, scopeApproval });
    setPanel(null); setCandidateKey(''); setOrdinaryFee(''); setContributors([{ userId: '', share: 100 }]); setOutOfScope(false); setScopeApproval('');
    await refresh(); setNotice('Approved workflow task recorded. Departmental production, departmental revenue allocation and individual TPA have been updated.');
  }); };
  const saveReceipt = (e: FormEvent) => { e.preventDefault(); run(async () => {
    if (!period) return;
    await retainerAccounting(`${base}/${period._id}/receipts`, { ...receipt, amount: Number(receipt.amount) });
    setPanel(null); setReceipt({ amount: '', receivedOn: today(), reference: '', sourceInvoiceId: '' }); await refresh(); setNotice('Actual revenue received recorded once in Billing & Margins and Management Reports.');
  }); };
  const act = (action: string, extra: object = {}) => run(async () => {
    if (!period) return;
    const reason = action === 'close' ? undefined : window.prompt('Reason for this correction (at least five characters):');
    if (action !== 'close' && !reason) return;
    await retainerAccounting(`${base}/${period._id}/actions/${action}`, { ...extra, reason }); await refresh(); setNotice('Statement updated. The audit history has been retained.');
  });
  const exportCsv = () => {
    if (!period) return;
    const a = period.allocation;
    const staffTotals = summariseRetainerStaff(a.services, linkedCases);
    const rows: (string | number)[][] = [['Monthly Retainer Statement', retainer.name, period.month],
      ['Retainer client', retainer.clientName], ['Fixed monthly fee', a.fixedFee], ['Actual revenue received', a.actualReceived], ['Total production', a.workValue],
      ['Unutilised retainer revenue', a.firmUnutilisedRevenue], ['Retainer utilisation (%)', a.utilisation], ['Individual TPA', a.staffTpa],
      [], ['Department', 'Work value', 'Share (%)', 'Revenue credit'], ...a.departments.map((d) => [d.department, d.ordinaryValue, d.share, d.allocatedRevenue]),
      ['Total', a.workValue, a.workValue ? 100 : 0, a.allocableRevenue],
      [], ['Staff member', 'Cases worked', 'Approved tasks', 'Individual production', 'TPA earned'],
      ...staffTotals.map((member) => [member.name, new Set([...member.matters.values()].map((matter) => matter.caseId)).size, member.tasks.size, member.production, member.earnedTpa]),
      ['Total', '', '', a.workValue, a.staffTpa],
      [], ['Staff member', 'Matter', 'Parties', 'Department', 'Approved tasks', 'Individual production', 'TPA rates (%)', 'TPA earned'],
      ...staffTotals.flatMap((member) => [...member.matters.values()].map((matter) => [member.name, matter.matterNo, matter.name, matter.department, matter.tasks.size, matter.production, [...matter.rates].sort((a, b) => a - b).join(', '), matter.earnedTpa])),
      [], ['Matter', 'Service', 'Performed', 'Department', 'Ordinary professional fee', 'Revenue credit', 'Staff', 'Contribution %', 'Individual monthly production', 'TPA %', 'TPA earned'],
      ...a.services.flatMap((s) => s.contributors.map((c) => [s.matterNo, s.title, s.performedOn, s.department, s.ordinaryFee, s.allocatedRevenue, c.name, c.share, c.production, c.tpaPercent, c.earnedTpa]))];
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/^[=+@\-]/, "'$&").replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${retainer.retainerNo}-${period.month}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const a = period?.allocation;
  const available = candidates.filter((w) => w.performedOn?.slice(0, 7) === period?.month);
  const selectedWork = available.find((w) => `${w.caseId}:${w.actionKey}` === candidateKey);
  return <section className="retainer-accounting" aria-label="Monthly Retainer Statement">
    <header className="ra-header"><div><span className="ra-eyebrow"><CalendarDays size={15} /> Monthly overview</span><h2>Monthly Retainer Statement</h2><p>Revenue received, approved work and staff TPA for the selected month.</p></div>
      <form className="ra-month-picker" onSubmit={open}><label>Month<input aria-label="Month" required type="month" disabled={busy || loading} value={month} onChange={(e) => selectMonth(e.target.value)} min={retainer.startDate.slice(0, 7)} max={retainer.endDate?.slice(0, 7)} /></label>{!period && <button disabled={busy || loading || !month || retainer.monthlyFee <= 0 || retainer.status !== 'Active'}>Record fixed monthly fee</button>}</form>
    </header>
    {error && <p role="alert" className="ra-error">{error}</p>}{notice && <p role="status" className="ra-notice">{notice}</p>}
    {loading ? <p>Loading Monthly Retainer Statements…</p> : <>
      {!!periods.length && <div className="ra-toolbar"><label>Recorded statements<select aria-label="Recorded statements" value={period?._id || ''} disabled={busy} onChange={(e) => { const selected = periods.find((item) => item._id === e.target.value); if (selected) selectMonth(selected.month); }}><option value="" disabled>Choose a recorded month</option>{periods.map((p) => <option key={p._id} value={p._id}>{p.month} · {p.status}</option>)}</select></label>
        {period && <>
        <span className="ra-status">{period?.status}</span><button type="button" disabled={busy} onClick={exportCsv}><Download size={15} /> Export Monthly Retainer Statement</button>
        <button type="button" disabled={busy} onClick={() => act(period?.status === 'Closed' ? 'reopen' : 'close')}>{period?.status === 'Closed' ? 'Reopen with reason' : 'Close month'}</button></>}
      </div>}
      {!period || !a ? <><div className="ra-empty"><CalendarDays /><h3>{busy ? 'Loading statement…' : 'Prepare this month’s statement'}</h3><p>{retainer.monthlyFee <= 0 ? 'Set the fixed monthly fee in Edit agreement to prepare monthly statements.' : 'Record the fixed monthly fee to begin. Then record approved workflow tasks and revenue received for this month.'}</p></div>{!busy && <RetainerProductionSummary linkedCases={linkedCases} month={month} />}</> : <>
        <div className="ra-metrics">
          <Metric label="Fixed monthly fee" value={retainerMoney(a.fixedFee)} detail={`Due ${period.dueDate}`} />
          <Metric label="Actual revenue received" value={retainerMoney(a.actualReceived)} detail={`${retainerMoney(a.outstanding)} outstanding`} />
          <Metric label="Value of work delivered" value={retainerMoney(a.workValue)} detail={`${a.servicesCount} approved tasks · ${a.mattersCount} matters worked`} />
          <Metric label="Retainer utilisation" value={`${a.utilisation}%`} detail={`${a.utilisationStatus} · work value ÷ fixed monthly fee`} />
          <Metric label="Staff TPA earned" value={retainerMoney(a.staffTpa)} detail="Accrued from approved individual production" />
          <Metric label="Unutilised retainer revenue" value={retainerMoney(a.firmUnutilisedRevenue)} detail="Retainer revenue retained at firm level" />
        </div>
        {(a.excessServiceValue > 0 || a.overpayment > 0) && <div className="ra-warning">{a.excessServiceValue > 0 && <p><strong>{a.substantialOverutilisation ? 'Management review required. ' : 'Overutilised. '}</strong>Excess service value: {retainerMoney(a.excessServiceValue)}. Additional fees depend on the retainer agreement.</p>}{a.overpayment > 0 && <p>Actual revenue received exceeds the fixed monthly fee by {retainerMoney(a.overpayment)}. Review the actual revenue received.</p>}</div>}
        <div className="ra-toolbar ra-entry-toolbar"><h3>Update this month</h3><button type="button" disabled={busy || period.status === 'Closed'} aria-expanded={panel === 'service'} onClick={() => setPanel(panel === 'service' ? null : 'service')}><Plus size={16} /> Record service</button><button type="button" disabled={busy} aria-expanded={panel === 'receipt'} onClick={() => setPanel(panel === 'receipt' ? null : 'receipt')}><Wallet size={16} /> Record actual revenue received</button></div>
        {panel === 'service' && <form className="ra-entry-form" onSubmit={saveService}><h3>Workflow task valuation</h3><p>Complete the matter’s review and approval first. Select the approved action and confirm its ordinary professional fee and assigned/contributing staff.</p>
          <label className="ra-wide">Approved workflow task<select required value={candidateKey} onChange={(e) => { setCandidateKey(e.target.value); const w = candidates.find((c) => `${c.caseId}:${c.actionKey}` === e.target.value); setOrdinaryFee(String(w?.ordinaryFee || '')); setDepartment(w?.department || ''); }}><option value="">{available.length ? 'Select approved workflow tasks completed during this month' : 'No unrecorded approved workflow tasks in this month'}</option>{available.map((w) => <option key={`${w.caseId}:${w.actionKey}`} value={`${w.caseId}:${w.actionKey}`}>{w.matterNo} · {w.title} · {w.performedOn}</option>)}</select></label>
          <label>Ordinary professional fee (RWF)<input required min="1" step="1" type="number" value={ordinaryFee} onChange={(e) => setOrdinaryFee(e.target.value)} /></label><label>Department<select required disabled={!!selectedWork?.department} value={department} onChange={(e) => setDepartment(e.target.value as Department)}><option value="">Select department</option><option>Dispute Resolution</option><option>Transaction & Advisory</option></select>{selectedWork?.department && <small>The department selected for the matter.</small>}</label>
          <fieldset className="ra-wide"><legend>Assigned/contributing staff · total must equal 100%</legend>{contributors.map((c, i) => <div className="ra-contributor" key={i}><label>Staff member<select required value={c.userId} onChange={(e) => setContributors((all) => all.map((v, j) => i === j ? { ...v, userId: e.target.value } : v))}><option value="">Select staff</option>{staff.map((s) => <option key={s._id} value={s._id}>{s.name} · {s.role.replaceAll('_', ' ')}</option>)}</select></label><label>Contribution %<input required type="number" min="0.01" max="100" step="0.01" value={c.share} onChange={(e) => setContributors((all) => all.map((v, j) => i === j ? { ...v, share: Number(e.target.value) } : v))} /></label>{contributors.length > 1 && <button type="button" onClick={() => setContributors((all) => all.filter((_, j) => i !== j))}>Remove</button>}</div>)}<button type="button" onClick={() => setContributors((all) => [...all, { userId: '', share: 0 }])}>Add contributor</button><span className="ra-share-total">Total: {contributors.reduce((n, c) => n + c.share, 0)}%</span></fieldset>
          <label className="ra-checkbox ra-wide"><input type="checkbox" checked={outOfScope} onChange={(e) => setOutOfScope(e.target.checked)} /> Work outside included scope</label>{outOfScope && <label className="ra-wide">Scope approval reference<input required={retainer.scopeApprovalRequired !== false} value={scopeApproval} onChange={(e) => setScopeApproval(e.target.value)} placeholder="Approver / instruction / approval reference" /></label>}
          <div className="ra-form-actions ra-wide"><button type="button" onClick={() => setPanel(null)}>Cancel</button><button disabled={busy || Math.abs(contributors.reduce((n, c) => n + c.share, 0) - 100) > 0.0001}><CheckCircle2 size={16} /> {busy ? 'Saving…' : 'Record approved workflow task'}</button></div>
        </form>}
        {panel === 'receipt' && <form className="ra-entry-form" onSubmit={saveReceipt}><h3>Record actual revenue received</h3><p>Use the existing paid invoice option if this money is already recorded in the platform.</p><label className="ra-wide">Payment source<select value={receipt.sourceInvoiceId} onChange={(e) => { const inv = invoices.find((i) => i._id === e.target.value); setReceipt((r) => ({ ...r, sourceInvoiceId: e.target.value, amount: inv ? String(inv.amount) : '', reference: inv?.invoiceNo || '' })); }}><option value="">New receipt — not already recorded in a matter invoice</option>{invoices.map((i) => <option value={i._id} key={i._id}>Transfer {i.invoiceNo} · {retainerMoney(i.amount)}</option>)}</select></label><label>Amount (RWF)<input required type="number" min="1" step="1" disabled={!!receipt.sourceInvoiceId} value={receipt.amount} onChange={(e) => setReceipt((r) => ({ ...r, amount: e.target.value }))} /></label><label>Received on<input required type="date" max={today()} disabled={!!receipt.sourceInvoiceId} value={receipt.receivedOn} onChange={(e) => setReceipt((r) => ({ ...r, receivedOn: e.target.value }))} /></label><label className="ra-wide">Bank / payment reference<input required maxLength={180} disabled={!!receipt.sourceInvoiceId} value={receipt.reference} onChange={(e) => setReceipt((r) => ({ ...r, reference: e.target.value }))} /></label><div className="ra-form-actions ra-wide"><button type="button" onClick={() => setPanel(null)}>Cancel</button><button disabled={busy}>{busy ? 'Saving…' : 'Record actual revenue received'}</button></div></form>}
        <RetainerProductionSummary key={period._id} allocation={a} linkedCases={linkedCases} month={period.month} />
        <details className="ra-register"><summary>Approved task register <span>{a.servicesCount} tasks</span></summary><p>Recorded task fees, staff contributions and approval details.</p>
        <div className="ra-table-wrap"><table><thead><tr><th>Service / matter</th><th>Department</th><th>Ordinary professional fee</th><th>Revenue credit</th><th>Individual monthly production / Individual TPA</th><th /></tr></thead><tbody>{a.services.map((s) => <tr key={s._id}><td><strong>{s.title}</strong><br /><Link to={`/cases/${s.caseId}`}>{s.matterNo}</Link><small>{s.performedOn} · approved by {s.approvedBy}</small></td><td>{s.department}</td><td>{retainerMoney(s.ordinaryFee)}</td><td>{retainerMoney(s.allocatedRevenue)}</td><td>{s.contributors.map((c) => <div key={c.userId}>{c.name} · {c.share}%<small>{retainerMoney(c.production)} × {c.tpaPercent}% = <strong>{retainerMoney(c.earnedTpa)}</strong></small></div>)}</td><td><button disabled={busy || period.status === 'Closed'} type="button" onClick={() => act('void-service', { serviceId: s._id })}>Reverse</button></td></tr>)}{!a.services.length && <tr><td colSpan={6}>No approved services recorded for this month.</td></tr>}</tbody></table></div></details>
        <h3>Actual revenue received</h3><div className="ra-table-wrap"><table><thead><tr><th>Received</th><th>Reference</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>{period.receipts.map((r) => <tr key={r._id}><td>{r.receivedOn}</td><td>{r.reference}{r.sourceInvoiceId && <small>Transferred from existing invoice</small>}</td><td>{retainerMoney(r.amount)}</td><td>{r.voidedAt ? 'Reversed' : 'Received'}</td><td><button disabled={busy} onClick={() => act(r.voidedAt ? 'restore-receipt' : 'void-receipt', { receiptId: r._id })}>{r.voidedAt ? 'Restore with reason' : 'Reverse'}</button></td></tr>)}{!period.receipts.length && <tr><td colSpan={5}>No receipts recorded.</td></tr>}</tbody></table></div>
        <p className="ra-policy">Revenue after staff TPA: <strong>{retainerMoney(a.retainedAfterTpa)}</strong>, before matter costs and overhead. Excess service value does not automatically create additional fees.</p>
        <details className="ra-register"><summary>Statement settings</summary><div className="ra-toolbar"><p>Fixed monthly fee for {period.month}: {retainerMoney(period.fixedFee)}. Changes require an approved amendment.</p><button type="button" disabled={busy || period.status === 'Closed'} onClick={() => { const value = window.prompt('Fixed monthly fee under the approved amendment (RWF):', String(period.fixedFee)); if (value !== null) act('amend-fee', { fixedFee: Number(value) }); }}>Amend fixed monthly fee</button></div></details>
        <details className="ra-audit"><summary>Statement audit history · {period.history.length} entries</summary>{period.history.slice().reverse().map((h, i) => <p key={i}><strong>{h.action.replaceAll('_', ' ')}</strong> · {h.actor} · {new Date(h.at).toLocaleString()} {h.reason && <span> — {h.reason}</span>}</p>)}{period.services.filter((s) => s.voidedAt).map((s) => <p key={s._id}>Reversed service: {s.matterNo} · {s.title} · {retainerMoney(s.ordinaryFee)}</p>)}</details>
      </>}
    </>}
  </section>;
}
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="ra-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
