import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, ArrowUpDown, BriefcaseBusiness, CalendarDays, Check, ChevronLeft, ChevronRight, Coins, Download, FileText, Filter, Landmark, RefreshCw, Search, ShoppingCart, Wallet, X } from 'lucide-react';
import type { UserRole } from '../../App';
import usePageTitle from '../../hooks/usePageTitle';
import { REPORT_PERIOD_OPTIONS } from '../../constants/reportPeriods';
import { getDataRevision, subscribeDataChanges } from '../../services/navigationRequest';
import { readFinanceWorkspace, type FinanceParams, type FinanceRow, type FinanceSection, type FinanceWorkspace } from '../../services/financeWorkspaceService';
import { Ageing, cell, Forecast, getColumns, Metric, money, pct, RecordDetail, SourceGuide, statusLabel, Trend } from './FinanceWorkspaceParts';
import './finance-workspace.css';

export type BillingFinanceView = string;
const roles = ['managing_director', 'managing_partner', 'executive_managing_partner', 'executive_assistant'];
const config = {
  'financial-dashboard': { title: 'Financial Dashboard', description: 'A clear view of fees, collections and the cost of running the firm.', icon: Landmark, table: 'Matter financial ledger', tabs: [['all', 'Overview']] },
  invoicing: { title: 'Billing & Invoicing', description: 'Track issued invoices, payment status and completed work ready for billing.', icon: FileText, table: 'Invoice register', tabs: [['all', 'All invoices'], ['Paid', 'Paid'], ['Pending', 'Pending'], ['Overdue', 'Overdue'], ['triggers', 'Billing opportunities']] },
  collections: { title: 'Collections & Receivables', description: 'Prioritise unpaid balances and understand what needs follow-up.', icon: ArrowDownLeft, table: 'Receivables & payment follow-up', tabs: [['all', 'All receivables'], ['Overdue', 'Overdue'], ['unknown', 'Missing payment terms']] },
  'cash-flow': { title: 'Cash & Cash Flow', description: 'Follow recorded money in and out, then explore the next 30 days.', icon: Wallet, table: 'Cash movement register', tabs: [['all', 'All movements'], ['inflows', 'Cash inflows'], ['outflows', 'Cash outflows'], ['forecast', 'Cash forecast']] },
  expenses: { title: 'Expenses & Procurement', description: 'Control matter costs, operating spend and purchases by supplier.', icon: ShoppingCart, table: 'Expense register', tabs: [['all', 'All expenses'], ['Direct matter cost', 'Direct matter costs'], ['Operating expense', 'Operating expenses'], ['vendors', 'Vendor spend']] },
  remuneration: { title: 'Firm Remuneration', description: 'Trace earned fees to completed work, collections and staff allocations.', icon: Coins, table: 'Completed work & earned fees', tabs: [['all', 'Fee earned'], ['by-staff', 'By staff'], ['by-role', 'By role'], ['by-matter', 'By matter'], ['balances', 'Remuneration balances']] },
};
const legacyTabs: Record<string, string> = { paid: 'Paid', pending: 'Pending', issued: 'Pending', overdue: 'Overdue', 'collections-overdue': 'Overdue', 'cash-inflows': 'inflows', 'cash-outflows': 'outflows', 'cash-forecast': 'forecast', 'expense-direct-costs': 'Direct matter cost', 'expense-operating': 'Operating expense', procurement: 'vendors', 'billing-triggers': 'triggers', 'by-role': 'by-role', 'by-staff': 'by-staff', 'by-matter': 'by-matter', accrued: 'accrued', payable: 'payable', deferred: 'deferred', 'remuneration-paid': 'paid' };

