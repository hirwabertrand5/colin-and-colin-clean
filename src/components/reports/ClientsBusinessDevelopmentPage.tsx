import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, BriefcaseBusiness, ChartNoAxesCombined, DollarSign, UsersRound } from 'lucide-react';

import { UserRole } from '../../App';
import { CaseData, getAllCases } from '../../services/caseService';
import { FirmReportRange, getFirmReports, FirmReportResponse } from '../../services/firmReportsService';
import { Invoice, listInvoices } from '../../services/invoiceService';
import { getAllProspects, Prospect, ProspectStage } from '../../services/prospectService';
import { listClientExperienceComplaints, listClientExperienceRedFlags, listClientExperienceRequests, listClientExperienceResponses } from '../../services/clientExperienceService';
import usePageTitle from '../../hooks/usePageTitle';

const PAGE_SIZE = 10;
const managementRoles: UserRole[] = ['managing_director', 'managing_partner', 'executive_managing_partner'];

type ViewKey = 'client-0' | 'client-1' | 'client-2' | 'client-3' | 'client-4' | 'client-5' | 'business-0' | 'business-1' | 'business-2' | 'business-3' | 'business-4' | 'business-5' | 'business-6' | 'business-7' | 'experience-0' | 'experience-1' | 'experience-2' | 'experience-3' | 'experience-4' | 'experience-5' | 'experience-6' | 'experience-7';

const viewDetails: Record<ViewKey, { title: string; description: string; kind: 'clients' | 'pipeline' | 'experience' }> = {
  'client-0': { title: 'Client Portfolio', description: 'Unique clients derived from the authoritative matter records.', kind: 'clients' },
  'client-1': { title: 'Client Financials', description: 'Billed, collected and outstanding amounts linked to each client matter.', kind: 'clients' },
  'client-2': { title: 'Client Profitability', description: 'Client profitability from the existing Firm Reports client profitability calculation.', kind: 'clients' },
  'client-3': { title: 'Client Relationship', description: 'Matter and contact relationship data available from the current matter model.', kind: 'clients' },
  'client-4': { title: 'Client Risk', description: 'Open client risk records from the existing risk system.', kind: 'experience' },
  'client-5': { title: 'Client Experience', description: 'Client experience records from feedback and complaint systems.', kind: 'experience' },
  'business-0': { title: 'Prospect & Intake', description: 'The existing prospect and intake workflow, surfaced for management reporting.', kind: 'pipeline' },
  'business-1': { title: 'Pipeline', description: 'Active prospect pipeline based on estimated fee values.', kind: 'pipeline' },
  'business-2': { title: 'Opportunities', description: 'Qualified opportunities represented by the existing prospect conversion workflow.', kind: 'pipeline' },
  'business-3': { title: 'Proposals & Quotations', description: 'Quotation values and quotation stages recorded on prospect records.', kind: 'pipeline' },
  'business-4': { title: 'Conversion', description: 'Conversion performance from qualified and converted prospect records.', kind: 'pipeline' },
  'business-5': { title: 'Lost Opportunities', description: 'Non-converted prospects and their recorded estimated fee values.', kind: 'pipeline' },
  'business-6': { title: 'Referral Sources', description: 'Prospect pipeline grouped by the referral source stored at intake.', kind: 'pipeline' },
  'business-7': { title: 'Revenue Forecast', description: 'Expected prospect fees. Probability is unavailable because no authoritative probability field or mapping exists.', kind: 'pipeline' },
  'experience-0': { title: 'Lost Prospect Feedback', description: 'Feedback records linked to non-converted prospects.', kind: 'experience' },
  'experience-1': { title: 'Mid-Matter Feedback', description: 'Feedback requests linked to active matters.', kind: 'experience' },
  'experience-2': { title: 'Matter Completion Feedback', description: 'Feedback requests linked to completed matters.', kind: 'experience' },
  'experience-3': { title: 'Client Satisfaction', description: 'Satisfaction responses from the client experience system.', kind: 'experience' },
  'experience-4': { title: 'Complaints', description: 'Complaint records from the client experience system.', kind: 'experience' },
  'experience-5': { title: 'Red Flags', description: 'Open red flags from the client experience and risk systems.', kind: 'experience' },
  'experience-6': { title: 'Follow-Up Actions', description: 'Feedback follow-up tasks from the existing task system.', kind: 'experience' },
  'experience-7': { title: 'Client Experience Analytics', description: 'Aggregated feedback and response measures from authoritative experience records.', kind: 'experience' },
};

