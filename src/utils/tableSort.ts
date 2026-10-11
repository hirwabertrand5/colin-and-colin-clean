export type SortDir = 'asc' | 'desc';

/** Values with no data — always ordered last, in BOTH directions. */
const isBlank = (value: unknown) => value === null || value === undefined || value === '';

/** Parse a display-formatted number ("1,250", "12%") or null. */
const toNumber = (value: unknown): number | null => {
  if (typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replace(/,/g, '');
  if (!text) return null;
  // Only treat the WHOLE string as numeric when it is one, so "TASK-10" and
  // "2026-03" keep comparing as text.
  if (!/^[-+]?(\d+\.?\d*|\.\d+)%?$/.test(text)) return null;
  const parsed = Number(text.replace('%', ''));
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Compare two cell values.
 *
 * - Numbers (and numeric strings such as "1,250" / "12%") compare NUMERICALLY,
 *   never lexicographically, so 9 sorts before 80.
 * - Blank values (null / undefined / '') always sort last regardless of
 *   direction, so "Pending"/"—" rows never jump to the top of a descending
 *   sort.
 * - Everything else falls back to a case-insensitive locale compare.
 */
export const compareValues = (a: unknown, b: unknown): number => {
  if (a === b) return 0;

  const aBlank = isBlank(a);
  const bBlank = isBlank(b);
  if (aBlank && bBlank) return 0;
  // Blank always loses, whichever direction the caller applies.
  if (aBlank) return 1;
  if (bBlank) return -1;

  const aNum = typeof a === 'number' ? a : toNumber(a);
  const bNum = typeof b === 'number' ? b : toNumber(b);
  if (aNum !== null && bNum !== null) {
    if (aNum === bNum) return 0;
    return aNum < bNum ? -1 : 1;
  }

  if (typeof a === 'number' || typeof b === 'number') {
    // One side is a real number and the other is not parseable: numbers first.
    return typeof a === 'number' ? -1 : 1;
  }

  return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
};

export const sortRows = <T,>(
  rows: T[],
  key: string,
  dir: SortDir,
  valueOf: (row: T) => unknown,
): T[] => {
  if (!key) return rows;
  const copy = [...rows];
  // Decorate with the original index so equal values keep a deterministic,
  // stable order (and the sort stays a pure function of the input).
  const decorated = copy.map((row, index) => ({ row, index, value: valueOf(row) }));
  decorated.sort((a, b) => {
    const cmp = compareValues(a.value, b.value);
    if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    // Tie-break on the original position: deterministic, never reorders equals.
    return a.index - b.index;
  });
  return decorated.map((entry) => entry.row);
};

export const toggleSortKey = (
  currentKey: string,
  currentDir: SortDir,
  column: string
): { key: string; dir: SortDir } => {
  if (currentKey === column) {
    return { key: column, dir: currentDir === 'asc' ? 'desc' : 'asc' };
  }
  return { key: column, dir: 'asc' };
};