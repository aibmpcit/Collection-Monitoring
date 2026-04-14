import { Router } from "express";
import { query } from "../config/db.js";
import { authenticate, authorize, type AuthedRequest } from "../middleware/auth.js";
import { assertBranchAccess, formatPaymentId, getRequestUser, isSuperAdmin, toNumber, userBranchId } from "../services/access.js";

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

router.get("/", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const params: unknown[] = [];
    const where = isSuperAdmin(user) ? "" : "WHERE b.branch_id = $1";
    if (!isSuperAdmin(user)) {
      params.push(userBranchId(user));
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
    }>(
      `SELECT
         c.id,
         c.loan_id,
         b.branch_id,
         c.amount,
         c.or_no,
         c.collected_at,
         u.username AS collected_by,
         l.loan_account_no,
         b.cif_key,
         b.member_name
       FROM collections c
       INNER JOIN loans l ON l.id = c.loan_id
       INNER JOIN borrowers b ON b.id = l.borrower_id
       LEFT JOIN users u ON u.id = c.created_by
       ${where}
       ORDER BY c.collected_at DESC, c.id DESC`,
      params
    );

    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        paymentId: formatPaymentId(row.id),
        loanId: row.loan_id,
        branchId: Number(row.branch_id ?? 0),
        loanAccountNo: row.loan_account_no,
        cifKey: row.cif_key ?? "",
        memberName: row.member_name ?? "",
        amount: toNumber(row.amount),
        orNo: row.or_no ?? "",
        collectedBy: row.collected_by ?? "System",
        collectedAt: row.collected_at
      }))
    );
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
        skipped.push({ id: paymentId, reason: "forbidden" });
        continue;
      }

      try {
        await query("DELETE FROM collections WHERE id = $1", [paymentId]);
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
    assertBranchAccess(user, Number(branchId));

    await query("DELETE FROM collections WHERE id = $1", [paymentId]);
    return res.json({ message: "Payment deleted" });
  } catch (error) {
    return next(error);
  }
});

export { router as paymentRouter };