const clientView = (view: ViewKey) => view.startsWith('client-');
const pipelineView = (view: ViewKey) => view.startsWith('business-');
const terminalStages: ProspectStage[] = ['Converted', 'Non-Converted'];
const normalize = (value?: string | null) => String(value || '').trim().toLowerCase();
const money = (value: number) => `RWF ${Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-US')}`;
const numberValue = (value: number) => value.toLocaleString('en-US');
const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : Number(String(value || '').replace(/[^\d.-]/g, '')) || 0;

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="flex min-h-24 flex-col justify-between rounded-lg border border-gray-200 bg-white p-4"><div className="text-xs uppercase tracking-[0.16em] text-gray-500">{label}</div><div className="mt-3 break-words text-2xl font-semibold leading-tight text-gray-900">{value}</div></div>;
}

function LoadingSkeleton() {
  return <div className="space-y-6"><div className="h-8 w-64 animate-pulse rounded bg-gray-200" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-lg border border-gray-200 bg-white" />)}</div><div className="overflow-hidden rounded-lg border border-gray-200 bg-white p-4"><div className="space-y-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="flex gap-3"><div className="h-9 w-10 animate-pulse rounded bg-gray-200" /><div className="h-9 flex-1 animate-pulse rounded bg-gray-200" /><div className="hidden h-9 w-40 animate-pulse rounded bg-gray-200 md:block" /></div>)}</div></div></div>;
}

