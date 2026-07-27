export type UrgencyColor = 'blue' | 'green' | 'yellow' | 'red' | 'gray';

const getDueRemainingRatio = (startAt?: Date | string, dueAt?: Date | string, now = new Date()) => {
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
  return Math.max(0, Math.min(1, remaining / total));
};

const getUrgencyColorFromRatio = (ratio: number | undefined): UrgencyColor => {
  if (ratio === undefined) return 'gray';
  if (ratio > 0.75) return 'blue';
  if (ratio > 0.5) return 'green';
  if (ratio > 0.25) return 'yellow';
  return 'red';
};

export const getUrgencyColorForDueDate = (dueAt?: Date | string, startAt?: Date | string, now = new Date()): UrgencyColor => {
  if (!dueAt) return 'gray';
  const d = dueAt instanceof Date ? dueAt : new Date(dueAt);
  const dueMs = d.getTime();
  if (!Number.isFinite(dueMs)) return 'gray';

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

export const getCaseVisibilityDeadline = (c: any) => {
  const currentDueAt = c?.workflowProgress?.currentStepDueAt || c?.workflowProgress?.nextDueAt;
  const currentStartAt = c?.workflowProgress?.currentStepStartAt || c?.workflowStartDate || c?.createdAt;
  return { dueAt: currentDueAt, startAt: currentStartAt };
};

export const getCaseUrgencyColor = (c: any, now = new Date()): UrgencyColor => {
  const { dueAt, startAt } = getCaseVisibilityDeadline(c);
  return getUrgencyColorForDueDate(dueAt, startAt, now);
};

export const isPublicYellowCase = (c: any, now = new Date()) => {
  const status = String(c?.status || '').trim().toLowerCase();
  if (!c) return false;
  if (status === 'closed' || status === 'temporarily closed') return false;
  if (String(c?.workflowProgress?.status || '').trim().toLowerCase() === 'completed') return false;
  if (String(c?.takeRequestState?.status || '').trim().toLowerCase() === 'claimed') return false;
  return getCaseUrgencyColor(c, now) === 'yellow';
};
