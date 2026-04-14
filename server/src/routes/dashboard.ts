import { Router } from "express";
import { query } from "../config/db.js";
import { authenticate, type AuthedRequest } from "../middleware/auth.js";
import { getRequestUser, isSuperAdmin, toNumber, userBranchId } from "../services/access.js";

const router = Router();

router.get("/metrics", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const params: unknown[] = [];
    const branchFilter = isSuperAdmin(user) ? "" : "AND b.branch_id = $1";
    if (!isSuperAdmin(user)) {
      params.push(userBranchId(user));
    }

    const loans = await query<{ total_portfolio: string | number; total_overdue: string | number }>(
      `SELECT
         COALESCE(SUM(COALESCE(l.principal_due, l.principal) + l.interest + COALESCE(l.penalty_due, l.penalty) + COALESCE(l.other_charges, 0)), 0) AS total_portfolio,
         COALESCE(SUM(
           CASE WHEN l.status = 'overdue'
             THEN COALESCE(l.principal_due, l.principal) + l.interest + COALESCE(l.penalty_due, l.penalty) + COALESCE(l.other_charges, 0)
             ELSE 0
           END
         ), 0) AS total_overdue
       FROM loans l
       INNER JOIN borrowers b ON b.id = l.borrower_id
       WHERE l.status != 'closed' ${branchFilter}`,
      params
    );

    const collections = await query<{ total: string | number }>(
      `SELECT COALESCE(SUM(c.amount), 0) AS total
       FROM collections c
       INNER JOIN loans l ON l.id = c.loan_id
       INNER JOIN borrowers b ON b.id = l.borrower_id
       WHERE DATE(c.collected_at) = CURRENT_DATE
         AND l.status != 'closed'
         ${branchFilter}`,
      params
    );

    return res.json({
      totalPortfolio: toNumber(loans.rows[0]?.total_portfolio ?? 0),
      totalOverdue: toNumber(loans.rows[0]?.total_overdue ?? 0),
      collectionsToday: toNumber(collections.rows[0]?.total ?? 0)
    });
  } catch (error) {
    return next(error);
  }
});

export { router as dashboardRouter };
