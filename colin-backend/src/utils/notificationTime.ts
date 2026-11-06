export const appTimezone = () => process.env.APP_TIMEZONE || 'Africa/Kigali';
export const formatNotificationTime = (date: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: appTimezone(), dateStyle: 'medium', timeStyle: 'short' }).format(date) + ` (${appTimezone()})`;
export const localDateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: appTimezone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const localHour = (date: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: appTimezone(), hour: '2-digit', hourCycle: 'h23' }).format(date));

/** Convert a calendar wall time without relying on the server's local timezone. */
export const eventDateTime = (date: string, time: string): Date | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return undefined;
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined;
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: appTimezone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = wallMs;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(parts.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    const rendered = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    instant += wallMs - rendered;
  }
  const result = new Date(instant);
  return localDateKey(result) === date ? result : undefined;
};

export const reminderHoursFor = (priority: string, prefs: any, event = false) => {
  if (event) return [...new Set<number>(prefs?.eventReminderHours || [24, 2])].filter(n => n > 0 && n <= 168).sort((a, b) => b - a);
  const first = prefs?.taskDueReminderHours || 24;
  return [...new Set<number>(priority === 'Critical' ? [72, first, 2] : priority === 'High' ? [48, first, 2] : priority === 'Low' ? [first] : [first, 2])].sort((a, b) => b - a);
};
// Catch up once at the closest applicable threshold; never send old 72h/24h
// reminders together for a newly-created short-deadline task.
export const dueReminderThreshold = (due: Date, now: Date, hours: number[], event = false) => {
  const remaining = (due.getTime() - now.getTime()) / 3600000;
  if (remaining <= 0) return event ? undefined : 0;
  return hours.filter(hour => remaining <= hour).sort((a, b) => a - b)[0];
};
