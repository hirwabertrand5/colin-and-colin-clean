import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CalendarClock, CheckCircle2, Search, TriangleAlert } from 'lucide-react';

import usePageTitle from '../../hooks/usePageTitle';
import { CaseData, getAllCases } from '../../services/caseService';
import { FirmCalendarEvent, getFirmEvents } from '../../services/eventService';
import { formatDeadlineDateTime, getDeadlinePillClass, resolveDeadlineDateTime } from '../../utils/workflowDeadline';

export type DeadlineView = 'all' | 'litigation' | 'transaction' | 'regulatory' | 'internal' | 'upcoming' | 'missed' | 'compliance';

const PAGE_SIZE = 10;
const ALL_FROM = '2000-01-01';
const ALL_TO = '2100-12-31';
const normalize = (value?: string | null) => String(value || '').trim().toLowerCase();
const dateKey = (value?: string) => {
  const date = resolveDeadlineDateTime(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
};
const todayKey = () => dateKey(new Date().toISOString());
const isValidDate = (value?: string) => Boolean(resolveDeadlineDateTime(value));
const eventType = (event: FirmCalendarEvent) => normalize(event.type);
const matterType = (matter?: CaseData | null) => normalize(matter?.caseType || matter?.matterType || matter?.workflow);

const details: Record<DeadlineView, { title: string; description: string; empty: string }> = {
  all: { title: 'All Deadlines', description: 'All recorded Deadline events and automated workflow deadlines.', empty: 'No deadline records found.' },
  litigation: { title: 'Litigation Deadlines', description: 'Recorded deadlines associated with litigation matters.', empty: 'No litigation deadlines found.' },
  transaction: { title: 'Transaction Deadlines', description: 'Recorded deadlines associated with transactional matters.', empty: 'No transaction deadlines found.' },
  regulatory: { title: 'Regulatory Deadlines', description: 'Recorded deadlines classified as regulatory.', empty: 'No regulatory deadlines found.' },
  internal: { title: 'Internal Deadlines', description: 'Recorded deadlines classified as internal.', empty: 'No internal deadlines found.' },
  upcoming: { title: 'Upcoming Deadlines', description: 'Recorded deadlines from today through the selected horizon.', empty: 'No upcoming deadlines found.' },
  missed: { title: 'Missed Deadlines', description: 'Past recorded deadlines without a completion signal in the current data model.', empty: 'No missed deadlines found.' },
  compliance: { title: 'Deadline Compliance', description: 'Compliance measures calculated from deadline records with available completion dates.', empty: 'No deadline compliance data available.' },
};

const eventIsCompleted = (_event: FirmCalendarEvent) => false;
const daysBetween = (left: Date, right: Date) => Math.round((left.getTime() - right.getTime()) / 86400000);

function Kpi({ label, value, icon: Icon }: { label: string; value: string; icon: typeof CalendarClock }) {
  return <div className="rounded-lg border border-gray-200 bg-white p-4"><div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-gray-500"><Icon size={16} />{label}</div><div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div></div>;
}

function LoadingSkeleton() {
  return <div className="space-y-6"><div className="h-8 w-52 animate-pulse rounded bg-gray-200" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-lg border border-gray-200 bg-white" />)}</div><div className="overflow-hidden rounded-lg border border-gray-200 bg-white p-4"><div className="space-y-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="flex gap-3"><div className="h-9 w-10 animate-pulse rounded bg-gray-200" /><div className="h-9 flex-1 animate-pulse rounded bg-gray-200" /><div className="hidden h-9 w-36 animate-pulse rounded bg-gray-200 md:block" /></div>)}</div></div></div>;
}

