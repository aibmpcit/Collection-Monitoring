import { query, type QueryClient } from "../config/db.js";
import { toBusinessDateTime } from "../config/time.js";
import type { RemarkKind } from "./remarkAttachments.js";

// A remark can carry one field photo (taken with the phone camera) in addition to its attachment.
// The phone's location at capture time is stored with it as the geotag.

export interface PhotoPayload {
  name: string;
  type: string;
  data: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  capturedAt: string;
}

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export async function ensureRemarkPhotoTable() {
  await query(`CREATE TABLE IF NOT EXISTS remark_photos (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    remark_kind VARCHAR(16) NOT NULL,
    remark_id INT UNSIGNED NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(40) NOT NULL,
    file_data LONGBLOB NOT NULL,
    latitude DECIMAL(9,6) NULL,
    longitude DECIMAL(9,6) NULL,
    accuracy_m INT UNSIGNED NULL,
    captured_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_remark_photo (remark_kind, remark_id)
  ) ENGINE=InnoDB`);
}

function invalid(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}

function coordinate(value: unknown, limit: number) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > limit) throw invalid("Invalid photo location");
  return Math.round(number * 1e6) / 1e6;
}

/** undefined = leave as is, null = remove the photo, object = save this photo. */
export function parsePhoto(value: unknown): PhotoPayload | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object") throw invalid("Invalid photo");
  const raw = value as Record<string, unknown>;
  const type = String(raw.type ?? "").trim().toLowerCase();
  if (!PHOTO_TYPES.has(type)) throw invalid("Photo must be a JPEG, PNG or WebP image");
  const data = String(raw.data ?? "").replace(/^data:[^;]+;base64,/, "");
  const bytes = Buffer.from(data, "base64").length;
  if (!data || bytes === 0) throw invalid("Invalid photo");
  if (bytes > MAX_PHOTO_BYTES) throw invalid("Photo must be 5 MB or smaller");
  const latitude = coordinate(raw.latitude, 90);
  const longitude = coordinate(raw.longitude, 180);
  if ((latitude === null) !== (longitude === null)) throw invalid("Invalid photo location");
  const accuracy = raw.accuracy === null || raw.accuracy === undefined || raw.accuracy === "" ? null : Math.max(0, Math.round(Number(raw.accuracy)));
  if (accuracy !== null && !Number.isFinite(accuracy)) throw invalid("Invalid photo location");
  const capturedAt = toBusinessDateTime(typeof raw.capturedAt === "string" ? raw.capturedAt : undefined);
  if (!capturedAt) throw invalid("Invalid photo time");
  const name = String(raw.name ?? "").trim().slice(0, 255) || "photo.jpg";
  return { name, type, data, latitude, longitude, accuracy, capturedAt };
}

export async function saveRemarkPhoto(kind: RemarkKind, remarkId: number, photo: PhotoPayload | null | undefined) {
  if (photo === undefined) return;
  if (photo === null) {
    await query("DELETE FROM remark_photos WHERE remark_kind = $1 AND remark_id = $2", [kind, remarkId]);
    return;
  }
  await query(
    `INSERT INTO remark_photos (remark_kind, remark_id, file_name, mime_type, file_data, latitude, longitude, accuracy_m, captured_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), mime_type = VALUES(mime_type), file_data = VALUES(file_data),
       latitude = VALUES(latitude), longitude = VALUES(longitude), accuracy_m = VALUES(accuracy_m),
       captured_at = VALUES(captured_at), created_at = CURRENT_TIMESTAMP`,
    [kind, remarkId, photo.name, photo.type, Buffer.from(photo.data, "base64"), photo.latitude, photo.longitude, photo.accuracy, photo.capturedAt]
  );
}

export async function deleteRemarkPhoto(client: QueryClient, kind: RemarkKind, remarkId: number) {
  await client.query("DELETE FROM remark_photos WHERE remark_kind = $1 AND remark_id = $2", [kind, remarkId]);
}

export async function getRemarkPhoto(kind: RemarkKind, remarkId: number) {
  const result = await query<{ file_name: string; mime_type: string; file_data: Buffer }>(
    "SELECT file_name, mime_type, file_data FROM remark_photos WHERE remark_kind = $1 AND remark_id = $2 LIMIT 1",
    [kind, remarkId]
  );
  return result.rows[0] ?? null;
}

/** Columns to select (with `rp` joined) so remark lists can show the photo and its location. */
export const PHOTO_COLUMNS = `rp.id AS photo_id, rp.latitude AS photo_latitude, rp.longitude AS photo_longitude,
  rp.accuracy_m AS photo_accuracy, rp.captured_at AS photo_captured_at`;

export function mapPhotoColumns(row: Record<string, unknown>) {
  if (!row.photo_id) return { photo: null };
  return {
    photo: {
      latitude: row.photo_latitude == null ? null : Number(row.photo_latitude),
      longitude: row.photo_longitude == null ? null : Number(row.photo_longitude),
      accuracy: row.photo_accuracy == null ? null : Number(row.photo_accuracy),
      capturedAt: String(row.photo_captured_at ?? "")
    }
  };
}
