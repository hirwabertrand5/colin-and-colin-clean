/** Effective periods are [from, until); persisted timestamps are UTC instants. */
export function resolveTpaRate(history: any[], at: Date | string, fallback: number): number {
  const time = new Date(at).getTime();
  if (!Number.isFinite(time)) return fallback;
  const eligible = history.filter(r => new Date(r.from).getTime() <= time &&
    (!r.until || time < new Date(r.until).getTime()));
  const latest = (kind: string) => eligible.filter(r => r.kind === kind)
    .sort((a, b) => new Date(b.from).getTime() - new Date(a.from).getTime())[0];
  return latest('special')?.rate ?? latest('normal')?.rate ?? fallback;
}

export function validateTpaChange(history: any[], input: any, now = new Date()) {
  if (!['normal', 'special', 'stop'].includes(input.kind)) throw new Error('Invalid TPA action.');
  if (typeof input.reason !== 'string' || !input.reason.trim()) throw new Error('A reason is required.');
  const parse = (value: unknown) => {
    if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('Use a timestamp with an explicit timezone.');
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid effective timestamp.');
    return date;
  };
  const from = parse(input.from);
  const until = input.until ? parse(input.until) : null;
  if (until && until <= from) throw new Error('End must be after start.');
  if (input.kind !== 'stop' && (typeof input.rate !== 'number' || !Number.isFinite(input.rate) || input.rate < 0 || input.rate > 100)) throw new Error('Rate must be between 0 and 100.');
  if (input.kind === 'special' && history.some(r => r.kind === 'special' &&
    (!r.until || from < new Date(r.until)) && (!until || new Date(r.from) < until))) throw new Error('Special TPA periods overlap.');
  if (input.kind === 'normal' && history.some(r => r.kind === 'normal' && new Date(r.from).getTime() === from.getTime())) throw new Error('A normal rate already starts at this timestamp.');
  if (from < now && !input.confirmBackdated) throw new Error('Confirm the backdated adjustment after reviewing its impact.');
  return { from, until };
}

/** Pure preview and write path share exactly the same proposed effective periods. */
export function proposeTpaHistory(history: any[], input: any, fallback: number, actor: string, now = new Date()) {
  const { from, until } = validateTpaChange(history, input, now);
  const proposed: any[] = JSON.parse(JSON.stringify(history));
  if (!proposed.some(r => r.kind === 'normal')) proposed.push({ kind: 'normal', rate: fallback, from: new Date(0), until: null,
    recordedAt: now, actor, reason: 'Preserved legacy role allocation' });
  if (input.kind === 'stop') {
    const special = proposed.find(r => r.kind === 'special' && String(r._id) === input.specialId);
    if (!special || from <= new Date(special.from) || (special.until && from >= new Date(special.until))) throw new Error('Select a special rate and a stop time inside its effective period.');
    special.until = from;
  } else {
    if (input.kind === 'normal') proposed.filter(r => r.kind === 'normal' && new Date(r.from) < from && (!r.until || from < new Date(r.until)))
      .forEach(r => { r.until = from; });
    const next = proposed.filter(r => r.kind === 'normal' && new Date(r.from) > from).sort((a,b) => +new Date(a.from) - +new Date(b.from))[0];
    proposed.push({ kind: input.kind, rate: input.rate, from, until: input.kind === 'normal' ? next?.from || null : until,
      recordedAt: now, actor, reason: input.reason.trim() });
  }
  return { history: proposed, from, until };
}
