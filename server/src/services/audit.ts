import type { NextFunction, Request, Response } from "express";
import { query } from "../config/db.js";
import type { JwtUser } from "../types/models.js";

// Audit trail: who changed what, and when. Every successful change through the API is recorded,
// plus security events such as sign-in lockouts. Only safe fields are kept: no passwords, file
// contents, notes or full request bodies.

export async function ensureAuditTable() {
  await query(`CREATE TABLE IF NOT EXISTS audit_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_id INT UNSIGNED NULL,
    actor_username VARCHAR(120) NULL,
    actor_role VARCHAR(32) NULL,
    action VARCHAR(160) NOT NULL,
    target_ids VARCHAR(255) NULL,
    details TEXT NULL,
    ip VARCHAR(64) NULL,
    PRIMARY KEY (id),
    KEY idx_audit_log_time (occurred_at),
    KEY idx_audit_log_actor (actor_id, occurred_at)
  ) ENGINE=InnoDB`);
}

export interface AuditEntry {
  actor?: Pick<JwtUser, "id" | "username" | "role"> | null;
  action: string;
  targetIds?: number[];
  details?: Record<string, unknown>;
  ip?: string | null;
}

/** Records an audit entry; never fails the request it describes. */
export async function recordAudit(entry: AuditEntry) {
  try {
    await query(
      "INSERT INTO audit_log (actor_id, actor_username, actor_role, action, target_ids, details, ip) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [entry.actor?.id ?? null, entry.actor?.username ?? null, entry.actor?.role ?? null, entry.action.slice(0, 160),
        entry.targetIds?.length ? entry.targetIds.join(",").slice(0, 255) : null,
        entry.details && Object.keys(entry.details).length ? JSON.stringify(entry.details).slice(0, 4000) : null,
        entry.ip?.slice(0, 64) ?? null]
    );
  } catch (error) {
    console.error("Unable to record audit entry", entry.action, error instanceof Error ? error.message : error);
  }
}

// Request fields worth keeping. Everything else (passwords, files, notes, member details) is left out.
const SAFE_FIELDS = ["role", "branchId", "permissions", "username", "code", "name", "closeMissing", "fileName",
  "rowsInFile", "paymentStatus", "amount", "status"];
// Writes that aren't changes worth auditing.
const SKIPPED = [/^\/api\/auth\//, /^\/api\/activity\//, /^\/api\/collections\/\d+\/draft$/, /\/remarked\/remark-ids$/];

function summarize(body: unknown) {
  if (!body || typeof body !== "object") return {};
  const raw = body as Record<string, unknown>;
  const details: Record<string, unknown> = {};
  for (const field of SAFE_FIELDS) if (raw[field] !== undefined) details[field] = raw[field];
  for (const field of ["ids", "loanIds"]) {
    const list = raw[field];
    if (Array.isArray(list)) details[field] = { count: list.length, first: list.slice(0, 20) };
  }
  if (Array.isArray(raw.rows)) details.rows = raw.rows.length;
  return details;
}

export function clientIp(req: Request) {
  return req.app.get("trust proxy") ? req.ip : req.socket.remoteAddress;
}

/** Records every successful change (POST/PATCH/PUT/DELETE) made by a signed-in user. */
export function auditChanges(req: Request & { user?: JwtUser }, res: Response, next: NextFunction) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
  const path = req.originalUrl.split("?")[0];
  if (SKIPPED.some(pattern => pattern.test(path))) return next();
  // A preview import changes nothing.
  if ((req.body as { preview?: unknown } | undefined)?.preview === true) return next();
  res.on("finish", () => {
    if (res.statusCode >= 400 || !req.user) return;
    void recordAudit({
      actor: req.user,
      action: `${req.method} ${path.replace(/\/\d+(?=\/|$)/g, "/:id")}`,
      targetIds: (path.match(/\/(\d+)(?=\/|$)/g) ?? []).map(part => Number(part.slice(1))),
      details: summarize(req.body),
      ip: clientIp(req)
    });
  });
  return next();
}
