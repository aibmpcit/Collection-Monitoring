// Member codes and loan account numbers are matched without regard to case or, for all-digit
// values, leading zeros. Older imports read spreadsheet cells as numbers and stored "000123"
// as "123"; matching both ways lets a correct file find and repair those records instead of
// creating duplicates.

/** Matching key for a member code or loan account number. */
export function identifierKey(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return trimmed.replace(/^0+(?=\d)/, "");
  return trimmed;
}

/** SQL expression computing identifierKey() for a column. The column name must be a constant. */
export function identifierKeySql(column: string): string {
  return `(CASE WHEN TRIM(${column}) REGEXP '^[0-9]+$'
    THEN COALESCE(NULLIF(TRIM(LEADING '0' FROM TRIM(${column})), ''), '0')
    ELSE LOWER(TRIM(${column})) END)`;
}