function Pagination({ page, pages, total, onChange }: { page: number; pages: number; total: number; onChange: (page: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-4 text-sm text-gray-600"><span>Showing {total ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, total)} of {total}</span><div className="flex gap-1"><button type="button" disabled={page === 1} onClick={() => onChange(page - 1)} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Previous</button>{Array.from({ length: pages }, (_, index) => index + 1).map((number) => <button type="button" key={number} onClick={() => onChange(number)} className={`rounded border px-3 py-1.5 ${number === page ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white'}`}>{number}</button>)}<button type="button" disabled={page === pages} onClick={() => onChange(page + 1)} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Next</button></div></div>;
}

type ClientRow = { name: string; matters: CaseData[]; billed: number; collected: number; outstanding: number; report?: FirmReportResponse['clientProfitability'][number] };

export default function ClientsBusinessDevelopmentPage({ userRole }: { userRole: UserRole }) {
  const [params] = useSearchParams();
  const rawView = params.get('view') as ViewKey | null;
  const view = rawView && viewDetails[rawView] ? rawView : 'client-0';
  const detail = viewDetails[view];
  const [cases, setCases] = useState<CaseData[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [report, setReport] = useState<FirmReportResponse | null>(null);
  const [experience, setExperience] = useState<Record<string, any[]>>({ requests: [], responses: [], complaints: [], redFlags: [] });
  const [range, setRange] = useState<FirmReportRange>('monthly');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const permitted = managementRoles.includes(userRole);

  usePageTitle(detail.title);

  useEffect(() => {
    if (!permitted) return;
    let mounted = true;
    setLoading(true);
    setError('');
    const needsExperience = detail.kind === 'experience';
    Promise.all([getAllCases(), listInvoices(), getAllProspects({ includeTerminal: true }), getFirmReports({ range, basis: 'invoiceDate' }), needsExperience ? listClientExperienceRequests().catch(() => []) : Promise.resolve([]), needsExperience ? listClientExperienceResponses().catch(() => []) : Promise.resolve([]), needsExperience ? listClientExperienceComplaints().catch(() => []) : Promise.resolve([]), needsExperience ? listClientExperienceRedFlags().catch(() => []) : Promise.resolve([])])
      .then(([caseData, invoiceData, prospectData, reportData, requests, responses, complaints, redFlags]) => {
        if (!mounted) return;
        setCases(caseData); setInvoices(invoiceData); setProspects(prospectData); setReport(reportData);
        setExperience({ requests, responses, complaints, redFlags });
      })
      .catch((loadError: any) => mounted && setError(loadError?.message || 'Failed to load clients and business development data.'))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [permitted, range]);

  const clients = useMemo<ClientRow[]>(() => {
    const grouped = new Map<string, CaseData[]>();
    cases.forEach((matter) => {
      const name = String(matter.parties || '').trim();
      if (name) grouped.set(normalize(name), [...(grouped.get(normalize(name)) || []), matter]);
    });
    return Array.from(grouped.entries()).map(([key, matters]) => {
      const clientInvoices = invoices.filter((invoice) => matters.some((matter) => String(matter._id) === String(invoice.caseId)));
      const billed = clientInvoices.reduce((sum, invoice) => sum + amount(invoice.amount), 0);
      const collected = clientInvoices.filter((invoice) => invoice.status === 'Paid').reduce((sum, invoice) => sum + amount(invoice.amount), 0);
      return { name: matters[0].parties || key, matters, billed, collected, outstanding: Math.max(0, billed - collected), report: report?.clientProfitability.find((item) => normalize(item.partyName) === key) };
    }).sort((left, right) => right.matters.length - left.matters.length);
  }, [cases, invoices, report]);

  const activeProspects = useMemo(() => prospects.filter((prospect) => prospect.isActive && !terminalStages.includes(prospect.stage)), [prospects]);
  const qualifiedProspects = useMemo(() => prospects.filter((prospect) => ['Conversion Assessment', 'Quotation Issued', 'Awaiting Client Decision', 'Final Follow-Up', 'Engagement'].includes(prospect.stage)), [prospects]);
  const convertedProspects = prospects.filter((prospect) => prospect.stage === 'Converted');
  const lostProspects = prospects.filter((prospect) => prospect.stage === 'Non-Converted');
  const pipelineValue = activeProspects.reduce((sum, prospect) => sum + amount(prospect.estimatedFeeValue), 0);
  const quotedValue = prospects.filter((prospect) => prospect.quotationAmount != null).reduce((sum, prospect) => sum + amount(prospect.quotationAmount), 0);
  const experienceRows = useMemo(() => {
    if (view === 'experience-0') return experience.requests.filter((item) => item.clientType === 'prospect');
    if (view === 'experience-1' || view === 'experience-2') return experience.requests.filter((item) => item.clientType === 'matter');
    if (view === 'experience-3' || view === 'experience-7') return experience.responses;
    if (view === 'experience-4') return experience.complaints;
    if (view === 'experience-5') return experience.redFlags.filter((item) => normalize(item.status) === 'open' || !item.status);
    return [];
  }, [experience, view]);
  const filteredClients = clients.filter((client) => !search || `${client.name} ${client.matters.map((matter) => `${matter.caseNo} ${matter.matterType}`).join(' ')}`.toLowerCase().includes(normalize(search)));
  const filteredProspects = prospects.filter((prospect) => !search || `${prospect.clientName} ${prospect.prospectNo} ${prospect.stage} ${prospect.referralSource || ''} ${prospect.enquirySource || ''}`.toLowerCase().includes(normalize(search)));
  const tableRows = detail.kind === 'experience' ? experienceRows.filter((item) => !search || JSON.stringify(item).toLowerCase().includes(normalize(search))) : clientView(view) ? filteredClients : filteredProspects;
  const pages = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const visibleRows = tableRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => setPage(1), [search, view, range]);

  if (!permitted) return <div className="rounded-lg border border-gray-200 bg-white p-6"><h1 className="text-xl font-semibold text-gray-900">Access denied</h1><p className="mt-2 text-gray-600">You do not have permission to view Clients & Business Development.</p></div>;
  if (loading) return <LoadingSkeleton />;

  const experienceUnavailable = (detail.kind === 'experience' && experienceRows.length === 0) || view === 'business-7';
  const conversionRate = qualifiedProspects.length ? `${Math.round((convertedProspects.length / qualifiedProspects.length) * 100)}%` : '—';
  return <div><div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><Link to="/" className="mb-3 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> Management Dashboard</Link><h1 className="text-2xl font-semibold text-gray-900">{detail.title}</h1><p className="mt-1 text-gray-600">{detail.description}</p></div><div className="flex items-center gap-2"><label htmlFor="client-bd-range" className="text-sm text-gray-600">Period</label><select id="client-bd-range" value={range} onChange={(event) => setRange(event.target.value as FirmReportRange)} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></div></div>{error && <div className="mb-5 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={17} />{error}</div>}{experienceUnavailable && <div className="mb-5 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">No authoritative list or probability source is available for this view in the current frontend data contract. No unrelated client or prospect values are substituted.</div>}<div className="mb-6 grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Clients" value={numberValue(clients.length)} /><Metric label="Active Matters" value={numberValue(clients.reduce((sum, client) => sum + client.matters.filter((matter) => normalize(matter.status) !== 'closed').length, 0))} /><Metric label={pipelineView(view) ? 'Active Pipeline' : 'Billed'} value={pipelineView(view) ? money(pipelineValue) : money(clients.reduce((sum, client) => sum + client.billed, 0))} /><Metric label={pipelineView(view) ? 'Conversion Rate' : 'Collected'} value={pipelineView(view) ? conversionRate : money(clients.reduce((sum, client) => sum + client.collected, 0))} /></div>{pipelineView(view) && <div className="mb-5 grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Active Prospects" value={numberValue(activeProspects.length)} /><Metric label="Qualified Opportunities" value={numberValue(qualifiedProspects.length)} /><Metric label="Converted Prospects" value={numberValue(convertedProspects.length)} /><Metric label="Quoted Value" value={money(quotedValue)} /></div>}{!experienceUnavailable && <><div className="mb-5 flex flex-col gap-3 sm:flex-row"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={clientView(view) ? 'Search client or matter...' : 'Search prospect, stage or referral source...'} className="w-full rounded-md border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400" /></div><div className="overflow-hidden rounded-lg border border-gray-200 bg-white"><div className="overflow-x-auto">{visibleRows.length === 0 ? <div className="p-10 text-center text-sm text-gray-500">No records found.</div> : detail.kind === 'experience' ? <table className="min-w-[720px] w-full table-fixed text-left text-sm"><thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500"><tr><th className="w-10 px-3 py-3">#</th><th className="w-48 px-3 py-3">Record</th><th className="w-32 px-3 py-3">Client / Matter</th><th className="w-32 px-3 py-3">Type / Status</th><th className="w-36 px-3 py-3">Date</th></tr></thead><tbody>{(visibleRows as any[]).map((item, index) => <tr key={item._id || index} className="border-t border-gray-100 align-top hover:bg-gray-50"><td className="px-3 py-4 text-gray-500">{(page - 1) * PAGE_SIZE + index + 1}</td><td className="px-3 py-4"><div className="truncate font-medium text-gray-900" title={item.title || item.subject || item.feedbackType || item.complaintType || item.description}>{item.title || item.subject || item.feedbackType || item.complaintType || item.description || 'Record'}</div><div className="truncate text-xs text-gray-500">{item.email || item.clientEmail || item.resolution || 'Details unavailable'}</div></td><td className="px-3 py-4"><div className="truncate">{item.clientName || item.prospect?.clientName || item.matterId || 'Unavailable'}</div></td><td className="px-3 py-4"><div className="truncate">{item.feedbackType || item.type || item.complaintType || 'Experience'}</div><div className="text-xs text-gray-500">{item.status || 'Status unavailable'}</div></td><td className="px-3 py-4 text-gray-600">{item.createdAt || item.sentAt || item.dateReceived || '—'}</td></tr>)}</tbody></table> : clientView(view) ? <table className="min-w-[900px] w-full table-fixed text-left text-sm"><thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500"><tr><th className="w-10 px-3 py-3">#</th><th className="w-44 px-3 py-3">Client</th><th className="w-32 px-3 py-3">Status</th><th className="w-28 px-3 py-3">Active / Total</th><th className="w-32 px-3 py-3">Billed</th><th className="w-32 px-3 py-3">Collected</th><th className="w-32 px-3 py-3">Outstanding</th><th className="w-20 px-3 py-3">Action</th></tr></thead><tbody>{(visibleRows as ClientRow[]).map((client, index) => <tr key={client.name} className="border-t border-gray-100 align-top hover:bg-gray-50"><td className="px-3 py-4 text-gray-500">{(page - 1) * PAGE_SIZE + index + 1}</td><td className="px-3 py-4"><div className="truncate font-medium text-gray-900" title={client.name}>{client.name}</div><div className="truncate text-xs text-gray-500">{client.matters[0]?.clientContacts?.[0]?.name || 'Contact unavailable'}</div></td><td className="px-3 py-4">{client.matters.some((matter) => normalize(matter.status) !== 'closed') ? 'Active' : 'Completed'}</td><td className="px-3 py-4">{client.matters.filter((matter) => normalize(matter.status) !== 'closed').length} / {client.matters.length}</td><td className="px-3 py-4 font-semibold">{money(client.billed)}</td><td className="px-3 py-4 font-semibold">{money(client.collected)}</td><td className="px-3 py-4 font-semibold">{money(client.outstanding)}</td><td className="px-3 py-4"><Link to={`/management/clients-business-development?view=client-0&client=${encodeURIComponent(client.name)}`} className="text-sm font-medium text-blue-700 hover:underline">Open</Link></td></tr>)}</tbody></table> : <table className="min-w-[980px] w-full table-fixed text-left text-sm"><thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500"><tr><th className="w-10 px-3 py-3">#</th><th className="w-40 px-3 py-3">Prospect</th><th className="w-32 px-3 py-3">Stage</th><th className="w-32 px-3 py-3">Practice Area</th><th className="w-32 px-3 py-3">Estimated Fee</th><th className="w-32 px-3 py-3">Referral Source</th><th className="w-32 px-3 py-3">Responsible Partner</th><th className="w-20 px-3 py-3">Action</th></tr></thead><tbody>{(visibleRows as Prospect[]).map((prospect, index) => <tr key={prospect._id} className="border-t border-gray-100 align-top hover:bg-gray-50"><td className="px-3 py-4 text-gray-500">{(page - 1) * PAGE_SIZE + index + 1}</td><td className="px-3 py-4"><Link to={`/matters/intake-prospects/${prospect._id}`} className="font-medium text-blue-700 hover:underline">{prospect.clientName}</Link><div className="truncate text-xs text-gray-500">{prospect.prospectNo}</div></td><td className="px-3 py-4"><span className="truncate" title={prospect.stage}>{prospect.stage}</span><div className="text-xs text-gray-500">{prospect.isActive ? 'Active' : 'Inactive'}</div></td><td className="px-3 py-4"><span className="truncate">{prospect.legalServicePath?.at(-1)?.label || 'Unavailable'}</span></td><td className="px-3 py-4 font-semibold">{prospect.estimatedFeeValue == null ? '—' : money(amount(prospect.estimatedFeeValue))}</td><td className="px-3 py-4"><span className="truncate" title={prospect.referralSource || 'Not recorded'}>{prospect.referralSource || 'Not recorded'}</span></td><td className="px-3 py-4"><span className="truncate">{typeof prospect.responsiblePartner === 'object' ? prospect.responsiblePartner.name : prospect.responsiblePartner || 'Not assigned'}</span></td><td className="px-3 py-4"><Link to={`/matters/intake-prospects/${prospect._id}`} className="text-sm font-medium text-blue-700 hover:underline">Open</Link></td></tr>)}</tbody></table>}</div>{tableRows.length > 0 && <Pagination page={page} pages={pages} total={tableRows.length} onChange={setPage} />}</div></>}{view === 'business-7' && <div className="mt-5 rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-600">Pipeline value: {money(pipelineValue)}. Expected revenue is unavailable because the current Prospect model does not expose a conversion probability.</div>}</div>;
}
