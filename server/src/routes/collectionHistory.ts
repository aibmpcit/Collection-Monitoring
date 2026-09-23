import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { authenticate, type AuthedRequest } from "../middleware/auth.js";
import { getRequestUser, isSuperAdmin, userBranchId } from "../services/access.js";

const router = Router();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});
const filters = z.object({
  from: date.optional(), to: date.optional(),
  collectorId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(120).optional(),
  type: z.enum(["payments", "remarks"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1)
}).refine(value => !value.from || !value.to || value.from <= value.to);

// Keep actor IDs and resource branches on every activity, including member-only notes.
const activitySql = `
  SELECT c.id, 'payment' AS kind, c.created_by AS collector_id, c.collected_at AS occurred_at,
    c.amount, c.or_no, NULL AS remark, NULL AS category, l.id AS loan_id,
    l.loan_account_no, b.id AS member_id, COALESCE(b.member_name, b.name) AS member_name,
    b.cif_key, b.branch_id
  FROM collections c JOIN loans l ON l.id = c.loan_id JOIN borrowers b ON b.id = l.borrower_id
  UNION ALL
  SELECT r.id, 'loan_remark', r.created_by, r.created_at, 0, NULL, r.remark_text,
    r.remark_category, l.id, l.loan_account_no, b.id, COALESCE(b.member_name, b.name), b.cif_key, b.branch_id
  FROM loan_remarks r JOIN loans l ON l.id = r.loan_id JOIN borrowers b ON b.id = l.borrower_id
  UNION ALL
  SELECT r.id, 'member_remark', r.created_by, r.created_at, 0, NULL, r.remark_text,
    r.remark_category, NULL, NULL, b.id, COALESCE(b.member_name, b.name), b.cif_key, b.branch_id
  FROM borrower_remarks r JOIN borrowers b ON b.id = r.borrower_id`;

router.get("/", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const parsed = filters.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid history filters or date range" });
    const filter = parsed.data;
    if (user.role === "staff" && filter.collectorId && filter.collectorId !== user.id) {
      return res.status(403).json({ message: "You can only view your own history" });
    }
    const params: unknown[] = [];
    const conditions: string[] = [];
    const add = (expression: string, value: unknown) => {
      params.push(value);
      conditions.push(expression.replace("?", `$${params.length}`));
    };
    if (!isSuperAdmin(user)) add("a.branch_id = ?", userBranchId(user));
    if (user.role === "staff" || filter.collectorId) add("a.collector_id = ?", user.role === "staff" ? user.id : filter.collectorId);
    if (user.role === "branch_admin") {
      conditions.push("u.role = 'staff'");
      add("u.branch_id = ?", userBranchId(user));
    }
    if (filter.from) add("a.occurred_at >= ?", filter.from);
    if (filter.to) add("a.occurred_at < DATE_ADD(?, INTERVAL 1 DAY)", filter.to);
    if (filter.search) add("LOCATE(?, CONCAT_WS(' ', a.member_name, a.cif_key, a.loan_account_no, a.or_no, a.remark, u.username, br.name)) > 0", filter.search);
    const source = `FROM (${activitySql}) a LEFT JOIN users u ON u.id = a.collector_id
      LEFT JOIN branches br ON br.id = a.branch_id ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}`;
    const summary = await query<{ total: number; amount: number; payments: number; members: number }>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(a.amount), 0) AS amount,
       COALESCE(SUM(a.kind = 'payment'), 0) AS payments, COUNT(DISTINCT a.member_id) AS members ${source}`, params);
    const counts = summary.rows[0];
    const total = filter.type === "payments" ? Number(counts.payments)
      : filter.type === "remarks" ? Number(counts.total) - Number(counts.payments) : Number(counts.total);
    const typeCondition = filter.type === "payments" ? "a.kind = 'payment'"
      : filter.type === "remarks" ? "a.kind IN ('loan_remark', 'member_remark')" : "";
    const rowSource = source + (typeCondition ? ` ${conditions.length ? "AND" : "WHERE"} ${typeCondition}` : "");
    const page = Math.min(filter.page, Math.max(1, Math.ceil(total / 20)));
    const rows = await query(`SELECT a.*, u.username AS collector_name, br.name AS branch_name ${rowSource}
      ORDER BY a.occurred_at DESC, a.kind, a.id DESC LIMIT 20 OFFSET ${(page - 1) * 20}`, params);
    return res.json({ items: rows.rows, summary: summary.rows[0], total, page, pageSize: 20 });
  } catch (error) { return next(error); }
});

export { router as collectionHistoryRouter };
