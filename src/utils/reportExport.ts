import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { downloadWorkbook } from './excelExport';

export interface ReportColumn<T> {
  label: string;
  value: (row: T) => unknown;
  type?: 'text' | 'money' | 'percent' | 'number' | 'center';
}

export interface TableReportParams<T> {
  filename: string;
  title: string;
  subtitle?: string;
  columns: ReportColumn<T>[];
  rows: T[];
}

const cellText = (value: unknown) => {
  if (value === null || value === undefined) return '';
  return String(value);
};

export const exportTableExcel = async <T>(params: TableReportParams<T>): Promise<void> => {
  const { columns, rows } = params;
  const headers = ['#', ...columns.map((c) => c.label)];
  const dataRows = rows.map((row, index) => [
    index + 1,
    ...columns.map((c) => c.value(row)),
  ]);

  const currencyColumns: number[] = [0];
  const percentColumns: number[] = [];
  const centerColumns: number[] = [];
  columns.forEach((c, i) => {
    const oneBased = i + 2;
    if (c.type === 'money') currencyColumns.push(oneBased);
    else if (c.type === 'percent') percentColumns.push(oneBased);
    else if (c.type === 'center') centerColumns.push(oneBased);
  });

  const filename = `${params.filename.replace(/[^A-Za-z0-9_-]/g, '_')}.xlsx`;
  await downloadWorkbook(filename, [
    {
      title: params.title,
      sections: [
        {
          title: 'Report Information',
          headers: ['Field', 'Value'],
          rows: [
            ['Report', params.title],
            ['Period / Range', params.subtitle || 'All records'],
            ['Record Count', rows.length],
            ['Generated At', new Date().toLocaleString()],
          ],
          centerColumns: [1],
        },
        {
          title: params.title,
          headers,
          rows: dataRows,
          currencyColumns,
          percentColumns,
          centerColumns,
        },
      ],
    },
  ]);
};

export const exportTablePdf = async <T>(params: TableReportParams<T>): Promise<void> => {
  const { columns, rows } = params;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(10, 11, `Colin & Colin Legal Solutions`);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text(10, 18, params.title);
  doc.setFontSize(9);
  doc.setTextColor(90);
  let metaY = 23;
  const metaLines = [
    params.subtitle ? `Period / Range: ${params.subtitle}` : '',
    `Record Count: ${rows.length}`,
    `Generated At: ${new Date().toLocaleString()}`,
  ].filter(Boolean);
  metaLines.forEach((line) => {
    doc.text(10, metaY, line);
    metaY += 4;
  });
  doc.setFontSize(9);
  doc.setTextColor(40);
  doc.setDrawColor(200);
  doc.line(10, metaY + 1, 287, metaY + 1);

  const startY = metaY + 6;
  autoTable(doc, {
    head: [['#', ...columns.map((c) => c.label)]],
    body: rows.map((row, index) => [
      String(index + 1),
      ...columns.map((c) => cellText(c.value(row))),
    ]),
    startY,
    theme: 'striped',
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    styles: {
      fontSize: 8,
      cellPadding: 1.6,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { top: startY, right: 10, bottom: 18, left: 10 },
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      10,
      205,
      `Colin & Colin Legal Solutions — ${params.title} — Generated ${new Date().toLocaleString()}`
    );
    doc.text(280, 205, `Page ${page} of ${pageCount}`);
    doc.setFontSize(8);
  }

  doc.save(`${params.filename.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`);
};

export const downloadTableReport = async <T>(
  kind: 'pdf' | 'excel',
  params: TableReportParams<T>
): Promise<void> => {
  if (kind === 'pdf') await exportTablePdf(params);
  else await exportTableExcel(params);
};