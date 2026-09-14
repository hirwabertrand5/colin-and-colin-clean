export type SortDir = 'asc' | 'desc';

export const compareValues = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
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
  copy.sort((a, b) => {
    const cmp = compareValues(valueOf(a), valueOf(b));
    return dir === 'asc' ? cmp : -cmp;
  });
  return copy;
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