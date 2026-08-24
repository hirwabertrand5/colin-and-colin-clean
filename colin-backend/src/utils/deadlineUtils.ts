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
    const [yearText, monthText, dayText] = raw.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (![year, month, day].every((part) => Number.isFinite(part))) return undefined;
    return new Date(Date.UTC(year, month - 1, day, DEFAULT_DEADLINE_HOUR_UTC, 0, 0, 0));
  }

  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  return normalizeLegacyMidnightDate(parsed);
};

export const formatDeadlineDateTime = (value?: Date | string) => {
  const resolved = resolveDeadlineDateTime(value);
  return resolved ? resolved.toLocaleString() : 'No deadline';
};
