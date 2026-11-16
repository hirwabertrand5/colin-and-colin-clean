import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BarChart3, CalendarDays, CircleHelp, ExternalLink, Wallet, X } from 'lucide-react';
import type { FinanceRow, FinanceSection, FinanceWorkspace } from '../../services/financeWorkspaceService';
import { updateInvoiceTerms } from '../../services/invoiceService';

export const money = (n: unknown) => n == null ? 'Not available' : `RWF ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
export const pct = (n: unknown) => n == null ? '—' : `${Math.round(Number(n) * 10) / 10}%`;
export const date = (value: unknown) => value ? String(value).slice(0, 10) : '—';
export type Column = { key: string; label: string; type?: 'money' | 'date' | 'number' | 'status' | 'percent' };

export function Metric({ label, value, detail, accent }: { label: string; value: string; detail?: string; accent?: string }) {
  return <article className={`finance-metric ${accent || ''}`}><div className="finance-metric-label">{label}</div><strong>{value}</strong>{detail && <p>{detail}</p>}</article>;
}

export function SourceGuide({ notes }: { notes: string[] }) {
  return <details className="finance-source-guide"><summary><CircleHelp size={16} />Sources & calculation rules</summary><div>{notes.map(note => <p key={note}>{note}</p>)}</div></details>;
}

export function Trend({ data, cash = false }: { data: FinanceWorkspace['trend']; cash?: boolean }) {
  const shown = data.slice(-12);
  const max = Math.max(1, ...shown.flatMap(r => [r.collected, cash ? Math.abs(r.costs) : r.billed]));
  return <section className="finance-panel"><div className="finance-panel-heading"><div><h2>{cash ? 'Collections & spend' : 'Billing & collection trend'}</h2><p>Monthly movement within the reporting period</p></div><BarChart3 size={20} /></div>
    {shown.length ? <><div className="finance-chart" role="img" aria-label={shown.map(r => `${r.label}: billed ${money(r.billed)}, collected ${money(r.collected)}, net costs ${money(r.costs)}`).join('; ')}>
      {shown.map(r => <div className="finance-chart-month" key={r.label}><div className="finance-chart-bars"><span className="is-billed" style={{ height: `${Math.max(0, (cash ? r.costs : r.billed) / max * 100)}%` }} title={`${cash ? 'Net costs' : 'Billed'}: ${money(cash ? r.costs : r.billed)}`} /><span className="is-collected" style={{ height: `${Math.max(0, r.collected / max * 100)}%` }} title={`Collected: ${money(r.collected)}`} /></div><small>{new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(new Date(`${r.label}-01`))}<em>{r.label.slice(0, 4)}</em></small></div>)}
    </div><div className="finance-chart-legend"><span><i className="is-billed" />{cash ? 'Net recorded costs' : 'Billed'}</span><span><i className="is-collected" />Collected</span></div></> : <div className="finance-empty-small">No movement recorded in this period.</div>}</section>;
}

export function Ageing({ report, onSelect }: { report: FinanceWorkspace; onSelect: (key: string) => void }) {
  const total = report.metrics.outstanding || 0;
  return <section className="finance-panel"><div className="finance-panel-heading"><div><h2>Receivables ageing</h2><p>Unpaid balances as at {report.range.to}</p></div><CalendarDays size={20} /></div><div className="finance-ageing">{report.ageing.map((band, i) => <button key={band.key} onClick={() => onSelect(band.key)} className={`finance-age-band band-${i}`}><span>{band.label}<small>{band.count} invoice{band.count === 1 ? '' : 's'}</small></span><strong>{money(band.value)}</strong><i><b style={{ width: `${total ? Math.min(100, band.value / total * 100) : 0}%` }} /></i></button>)}</div></section>;
}

export function Forecast({ report }: { report: FinanceWorkspace }) {
  const [probability, setProbability] = useState(75);
  const [plannedSpend, setPlannedSpend] = useState('');
  const expected = (report.metrics.outstanding || 0) * probability / 100;
  const costs = plannedSpend === '' ? report.metrics.monthlyExpenseRunRate : Number(plannedSpend);
  return <section className="finance-panel finance-forecast"><div className="finance-panel-heading"><div><h2>Next 30 days · scenario</h2><p>Adjust collection confidence and planned cash payments.</p></div><Wallet size={20} /></div>
    <label className="finance-range-label">Expected collection of open receivables<strong>{probability}%</strong><input aria-label="Expected collection percentage" type="range" min="0" max="100" step="5" value={probability} onChange={e => setProbability(Number(e.target.value))} /></label>
    <label className="finance-field">Planned cash payments (RWF)<input aria-label="Planned cash payments" type="number" min="0" placeholder={String(report.metrics.monthlyExpenseRunRate ?? 0)} value={plannedSpend} onChange={e => setPlannedSpend(e.target.value)} /><small>Defaults to 30 days of the selected period’s average net costs.</small></label>
    <dl className="finance-bridge"><div><dt>Potential collections</dt><dd>{money(expected)}</dd></div><div><dt>Planned payments</dt><dd>{money(costs)}</dd></div><div className="finance-bridge-total"><dt>Projected net movement</dt><dd>{costs == null ? 'Not available' : money(expected - costs)}</dd></div></dl><p className="finance-footnote">A planning scenario using your assumptions. A closing bank balance requires a reconciled opening balance.</p></section>;
}

export function getColumns(section: FinanceSection, tab: string): Column[] {
  const ref: Column = { key: 'reference', label: 'Reference' };
  const client: Column = { key: 'client', label: 'Client' };
  const matter: Column = { key: 'matterNo', label: 'Matter' };
  const amount = (key: string, label: string): Column => ({ key, label, type: 'money' });
  if (section === 'financial-dashboard' || section === 'invoicing' && tab === 'triggers') return [ref, client, amount('contractValue', 'Contract value'), amount('billed', 'Billed'), amount('collected', 'Collected'), amount('outstanding', 'Receivable'), ...(tab === 'triggers' ? [amount('unbilled', 'Work awaiting billing')] : [amount('directCosts', 'Direct costs')])];
  if (section === 'invoicing') return [{ ...ref, label: 'Invoice' }, matter, client, { key: 'date', label: 'Invoice date', type: 'date' }, { key: 'dueDate', label: 'Due date', type: 'date' }, amount('amount', 'Amount'), { key: 'status', label: 'Status', type: 'status' }];
  if (section === 'collections') return [{ ...ref, label: 'Invoice' }, client, matter, { key: 'dueDate', label: 'Due date', type: 'date' }, { key: 'age', label: 'Days overdue', type: 'number' }, amount('outstanding', 'Open balance'), { key: 'status', label: 'Status', type: 'status' }];
  if (section === 'cash-flow') return [{ key: 'date', label: 'Date', type: 'date' }, { ...ref, label: 'Transaction' }, client, { key: 'category', label: 'Type' }, amount('inflow', 'Cash in'), amount('outflow', 'Cash out')];
  if (section === 'expenses') return tab === 'vendors' ? [{ ...ref, label: 'Vendor' }, { key: 'count', label: 'Entries', type: 'number' }, amount('amount', 'Recorded spend'), amount('refund', 'Refunds'), amount('netCost', 'Net spend')]
    : [{ ...ref, label: 'Expense' }, { key: 'date', label: 'Expense date', type: 'date' }, { key: 'vendor', label: 'Vendor' }, { key: 'category', label: 'Category' }, { key: 'status', label: 'Allocation' }, amount('amount', 'Recorded cost'), amount('refund', 'Refunds'), amount('netCost', 'Net cost')];
  if (['by-staff', 'by-role', 'by-matter'].includes(tab)) return [{ ...ref, label: tab === 'by-staff' ? 'Staff member' : tab === 'by-role' ? 'Role' : 'Matter' }, ...(tab === 'by-staff' ? [{ key: 'role', label: 'Role' }] : []), { key: 'actions', label: 'Staff action entries', type: 'number' }, amount('earnedFee', 'Known earned fees'), { key: 'missing', label: 'Unpriced entries', type: 'number' }];
  return [{ key: 'staff', label: 'Staff member' }, matter, { ...ref, label: 'Completed action' }, { key: 'date', label: 'Completed', type: 'date' }, amount('eligibleBase', 'Funded action value'), { key: 'tpa', label: 'TPA', type: 'percent' }, amount('earnedFee', 'Earned fee'), { key: 'status', label: 'Status', type: 'status' }];
}

const statusLabels: Record<string, string> = { ready: 'Eligible', 'awaiting-collection': 'Awaiting collection', 'awaiting-input': 'Needs scoring', incomplete: 'Missing attribution' };
export const statusLabel = (value: unknown) => statusLabels[String(value)] || String(value || '—');
export const cell = (row: FinanceRow, column: Column) => column.type === 'money' ? money(row[column.key]) : column.type === 'date' ? date(row[column.key]) : column.type === 'percent' ? pct(row[column.key]) : column.type === 'status' ? statusLabel(row[column.key]) : row[column.key] == null ? '—' : String(row[column.key]).replace(/_/g, ' ');

function PaymentTerms({ row }: { row: FinanceRow }) {
  const [dueDate, setDueDate] = useState(String(row.dueDate || ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return <form className="finance-terms-form" onSubmit={async e => { e.preventDefault(); setSaving(true); setError('');
    try { await updateInvoiceTerms(String(row.id), dueDate); } catch (reason: any) { setError(reason.message); } finally { setSaving(false); }
  }}><label className="finance-field">Invoice due date<input aria-label="Invoice due date" type="date" min={String(row.date || '')} value={dueDate} onChange={e => setDueDate(e.target.value)} disabled={saving} /></label><button className="finance-button primary" disabled={saving}>{saving ? 'Saving…' : 'Save payment terms'}</button>{error && <p role="alert">{error}</p>}</form>;
}

export function RecordDetail({ row, onClose, canManage = false }: { row: FinanceRow | null; onClose: () => void; canManage?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (row) ref.current?.showModal(); else ref.current?.close(); }, [row]);
  return <dialog ref={ref} className="finance-drawer" aria-labelledby="finance-detail-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="finance-drawer-body"><div className="finance-panel-heading"><div><p>RECORD DETAILS</p><h2 id="finance-detail-title">{row?.reference || 'Financial record'}</h2></div><button className="finance-icon-button" aria-label="Close record details" onClick={onClose}><X size={20} /></button></div>
    {row && <><dl className="finance-record-details">{Object.entries(row).filter(([key, value]) => value != null && !['id', 'caseId', 'fileUrl', 'proofUrl', 'fundId', 'band'].includes(key)).map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1')}</dt><dd>{['amount', 'earnedFee', 'eligibleBase', 'unfundedBase', 'netCost', 'refund', 'outstanding', 'contractValue', 'billed', 'collected', 'directCosts', 'allBilled', 'unbilled', 'inflow', 'outflow'].includes(key) ? money(value) : key === 'status' ? statusLabel(value) : String(value)}</dd></div>)}</dl>
      {canManage && row.recordType === 'invoice' && !String(row.id).includes(':') && <PaymentTerms key={String(row.id)} row={row} />}
      {row.caseId && <Link className="finance-button primary" to={`/cases/${row.caseId}?tab=billing`} onClick={onClose}>Open matter billing<ArrowUpRight size={16} /></Link>}
      {['fileUrl', 'proofUrl'].filter(key => row[key]).map(key => {
        const raw = String(row[key]); const href = raw.startsWith('/uploads/') ? `${String(import.meta.env.VITE_API_URL).replace(/\/api\/?$/, '')}${raw}` : /^https?:\/\//i.test(raw) ? raw : '';
        return href ? <a key={key} className="finance-button" href={href} target="_blank" rel="noreferrer">{key === 'proofUrl' ? 'Payment proof' : 'Supporting document'}<ExternalLink size={15} /></a> : null;
      })}</>}
  </div></dialog>;
}
