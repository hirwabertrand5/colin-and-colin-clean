/**
 * Shared reporting date-range helper — the SINGLE source of truth for what a
 * reporting period means. Firm Reports, the staff dashboards, the Staff
 * Earnings report and the activity trail all resolve their window here so a
 * period always means the exact same dates everywhere.
 *
 * Period semantics (local server calendar, inclusive start / exclusive end):
 *   - `all`     → NO date restriction at all. All eligible historical records.
 *                 Never a substituted window, never an invented date.
 *   - `daily`   → the previous complete calendar day.
 *   - `weekly`  → the rolling seven-day window ending today.
 *   - `monthly` → the complete previous calendar month.
 *   - `quarterly` → the complete previous calendar quarter.
 *   - `yearly`  → the complete previous calendar year.
 *   - `ytd`     → 1 January of the current year through the end of today.
 *   - `this_month` → the first of the current month through the end of today.
 *   - `custom`  → the explicit from/to whole days the user selected.
 *
 * Boundaries are inclusive-start / EXCLUSIVE-end (`>= from`, `< to`) so a
 * record can never be counted in two adjacent periods. Every window is built
 * from calendar arithmetic (never "minus N days"), so month lengths, leap
 * years and month-end days are handled correctly.
 */

export type ReportDateBasis = 'invoiceDate' | 'paymentDate' | 'taskDate';

export const REPORT_RANGE_LABELS: Record<string, string> = {
  all: 'All time',
  daily: 'Last day',
  weekly: 'Last week',
  monthly: 'Last month',
  quarterly: 'Last quarter',
  yearly: 'Last year',
  ytd: 'Year to date',
  this_month: 'This month',
  custom: 'Custom range',
};

/**
 * Every `range` value a caller may legitimately send. Anything outside this
 * set is rejected rather than silently degraded to another period, so an
 * "All time" selection can never be quietly treated as "Last month".
 */
export const SUPPORTED_REPORT_RANGE_KEYS = Object.keys(REPORT_RANGE_LABELS);

/** Aliases that must never be turned into a date window. */
const ALL_TIME_KEYS = new Set(['all', 'alltime', 'all-time', 'all_time', '*']);

export const isAllTimeRangeKey = (value: unknown): boolean =>
  ALL_TIME_KEYS.has(String(value || '').trim().toLowerCase());

/** Start of the local calendar day containing `date`. */
const startOfDay = (date: Date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

/** End of the local calendar day containing `date` (23:59:59.999). */
const endOfDay = (date: Date) => {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
};

/** Midnight on the first day of the month, `offset` months from `date`. */
const startOfMonthOffset = (date: Date, offset: number) =>
  new Date(date.getFullYear(), date.getMonth() + offset, 1, 0, 0, 0, 0);

/** Last instant of the month `offset` months from `date`. */
const endOfMonthOffset = (date: Date, offset: number) => {
  // Day 0 of the following month is the last day of the target month.
  const firstOfNext = new Date(date.getFullYear(), date.getMonth() + offset + 1, 1, 0, 0, 0, 0);
  return new Date(firstOfNext.getTime() - 1);
};

/**
 * Named windows are whole local calendar days. `to` is the last INSTANT of the
 * window (inclusive when compared with `<=`), which keeps the existing
 * `$lte`-style MongoDB predicates correct while `isWithinReportRange` applies
 * the exclusive-end rule for in-memory comparisons.
 */
export function computeRange(range?: string) {
  const now = new Date();
  const to = endOfDay(now);
  const from = startOfDay(now);
  const r = String(range || 'monthly').trim().toLowerCase();

  if (r === 'all' || ALL_TIME_KEYS.has(r)) {
    // All time: no lower bound, so the window simply reaches back to the
    // epoch. Callers that want the true all-time view use
    // `resolveOptionalReportRange`, which returns null for this key.
    from.setTime(0);
    to.setTime(8.64e15);
    return { from, to };
  }

  if (r === 'daily') {
    // The previous complete calendar day.
    from.setDate(from.getDate() - 1);
    to.setDate(to.getDate() - 1);
    to.setHours(23, 59, 59, 999);
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }

  if (r === 'weekly') {
    // Rolling seven days ending today (today included).
    from.setDate(from.getDate() - 6);
    return { from, to };
  }

  if (r === 'this_month') {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }

  if (r === 'monthly') {
    // The complete previous calendar month.
    const firstOfThisMonth = startOfMonthOffset(now, 0);
    to.setTime(endOfMonthOffset(now, -1).getTime());
    from.setTime(firstOfThisMonth.getTime());
    from.setMonth(from.getMonth() - 1);
    return { from, to };
  }

  if (r === 'quarterly') {
    // The complete previous calendar quarter.
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    from.setTime(new Date(now.getFullYear(), quarterStartMonth - 3, 1, 0, 0, 0, 0).getTime());
    to.setTime(endOfMonthOffset(new Date(now.getFullYear(), quarterStartMonth, 1), -1).getTime());
    return { from, to };
  }

  if (r === 'yearly') {
    // The complete previous calendar year.
    from.setTime(new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0, 0).getTime());
    to.setTime(new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999).getTime());
    return { from, to };
  }

  if (r === 'ytd') {
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }

  // Unknown key: fall back to the previous calendar month, matching the
  // historical default. `resolveOptionalReportRange` rejects unknown keys
  // before this point, so this branch only guards direct `computeRange` calls.
  from.setTime(startOfMonthOffset(now, -1).getTime());
  to.setTime(endOfMonthOffset(now, -1).getTime());
  return { from, to };
}


