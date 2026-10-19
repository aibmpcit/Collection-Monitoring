import type { FilterField, FilterValues } from "../components/FilterButton";

// Excel and PDF exports of a filtered list. Each export carries its filters so the file explains itself.

export interface ExportColumn<T> {
  label: string;
  value: (row: T) => string | number | null | undefined;
  /** Relative PDF column width (default 1). */
  width?: number;
  /** Peso amounts: numbers in Excel, "PHP 1,234.00" in the PDF. */
  money?: boolean;
}

export interface TableExport<T> {
  title: string;
  /** File name without extension, e.g. "loan-records". */
  fileBase: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** Lines under the title, e.g. the active filters. */
  details: string[];
}

/** Most rows one export collects; keeps a runaway export from freezing the browser. */
export const MAX_EXPORT_ROWS = 20000;
const PAGE_SIZE = 200;

/** Collects every page of a paged list endpoint. `pathFor` builds the request for a page number. */
export async function fetchAllPages<T>(load: (path: string) => Promise<{ items: T[]; total: number }>, pathFor: (page: number, pageSize: number) => string) {
  const rows: T[] = [];
  for (let page = 1; rows.length < MAX_EXPORT_ROWS; page += 1) {
    const result = await load(pathFor(page, PAGE_SIZE));
    rows.push(...result.items);
    // A short page is the last one, whatever the total says.
    if (result.items.length < PAGE_SIZE || rows.length >= result.total) break;
  }
  return rows.slice(0, MAX_EXPORT_ROWS);
}

/** "PAR age: PAR 31-60 · Sort by: Highest PAR age", or "No filters". */
export function describeFilters(fields: FilterField[], values: FilterValues, search = "") {
  const parts = fields.flatMap(field => {
    const value = values[field.key];
    if (!value) return [];
    const label = field.options.find(([option]) => option === value)?.[1] ?? value;
    return [`${field.label}: ${label}`];
  });
  if (search.trim()) parts.unshift(`Search: "${search.trim()}"`);
  return parts.length ? parts.join(" · ") : "No filters";
}

export const plainDate = (value: unknown) => String(value ?? "").replace("T", " ").slice(0, 10);
export const plainDateTime = (value: unknown) => String(value ?? "").replace("T", " ").slice(0, 16);

const stamp = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const peso = (value: unknown) => `PHP ${Number(value ?? 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function exportToExcel<T>({ title, fileBase, columns, rows, details }: TableExport<T>) {
  const XLSX = await import("xlsx");
  const header = [[title], ...details.map(line => [line]), [`Generated: ${new Date().toLocaleString()}`], []];
  const sheet = XLSX.utils.aoa_to_sheet([
    ...header,
    columns.map(column => column.label),
    ...rows.map(row => columns.map(column => {
      const value = column.value(row);
      return column.money ? Number(value ?? 0) : value ?? "";
    }))
  ]);
  sheet["!cols"] = columns.map(column => ({ wch: Math.max(10, Math.round((column.width ?? 1) * 14)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, title.slice(0, 31));
  XLSX.writeFile(workbook, `${fileBase}-${stamp()}.xlsx`);
}

export async function exportToPdf<T>(table: TableExport<T>) {
  (await buildPdf(table)).save(`${table.fileBase}-${stamp()}.pdf`);
}

/** The PDF document for a table (landscape A4, header repeated on each page, page numbers). */
export async function buildPdf<T>({ title, columns, rows, details }: TableExport<T>) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const left = 10;
  const usable = pdf.internal.pageSize.getWidth() - left * 2;
  const bottom = pdf.internal.pageSize.getHeight() - 12;
  const totalWeight = columns.reduce((sum, column) => sum + (column.width ?? 1), 0);
  const widths = columns.map(column => usable * (column.width ?? 1) / totalWeight);
  const generated = new Date().toLocaleString();

  const fit = (text: string, width: number) => {
    if (pdf.getTextWidth(text) <= width - 3) return text;
    let shortened = text;
    while (shortened.length > 1 && pdf.getTextWidth(`${shortened}...`) > width - 3) shortened = shortened.slice(0, -1);
    return `${shortened}...`;
  };
  const drawHeader = () => {
    pdf.setTextColor(20, 30, 45);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.text(title, left, 13);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    let y = 19;
    for (const line of [...details, `Generated: ${generated}`]) {
      for (const wrapped of pdf.splitTextToSize(line, usable) as string[]) { pdf.text(wrapped, left, y); y += 4.5; }
    }
    y += 1.5;
    pdf.setFillColor(0, 61, 150);
    pdf.rect(left, y, usable, 7, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    let x = left;
    columns.forEach((column, index) => { pdf.text(fit(column.label, widths[index]), x + 1.5, y + 4.8); x += widths[index]; });
    pdf.setTextColor(20, 30, 45);
    pdf.setFont("helvetica", "normal");
    return y + 12;
  };

  let y = drawHeader();
  rows.forEach((row, index) => {
    if (y > bottom) { pdf.addPage(); y = drawHeader(); }
    if (index % 2 === 0) { pdf.setFillColor(245, 248, 252); pdf.rect(left, y - 4.5, usable, 6.5, "F"); }
    let x = left;
    columns.forEach((column, columnIndex) => {
      const value = column.value(row);
      const text = column.money ? peso(value) : String(value ?? "");
      pdf.text(fit(text, widths[columnIndex]), x + 1.5, y);
      x += widths[columnIndex];
    });
    y += 6.5;
  });
  if (!rows.length) pdf.text("No records match these filters.", left, y);

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFontSize(7.5);
    pdf.setTextColor(110, 120, 135);
    pdf.text(`Page ${page} of ${pages}`, left + usable, pdf.internal.pageSize.getHeight() - 6, { align: "right" });
  }
  return pdf;
}
