export type UrgencyColor = 'blue' | 'green' | 'yellow' | 'red' | 'gray';
export type DeadlineZone = 'excellent' | 'good' | 'delayed' | 'risk' | 'untracked';

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export const getDueRemainingRatio = (startAt?: Date | string, dueAt?: Date | string, now = new Date()) => {
  if (!startAt || !dueAt) return undefined;
  const s = startAt instanceof Date ? startAt : new Date(startAt);
  const d = dueAt instanceof Date ? dueAt : new Date(dueAt);
  const startMs = s.getTime();
  const dueMs = d.getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(dueMs)) return undefined;
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
  if (!dueAt) return 'gray';
  const d = dueAt instanceof Date ? dueAt : new Date(dueAt);
  const dueMs = d.getTime();
  if (!Number.isFinite(dueMs)) return 'gray';

  const ratio = getDueRemainingRatio(startAt, dueAt, now);
  if (ratio !== undefined) return getUrgencyColorFromRatio(ratio);

  const hoursLeft = (dueMs - now.getTime()) / (1000 * 60 * 60);
  if (hoursLeft <= 0) return 'red';
  if (hoursLeft <= 48) return 'red';
  if (hoursLeft <= 24 * 7) return 'yellow';
  if (hoursLeft <= 24 * 21) return 'green';
  return 'blue';
};

export const getUrgencyClass = (color: UrgencyColor) => {
  // Solid pills with white text for consistent emphasis
  if (color === 'blue') return 'bg-blue-600 text-white border-blue-700';
  if (color === 'green') return 'bg-green-600 text-white border-green-700';
  if (color === 'yellow') return 'bg-yellow-500 text-white border-yellow-600';
  if (color === 'red') return 'bg-red-600 text-white border-red-700';
  return 'bg-gray-500 text-white border-gray-600';
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

export const getTimeUsedRatio = (startAt?: Date | string, endAt?: Date | string, dueAt?: Date | string) => {
  if (!startAt || !endAt || !dueAt) return undefined;
  const s = startAt instanceof Date ? startAt : new Date(startAt);
  const e = endAt instanceof Date ? endAt : new Date(endAt);
  const d = dueAt instanceof Date ? dueAt : new Date(dueAt);
  const total = d.getTime() - s.getTime();
  const used = e.getTime() - s.getTime();
  if (!Number.isFinite(total) || !Number.isFinite(used) || total <= 0) return undefined;
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
  const d = dueAt instanceof Date ? dueAt : new Date(dueAt);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return 'No deadline';
  const diff = ms - now.getTime();
  if (diff < 0) return `${formatDurationCountdown(diff)} overdue`;
  return `${formatDurationCountdown(diff)} left`;
};