function Pagination({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (page: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-4 text-sm text-gray-600"><span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span><div className="flex gap-1"><button type="button" disabled={page === 1} onClick={() => onChange(Math.max(1, page - 1))} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Previous</button>{Array.from({ length: totalPages }, (_, index) => index + 1).map((number) => <button type="button" key={number} onClick={() => onChange(number)} className={`rounded border px-3 py-1.5 ${number === page ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white'}`}>{number}</button>)}<button type="button" disabled={page === totalPages} onClick={() => onChange(Math.min(totalPages, page + 1))} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Next</button></div></div>;
}

export default function DeadlineManagementPage({ view }: { view: DeadlineView }) {
  const detail = details[view];
  const [events, setEvents] = useState<FirmCalendarEvent[]>([]);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [search, setSearch] = useState('');
  const [horizon, setHorizon] = useState('30');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  usePageTitle(detail.title);

  useEffect(() => {
    let mounted = true;
    Promise.all([getFirmEvents({ from: ALL_FROM, to: ALL_TO, type: 'Deadline' }), getAllCases()])
      .then(([eventData, caseData]) => {
        if (!mounted) return;
        setEvents(eventData.filter((event) => eventType(event) === 'deadline'));
        setCases(caseData);
      })
      .catch((loadError) => mounted && setError(loadError?.message || 'Failed to load deadlines.'))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  const caseMap = useMemo(() => new Map(cases.filter((matter) => matter._id).map((matter) => [matter._id as string, matter])), [cases]);
  const filtered = useMemo(() => {
    const today = todayKey();
    const horizonDate = new Date();
    horizonDate.setDate(horizonDate.getDate() + Number(horizon));
    const horizonKey = dateKey(horizonDate.toISOString());
    const term = normalize(search);

    return events.filter((event) => {
      const matter = caseMap.get(event.caseId);
      const due = dateKey(event.date);
      if (!due) return false;
      const type = eventType(event);
      const matchesView = view === 'all'
        || (view === 'litigation' && matterType(matter).includes('litigation'))
        || (view === 'transaction' && (matterType(matter).includes('transaction') || matterType(matter).includes('transactional')))
        || (view === 'regulatory' && (normalize(event.title).includes('regulatory') || normalize(event.description).includes('regulatory')))
        || (view === 'internal' && (normalize(event.title).includes('internal') || normalize(event.description).includes('internal')))
        || (view === 'upcoming' && due >= today && due <= horizonKey)
        || (view === 'missed' && due < today && !eventIsCompleted(event))
        || view === 'compliance';
      const searchable = [event.title, event.description, event.type, event.date, event.time, matter?.caseNo, matter?.parties, matter?.caseType, matter?.matterType].map(normalize).join(' ');
      return matchesView && (!term || searchable.includes(term));
    }).sort((left, right) => `${left.date}${left.time || ''}`.localeCompare(`${right.date}${right.time || ''}`));
  }, [caseMap, events, horizon, search, view]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => setPage(1), [horizon, search, view]);
  useEffect(() => setPage((currentPage) => Math.min(currentPage, totalPages)), [totalPages]);

  const compliance = useMemo(() => {
    const due = events.filter((event) => isValidDate(event.date) && dateKey(event.date) <= todayKey());
    const met = due.filter((event) => eventIsCompleted(event));
    const missed = due.filter((event) => !eventIsCompleted(event));
    const criticalUpcoming = events.filter((event) => {
      const key = dateKey(event.date);
      const today = todayKey();
      const sevenDays = new Date();
      sevenDays.setDate(sevenDays.getDate() + 7);
      return key >= today && key <= dateKey(sevenDays.toISOString());
    });
    return { due, met, missed, criticalUpcoming };
  }, [events]);

  if (loading) return <LoadingSkeleton />;

  return <div><div className="mb-6 flex items-start justify-between gap-4"><div><Link to="/calendar" className="mb-3 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> Calendar</Link><h1 className="text-2xl font-semibold text-gray-900">{detail.title}</h1><p className="mt-1 text-gray-600">{detail.description}</p></div><div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs text-gray-500 shadow-sm">Source: Calendar Deadline events and workflow deadlines</div></div>
    {error && <div className="mb-4 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={17} />{error}</div>}
    {view === 'compliance' && <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><TriangleAlert size={16} className="mr-2 inline" />The current deadline event model has no completion/completedAt field. Compliance and average delay therefore remain unavailable rather than treating missing completion as success.</div>}
    {view === 'compliance' ? <><div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><Kpi icon={CalendarClock} label="Deadlines Due" value={String(compliance.due.length)} /><Kpi icon={CheckCircle2} label="Deadlines Met" value={String(compliance.met.length)} /><Kpi icon={TriangleAlert} label="Missed" value={String(compliance.missed.length)} /><Kpi icon={CheckCircle2} label="Compliance" value={compliance.due.length ? `${Math.round((compliance.met.length / compliance.due.length) * 100)}%` : '—'} /><Kpi icon={CalendarClock} label="Critical Upcoming" value={String(compliance.criticalUpcoming.length)} /></div><DeadlineTable rows={paginated} page={page} pageSize={PAGE_SIZE} totalPages={totalPages} total={filtered.length} empty={detail.empty} onPageChange={setPage} caseMap={caseMap} /></> : <><div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Kpi icon={CalendarClock} label="Deadlines" value={String(filtered.length)} /><Kpi icon={CheckCircle2} label="Upcoming" value={String(events.filter((event) => dateKey(event.date) >= todayKey()).length)} /><Kpi icon={TriangleAlert} label="Past Incomplete" value={String(events.filter((event) => dateKey(event.date) < todayKey() && !eventIsCompleted(event)).length)} /></div><div className="mb-6 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search deadline, matter, client..." className="w-full rounded-md border border-gray-300 py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-gray-400" /></div>{view === 'upcoming' && <select value={horizon} onChange={(event) => setHorizon(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2"><option value="7">Next 7 days</option><option value="30">Next 30 days</option><option value="90">Next 90 days</option></select>}</div><DeadlineTable rows={paginated} page={page} pageSize={PAGE_SIZE} totalPages={totalPages} total={filtered.length} empty={detail.empty} onPageChange={setPage} caseMap={caseMap} /></>}</div>;
}

function DeadlineTable({ rows, page, pageSize, totalPages, total = rows.length, empty, onPageChange, caseMap }: { rows: FirmCalendarEvent[]; page: number; pageSize: number; totalPages: number; total?: number; empty: string; onPageChange: (page: number) => void; caseMap: Map<string, CaseData> }) {
  return <div className="overflow-hidden rounded-lg border border-gray-200 bg-white"><div className="overflow-x-auto">{rows.length === 0 ? <div className="p-12 text-center text-sm text-gray-500">{empty}</div> : <table className="min-w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Deadline</th><th className="px-4 py-3">Matter / Client</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Due Date</th><th className="px-4 py-3">Status</th></tr></thead><tbody>{rows.map((event, index) => { const matter = caseMap.get(event.caseId); const past = dateKey(event.date) < todayKey(); return <tr key={event._id || `${event.caseId}-${event.date}-${event.title}`} className="border-t border-gray-100 align-top hover:bg-gray-50"><td className="px-4 py-4 text-gray-500">{(page - 1) * pageSize + index + 1}</td><td className="px-4 py-4"><div className="font-medium text-gray-900">{event.title || 'Untitled deadline'}</div><div className="mt-1 text-xs text-gray-500">{event.automated ? 'Workflow deadline' : event.description || '—'}</div></td><td className="px-4 py-4"><Link to={event.caseId ? `/matters/${event.caseId}` : '/matters'} className="font-medium text-blue-700 hover:underline">{matter?.caseNo || 'Matter unavailable'}</Link><div className="text-xs text-gray-500">{matter?.parties || 'Client unavailable'}</div></td><td className="px-4 py-4">{event.type || 'Deadline'}</td><td className={`px-4 py-4 text-xs ${getDeadlinePillClass(event.date)}`}>{formatDeadlineDateTime(`${event.date}T${event.time || '12:00'}`)}</td><td className="px-4 py-4"><span className={`rounded-full border px-2 py-1 text-xs font-medium ${past ? 'border-red-100 bg-red-50 text-red-700' : 'border-blue-100 bg-blue-50 text-blue-700'}`}>{past ? 'Past / completion unavailable' : 'Upcoming'}</span></td></tr>; })}</tbody></table>}</div>{total > 0 && <Pagination page={page} totalPages={totalPages} total={total} onChange={onPageChange} />}</div>;
}