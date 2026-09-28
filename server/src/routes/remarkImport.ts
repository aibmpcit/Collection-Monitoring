import { Router } from "express";
import { z } from "zod";
import { withTransaction } from "../config/db.js";
import { authenticate, authorize, type AuthedRequest } from "../middleware/auth.js";
import { getRequestUser, IMPORT_REMARK_CATEGORIES } from "../services/access.js";


export const remarkImportRouter = Router();
const schema = z.object({
  branchId: z.number().int().positive(),
  rows: z.array(z.object({
    row: z.number().int().positive(),
    loanAccountNo: z.string().trim().min(1),
    remarks: z.array(z.object({
      category: z.string().refine(value => IMPORT_REMARK_CATEGORIES.has(value)),
      description: z.string().trim().min(1).max(2000)
    })).min(1).max(16)
  })).min(1).max(10000)
});
remarkImportRouter.post("/remarks/import", authenticate, authorize(["super_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid import: choose a branch and provide account numbers, valid categories, and descriptions of 1-2000 characters." });
    const user = getRequestUser(req);
    const result = await withTransaction(async client => {
      let imported = 0;
      let remarksImported = 0;
      const skipped: Array<{ row: number; reason: string }> = [];
      // Consistent account ordering avoids concurrent imports locking loans in opposite order.
      const rows = [...parsed.data.rows].sort((a, b) => a.loanAccountNo.localeCompare(b.loanAccountNo));
      for (const row of rows) {
        const matches = await client.query<{ id: number }>(
          `SELECT l.id FROM loans l JOIN borrowers b ON b.id = l.borrower_id
           WHERE l.loan_account_no = $1 AND b.branch_id = $2 FOR UPDATE`,
          [row.loanAccountNo, parsed.data.branchId]
        );
        if (matches.rows.length !== 1) {
          let reason = "Ambiguous loan account";
          if (!matches.rows.length) {
            const elsewhere = await client.query<{ code: string; name: string }>(
              "SELECT DISTINCT br.code, br.name FROM loans l JOIN borrowers b ON b.id = l.borrower_id JOIN branches br ON br.id = b.branch_id WHERE l.loan_account_no = $1",
              [row.loanAccountNo]
            );
            reason = elsewhere.rows.length
              ? "Account belongs to " + elsewhere.rows.map(branch => branch.code + " - " + branch.name).join(", ") + "; select the matching branch"
              : "Loan not found; import this account through Collection Import first and check its import results";
          }
          skipped.push({ row: row.row, reason: row.loanAccountNo + ": " + reason });
          continue;
        }
        const loanId = matches.rows[0].id;
        for (const remark of row.remarks) {
          await client.query("INSERT INTO loan_remarks (loan_id, remark_text, remark_category, created_by) VALUES ($1, $2, $3, $4)", [loanId, remark.description, remark.category, user.id]);
          remarksImported++;
        }
        imported++;
      }
      return { imported, remarksImported, skipped };
    });
    return res.json(result);
  } catch (error) { next(error); }
});
