// Speculative data lives only in memory and is consumed by the next page read.
// Ordinary GETs are fresh; this is not a persistent application-data cache.
const prepared = new Map<string, { promise: Promise<Response>; expires: number; generation: number }>();
const reading = new Map<string, Promise<Response>>();
let generation = 0;
let account = '';
const MAX_PREPARED = 32;
const PREPARE_MS = 5000;

export function clearNavigationRequests() {
  generation++;
  prepared.clear();
  reading.clear();
}

function requestKey(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof input !== 'string' && !(input instanceof URL)) return '';
  const headers = new Headers(init?.headers);
  const identity = headers.get('authorization') || '';
  if (!identity || init?.signal || init?.cache === 'no-store' || init?.cache === 'reload') return '';
  if (account !== identity) { clearNavigationRequests(); account = identity; }
  const url = new URL(String(input), typeof location === 'undefined' ? 'http://localhost' : location.origin);
  url.searchParams.sort();
  return `${identity}:${init?.credentials || 'same-origin'}:${url.href}:${JSON.stringify([...headers.entries()].sort())}`;
}

function read(input: RequestInfo | URL, init: RequestInit | undefined, key: string) {
  let pending = reading.get(key);
  if (!pending) {
    pending = globalThis.fetch(input, init);
    reading.set(key, pending);
    const clear = () => { if (reading.get(key) === pending) reading.delete(key); };
    void pending.then(response => {
      clear();
      if (response.status === 401 || response.status === 403) clearNavigationRequests();
    }, clear);
  }
  return pending;
}

/** Preserve fetch semantics, share concurrent reads, and invalidate on every write. */
export async function navigationFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    clearNavigationRequests();
    try { return await globalThis.fetch(input, init); }
    finally { clearNavigationRequests(); }
  }
  const key = method === 'GET' ? requestKey(input, init) : '';
  if (!key) return globalThis.fetch(input, init);
  const ready = prepared.get(key);
  prepared.delete(key);
  if (ready && ready.expires > Date.now() && ready.generation === generation) {
    try {
      const response = await ready.promise;
      if (response.ok && ready.generation === generation) return response.clone();
    } catch { /* A failed speculative request must not prevent a normal retry. */ }
  }
  return (await read(input, init, key)).clone();
}

export async function prepareNavigationRequest(url: string, init: RequestInit) {
  const key = requestKey(url, init);
  if (!key) return;
  const existing = prepared.get(key);
  if (existing && existing.expires > Date.now()) return;
  for (const [id, item] of prepared) if (item.expires <= Date.now()) prepared.delete(id);
  while (prepared.size >= MAX_PREPARED) prepared.delete(prepared.keys().next().value!);
  const item = { promise: read(url, init, key), expires: Date.now() + PREPARE_MS, generation };
  prepared.set(key, item);
  try {
    const response = await item.promise;
    if (!response.ok && prepared.get(key) === item) prepared.delete(key);
  } catch {
    if (prepared.get(key) === item) prepared.delete(key);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => { if (!event.key || ['token', 'user'].includes(event.key)) clearNavigationRequests(); });
  window.addEventListener('pagehide', clearNavigationRequests);
}
