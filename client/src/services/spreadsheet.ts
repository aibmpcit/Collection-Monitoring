let xlsxLoader: Promise<typeof import("xlsx")> | null = null;

export function loadXlsx() {
  xlsxLoader ??= import("xlsx");
  return xlsxLoader;
}

function isCsv(file: File) {
  return /\.csv$/i.test(file.name) || file.type === "text/csv";
}

/**
 * Keeps leading zeros that a cell displays but its stored number lacks, such as a member code
 * typed as 123 and formatted to show "000123", or a phone number shown as "09171234567".
 * Other numbers (amounts, Excel date serials) keep their underlying value.
 */
export function preserveLeadingZeros(value: unknown, text: unknown): unknown {
  if (typeof value === "number" && typeof text === "string" && /^0\d+$/.test(text.trim())) return text.trim();
  return value;
}

export interface SpreadsheetData {
  /** Cell values by row, header row first, with displayed leading zeros kept. */
  grid: unknown[][];
  /** Cell text exactly as displayed, header row first. */
  texts: string[][];
  /** Spreadsheet row number (1-based) of the header row; data may not start on row 1. */
  headerRow: number;
}

/** Reads the first worksheet of a CSV or Excel file. */
export async function readSpreadsheet(file: File): Promise<SpreadsheetData> {
  const XLSX = await loadXlsx();
  // CSV cells are text; letting SheetJS turn them into numbers would strip "000123" to 123.
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: isCsv(file) });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("The file has no worksheet.");
  const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
  const texts = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false })
    .map(row => row.map(cell => String(cell ?? "")));
  const grid = values.map((row, rowIndex) => row.map((value, column) => preserveLeadingZeros(value, texts[rowIndex]?.[column])));
  const headerRow = XLSX.utils.decode_range(sheet["!ref"] ?? "A1").s.r + 1;
  return { grid, texts, headerRow };
}

/**
 * Turns a grid into one object per non-blank data row, keyed by header text. Each record also
 * carries `__row`, its 1-based spreadsheet row, so import messages can point at the right line.
 */
export function gridToRecords(grid: unknown[][], headerRow = 1): Record<string, unknown>[] {
  const headers = (grid[0] ?? []).map(header => String(header ?? ""));
  return grid
    .map((row, index) => ({ row, line: index + headerRow }))
    .slice(1)
    .filter(({ row }) => row.some(cell => String(cell ?? "").trim() !== ""))
    .map(({ row, line }) => ({ ...Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""])), __row: line }));
}
