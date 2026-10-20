// Upload types are decided by the file's first bytes (its signature), never by the name or the type
// the browser claims. Only these types are ever served with their own type; anything else is
// stored and served as a plain download (application/octet-stream), so an uploaded HTML or SVG file
// can't run as a page in someone's browser.

export const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SERVABLE_TYPES = new Set([...PHOTO_TYPES, "image/gif", "image/heic", "application/pdf"]);
const DOWNLOAD_TYPE = "application/octet-stream";

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  buffer.length >= offset + bytes.length && bytes.every((byte, index) => buffer[offset + index] === byte);
const ascii = (buffer: Buffer, start: number, end: number) => buffer.subarray(start, end).toString("latin1");

/** The type the file's signature shows, or null when it isn't one we recognise. */
export function detectFileType(buffer: Buffer): string | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WEBP") return "image/webp";
  if (ascii(buffer, 0, 6) === "GIF87a" || ascii(buffer, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(buffer, 4, 8) === "ftyp" && /^(heic|heix|hevc|mif1|msf1)$/.test(ascii(buffer, 8, 12))) return "image/heic";
  if (ascii(buffer, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

/** Type to store for an attachment: its verified type when recognised, otherwise a plain download. */
export function storedAttachmentType(buffer: Buffer): string {
  return detectFileType(buffer) ?? DOWNLOAD_TYPE;
}

/** Content-Type to send for a stored file; covers rows saved before uploads were verified. */
export function servedContentType(storedType: string | null | undefined): string {
  const type = String(storedType ?? "").trim().toLowerCase();
  return SERVABLE_TYPES.has(type) ? type : DOWNLOAD_TYPE;
}

/** Only verified images may be shown inline; everything else downloads. */
export function canShowInline(storedType: string | null | undefined): boolean {
  return servedContentType(storedType).startsWith("image/");
}
