import { Router } from "express";
import { query } from "../config/db.js";
import { authenticate, authorize, type AuthedRequest } from "../middleware/auth.js";
import { calculateCollectionEfficiency, calculateOverdueRate } from "../services/calculations.js";
import { getRequestUser, isSuperAdmin, toNumber, userBranchId } from "../services/access.js";

const router = Router();

router.get("/overview", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const params: unknown[] = [];
    const branchFilter = isSuperAdmin(user) ? "" : "AND b.branch_id = $1";
    if (!isSuperAdmin(user)) {
      params.push(userBranchId(user));
    }

    const [activeResult, overdueResult, todayCollectedResult, todayDueResult] = await Promise.all([
      query<{ value: string | number }>(
        `SELECT COUNT(*)::text AS value
         FROM loans l
         INNER JOIN borrowers b ON b.id = l.borrower_id
         WHERE l.status != 'closed' ${branchFilter}`,
        params
      ),
      query<{ value: string | number }>(
        `SELECT COUNT(*)::text AS value
         FROM loans l
         INNER JOIN borrowers b ON b.id = l.borrower_id
         WHERE l.status = 'overdue' ${branchFilter}`,
        params
      ),
      query<{ value: string | number }>(
        `SELECT COALESCE(SUM(c.amount), 0) AS value
         FROM collections c
         INNER JOIN loans l ON l.id = c.loan_id
         INNER JOIN borrowers b ON b.id = l.borrower_id
         WHERE DATE(c.collected_at) = CURRENT_DATE
           AND l.status != 'closed'
           ${branchFilter}`,
        params
      ),
      query<{ value: string | number }>(
        `SELECT COALESCE(SUM(COALESCE(l.principal_due, l.principal) + l.interest + COALESCE(l.penalty_due, l.penalty) + COALESCE(l.other_charges, 0)), 0) AS value
         FROM loans l
         INNER JOIN borrowers b ON b.id = l.borrower_id
         WHERE DATE(COALESCE(l.maturity_date, l.due_date)) = CURRENT_DATE
           AND l.status != 'closed'
           ${branchFilter}`,
        params
      )
    ]);

    const activeLoans = toNumber(activeResult.rows[0]?.value ?? 0);
    const overdueLoans = toNumber(overdueResult.rows[0]?.value ?? 0);
    const todayCollected = toNumber(todayCollectedResult.rows[0]?.value ?? 0);
    const todayDue = toNumber(todayDueResult.rows[0]?.value ?? 0);

    return res.json({
      overdueRate: calculateOverdueRate(overdueLoans, activeLoans),
      collectionEfficiency: calculateCollectionEfficiency(todayCollected, todayDue),
      activeLoans
    });
  } catch (error) {
    return next(error);
  }
});

export { router as analyticsRouter };
