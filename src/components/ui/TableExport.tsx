import { Download, FileSpreadsheet } from 'lucide-react';
import { downloadTableReport, ReportColumn } from '../../utils/reportExport';

export default function TableExport<T>({
  filename,
  title,
  subtitle,
  columns,
  rows,
}: {
  filename: string;
  title: string;
  subtitle?: string;
  columns: ReportColumn<T>[];
  rows: T[];
}) {
  const busy = { value: false };
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void downloadTableReport('excel', { filename, title, subtitle, columns, rows })}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        title="Download report as Excel (.xlsx)"
      >
        <FileSpreadsheet className="h-3.5 w-3.5" />
        Excel
      </button>
      <button
        type="button"
        onClick={() => void downloadTableReport('pdf', { filename, title, subtitle, columns, rows })}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        title="Download report as PDF"
      >
        <Download className="h-3.5 w-3.5" />
        PDF
      </button>
    </div>
  );
}