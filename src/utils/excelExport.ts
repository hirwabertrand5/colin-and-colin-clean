import { Workbook, type Worksheet } from 'exceljs';

const HEADER_FILL = '#0F172A';
const HEADER_TEXT = '#FFFFFF';
const STRIPE_FILL = '#F8FAFC';
const BORDER_COLOR = '#CBD5E1';

export interface ExcelSectionDefinition {
  title: string;
  headers: Array<string>;
  rows: Array<Array<unknown>>;
  currencyColumns?: Array<number>;
  percentColumns?: Array<number>;
  centerColumns?: Array<number>;
  summaryRow?: Array<unknown>;
}

export interface ExcelSheetDefinition {
  title: string;
  sections: Array<ExcelSectionDefinition>;
}

const toNumeric = (value: unknown) => {
  if (typeof value === 'number') return value;
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toPercentValue = (value: unknown) => {
  if (typeof value === 'number') {
    return value > 1 ? value / 100 : value;
  }
  const parsed = Number(String(value ?? '').replace('%', ''));
  return Number.isFinite(parsed) ? (parsed > 1 ? parsed / 100 : parsed) : 0;
};

const styleHeaderRow = (row: Worksheet['row'], rowHeight = 26) => {
  row.height = rowHeight;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: HEADER_TEXT.replace('#', 'FF') } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL.replace('#', 'FF') },
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: BORDER_COLOR.replace('#', 'FF') } },
      bottom: { style: 'thin', color: { argb: BORDER_COLOR.replace('#', 'FF') } },
      left: { style: 'thin', color: { argb: BORDER_COLOR.replace('#', 'FF') } },
      right: { style: 'thin', color: { argb: BORDER_COLOR.replace('#', 'FF') } },
    };
  });
};

const styleTitleRow = (row: Worksheet['row']) => {
  row.height = 24;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF0F172A' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    };
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
  });
};

const styleDataRow = (row: Worksheet['row'], rowIndex: number, section: ExcelSectionDefinition) => {
  row.height = 20;
  const isEven = rowIndex % 2 === 0;
  row.eachCell({ includeEmpty: true }, (cell, colIndex) => {
    const rawValue = row.getCell(colIndex).value;
    const value = rawValue;
    const text = value == null ? '' : String(value);
    cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF0F172A' } };
    cell.alignment = { vertical: 'middle' };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: isEven ? STRIPE_FILL.replace('#', 'FF') : 'FFFFFFFF' },
    };
    cell.border = {
      top: { style: 'thin', color: { argb: BORDER_COLOR.replace('#', 'FF') } },
      bottom: { style: 'thin', color: { argb: BORDER_COLOR.replace('#', 'FF') } },
      left: { style: 'thin', color: { argb: BORDER_COLOR.replace('#', 'FF') } },
      right: { style: 'thin', color: { argb: BORDER_COLOR.replace('#', 'FF') } },
    };

    if (section.currencyColumns?.includes(colIndex)) {
      cell.alignment = { ...cell.alignment, horizontal: 'right' };
      if (typeof value === 'number') {
        cell.numFmt = 'RWF #,##0';
      }
    } else if (section.percentColumns?.includes(colIndex)) {
      cell.alignment = { ...cell.alignment, horizontal: 'center' };
      if (typeof value === 'number') {
        cell.numFmt = '0.00%';
      }
    } else if (section.centerColumns?.includes(colIndex) || /^\d{4}-\d{2}-\d{2}$/.test(text)) {
      cell.alignment = { ...cell.alignment, horizontal: 'center' };
    } else if (colIndex === 1) {
      cell.alignment = { ...cell.alignment, horizontal: 'left' };
    }
  });
};

const styleSummaryRow = (row: Worksheet['row']) => {
  row.height = 22;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'right' };
    cell.border = {
      top: { style: 'thin', color: { argb: BORDER_COLOR.replace('#', 'FF') } },
      bottom: { style: 'double', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: BORDER_COLOR.replace('#', 'FF') } },
      right: { style: 'thin', color: { argb: BORDER_COLOR.replace('#', 'FF') } },
    };
  });
};

export const createStyledWorkbook = async (sheets: Array<ExcelSheetDefinition>) => {
  const workbook = new Workbook();
  workbook.properties = {
    title: 'Firm Reports',
    subject: 'Executive financial and productivity export',
    creator: 'Colin & Colin',
  };

  sheets.forEach((sheetDefinition) => {
    const worksheet = workbook.addWorksheet(sheetDefinition.title);
    worksheet.views = [{ showGridLines: true }];
    worksheet.properties.defaultRowHeight = 20;
    worksheet.font = { name: 'Segoe UI', size: 11, color: { argb: 'FF0F172A' } };

    let rowIndex = 1;
    sheetDefinition.sections.forEach((section, sectionIndex) => {
      const titleRow = worksheet.getRow(rowIndex);
      titleRow.getCell(1).value = section.title.toUpperCase();
      styleTitleRow(titleRow);
      rowIndex += 1;

      const headerRow = worksheet.getRow(rowIndex);
      headerRow.values = section.headers;
      styleHeaderRow(headerRow);
      rowIndex += 1;

      section.rows.forEach((rowValues) => {
        const row = worksheet.getRow(rowIndex);
        row.values = rowValues;
        styleDataRow(row, rowIndex, section);
        rowIndex += 1;
      });

      if (section.summaryRow) {
        const summaryRow = worksheet.getRow(rowIndex);
        summaryRow.values = section.summaryRow;
        styleSummaryRow(summaryRow);
        rowIndex += 1;
      }

      if (sectionIndex < sheetDefinition.sections.length - 1) {
        worksheet.addRow([]);
        worksheet.addRow([]);
        rowIndex += 2;
      }
    });

    const maxColumns = worksheet.columns.length || 1;
    for (let columnIndex = 1; columnIndex <= maxColumns; columnIndex += 1) {
      let maxLength = 14;
      worksheet.eachRow({ includeEmpty: true }, (row) => {
        const value = row.getCell(columnIndex).value;
        const text = value == null ? '' : String(value);
        maxLength = Math.max(maxLength, text.length + 5);
      });
      worksheet.getColumn(columnIndex).width = Math.max(maxLength, 14);
    }
  });

  return workbook;
};

export const downloadWorkbook = async (filename: string, sheets: Array<ExcelSheetDefinition>) => {
  const workbook = await createStyledWorkbook(sheets);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
