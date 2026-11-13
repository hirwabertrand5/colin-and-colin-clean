export type ReportDateBasis = 'invoiceDate' | 'paymentDate' | 'taskDate';

export const REPORT_RANGE_LABELS: Record<string, string> = {
  all: 'All time', daily: 'Today', weekly: 'Last 7 days', monthly: 'This month',
  quarterly: 'Previous quarter', yearly: 'Previous year', ytd: 'Year to date',
  this_month: 'This month', custom: 'Custom range',
};
export const SUPPORTED_REPORT_RANGE_KEYS = Object.keys(REPORT_RANGE_LABELS);
const ALL_TIME_KEYS = new Set(['all', 'alltime', 'all-time', 'all_time', '*']);
export const isAllTimeRangeKey = (value: unknown) => ALL_TIME_KEYS.has(String(value || '').trim().toLowerCase());
export const reportTimeZone = () => process.env.APP_TIMEZONE || 'Africa/Kigali';
export const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** Calendar day in the firm's timezone, independently of the server's timezone. */
export const localISODate = (date: Date, timeZone = reportTimeZone()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const calendarDay = (day: string) => new Date(`${day}T00:00:00.000Z`);
const shiftDay = (day: string, offset: number) => {
  const date = calendarDay(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return isoDate(date);
};
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day)
  && Number.isFinite(calendarDay(day).getTime()) && isoDate(calendarDay(day)) === day;

/** Convert a wall-clock midnight to an instant, including timezone/DST offsets. */
const midnight = (day: string, timeZone: string) => {
  const target = calendarDay(day).getTime();
  let instant = target;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 4; i++) {
    const parts = formatter.formatToParts(new Date(instant));
    const n = (type: string) => Number(parts.find(p => p.type === type)!.value);
    const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
    const corrected = instant + target - wall;
    if (corrected === instant) break;
    instant = corrected;
  }
  return new Date(instant);
};

export type ResolvedReportRange = {
  key: string; label: string; from: Date; to: Date; toExclusive: Date;
  fromISO: string; toISO: string; displayFrom: string; displayTo: string;
};

export const resolveOptionalReportRange = (
  query: { range?: unknown; from?: unknown; to?: unknown } | undefined,
  now = new Date(),
  timeZone = reportTimeZone(),
): ResolvedReportRange | null | { error: string } => {
  const raw = String(query?.range || '').trim();
  let key = raw.toLowerCase();
  const customFrom = String(query?.from || '').trim();
  const customTo = String(query?.to || '').trim();
  if (isAllTimeRangeKey(key)) return null;
  if (!key && !customFrom && !customTo) return null;
  if (key && !SUPPORTED_REPORT_RANGE_KEYS.includes(key)) return { error: `Unsupported reporting period "${raw}".` };

  let fromDay = localISODate(now, timeZone);
  let toDay = fromDay;
  if (key === 'custom' || customFrom || customTo) {
    if (!customFrom || !customTo) return { error: 'Custom range needs both from and to dates.' };
    if (!validDay(customFrom) || !validDay(customTo)) return { error: 'Invalid from/to date.' };
    if (customFrom > customTo) return { error: 'The From date must be on or before the To date.' };
    fromDay = customFrom; toDay = customTo; key = 'custom';
  } else if (key === 'weekly') {
    fromDay = shiftDay(fromDay, -6);
  } else if (key === 'monthly' || key === 'this_month') {
    fromDay = `${fromDay.slice(0, 7)}-01`;
  } else if (key === 'ytd') {
    fromDay = `${fromDay.slice(0, 4)}-01-01`;
  } else if (key === 'quarterly') {
    const date = calendarDay(fromDay);
    const quarterStart = new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1));
    toDay = shiftDay(isoDate(quarterStart), -1);
    quarterStart.setUTCMonth(quarterStart.getUTCMonth() - 3);
    fromDay = isoDate(quarterStart);
  } else if (key === 'yearly') {
    const year = Number(fromDay.slice(0, 4)) - 1;
    fromDay = `${year}-01-01`; toDay = `${year}-12-31`;
  }
  const from = midnight(fromDay, timeZone);
  const toExclusive = midnight(shiftDay(toDay, 1), timeZone);
  return { key, label: `${REPORT_RANGE_LABELS[key]} (${fromDay} → ${toDay})`, from,
    to: new Date(toExclusive.getTime() - 1), toExclusive,
    fromISO: fromDay, toISO: toDay, displayFrom: fromDay, displayTo: toDay };
};

/** Compatibility for callers that require a concrete window. Prefer the resolver. */
export function computeRange(range?: string) {
  if (isAllTimeRangeKey(range)) return { from: new Date(0), to: new Date('9999-12-31T23:59:59.999Z') };
  const resolved = resolveOptionalReportRange({ range: range || 'monthly' });
  if (resolved && !('error' in resolved)) return { from: resolved.from, to: resolved.to };
  const fallback = resolveOptionalReportRange({ range: 'monthly' }) as ResolvedReportRange;
  return { from: fallback.from, to: fallback.to };
}

export const normalizeReportBasis = (value?: string): ReportDateBasis => {
  const normalized = String(value || 'invoiceDate').trim().toLowerCase();
  if (normalized === 'paymentdate' || normalized === 'payment_date') return 'paymentDate';
  if (normalized === 'taskdate' || normalized === 'task_date') return 'taskDate';
  return 'invoiceDate';
};

/** Inclusive start and exclusive end: adjacent reporting periods never overlap. */
export const isWithinReportRange = (value: unknown, range: ResolvedReportRange | null): boolean => {
  if (!range) return true;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return validDay(value) && value >= range.fromISO && value <= range.toISO;
  const date = value instanceof Date ? value : value ? new Date(String(value)) : null;
  return Boolean(date && Number.isFinite(date.getTime()) && date >= range.from && date < range.toExclusive);
};
