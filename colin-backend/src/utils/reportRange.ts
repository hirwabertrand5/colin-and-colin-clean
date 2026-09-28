/**
 * Shared reporting date-range helper.
 *
 * Firm Reports and the staff dashboards resolve a period with the same rules,
 * so both must use this single implementation: a named window (daily, weekly,
 * monthly, quarterly, yearly, year-to-date) is relative to now, and a custom
 * window is passed as explicit from/to dates covering whole days.
 */

export type ReportDateBasis = 'invoiceDate' | 'paymentDate' | 'taskDate';

export const REPORT_RANGE_LABELS: Record<string, string> = {
  daily: 'Last day',
  weekly: 'Last week',
  monthly: 'Last month',
  quarterly: 'Last quarter',
  yearly: 'Last year',
  ytd: 'Year to date',
  custom: 'Custom range',
};

/** Named windows are inclusive whole days ending today at 23:59:59.999. */
export function computeRange(range?: string) {
  const to = new Date();
  to.setHours(23, 59, 59, 999);

  const from = new Date(to);
  const r = String(range || 'monthly').toLowerCase();

  if (r === 'daily') from.setDate(from.getDate());
  else if (r === 'weekly') from.setDate(from.getDate() - 7);
  else if (r === 'quarterly') from.setMonth(from.getMonth() - 3);
  else if (r === 'yearly') from.setFullYear(from.getFullYear() - 1);
  else if (r === 'ytd') from.setMonth(0, 1);
  else from.setMonth(from.getMonth() - 1); // monthly default

  from.setHours(0, 0, 0, 0);
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
  /** UTC-based ISO dates (safe for stored YYYY-MM-DD string fields). */
  fromISO: string;
  toISO: string;
  /** Calendar dates to DISPLAY — the days the user actually selected. */
  displayFrom: string;
  displayTo: string;
};

/**
 * Resolve `range`/`from`/`to` query values the same way for every report.
 * Returns null when no period was requested (callers keep their all-time view)
 * or `{ error }` when a custom window is incomplete or invalid.
 */
export const resolveOptionalReportRange = (
  query: { range?: unknown; from?: unknown; to?: unknown } | undefined
): ResolvedReportRange | null | { error: string } => {
  const range = query?.range ? String(query.range).trim().toLowerCase() : '';
  const fromRaw = query?.from ? String(query.from).trim() : '';
  const toRaw = query?.to ? String(query.to).trim() : '';
  const hasCustom = Boolean(fromRaw && toRaw);
  if (!range && !hasCustom) return null;

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
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);
    key = 'custom';
  } else {
    ({ from: fromDate, to: toDate } = computeRange(key));
  }

  return {
    key,
    label: `${REPORT_RANGE_LABELS[key] || key} (${localISODate(fromDate)} → ${localISODate(toDate)})`,
    from: fromDate,
    to: toDate,
    fromISO: isoDate(fromDate),
    toISO: isoDate(toDate),
    displayFrom: localISODate(fromDate),
    displayTo: localISODate(toDate),
  };
};

/** True when `value` falls inside the resolved period (inclusive). */
export const isWithinReportRange = (value: unknown, range: ResolvedReportRange | null): boolean => {
  if (!range) return false;
  const date = value instanceof Date ? value : value ? new Date(String(value)) : null;
  if (!date || Number.isNaN(date.getTime())) return false;
  return date.getTime() >= range.from.getTime() && date.getTime() <= range.to.getTime();
};