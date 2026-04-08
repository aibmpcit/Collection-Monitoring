import { Router } from "express";
import { query } from "../config/db.js";
import { authenticate, type AuthedRequest } from "../middleware/auth.js";
import { assertBranchAccess, getRequestUser, toNumber } from "../services/access.js";

const router = Router();

router.post("/:loanId/draft", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const loanId = Number(req.params.loanId);
    if (!Number.isInteger(loanId) || loanId <= 0) {
      return res.status(400).json({ message: "Invalid loan id" });
    }

    const result = await query<{
      branch_id: number | null;
      member_name: string | null;
      name: string | null;
      maturity_date: string | null;
      due_date: string | null;
      principal_due: string | number | null;
      principal: string | number | null;
      interest: string | number | null;
      penalty_due: string | number | null;
      penalty: string | number | null;
      other_charges: string | number | null;
    }>(
      `SELECT
         b.branch_id,
         b.member_name,
         b.name,
         l.maturity_date,
         l.due_date,
         l.principal_due,
         l.principal,
         l.interest,
         l.penalty_due,
         l.penalty,
         l.other_charges
       FROM loans l
       INNER JOIN borrowers b ON b.id = l.borrower_id
       WHERE l.id = $1
       LIMIT 1`,
      [loanId]
    );

    const loan = result.rows[0];
    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }
    assertBranchAccess(user, Number(loan.branch_id ?? 0));

    const total =
      toNumber(loan.principal_due ?? loan.principal ?? 0) +
      toNumber(loan.interest ?? 0) +
      toNumber(loan.penalty_due ?? loan.penalty ?? 0) +
      toNumber(loan.other_charges ?? 0);
    const memberName = loan.member_name || loan.name || "Member";
    const maturityDate = loan.maturity_date || loan.due_date || "";
    const draft = `Hello ${memberName}, this is a reminder that your due amount of $${total.toFixed(2)} was scheduled on ${maturityDate}. Please contact us for payment assistance.`;

    return res.json({ draft });
  } catch (error) {
    return next(error);
  }
});

export { router as collectionRouter };
