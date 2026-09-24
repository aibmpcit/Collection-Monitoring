import { query } from "../config/db.js";

export type RemarkKind = "loan" | "member";

export interface AttachmentPayload {
  name: string;
  type: string;
  data: string;
}

export async function ensureRemarkAttachmentTable() {
  await query(`CREATE TABLE IF NOT EXISTS remark_attachments (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    remark_kind VARCHAR(16) NOT NULL,
    remark_id INT UNSIGNED NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    file_data LONGBLOB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_remark_attachment (remark_kind, remark_id)
  ) ENGINE=InnoDB`);
}

export function parseAttachment(value: unknown): AttachmentPayload | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!value || typeof value !== "object") throw Object.assign(new Error("Invalid attachment"), { status: 400 });
  const raw = value as Record<string, unknown>;
  const name = String(raw.name ?? "").trim().slice(0, 255);
  const type = String(raw.type ?? "application/octet-stream").trim().slice(0, 120) || "application/octet-stream";
  const data = String(raw.data ?? "").replace(/^data:[^;]+;base64,/, "");
  if (!name || !data) throw Object.assign(new Error("Invalid attachment"), { status: 400 });
  const buffer = Buffer.from(data, "base64");
  if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
    throw Object.assign(new Error("Attachment must be 5 MB or smaller"), { status: 400 });
  }
  return { name, type, data };
}

export async function saveRemarkAttachment(kind: RemarkKind, remarkId: number, attachment: AttachmentPayload | null | undefined) {
  if (attachment === undefined) return;
  if (attachment === null) {
    await query("DELETE FROM remark_attachments WHERE remark_kind = $1 AND remark_id = $2", [kind, remarkId]);
    return;
  }
  await query(
    `INSERT INTO remark_attachments (remark_kind, remark_id, file_name, mime_type, file_data)
     VALUES ($1, $2, $3, $4, $5)
     ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), mime_type = VALUES(mime_type), file_data = VALUES(file_data), created_at = CURRENT_TIMESTAMP`,
    [kind, remarkId, attachment.name, attachment.type, Buffer.from(attachment.data, "base64")]
  );
}

export async function getRemarkAttachment(kind: RemarkKind, remarkId: number) {
  const result = await query<{ file_name: string; mime_type: string; file_data: Buffer }>(
    "SELECT file_name, mime_type, file_data FROM remark_attachments WHERE remark_kind = $1 AND remark_id = $2 LIMIT 1",
    [kind, remarkId]
  );
  return result.rows[0] ?? null;
}
