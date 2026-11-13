/** Pure lifecycle rules shared by API reports and the browser's matter lists. */
export type MatterLifecycleRecord = { status?: unknown; workflowProgress?: { status?: unknown } | null };
export const normalizeMatterStatus = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
export const isTemporarilyClosedMatter = (matter?: MatterLifecycleRecord | null) => normalizeMatterStatus(matter?.status) === 'temporarily closed';
export const isReturnedToIntakeMatter = (matter?: MatterLifecycleRecord | null) => normalizeMatterStatus(matter?.status) === 'returned to intake';
export const isCompletedMatter = (matter?: MatterLifecycleRecord | null) => Boolean(matter)
  && !isTemporarilyClosedMatter(matter) && !isReturnedToIntakeMatter(matter)
  && (['closed', 'completed'].includes(normalizeMatterStatus(matter?.status)) || normalizeMatterStatus(matter?.workflowProgress?.status) === 'completed');
/** Paused/intake/terminal records never contribute to an active-matter total. */
export const isActiveMatter = (matter?: MatterLifecycleRecord | null) => Boolean(matter)
  && !isCompletedMatter(matter) && !isTemporarilyClosedMatter(matter) && !isReturnedToIntakeMatter(matter)
  && !['cancelled', 'canceled'].includes(normalizeMatterStatus(matter?.status));
/** Count identities once even when a matter joins multiple assignments or tasks. */
export const countActiveMatters = (matters: Array<MatterLifecycleRecord & { _id?: unknown; id?: unknown }>) => {
  const seen = new Set<string>(); let count = 0;
  for (const matter of matters) {
    if (!isActiveMatter(matter)) continue;
    const id = String(matter._id || matter.id || '');
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    count++;
  }
  return count;
};
