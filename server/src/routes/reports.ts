import { Router } from "express";
import { query } from "../config/db.js";
import { authenticate, type AuthedRequest } from "../middleware/auth.js";
import { getRequestUser, isSuperAdmin, toNumber, userBranchId } from "../services/access.js";

const router = Router();

router.get("/overdue", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const params: unknown[] = [];
    const branchFilter = isSuperAdmin(user) ? "" : "AND b.branch_id = $1";
    if (!isSuperAdmin(user)) {
      params.push(userBranchId(user));
    }

    const result = await query<{
      loan_id: number;
      borrower_id: number;
      member_name: string | null;
      name: string | null;
      contact_info: string | null;
      phone: string | null;
      email: string | null;
      principal_due: string | number | null;
      principal: string | number | null;
      interest: string | number | null;
      penalty_due: string | number | null;
      penalty: string | number | null;
      other_charges: string | number | null;
      maturity_date: string | null;
      due_date: string | null;
      days_overdue: string | number;
    }>(
      `SELECT
         l.id AS loan_id,
         b.id AS borrower_id,
         b.member_name,
         b.name,
         b.contact_info,
         b.phone,
         b.email,
         l.principal_due,
         l.principal,
         l.interest,
         l.penalty_due,
         l.penalty,
         l.other_charges,
         l.maturity_date,
         l.due_date,
         GREATEST(0, CURRENT_DATE - COALESCE(l.maturity_date, l.due_date)) AS days_overdue
       FROM loans l
       INNER JOIN borrowers b ON b.id = l.borrower_id
       WHERE l.status = 'overdue' ${branchFilter}
       ORDER BY COALESCE(l.maturity_date, l.due_date) ASC`,
      params
    );

    return res.json(
      result.rows.map((row) => {
        const principal = toNumber(row.principal_due ?? row.principal ?? 0);
        const interest = toNumber(row.interest ?? 0);
        const penalty = toNumber(row.penalty_due ?? row.penalty ?? 0);
        const otherCharges = toNumber(row.other_charges ?? 0);

        return {
          loanId: row.loan_id,
          borrowerId: row.borrower_id,
          name: row.member_name ?? row.name ?? "",
          phone: row.contact_info ?? row.phone ?? "",
          email: row.email ?? "",
          principal,
          interest,
          penalty,
          totalOutstanding: principal + interest + penalty + otherCharges,
          dueDate: row.maturity_date ?? row.due_date ?? "",
          daysOverdue: Number(row.days_overdue ?? 0)
        };
      })
    );
  } catch (error) {
    return next(error);
  }
});

export { router as reportsRouter };
