import { navigationFetch, getDataRevision } from './navigationRequest';
import { API_URL } from './apiConfig';

export type FinanceSection = 'financial-dashboard' | 'invoicing' | 'collections' | 'cash-flow' | 'expenses' | 'remuneration';
export type FinanceRow = Record<string, string | number | boolean | null>;
export type FinanceParams = { range: string; from?: string; to?: string; tab: string; q?: string; status?: string; servicePath?: string;
  staff?: string; role?: string; fund?: string; sort: string; dir: string; page: number; pageSize: number };
export type FinanceWorkspace = {
  section: FinanceSection;
  range: { key: string; from: string | null; to: string; label: string };
  currency: string; timeZone: string;
  metrics: Record<string, number | null>;
  ageing: { key: string; label: string; value: number; count: number }[];
  trend: { label: string; billed: number; collected: number; costs: number }[];
  rows: FinanceRow[];
  pagination: { page: number; pages: number; pageSize: number; total: number };
  options: { services: { id: string; label: string; parent: string; depth: number }[]; staff: { key: string; name: string; role: string }[]; roles: string[]; funds: { id: string; name: string }[] };
  notes: string[];
};

type Resource = { expires: number; pending: boolean; readers: number; controller: AbortController; promise: Promise<FinanceWorkspace> };
const resources = new Map<string, Resource>();
let identity = '';
let revision = -1;
const abortError = () => new DOMException('Request cancelled.', 'AbortError');
class FinanceHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function loadWorkspace(section: FinanceSection, query: URLSearchParams, token: string, refresh: boolean, signal: AbortSignal): Promise<FinanceWorkspace> {
  // A cold/reconnecting server gets one automatic recovery attempt. Ordinary
  // reads are fast; the deadline does not artificially reject a healthy reply
  // just after the old 15-second limit. Superseded requests cancel immediately.
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, attempt ? 25000 : 20000);
    try {
      if (signal.aborted) throw abortError();
      const response = await navigationFetch(`${API_URL}/billing/workspace/${section}?${query}`, {
        headers: { Authorization: `Bearer ${token}`, ...(refresh && attempt === 0 ? { 'X-Finance-Refresh': '1' } : {}) }, signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new FinanceHttpError(response.status, data.message || 'Unable to load finance records.');
      if (data.section !== section || !Array.isArray(data.rows) || !data.metrics || !data.pagination || !data.options) throw new Error('The finance response was incomplete. Please retry.');
      return data as FinanceWorkspace;
    } catch (error) {
      if (signal.aborted) throw abortError();
      const transient = timedOut || error instanceof TypeError || error instanceof FinanceHttpError && [408, 502, 503, 504].includes(error.status);
      if (attempt === 0 && transient) continue;
      if (timedOut) throw new Error('The server is not responding. Check your connection and try again.');
      throw error;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  }
}

function consume(resource: Resource, key: string, signal?: AbortSignal): Promise<FinanceWorkspace> {
  if (signal?.aborted) return Promise.reject(abortError());
  resource.readers++;
  return new Promise((resolve, reject) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true; resource.readers--; signal?.removeEventListener('abort', cancel);
      if (!resource.readers && resource.pending) {
        resource.controller.abort();
        if (resources.get(key) === resource) resources.delete(key);
      }
    };
    const cancel = () => { release(); reject(abortError()); };
    signal?.addEventListener('abort', cancel, { once: true });
    void resource.promise.then(value => { if (!released) { release(); resolve(value); } }, error => { if (!released) { release(); reject(error); } });
  });
}

/** Account-scoped, mutation-aware, bounded cache. Freshness starts on success;
 * pending reads remain shared until completed, cancelled or rejected.
 */
export const readFinanceWorkspace = (section: FinanceSection, params: FinanceParams, refresh = false, signal?: AbortSignal): Promise<FinanceWorkspace> => {
  if (signal?.aborted) return Promise.reject(abortError());
  const token = localStorage.getItem('token') || '';
  const dataRevision = getDataRevision();
  if (identity !== token || revision !== dataRevision) {
    for (const resource of resources.values()) resource.controller.abort();
    resources.clear(); identity = token; revision = dataRevision;
  }
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value != null && value !== '') query.set(key, String(value)); });
  query.sort();
  const key = `${section}:${query}`;
  const cached = resources.get(key);
  if (!refresh && cached && (cached.pending || cached.expires > Date.now())) return consume(cached, key, signal);
  for (const [id, item] of resources) if (!item.pending && item.expires <= Date.now()) resources.delete(id);
  while (resources.size >= 32) {
    const oldest = [...resources].find(([, resource]) => !resource.pending)?.[0] || resources.keys().next().value!;
    resources.delete(oldest);
  }
  const controller = new AbortController();
  const resource: Resource = { promise: loadWorkspace(section, query, token, refresh, controller.signal), expires: 0, pending: true, readers: 0, controller };
  resources.set(key, resource);
  void resource.promise.then(() => { resource.pending = false; resource.expires = Date.now() + 20000; }, () => {
    resource.pending = false;
    if (resources.get(key) === resource) resources.delete(key);
  });
  return consume(resource, key, signal);
};

/** Pointer/focus navigation uses the same resource the page will consume. */
export async function prepareFinanceWorkspace(href: string) {
  const url = new URL(href, location.origin);
  const section = (url.pathname.match(/\/billing\/finance\/([^/]+)/)?.[1] || 'financial-dashboard') as FinanceSection;
  if (!['financial-dashboard', 'invoicing', 'collections', 'cash-flow', 'expenses', 'remuneration'].includes(section)) return;
  const q = url.searchParams;
  const tab = q.get('tab') || 'all';
  await readFinanceWorkspace(section, { range: q.get('range') || 'ytd', tab, q: q.get('q') || '',
    ...(q.get('range') === 'custom' ? { from: q.get('from') || '', to: q.get('to') || '' } : {}),
    status: q.get('status') || (['Paid', 'Pending', 'Overdue', 'unknown', 'Direct matter cost', 'Operating expense'].includes(tab) ? tab : 'all'),
    servicePath: q.get('servicePath') || '', staff: q.get('staff') || '', role: q.get('role') || '', fund: q.get('fund') || '',
    sort: q.get('sort') || 'date', dir: q.get('dir') || 'desc', page: Number(q.get('page')) || 1, pageSize: Number(q.get('pageSize')) || 10 }).catch(() => {});
}
