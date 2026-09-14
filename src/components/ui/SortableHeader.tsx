import type { SortDir } from '../../utils/tableSort';

export default function SortableHeader({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  className = 'px-4 py-3',
  align = 'left',
}: {
  label: string;
  column: string;
  sortKey: string;
  sortDir: SortDir;
  onSort: (column: string) => void;
  className?: string;
  align?: 'left' | 'right';
}) {
  const active = sortKey === column;
  return (
    <th
      className={`${className} ${align === 'right' ? 'text-right' : ''} select-none cursor-pointer`}
      onClick={() => onSort(column)}
      title={`Sort by ${label}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={active ? 'text-gray-800' : 'text-gray-300'} aria-hidden="true">
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '▲▼'}
        </span>
      </span>
    </th>
  );
}