export default function BillingFinancePage({ view, userRole }: { view: BillingFinanceView; userRole: UserRole }) {
  const location = useLocation();
  const section = (location.pathname.match(/\/billing\/finance\/([^/]+)/)?.[1] || 'financial-dashboard') as FinanceSection;
  const current = config[section] || config['financial-dashboard'];
  const Icon = current.icon;
  usePageTitle(current.title);
  const [url, setUrl] = useSearchParams();
  const update = (values: Record<string, string | number | null>, replace = false) => setUrl(previous => {
    const next = new URLSearchParams(previous); next.delete('page');
    Object.entries(values).forEach(([key, value]) => { if (value == null || value === '') next.delete(key); else next.set(key, String(value)); });
    return next;
  }, { replace });
  const period = url.get('range') || 'ytd';
  const tab = url.get('tab') || legacyTabs[view] || 'all';
  const [input, setInput] = useState(url.get('q') || '');
  const [report, setReport] = useState<FinanceWorkspace | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [errorKey, setErrorKey] = useState('');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const lastRefresh = useRef(0);
  const [exporting, setExporting] = useState(false);
  const [slow, setSlow] = useState(false);
  const [detail, setDetail] = useState<FinanceRow | null>(null);
  const revision = useSyncExternalStore(subscribeDataChanges, getDataRevision, getDataRevision);
  const permitted = roles.includes(userRole);
  useEffect(() => setInput(url.get('q') || ''), [url.get('q')]);
  useEffect(() => {
    if (input === (url.get('q') || '')) return;
    const timer = setTimeout(() => update({ q: input }, true), 220);
    return () => clearTimeout(timer);
  }, [input]);
  const params: FinanceParams = useMemo(() => ({ range: period, ...(period === 'custom' ? { from: url.get('from') || '', to: url.get('to') || '' } : {}),
    tab, q: url.get('q') || '', status: url.get('status') || (['Paid', 'Pending', 'Overdue', 'unknown', 'Direct matter cost', 'Operating expense'].includes(tab) ? tab : 'all'),
    servicePath: url.get('servicePath') || '', staff: url.get('staff') || '', role: url.get('role') || '', fund: url.get('fund') || '',
    sort: url.get('sort') || 'date', dir: url.get('dir') || 'desc', page: Math.max(1, Number(url.get('page')) || 1), pageSize: Number(url.get('pageSize')) || 10 }), [url.toString(), tab]);
  const scopeKey = JSON.stringify([section, params, revision, refresh]);
  const customError = period === 'custom' && (!params.from || !params.to ? 'Choose both dates to load a custom period.' : params.from > params.to ? 'The From date must be on or before the To date.' : '');
  const ready = loadedKey === scopeKey && report?.section === section && !customError;
  const failed = errorKey === scopeKey && error;
  useEffect(() => {
    if (!permitted || customError) return;
    let active = true;
    const controller = new AbortController();
    setSlow(false);
    const slowTimer = setTimeout(() => { if (active) setSlow(true); }, 2000);
    setDetail(null);
    const force = lastRefresh.current !== refresh;
    lastRefresh.current = refresh;
    readFinanceWorkspace(section, params, force, controller.signal).then(data => {
      if (!active) return;
      clearTimeout(slowTimer); setSlow(false);
      setReport(data); setLoadedKey(scopeKey); setError(''); setErrorKey('');
    }).catch(reason => { if (active && reason.name !== 'AbortError') { clearTimeout(slowTimer); setSlow(false); setError(reason.message); setErrorKey(scopeKey); } });
    return () => { active = false; clearTimeout(slowTimer); controller.abort(); };
  }, [scopeKey, permitted, customError]);
  const selectedPath = (params.servicePath || '').split('/').filter(Boolean);
  const options = report?.section === section ? report.options : null;
  const columns = getColumns(section, tab);
  const m = report?.metrics || {};
  const balances = section === 'remuneration' && ['balances', 'accrued', 'payable', 'deferred', 'paid'].includes(tab);
  const exportRows = async (format: 'excel' | 'pdf') => {
    if (!ready || !report || exporting) return;
    setExporting(true);
    try {
      const first = await readFinanceWorkspace(section, { ...params, page: 1, pageSize: 100 });
      const rows = [...first.rows];
      for (let page = 2; page <= first.pagination.pages; page++) rows.push(...(await readFinanceWorkspace(section, { ...params, page, pageSize: 100 })).rows);
      const { downloadTableReport } = await import('../../utils/reportExport');
      await downloadTableReport(format, { filename: `finance_${section}_${report.range.to}`, title: current.title, subtitle: `${report.range.label}; ${tab}; ${params.q || 'all matching records'}`,
        columns: columns.map(column => ({ label: column.label, value: (row: FinanceRow) => column.type === 'money' || column.type === 'number' ? row[column.key] : cell(row, column), ...(column.type === 'money' ? { type: 'money' as const } : {}) })), rows });
    } catch (reason: any) { setError(reason.message || 'Unable to export records.'); setErrorKey(scopeKey); }
    finally { setExporting(false); }
  };
  if (!permitted) return <div className="finance-empty"><h1>Access denied</h1><p>Your account cannot view firm finance records.</p></div>;
  const metric = (key: string, label: string, detail?: string, accent?: string, percent = false) => <Metric key={key} label={label} value={percent ? pct(m[key]) : money(m[key])} detail={detail} accent={accent} />;
  const setTab = (key: string) => update({ tab: key, status: null, sort: null, dir: null, fund: null });
  return <div className="finance-workspace">
    <header className="finance-header"><div><div className="finance-breadcrumb"><Link to="/billing/finance/financial-dashboard">Billing & Finance</Link><ChevronRight size={13} /><span>{current.title}</span></div><div className="finance-title"><span className="finance-title-icon"><Icon size={24} /></span><div><h1>{current.title}</h1><p>{current.description}</p></div></div></div><Link className="finance-button" to="/matters"><BriefcaseBusiness size={16} />{section === 'invoicing' ? 'Bill a matter' : 'Open matters'}<ArrowUpRight size={15} /></Link></header>
    <section className="finance-filters" aria-label="Finance filters"><div className="finance-filter-fields"><label className="finance-field"><span><CalendarDays size={14} />Reporting period</span><select value={period} onChange={e => update({ range: e.target.value, from: null, to: null })}>{REPORT_PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      {period === 'custom' && <><label className="finance-field">From<input aria-label="From" type="date" value={params.from} onChange={e => update({ from: e.target.value })} /></label><label className="finance-field">To<input aria-label="To" type="date" value={params.to} min={params.from} onChange={e => update({ to: e.target.value })} /></label></>}
      {section !== 'remuneration' && Array.from({ length: Math.min(selectedPath.length + 1, 8) }, (_, depth) => {
        const parent = selectedPath.slice(0, depth).join('/');
        const choices = options?.services.filter(o => o.parent === parent) || [];
        if (!choices.length && depth) return null;
        return <label key={depth} className="finance-field"><span><Filter size={14} />{['Legal service', 'Category', 'Practice area', 'Service line'][depth] || 'Service detail'}</span><select aria-label={['Legal service', 'Category', 'Practice area', 'Service line'][depth] || `Service level ${depth + 1}`} value={selectedPath[depth] || ''} onChange={e => update({ servicePath: [...selectedPath.slice(0, depth), ...(e.target.value ? [e.target.value] : [])].join('/') })}><option value="">All {depth ? 'categories' : 'legal services'}</option>{choices.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>;
      })}
      {section === 'remuneration' && <><label className="finance-field">Staff member<select value={params.staff} onChange={e => update({ staff: e.target.value })}><option value="">All staff</option>{options?.staff.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label><label className="finance-field">Role<select value={params.role} onChange={e => update({ role: e.target.value })}><option value="">All roles</option>{options?.roles.map(role => <option key={role} value={role}>{role.replace(/_/g, ' ')}</option>)}</select></label></>}
      <button className="finance-button primary finance-refresh" disabled={!ready && !failed && !customError} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={15} className={!ready && !failed && !customError ? 'finance-spin' : ''} />Refresh</button>
    </div><div className="finance-filter-context"><span>{customError || (ready ? `${report!.range.from || 'Beginning'} → ${report!.range.to} · ${report!.timeZone} · All amounts in RWF` : 'Loading selected period…')}</span>{(selectedPath.length > 0 || params.staff || params.role || params.q || params.status !== 'all' || params.fund) && <button onClick={() => { setInput(''); update({ servicePath: null, staff: null, role: null, q: null, status: null, fund: null, tab: 'all' }); }}>Clear filters<X size={12} /></button>}</div></section>
    <nav className="finance-tabs" aria-label={`${current.title} views`}>{current.tabs.map(([key, label]) => <button key={key} aria-pressed={tab === key || key === 'balances' && balances} className={tab === key || key === 'balances' && balances ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {!balances && <div className="finance-query-bar"><label className="finance-search"><Search size={16} /><input aria-label="Search finance records" placeholder="Search reference, client, matter or staff…" value={input} onChange={e => setInput(e.target.value)} />{input && <button aria-label="Clear search" onClick={() => { setInput(''); update({ q: null }); }}><X size={14} /></button>}</label>
      {section === 'expenses' && tab !== 'vendors' && <label className="finance-field compact">Fund<select value={params.fund} onChange={e => update({ fund: e.target.value })}><option value="">All funds</option>{options?.funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      {params.status !== 'all' && <button className="finance-filter-chip" onClick={() => update({ status: null, tab: 'all' })}>{statusLabel(params.status)}<X size={12} /></button>}
      <label className="finance-field compact">Rows<select aria-label="Rows per page" value={params.pageSize} onChange={e => update({ pageSize: e.target.value })}>{[10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}</select></label></div>}
    {failed && <div className="finance-error" role="alert"><span>{error}</span><button className="finance-button" onClick={() => setRefresh(n => n + 1)}>Retry</button></div>}
    {customError ? <div className="finance-empty"><CalendarDays size={28} /><h2>Select your reporting dates</h2><p>{customError}</p></div> : !ready ? !failed && <div className="finance-loading" role="status" aria-label="Loading finance data"><p>{slow ? 'The server is taking longer than usual. Your request is still running…' : 'Loading selected period…'}</p><div className="finance-metrics">{[1, 2, 3, 4].map(i => <div key={i} />)}</div><div className="finance-loading-panel" /></div> : <>
      {section === 'financial-dashboard' && <><section className="finance-overview"><div className="finance-overview-main"><span className="finance-eyebrow">FIRM FINANCIAL POSITION</span><p>Net profit from recorded collections</p><strong>{money(m.netProfit)}</strong><span className="finance-overview-sub">Collected revenue − direct matter costs − operating expenses</span><div><span>Gross margin<b>{pct(m.grossMargin)}</b></span><span>Net margin<b>{pct(m.netMargin)}</b></span></div></div><div className="finance-overview-side"><span>Collections in the period</span><strong>{money(m.collected)}</strong><p>{pct(m.invoiceSettlementRate)} of this period’s billed value paid by the report end.</p><Link to="/billing/finance/collections">Review open receivables<ArrowUpRight size={16} /></Link></div></section>
        <div className="finance-metrics">{metric('contractValue', 'Contract value', 'Matters entered in this period')}{metric('billed', 'Total billed', `${m.invoiceCount || 0} invoices entered`)}{metric('outstanding', 'Open receivables', 'All unpaid invoices at period end', 'amber')}{metric('directCosts', 'Direct matter costs', 'Recorded costs less period refunds')}{metric('grossProfit', 'Gross profit', 'Collections less direct costs', 'green')}{metric('operatingExpenses', 'Operating expenses', 'Internal firm costs less refunds')}{metric('collectionRate', 'Collection rate', 'Period collections ÷ period billings', undefined, true)}{metric('invoiceSettlementRate', 'Period invoices settled', 'Paid share of invoices entered this period', undefined, true)}</div>
        <div className="finance-two-column"><Trend data={report!.trend} /><section className="finance-panel"><div className="finance-panel-heading"><div><h2>From collection to profit</h2><p>Recorded financial contribution for the period</p></div><Coins size={20} /></div><dl className="finance-bridge"><div><dt>Collected revenue</dt><dd>{money(m.collected)}</dd></div><div><dt>Direct matter costs</dt><dd>{money(m.directCosts)}</dd></div><div className="subtotal"><dt>Gross profit</dt><dd>{money(m.grossProfit)}</dd></div><div><dt>Operating expenses</dt><dd>{money(m.operatingExpenses)}</dd></div><div className="finance-bridge-total"><dt>Net profit</dt><dd>{money(m.netProfit)}</dd></div></dl><Link className="finance-text-link" to="/billing/finance/profitability">Open Profitability<ArrowUpRight size={15} /></Link></section></div></>}
      {section === 'invoicing' && <div className="finance-metrics"><Metric label="Number of invoices" value={String(m.invoiceCount || 0)} detail="Entered in the selected period" />{metric('billed', 'Total billed', 'Value of period invoices')}{metric('averageInvoice', 'Average invoice value', 'Total billed ÷ invoice count')}<Metric label="Payment status" value={`${m.paidCount || 0} paid · ${m.pendingCount || 0} pending`} detail={`${m.periodOverdueCount || 0} overdue · ${money(m.periodOutstanding)} open`} /></div>}
      {section === 'collections' && <><div className="finance-metrics">{metric('outstanding', 'Open receivables', 'All unpaid invoices at period end', 'amber')}{metric('overdue', 'Confirmed overdue', 'Unpaid invoices past recorded due date', 'rose')}{metric('collectionRate', 'Collection rate', 'Period collections ÷ period billings', undefined, true)}<Metric label="Average invoice age" value={m.averageDebtorAge == null ? '—' : `${Math.round(m.averageDebtorAge)} days`} detail="Balance-weighted age of open invoices" /></div><div className="finance-two-column"><Ageing report={report!} onSelect={status => update({ status, tab: 'all' })} /><section className="finance-panel"><div className="finance-panel-heading"><div><h2>Collection priorities</h2><p>Open a record to access its matter billing.</p></div><Check size={20} /></div><div className="finance-priority"><strong>{money(m.overdue)}</strong><span>confirmed overdue balance</span><p>Start with the oldest due dates and the largest open balances.</p><button className="finance-button" onClick={() => update({ tab: 'Overdue', status: null, sort: 'age', dir: 'desc' })}>Review overdue invoices<ArrowUpRight size={15} /></button></div><div className="finance-inline-note">{m.missingDueDates || 0} unpaid invoices have no due date. Record payment terms before treating these balances as overdue.</div></section></div></>}
      {section === 'cash-flow' && <><div className="finance-metrics">{metric('periodInflow', 'Cash inflows', 'Collections and expense refunds', 'green')}{metric('periodOutflow', 'Cash outflows', 'Recorded expense payments')}{metric('netCashFlow', 'Net cash movement', 'Inflows less outflows', (m.netCashFlow || 0) < 0 ? 'rose' : 'green')}{metric('pettyCash', 'Current petty cash', 'Live balance across active funds')}</div><div className="finance-two-column"><Trend data={report!.trend} cash /><Forecast key={`${period}:${params.from}:${params.to}`} report={report!} /></div><div className="finance-inline-note">Opening cumulative recorded movement: {money(m.openingMovement)} · Closing cumulative recorded movement: {money(m.closingMovement)}. These figures exclude unrecorded opening funds and do not establish a bank balance.</div></>}
      {section === 'expenses' && <><div className="finance-metrics">{metric('grossExpenses', 'Recorded expenses', 'Costs entered during the period')}{metric('refunds', 'Expense refunds', 'Refunds dated in the period', 'green')}{metric('directCosts', 'Direct matter costs', 'Costs assigned to client matters')}{metric('operatingExpenses', 'Operating expenses', 'Internal costs less refunds')}</div><section className="finance-expense-strip"><div><span>Net recorded costs</span><strong>{money(m.totalExpenses)}</strong></div><p>Refunds remain in their own period. A refund of an earlier expense can produce a negative net cost.</p>{tab === 'vendors' && <p>Supplier spend is based on recorded expenses. Purchase orders and approval stages need separate procurement records.</p>}</section></>}
      {section === 'remuneration' && <><div className="finance-metrics">{metric('earnedFee', 'Known earned fees', 'Calculated through the existing TPA engine', 'green')}{metric('eligibleBase', 'Funded work value', 'Completed action bases counted once')}{metric('unfundedBase', 'Unfunded work value', 'Completed value awaiting collection', 'amber')}<Metric label="Entries needing inputs" value={String(m.awaitingInput || 0)} detail={`${m.actions || 0} completed actions · ${m.staffCount || 0} staff`} /></div><div className="finance-inline-note">Earned fee = funded action value × TPA × timeliness × quality. Open any record to inspect its inputs. Missing scores remain unpriced.</div></>}
      {balances ? <section className="finance-panel"><div className="finance-panel-heading"><div><h2>Remuneration balances</h2><p>Approval and payment records determine these balances.</p></div><Coins size={20} /></div><div className="finance-metrics">{['Accrued', 'Payable', 'Deferred', 'Paid'].map(label => <Metric key={label} label={label} value="Not recorded" detail={label === 'Paid' ? 'Requires confirmed staff disbursements' : 'Requires a remuneration approval ledger'} />)}</div><p className="finance-footnote">The known earned fees above are calculated from completed work. Payroll balances need approval and disbursement records.</p></section>
        : <section className="finance-panel finance-register"><div className="finance-register-heading"><div><h2>{section === 'expenses' && tab === 'vendors' ? 'Vendor spend register' : section === 'invoicing' && tab === 'triggers' ? 'Completed work awaiting billing' : current.table}</h2><p>{report!.pagination.total.toLocaleString()} matching records · summaries above cover the period and service/staff filters</p></div><div className="finance-export"><button className="finance-button" disabled={exporting} onClick={() => void exportRows('excel')}><Download size={14} />{exporting ? 'Preparing…' : 'Excel'}</button><button className="finance-button" disabled={exporting} onClick={() => void exportRows('pdf')}>PDF</button></div></div>
          {report!.rows.length ? <div className="finance-table-scroll"><table><caption className="finance-sr-only">{current.table}</caption><thead><tr>{columns.map(c => <th key={c.key} scope="col" aria-sort={params.sort === c.key ? params.dir === 'asc' ? 'ascending' : 'descending' : 'none'} className={['money', 'number', 'percent'].includes(c.type || '') ? 'numeric' : ''}><button onClick={() => update({ sort: c.key, dir: params.sort === c.key && params.dir === 'asc' ? 'desc' : 'asc' })}>{c.label}<ArrowUpDown size={12} /></button></th>)}<th scope="col"><span className="finance-sr-only">Actions</span></th></tr></thead><tbody>{report!.rows.map(row => <tr key={String(row.id)}>{columns.map((c, i) => <td key={c.key} className={`${['money', 'number', 'percent'].includes(c.type || '') ? 'numeric' : ''} ${i === 0 ? 'finance-primary-cell' : ''}`}>{c.type === 'status' ? <span className={`finance-status status-${String(row.status).toLowerCase().replace(/[^a-z]/g, '')}`}>{cell(row, c)}</span> : cell(row, c)}{i === 0 && section === 'expenses' && row.matterNo && <small>{String(row.matterNo)}</small>}</td>)}<td><button className="finance-row-action" aria-label={`View ${row.reference}`} onClick={() => setDetail(row)}>Details<ChevronRight size={14} /></button></td></tr>)}</tbody></table></div> : <div className="finance-empty"><Search size={28} /><h3>No matching records</h3><p>Try another period, search term or filter.</p></div>}
          <footer className="finance-pagination"><span>{report!.pagination.total ? `${(report!.pagination.page - 1) * report!.pagination.pageSize + 1}–${Math.min(report!.pagination.page * report!.pagination.pageSize, report!.pagination.total)}` : '0'} of {report!.pagination.total} records</span><div><button aria-label="Previous page" disabled={report!.pagination.page === 1} onClick={() => update({ page: report!.pagination.page - 1 })}><ChevronLeft size={16} /></button><span>Page {report!.pagination.page} of {report!.pagination.pages}</span><button aria-label="Next page" disabled={report!.pagination.page >= report!.pagination.pages} onClick={() => update({ page: report!.pagination.page + 1 })}><ChevronRight size={16} /></button></div></footer>
        </section>}
      <SourceGuide notes={report!.notes} />
    </>}
    <RecordDetail row={detail} onClose={() => setDetail(null)} canManage={['managing_director', 'executive_assistant'].includes(userRole)} />
  </div>;
}
