export const INTAKE_ROWS_PER_PAGE = 10;

export default function IntakeTablePagination({ page, total, view, busy, onPageChange }: {
  page: number; total: number; view: 'links' | 'submissions'; busy: boolean;
  onPageChange: (page: number) => void;
}) {
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / INTAKE_ROWS_PER_PAGE));
  const buttonClass = 'rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700';
  return <div className="flex flex-col gap-4 border-t border-gray-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
    <p className="text-sm text-gray-600 dark:text-gray-400" role="status">
      Showing {(page - 1) * INTAKE_ROWS_PER_PAGE + 1}-{Math.min(page * INTAKE_ROWS_PER_PAGE, total)} of {total} {view === 'links' ? 'intake links' : 'submissions'}
    </p>
    <nav className="flex flex-wrap items-center gap-2" aria-label={view === 'links' ? 'Intake links pagination' : 'Client submissions pagination'}>
      <button type="button" onClick={() => onPageChange(page - 1)} disabled={page === 1 || busy} className={buttonClass}>Previous</button>
      {Array.from({ length: pages }, (_, index) => index + 1).map(number => <button
        key={number} type="button" disabled={busy} onClick={() => onPageChange(number)} aria-current={page === number ? 'page' : undefined}
        className={`rounded-md border px-3 py-2 text-sm font-medium transition ${page === number
          ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
          : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'}`}
      >{number}</button>)}
      <button type="button" onClick={() => onPageChange(page + 1)} disabled={page === pages || busy} className={buttonClass}>Next</button>
    </nav>
  </div>;
}
