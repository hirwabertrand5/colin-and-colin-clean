type Section = 'cases' | 'tasks' | 'billing' | 'events' | 'audit' | 'prospects' | 'invoices' | 'fund' | 'staff' | 'summary' | 'performance' | 'independent' | 'executive';
type Deferred = { promise: Promise<unknown>; resolve: (data: unknown) => void; reject: (error: Error) => void; settled: boolean; consumed: boolean };
type Bootstrap = { key: string; started: number; sections: Map<Section, Deferred>; controller: AbortController };
let current: Bootstrap | undefined;

export function clearDashboardData() { current?.controller.abort(); current = undefined; }

const identity = () => {
  try { return { token: localStorage.getItem('token'), role: JSON.parse(localStorage.getItem('user') || 'null')?.role as string }; }
  catch { return { token: null, role: '' }; }
};

function start() {
  const { token, role } = identity();
  if (!token || !role) return undefined;
  clearDashboardData();
  const management = ['managing_director', 'managing_partner', 'executive_managing_partner'].includes(role);
  const names: Section[] = role === 'executive_assistant' ? ['executive'] : management
    ? ['cases', 'tasks', 'billing', 'events', 'audit', 'prospects', 'invoices', 'fund', 'staff']
    : ['summary', 'cases', 'tasks', 'events', 'performance', 'prospects', 'independent', 'audit'];
  const today = new Date().toISOString().slice(0, 10);
  const batch: Bootstrap = { key: `${token}:${role}:${today}`, started: Date.now(), controller: new AbortController(), sections: new Map() };
  for (const name of names) {
    let resolve!: Deferred['resolve'], reject!: Deferred['reject'];
    const promise = new Promise<unknown>((ok, fail) => { resolve = ok; reject = fail; });
    void promise.catch(() => {});
    batch.sections.set(name, { promise, resolve, reject, settled: false, consumed: false });
  }
  current = batch;
  void (async () => {
    try {
      const response = await globalThis.fetch(`${import.meta.env.VITE_API_URL}/dashboard/bootstrap?today=${today}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: batch.controller.signal, cache: 'no-store',
      });
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) throw new Error('Dashboard data could not be loaded.');
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      const consume = (line: string) => {
        if (!line.trim()) return;
        const record = JSON.parse(line), section = batch.sections.get(record.section);
        if (!section || section.settled) return;
        section.settled = true;
        record.status === 'fulfilled' ? section.resolve(record.value) : section.reject(new Error(record.message || 'Unable to load dashboard section.'));
      };
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
        if (done) break;
      }
      consume(buffer);
    } catch (error: any) {
      for (const section of batch.sections.values()) if (!section.settled) { section.settled = true; section.reject(error); }
    } finally {
      for (const section of batch.sections.values()) if (!section.settled) { section.settled = true; section.reject(new Error('Dashboard response was incomplete.')); }
    }
  })();
  return batch;
}

/** Start immediately after sign-in, in parallel with loading the dashboard code. */
export function prepareDashboardData() { start(); }

/** Each initial section consumes one streamed result. Revisits request fresh data. */
export function getDashboardSection<T>(name: Section): Promise<T> {
  const { token, role } = identity();
  const key = `${token}:${role}:${new Date().toISOString().slice(0, 10)}`;
  if (!current || current.key !== key || Date.now() - current.started > 30000 || current.sections.get(name)?.consumed) start();
  const section = current?.sections.get(name);
  if (!section) return Promise.reject(new Error('This dashboard section is unavailable.'));
  section.consumed = true;
  return section.promise as Promise<T>;
}
