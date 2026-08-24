export type UrgencyColor = 'blue' | 'green' | 'yellow' | 'red' | 'gray';
export type DeadlineZone = 'excellent' | 'good' | 'delayed' | 'risk' | 'untracked';

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const DEFAULT_DEADLINE_HOUR_UTC = 12;

const isDateOnlyString = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const normalizeLegacyMidnightDate = (value: Date) => {
  if (
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  ) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), DEFAULT_DEADLINE_HOUR_UTC, 0, 0, 0));
  }
  return value;
};

export const resolveDeadlineDateTime = (value?: Date | string) => {
  if (!value) return undefined;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return undefined;
    return normalizeLegacyMidnightDate(new Date(value));
  }

  const raw = String(value).trim();
  if (!raw) return undefined;

  if (isDateOnlyString(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, DEFAULT_DEADLINE_HOUR_UTC, 0, 0, 0));
  }

  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  return normalizeLegacyMidnightDate(parsed);
};

const hasExplicitTime = (value?: Date | string) => {
  if (!value) return false;
  if (value instanceof Date) {
    return (
      value.getHours() !== 0 ||
      value.getMinutes() !== 0 ||
      value.getSeconds() !== 0 ||
      value.getMilliseconds() !== 0
    );
  }
  const raw = String(value).trim();
  return raw.includes('T') || raw.includes(' ');
};

export const formatDeadlineDateTime = (value?: Date | string) => {
  const resolved = resolveDeadlineDateTime(value);
  if (!resolved) return 'No deadline';
  return resolved.toLocaleString();
};

export const toDateTimeLocalValue = (value?: Date | string) => {
  const resolved = resolveDeadlineDateTime(value);
  if (!resolved) return '';

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${resolved.getFullYear()}-${pad(resolved.getMonth() + 1)}-${pad(resolved.getDate())}T${pad(
    resolved.getHours()
  )}:${pad(resolved.getMinutes())}`;
};

export const getDueRemainingRatio = (startAt?: Date | string, dueAt?: Date | string, now = new Date()) => {
  if (!startAt || !dueAt) return undefined;
  const s = resolveDeadlineDateTime(startAt);
  const d = resolveDeadlineDateTime(dueAt);
  if (!s || !d) return undefined;
  const startMs = s.getTime();
  const dueMs = d.getTime();
  const nowMs = now.getTime();
  const total = Math.max(0, dueMs - startMs);
  if (total === 0) return nowMs <= dueMs ? 1 : 0;
  const remaining = dueMs - nowMs;
  return clamp01(remaining / total);
};

export const getUrgencyColorFromRatio = (ratio: number | undefined): UrgencyColor => {
  if (ratio === undefined) return 'gray';
  if (ratio > 0.75) return 'blue';
  if (ratio > 0.5) return 'green';
  if (ratio > 0.25) return 'yellow';
  return 'red';
};

export const getUrgencyColorForDueDate = (
  dueAt?: Date | string,
  startAt?: Date | string,
  now = new Date()
): UrgencyColor => {
  // Use absolute remaining-time thresholds (platform-wide business rules):
  // - overdue OR <= 48 hours => RED
  // - <= 7 days => YELLOW
  // - <= 21 days => GREEN
  // - > 21 days => BLUE
  if (!dueAt) return 'gray';
  const d = resolveDeadlineDateTime(dueAt);
  if (!d) return 'gray';
  const dueMs = d.getTime();

  const nowMs = now.getTime();
  const remainingMs = dueMs - nowMs;
  const hoursLeft = remainingMs / (1000 * 60 * 60);
  const daysLeft = hoursLeft / 24;

  if (remainingMs <= 0) return 'red';
  const ratioColor = getUrgencyColorFromRatio(getDueRemainingRatio(startAt, dueAt, now));
  if (ratioColor !== 'gray') return ratioColor;
  if (hoursLeft <= 48) return 'red';
  if (daysLeft <= 7) return 'yellow';
  if (daysLeft <= 21) return 'green';
  return 'blue';
};

export const getUrgencyClass = (color: UrgencyColor) => {
  if (color === 'blue') return 'deadline-urgency-blue';
  if (color === 'green') return 'deadline-urgency-green';
  if (color === 'yellow') return 'deadline-urgency-yellow';
  if (color === 'red') return 'deadline-urgency-red';
  return 'deadline-urgency-gray';
};

export const getPerformanceZoneFromUsedRatio = (ratio: number | undefined): DeadlineZone => {
  if (ratio === undefined) return 'untracked';
  if (ratio <= 0.25) return 'excellent';
  if (ratio <= 0.55) return 'good';
  if (ratio <= 0.85) return 'delayed';
  return 'risk';
};

export const getZoneColor = (zone: DeadlineZone): UrgencyColor => {
  if (zone === 'excellent') return 'blue';
  if (zone === 'good') return 'green';
  if (zone === 'delayed') return 'yellow';
  if (zone === 'risk') return 'red';
  return 'gray';
};

// Returns the CSS class for a deadline pill given due and start dates.
export const getDeadlinePillClass = (dueAt?: Date | string, startAt?: Date | string) => {
  return getUrgencyClass(getUrgencyColorForDueDate(dueAt, startAt));
};

export const getTimeUsedRatio = (startAt?: Date | string, endAt?: Date | string, dueAt?: Date | string) => {
  if (!startAt || !endAt || !dueAt) return undefined;
  const s = resolveDeadlineDateTime(startAt);
  const e = resolveDeadlineDateTime(endAt);
  const d = resolveDeadlineDateTime(dueAt);
  if (!s || !e || !d) return undefined;
  const total = d.getTime() - s.getTime();
  const used = e.getTime() - s.getTime();
  if (total <= 0) return undefined;
  return Math.max(0, used / total);
};

export const formatDurationCountdown = (ms: number) => {
  const abs = Math.abs(ms);
  const minute = 1000 * 60;
  const hour = minute * 60;
  const day = hour * 24;
  const month = day * 30;
  const months = Math.floor(abs / month);
  const days = Math.floor((abs % month) / day);
  const hours = Math.floor((abs % day) / hour);
  const minutes = Math.floor((abs % hour) / minute);
  if (months > 0) return `${months}mo ${days}d ${hours}h`;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(0, minutes)}m`;
};

export const formatDueCountdown = (dueAt?: Date | string, now = new Date()) => {
  if (!dueAt) return 'No deadline';
  const d = resolveDeadlineDateTime(dueAt);
  if (!d) return 'No deadline';
  const ms = d.getTime();
  const diff = ms - now.getTime();
  if (diff < 0) return `${formatDurationCountdown(diff)} overdue`;
  return `${formatDurationCountdown(diff)} left`;
};
