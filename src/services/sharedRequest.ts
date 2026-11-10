const pending = new Map<string, Promise<unknown>>();

/** Share simultaneous reads only. Settled data is never cached across edits. */
export function shareRequest<T>(key: string, read: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const request = read();
  pending.set(key, request);
  const clear = () => { if (pending.get(key) === request) pending.delete(key); };
  void request.then(clear, clear);
  return request;
}
