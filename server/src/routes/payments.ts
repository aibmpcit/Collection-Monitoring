import { addDateRange, dayParam, periodCondition, periodSchema } from "../services/listPeriods.js";
import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { authenticate, authorize, type AuthedRequest } from "../middleware/auth.js";
import { assertBranchAccess, formatPaymentId, getRequestUser, isSuperAdmin, toNumber, userBranchId } from "../services/access.js";
import { refreshLoanActionStatus } from "../services/loanActionStatus.js";

async function paymentLoanId(paymentId: number) {
  const result = await query<{ loan_id: number }>("SELECT loan_id FROM collections WHERE id = $1 LIMIT 1", [paymentId]);
  return result.rows[0]?.loan_id ?? null;
}

const router = Router();

async function paymentBranchId(paymentId: number) {
  const result = await query<{ branch_id: number | null }>(
    `SELECT b.branch_id
     FROM collections c
     INNER JOIN loans l ON l.id = c.loan_id
     INNER JOIN borrowers b ON b.id = l.borrower_id
     WHERE c.id = $1
     LIMIT 1`,
    [paymentId]
  );
  return result.rows[0]?.branch_id ?? null;
}

const paymentListFilters = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(120).optional(),
  branchId: z.coerce.number().int().positive().optional(),
  borrowerId: z.coerce.number().int().positive().optional(),
  sort: z.enum(["member", "recent"]).default("member"),
  paymentStatus: z.enum(["partial", "settled"]).optional(),
  period: periodSchema.optional(),
  dateFrom: dayParam,
  dateTo: dayParam,
  openLoansOnly: z.literal("true").optional(),
  idsOnly: z.literal("true").optional()
});

/**
 * Lists payments visible to the user (collectors see only their own).
 * - With `page`: one page of matches plus the total.
 * - With `idsOnly=true`: every matching id, for "select all matching" actions.
 * - Otherwise: every match (used for a single member's history).
 */
router.get("/", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const parsed = paymentListFilters.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payment filters" });
    const filter = parsed.data;

    const params: unknown[] = [];
    const conditions: string[] = [];
    const add = (expression: string, value: unknown) => {
      params.push(value);
      conditions.push(expression.replace("?", `$${params.length}`));
    };
    if (!isSuperAdmin(user)) add("b.branch_id = ?", userBranchId(user));
    if (isSuperAdmin(user) && filter.branchId) add("b.branch_id = ?", filter.branchId);
    if (user.role === "staff") add("c.created_by = ?", user.id);
    if (filter.borrowerId) add("l.borrower_id = ?", filter.borrowerId);
    if (filter.openLoansOnly === "true") conditions.push("l.status != 'closed'");
    if (filter.paymentStatus) add("c.payment_status = ?", filter.paymentStatus);
    if (filter.period) conditions.push(periodCondition("c.collected_at", filter.period));
    addDateRange(add, "c.collected_at", filter.dateFrom, filter.dateTo);
    if (filter.search) {
      add(`LOCATE(?, CONCAT_WS(' ', CONCAT('PAY-', LPAD(c.id, 6, '0')), c.or_no, u.username, l.loan_account_no,
        b.cif_key, b.member_name, c.amount, c.collected_at)) > 0`, filter.search);
    }
    const source = `FROM collections c
       INNER JOIN loans l ON l.id = c.loan_id
       INNER JOIN borrowers b ON b.id = l.borrower_id
       LEFT JOIN users u ON u.id = c.created_by
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}`;
    const order = filter.sort === "recent"
      ? "ORDER BY c.collected_at DESC, c.id DESC"
      : "ORDER BY COALESCE(b.member_name, ''), c.id";

    if (filter.idsOnly === "true") {
      const ids = await query<{ id: number }>(`SELECT c.id ${source} ${order}`, params);
      return res.json({ ids: ids.rows.map(row => Number(row.id)) });
    }

    const pageSize = filter.pageSize;
    let page = 1;
    let total = 0;
    let limit = "";
    if (filter.page !== undefined) {
      const counted = await query<{ total: number }>(`SELECT COUNT(*) AS total ${source}`, params);
      total = Number(counted.rows[0]?.total ?? 0);
      page = Math.min(filter.page, Math.max(1, Math.ceil(total / pageSize)));
      limit = `LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    }

    const result = await query<{
      id: number;
      loan_id: number;
      branch_id: number | null;
      amount: string | number;
      or_no: string | null;
      collected_at: string;
      collected_by: string | null;
      loan_account_no: string;
      cif_key: string | null;
      member_name: string | null;
      payment_status: string | null;
    }>(
      `SELECT
         c.id,
         c.loan_id,
         b.branch_id,
         c.amount,
         c.or_no,
         c.collected_at,
         c.payment_status,
         u.username AS collected_by,
         l.loan_account_no,
         b.cif_key,
         b.member_name
       ${source}
       ${order} ${limit}`,
      params
    );

    const items = result.rows.map((row) => ({
      id: row.id,
      paymentId: formatPaymentId(row.id),
      loanId: row.loan_id,
      branchId: Number(row.branch_id ?? 0),
      loanAccountNo: row.loan_account_no,
      cifKey: row.cif_key ?? "",
      memberName: row.member_name ?? "",
      amount: toNumber(row.amount),
      orNo: row.or_no ?? "",
      paymentStatus: row.payment_status,
      collectedBy: row.collected_by ?? "System",
      collectedAt: row.collected_at
    }));
    return res.json(filter.page !== undefined ? { items, total, page, pageSize } : items);
  } catch (error) {
    return next(error);
  }
});

router.delete("/bulk", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
      : [];
    if (ids.length === 0) {
      return res.status(400).json({ message: "No payment ids provided" });
    }

    let deleted = 0;
    const skipped: Array<{ id: number; reason: string }> = [];

    for (const paymentId of ids) {
      const branchId = await paymentBranchId(paymentId);
      if (branchId == null) {
        skipped.push({ id: paymentId, reason: "not_found" });
        continue;
      }
      try {
        assertBranchAccess(user, Number(branchId));
      } catch {
        skipped.push({ id: paymentId, reason: "not_found" }); // another branch's record counts as missing
        continue;
      }

      try {
        const loanId = await paymentLoanId(paymentId);
        await query("DELETE FROM payment_proofs WHERE payment_id = $1", [paymentId]);
        await query("DELETE FROM collections WHERE id = $1", [paymentId]);
        // The loan's status falls back to its previous payment's type.
        if (loanId) await refreshLoanActionStatus({ query }, loanId);
        deleted += 1;
      } catch {
        skipped.push({ id: paymentId, reason: "delete_failed" });
      }
    }

    return res.json({ deleted, skipped });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:paymentId", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const paymentId = Number(req.params.paymentId);
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      return res.status(400).json({ message: "Invalid payment id" });
    }

    const branchId = await paymentBranchId(paymentId);
    if (branchId == null) {
      return res.status(404).json({ message: "Payment not found" });
    }
    assertBranchAccess(user, Number(branchId), "Payment not found");

    const loanId = await paymentLoanId(paymentId);
    await query("DELETE FROM payment_proofs WHERE payment_id = $1", [paymentId]);
    await query("DELETE FROM collections WHERE id = $1", [paymentId]);
    if (loanId) await refreshLoanActionStatus({ query }, loanId);
    return res.json({ message: "Payment deleted" });
  } catch (error) {
    return next(error);
  }
});

export { router as paymentRouter };