export const normalizeReportBasis = (value?: string): ReportDateBasis => {
  const normalized = String(value || 'invoiceDate').trim().toLowerCase();
  if (normalized === 'paymentdate' || normalized === 'payment_date') return 'paymentDate';
  if (normalized === 'taskdate' || normalized === 'task_date') return 'taskDate';
  return 'invoiceDate';
};

export const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** Format a date as YYYY-MM-DD on the server's local calendar (no UTC day shift). */
export const localISODate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export type ResolvedReportRange = {
  key: string;
  label: string;
  from: Date;
  to: Date;
  /**
   * EXCLUSIVE end boundary — the first instant AFTER the window.
   *
   * This is the boundary period comparisons must use (`>= from`, `< toExclusive`),
   * so a record sitting exactly on the next period's first instant is counted
   * once, in that later period only.
   *
   * `to` stays the last INSTANT inside the window (23:59:59.999 of the final
   * day) because existing MongoDB `$lte` predicates and the YYYY-MM-DD string
   * comparisons in Firm Reports are built on it.
   */
  toExclusive: Date;
  /** UTC-based ISO dates (safe for stored YYYY-MM-DD string fields). */
  fromISO: string;
  toISO: string;
  /** Calendar dates to DISPLAY — the days the user actually selected. */
  displayFrom: string;
  displayTo: string;
};

/**
 * Resolve `range`/`from`/`to` query values the same way for every report.
 *
 * Returns:
 *   - `null`      when no period was requested, or when the period is
 *                 explicitly All Time. Callers keep their all-time view and
 *                 apply NO date restriction whatsoever.
 *   - `{ error }` when a custom window is incomplete/invalid, or when the
 *                 `range` key is not one this application supports.
 *
 * All Time is deliberately a `null` result rather than a date window: it must
 * never be translated into a start/end date, and it must never be silently
 * substituted with another period.
 */
export const resolveOptionalReportRange = (
  query: { range?: unknown; from?: unknown; to?: unknown } | undefined
): ResolvedReportRange | null | { error: string } => {
  const rangeRaw = query?.range ? String(query.range).trim() : '';
  const range = rangeRaw.toLowerCase();
  const fromRaw = query?.from ? String(query.from).trim() : '';
  const toRaw = query?.to ? String(query.to).trim() : '';
  const hasCustom = Boolean(fromRaw && toRaw);
  const hasPartialCustom = Boolean(fromRaw || toRaw);

  // All Time wins outright: no lower bound, no upper bound, no date filter.
  // This is checked BEFORE the empty-query test so an explicit `range=all`
  // behaves identically to sending no period at all.
  if (isAllTimeRangeKey(rangeRaw)) return null;

  if (!range && !hasCustom) {
    // A lone `from` or a lone `to` is an incomplete custom window, not a
    // request for a named period — report it rather than silently ignoring it.
    if (hasPartialCustom) return { error: 'Custom range needs both from and to dates.' };
    return null;
  }

  let key = range || 'custom';
  let fromDate: Date;
  let toDate: Date;

  if (hasCustom || key === 'custom') {
    if (!hasCustom) return { error: 'Custom range needs both from and to dates.' };
    fromDate = new Date(fromRaw);
    toDate = new Date(toRaw);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return { error: 'Invalid from/to date.' };
    }
    if (fromDate.getTime() > toDate.getTime()) {
      return { error: 'The From date must be on or before the To date.' };
    }
    fromDate = startOfDay(fromDate);
    toDate = endOfDay(toDate);
    key = 'custom';
  } else {
    // Reject unrecognised periods instead of quietly falling back to another
    // window — a typo must surface as an error, never as wrong figures.
    if (!SUPPORTED_REPORT_RANGE_KEYS.includes(key)) {
      return {
        error: `Unsupported reporting period "${rangeRaw}". Supported periods: ${SUPPORTED_REPORT_RANGE_KEYS.join(', ')}.`,
      };
    }
    ({ from: fromDate, to: toDate } = computeRange(key));
  }

  return {
    key,
    label: `${REPORT_RANGE_LABELS[key] || key} (${localISODate(fromDate)} → ${localISODate(toDate)})`,
    from: fromDate,
    to: toDate,
    // Exclusive end = the first instant after the window (midnight of the day
    // following `to` for whole-day windows).
    toExclusive: new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() + 1, 0, 0, 0, 0),
    fromISO: isoDate(fromDate),
    toISO: isoDate(toDate),
    displayFrom: localISODate(fromDate),
    displayTo: localISODate(toDate),
  };
};

/**
 * True when `value` falls inside the resolved period.
 *
 * A `null` range means "no period restriction" (All Time), so every value
 * qualifies — this is what lets All Time include historical records without
 * inventing a start date. Missing/invalid dates never match a real period
 * (they are genuinely unattributable), but they DO match All Time so they are
 * never silently dropped from an all-time total.
 *
 * The end boundary is EXCLUSIVE (`< toExclusive`): a record sitting exactly on
 * the next period's first instant belongs to that later period only, so
 * adjacent windows can never both count it.
 */
export const isWithinReportRange = (value: unknown, range: ResolvedReportRange | null): boolean => {
  const date = value instanceof Date ? value : value ? new Date(String(value)) : null;
  const hasValidDate = Boolean(date && !Number.isNaN(date.getTime()));

  // No period selected (All Time): include everything, even undated records,
  // because there is no window they could fall outside of.
  if (!range) return true;

  if (!hasValidDate) return false;
  const time = date!.getTime();
  // Inclusive start, exclusive end.
  return time >= range.from.getTime() && time < range.toExclusive.getTime();
};