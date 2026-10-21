import { detectFileType, storedAttachmentType } from "./fileTypes.js";
import { query, type QueryClient } from "../config/db.js";
import { toBusinessDateTime } from "../config/time.js";

// Field evidence captured on the collector's phone:
// - every payment carries proof (a camera photo or an attached file) plus where it was recorded;
// - a remark may carry just a location ("Add location").

export interface GeoPoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  placeName: string | null;
}

/** Payment proof: the photo or file is required; the location is optional. */
export interface PaymentProofPayload {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  placeName: string | null;
  kind: "photo" | "attachment";
  name: string;
  type: string;
  data: string;
  capturedAt: string;
}

const MAX_PROOF_BYTES = 5 * 1024 * 1024;

/** Readable place for a location (e.g. "Brgy. Centro Norte, Culasi, Antique"); display only. */
export function placeNameOf(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 160) : "";
  return text || null;
}

function invalid(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}

function coordinate(value: unknown, limit: number, label: string) {
  const number = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number) || Math.abs(number) > limit) {
    throw invalid(label);
  }
  return Math.round(number * 1e6) / 1e6;
}

function accuracyOf(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** A required point: both coordinates present and in range. */
export function parseGeoPoint(value: unknown, message = "Location is required"): GeoPoint {
  if (!value || typeof value !== "object") throw invalid(message);
  const raw = value as Record<string, unknown>;
  return {
    latitude: coordinate(raw.latitude, 90, message),
    longitude: coordinate(raw.longitude, 180, message),
    accuracy: accuracyOf(raw.accuracy),
    placeName: placeNameOf(raw.placeName)
  };
}

/** Remark location: undefined = leave as is, null = remove, object = save. */
export function parseRemarkLocation(value: unknown): GeoPoint | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return parseGeoPoint(value, "Invalid location");
}

/** Payment proof: a photo or file with the location it was recorded at. */
export function parsePaymentProof(value: unknown): PaymentProofPayload | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") throw invalid("Invalid payment proof");
  const raw = value as Record<string, unknown>;
  const kind = raw.kind === "photo" ? "photo" : raw.kind === "attachment" ? "attachment" : null;
  if (!kind) throw invalid("Payment proof must be a photo or an attachment");
  const data = String(raw.data ?? "").replace(/^data:[^;]+;base64,/, "");
  if (!data) throw invalid("Payment proof file is empty");
  // Size is known from the base64 length before decoding anything.
  if (Math.floor(data.length * 3 / 4) > MAX_PROOF_BYTES + 3) throw invalid("Payment proof must be 5 MB or smaller");
  const buffer = Buffer.from(data, "base64");
  if (buffer.length === 0) throw invalid("Payment proof file is empty");
  if (buffer.length > MAX_PROOF_BYTES) throw invalid("Payment proof must be 5 MB or smaller");
  // The file's own bytes decide its type, not the type the browser claims.
  const detected = detectFileType(buffer);
  if (kind === "photo" && !detected?.startsWith("image/")) throw invalid("The payment photo must be an image");
  const type = kind === "photo" ? detected! : storedAttachmentType(buffer);
  // Location is optional: none at all is fine, but a half or impossible location is refused.
  const hasLocation = [raw.latitude, raw.longitude].some(value => value !== null && value !== undefined && value !== "");
  const point = hasLocation
    ? parseGeoPoint(raw, "Invalid payment proof location")
    : { latitude: null, longitude: null, accuracy: null, placeName: null };
  const capturedAt = toBusinessDateTime(typeof raw.capturedAt === "string" ? raw.capturedAt : undefined);
  if (!capturedAt) throw invalid("Invalid payment proof time");
  const name = String(raw.name ?? "").trim().slice(0, 255) || (kind === "photo" ? "payment-photo.jpg" : "payment-proof");
  return { kind, name, type, data, capturedAt, ...point };
}

export async function ensureFieldEvidenceTables() {
  await query(`CREATE TABLE IF NOT EXISTS payment_proofs (
    payment_id INT UNSIGNED NOT NULL,
    kind VARCHAR(16) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    file_data LONGBLOB NOT NULL,
    latitude DECIMAL(9,6) NULL,
    longitude DECIMAL(9,6) NULL,
    accuracy_m INT UNSIGNED NULL,
    place_name VARCHAR(160) NULL,
    captured_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (payment_id)
  ) ENGINE=InnoDB`);
}

export async function savePaymentProof(client: QueryClient, paymentId: number, proof: PaymentProofPayload) {
  await client.query(
    `INSERT INTO payment_proofs (payment_id, kind, file_name, mime_type, file_data, latitude, longitude, accuracy_m, place_name, captured_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON DUPLICATE KEY UPDATE kind = VALUES(kind), file_name = VALUES(file_name), mime_type = VALUES(mime_type),
       file_data = VALUES(file_data), latitude = VALUES(latitude), longitude = VALUES(longitude),
       accuracy_m = VALUES(accuracy_m), place_name = VALUES(place_name), captured_at = VALUES(captured_at), created_at = CURRENT_TIMESTAMP`,
    [paymentId, proof.kind, proof.name, proof.type, Buffer.from(proof.data, "base64"), proof.latitude, proof.longitude, proof.accuracy, proof.placeName, proof.capturedAt]
  );
}

export async function getPaymentProof(paymentId: number) {
  const result = await query<{ kind: string; file_name: string; mime_type: string; file_data: Buffer }>(
    "SELECT kind, file_name, mime_type, file_data FROM payment_proofs WHERE payment_id = $1 LIMIT 1",
    [paymentId]
  );
  return result.rows[0] ?? null;
}

/** Columns to select (with `pp` joined) so payment lists can show the proof and its location. */
export const PROOF_COLUMNS = `pp.kind AS proof_kind, pp.file_name AS proof_name, pp.latitude AS proof_latitude,
  pp.longitude AS proof_longitude, pp.accuracy_m AS proof_accuracy, pp.place_name AS proof_place, pp.captured_at AS proof_captured_at`;

export function mapProofColumns(row: Record<string, unknown>) {
  if (!row.proof_kind) return { proof: null };
  return {
    proof: {
      kind: String(row.proof_kind),
      fileName: String(row.proof_name ?? ""),
      latitude: row.proof_latitude == null ? null : Number(row.proof_latitude),
      longitude: row.proof_longitude == null ? null : Number(row.proof_longitude),
      accuracy: row.proof_accuracy == null ? null : Number(row.proof_accuracy),
      placeName: row.proof_place ? String(row.proof_place) : null,
      capturedAt: String(row.proof_captured_at ?? "")
    }
  };
}

/** Remark rows: `location` from the latitude/longitude/location_accuracy columns. */
export function mapRemarkLocation(row: Record<string, unknown>) {
  if (row.latitude == null || row.longitude == null) return { location: null };
  return {
    location: {
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      accuracy: row.location_accuracy == null ? null : Number(row.location_accuracy),
      placeName: row.place_name ? String(row.place_name) : null
    }
  };
}

export async function saveRemarkLocation(table: "loan_remarks" | "borrower_remarks", remarkId: number, location: GeoPoint | null | undefined) {
  if (location === undefined) return;
  await query(
    `UPDATE ${table} SET latitude = $1, longitude = $2, location_accuracy = $3, place_name = $4 WHERE id = $5`,
    [location?.latitude ?? null, location?.longitude ?? null, location?.accuracy ?? null, location?.placeName ?? null, remarkId]
  );
}
