import type { RequestHandler } from 'express';

type Entry = { promise: Promise<unknown>; expires: number; pending: boolean };
const entries = new Map<string, Entry>();
const FRESH_MS = 20000;
const MAX_ENTRIES = 24;

/** Share in-flight reads as well as completed snapshots. Never cache failures.
 * Expiry starts after completion so a slow cold read cannot duplicate itself.
 */
export function readFinanceCache<T>(key: string, load: () => PromiseLike<T>): Promise<T> {
  const cached = entries.get(key);
  if (cached && (cached.pending || cached.expires > Date.now())) {
    entries.delete(key); entries.set(key, cached);
    return cached.promise as Promise<T>;
  }
  for (const [id, entry] of entries) if (!entry.pending && entry.expires <= Date.now()) entries.delete(id);
  while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  const entry: Entry = { promise: Promise.resolve().then(load), expires: 0, pending: true };
  entries.set(key, entry);
  void entry.promise.then(() => { entry.pending = false; entry.expires = Date.now() + FRESH_MS; }, () => {
    if (entries.get(key) === entry) entries.delete(key);
  });
  return entry.promise as Promise<T>;
}

export const invalidateFinanceReads = () => entries.clear();

/** Route guards still run before every cached financial response. Clear both
 * before and after mutations so a read during a save cannot poison the cache.
 * The short TTL also bounds changes made by another server instance.
 */
export const invalidateFinanceReadsOnWrite: RequestHandler = (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    invalidateFinanceReads();
    res.once('finish', invalidateFinanceReads);
  }
  next();
};
