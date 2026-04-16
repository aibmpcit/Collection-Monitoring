import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { authenticate, authorize, type AuthedRequest } from "../middleware/auth.js";
import {
  assertBranchAccess,
  getRequestUser,
  isSuperAdmin,
  normalizeRemarkCategory,
  userBranchId
} from "../services/access.js";

const router = Router();

const borrowerSchema = z.object({
  cifKey: z.string().trim().min(2),
  memberName: z.string().trim().min(2),
  contactInfo: z.string().trim().min(7),
  address: z.string().trim().min(5),
  branchId: z.coerce.number().int().positive().optional()
});

const borrowerImportSchema = z.object({
  cifKey: z.string().trim().min(2),
  memberName: z.string().trim().min(2),
  contactInfo: z.string().trim().default(""),
  address: z.string().trim().min(1).default("NA"),
  branchId: z.coerce.number().int().positive().optional()
});

type BorrowerImportPayload = z.infer<typeof borrowerImportSchema>;

type NormalizedBorrowerImportRow = {
  cifKey: string;
  branchId: number;
  memberName: string;
  contactInfo: string;
  address: string;
  email: string;
};

function borrowerEmail(cifKey: string): string {
  return `na+${cifKey.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}@example.com`;
}

async function borrowerBranchId(borrowerId: number): Promise<number | null> {
  const result = await query<{ branch_id: number | null }>("SELECT branch_id FROM borrowers WHERE id = $1 LIMIT 1", [borrowerId]);
  if (result.rowCount === 0) return null;
  return result.rows[0].branch_id;
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
      cif_key: string | null;
      branch_id: number | null;
      branch_name: string | null;
      member_name: string | null;
      contact_info: string | null;
      address: string | null;
      name: string | null;
      phone: string | null;
      email: string | null;
      loan_id: number | null;
      borrower_id: number | null;
      loan_account_no: string | null;
      loan_type: string | null;
      date_release: string | null;
      maturity_date: string | null;
      loan_amount: string | number | null;
      principal_due: string | number | null;
      penalty_due: string | number | null;
      other_charges: string | number | null;
      par_age: number | null;
      notes: string | null;
      principal: string | number | null;
      interest: string | number | null;
      penalty: string | number | null;
      due_date: string | null;
      status: "active" | "closed" | "overdue" | null;
    }>(
      `SELECT
         b.id,
         b.cif_key,
         b.branch_id,
         br.name AS branch_name,
         b.member_name,
         b.contact_info,
         b.address,
         b.name,
         b.phone,
         b.email,
         latest.loan_id,
         latest.borrower_id,
         latest.loan_account_no,
         latest.loan_type,
         latest.date_release,
         latest.maturity_date,
         latest.loan_amount,
         latest.principal_due,
         latest.penalty_due,
         latest.other_charges,
         latest.par_age,
         latest.notes,
         latest.principal,
         latest.interest,
         latest.penalty,
         latest.due_date,
         latest.status
       FROM borrowers b
       LEFT JOIN branches br ON br.id = b.branch_id
       LEFT JOIN LATERAL (
         SELECT
           l.id AS loan_id,
           l.borrower_id,
           l.loan_account_no,
           l.loan_type,
           l.date_release,
           l.maturity_date,
           l.loan_amount,
           l.principal_due,
           l.penalty_due,
           l.other_charges,
           l.par_age,
           l.notes,
           l.principal,
           l.interest,
           l.penalty,
           l.due_date,
           l.status
         FROM loans l
         WHERE l.borrower_id = b.id
         ORDER BY l.id DESC
         LIMIT 1
       ) latest ON TRUE
       ${where}
       ORDER BY COALESCE(b.member_name, b.name) ASC`
      ,
      params
    );

    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        cifKey: row.cif_key ?? "",
        branchId: row.branch_id,
        branchName: row.branch_name ?? "",
        memberName: row.member_name ?? row.name ?? "",
        contactInfo: row.contact_info ?? row.phone ?? "",
        address: row.address ?? "",
        name: row.name ?? row.member_name ?? "",
        phone: row.phone ?? row.contact_info ?? "",
        email: row.email ?? "",
        latestLoan: row.loan_id
          ? {
              id: row.loan_id,
              borrowerId: row.borrower_id!,
              loanAccountNo: row.loan_account_no ?? "",
              loanType: row.loan_type ?? "",
              dateRelease: row.date_release ?? row.due_date ?? "",
              maturityDate: row.maturity_date ?? row.due_date ?? "",
              loanAmount: Number(row.loan_amount ?? row.principal ?? 0),
              principalDue: Number(row.principal_due ?? row.principal ?? 0),
              penaltyDue: Number(row.penalty_due ?? row.penalty ?? 0),
              otherCharges: Number(row.other_charges ?? 0),
              parAge: row.par_age ?? 0,
              notes: row.notes ?? "",
              principal: Number(row.principal_due ?? row.principal ?? 0),
              interest: Number(row.interest ?? 0),
              penalty: Number(row.penalty_due ?? row.penalty ?? 0),
              dueDate: row.due_date ?? "",
              status: row.status ?? "active"
            }
          : undefined
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const parsed = borrowerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid borrower payload" });
    }

    const branchId = isSuperAdmin(user) ? Number(parsed.data.branchId ?? 0) : userBranchId(user);
    if (branchId <= 0) {
      return res.status(400).json({ message: "Invalid borrower payload" });
    }

    const inserted = await query<{ id: number }>(
      `INSERT INTO borrowers (cif_key, branch_id, member_name, contact_info, address, name, phone, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        parsed.data.cifKey.trim(),
        branchId,
        parsed.data.memberName.trim(),
        parsed.data.contactInfo.trim(),
        parsed.data.address.trim(),
        parsed.data.memberName.trim(),
        parsed.data.contactInfo.trim(),
        borrowerEmail(parsed.data.cifKey)
      ]
    );

    return res.status(201).json({
      id: inserted.rows[0].id,
      cifKey: parsed.data.cifKey.trim(),
      branchId,
      memberName: parsed.data.memberName.trim(),
      contactInfo: parsed.data.contactInfo.trim(),
      address: parsed.data.address.trim(),
      name: parsed.data.memberName.trim(),
      phone: parsed.data.contactInfo.trim(),
      email: borrowerEmail(parsed.data.cifKey)
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/bulk", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) {
      return res.status(400).json({ message: "No member rows provided" });
    }

    const normalizedRows: NormalizedBorrowerImportRow[] = [];

    for (const row of rows as unknown[]) {
      const result = borrowerImportSchema.safeParse(row);
      if (!result.success) continue;

      const payload: BorrowerImportPayload = result.data;
      const branchId = isSuperAdmin(user) ? Number(payload.branchId ?? 0) : userBranchId(user);
      if (branchId <= 0) continue;

      const cifKey = payload.cifKey.trim();
      const memberName = payload.memberName.trim();
      const contactInfo = payload.contactInfo.trim();
      const address = payload.address.trim();

      normalizedRows.push({
        cifKey,
        branchId,
        memberName,
        contactInfo,
        address,
        email: borrowerEmail(cifKey)
      });
    }

    if (normalizedRows.length === 0) {
      return res.status(400).json({ message: "No valid member rows provided" });
    }

    const uniqueRows = Array.from(
      normalizedRows.reduce((map: Map<string, NormalizedBorrowerImportRow>, row: NormalizedBorrowerImportRow) => {
        map.set(row.cifKey.toLowerCase(), row);
        return map;
      }, new Map<string, NormalizedBorrowerImportRow>()).values()
    );

    const existingResult = await query<{ cif_key: string }>(
      "SELECT cif_key FROM borrowers WHERE cif_key = ANY($1::text[])",
      [uniqueRows.map((row) => row.cifKey)]
    );
    const existingCifKeys = new Set(existingResult.rows.map((row) => row.cif_key.toLowerCase()));

    const inserted = uniqueRows.filter((row) => !existingCifKeys.has(row.cifKey.toLowerCase())).length;
    const updated = uniqueRows.length - inserted;

    await query(
      `INSERT INTO borrowers (cif_key, branch_id, member_name, contact_info, address, name, phone, email)
       SELECT
         item.cif_key,
         item.branch_id,
         item.member_name,
         item.contact_info,
         item.address,
         item.member_name,
         item.contact_info,
         item.email
       FROM json_to_recordset($1::json) AS item(
         cif_key text,
         branch_id int,
         member_name text,
         contact_info text,
         address text,
         email text
       )
       ON CONFLICT (cif_key) DO UPDATE
       SET branch_id = EXCLUDED.branch_id,
           member_name = EXCLUDED.member_name,
           contact_info = EXCLUDED.contact_info,
           address = EXCLUDED.address,
           name = EXCLUDED.name,
           phone = EXCLUDED.phone,
           email = EXCLUDED.email`,
      [
        JSON.stringify(
          uniqueRows.map((row) => ({
            cif_key: row.cifKey,
            branch_id: row.branchId,
            member_name: row.memberName,
            contact_info: row.contactInfo,
            address: row.address,
            email: row.email
          }))
        )
      ]
    );

    return res.json({ inserted, updated });
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
      return res.status(400).json({ message: "No member ids provided" });
    }

    let deleted = 0;
    const skipped: Array<{ id: number; reason: string }> = [];

    for (const borrowerId of ids) {
      const owner = await query<{ branch_id: number | null }>("SELECT branch_id FROM borrowers WHERE id = $1 LIMIT 1", [borrowerId]);
      if (owner.rowCount === 0) {
        skipped.push({ id: borrowerId, reason: "not_found" });
        continue;
      }

      try {
        assertBranchAccess(user, Number(owner.rows[0].branch_id ?? 0));
      } catch {
        skipped.push({ id: borrowerId, reason: "forbidden" });
        continue;
      }

      const loanCount = await query<{ total: string }>("SELECT COUNT(*)::text AS total FROM loans WHERE borrower_id = $1", [borrowerId]);
      if (Number(loanCount.rows[0]?.total ?? 0) > 0) {
        skipped.push({ id: borrowerId, reason: "has_loan_history" });
        continue;
      }

      await query("DELETE FROM borrowers WHERE id = $1", [borrowerId]);
      deleted += 1;
    }

    return res.json({ deleted, skipped });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:borrowerId", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const borrowerId = Number(req.params.borrowerId);
    if (!Number.isInteger(borrowerId) || borrowerId <= 0) {
      return res.status(400).json({ message: "Invalid borrower id" });
    }

    const parsed = borrowerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid borrower payload" });
    }

    const branchId = await borrowerBranchId(borrowerId);
    if (branchId == null) {
      return res.status(404).json({ message: "Borrower not found" });
    }
    assertBranchAccess(user, branchId);

    await query(
      `UPDATE borrowers
       SET cif_key = $1, member_name = $2, contact_info = $3, address = $4, name = $5, phone = $6, email = $7
       WHERE id = $8`,
      [
        parsed.data.cifKey.trim(),
        parsed.data.memberName.trim(),
        parsed.data.contactInfo.trim(),
        parsed.data.address.trim(),
        parsed.data.memberName.trim(),
        parsed.data.contactInfo.trim(),
        borrowerEmail(parsed.data.cifKey),
        borrowerId
      ]
    );

    return res.json({
      id: borrowerId,
      cifKey: parsed.data.cifKey.trim(),
      memberName: parsed.data.memberName.trim(),
      contactInfo: parsed.data.contactInfo.trim(),
      address: parsed.data.address.trim(),
      name: parsed.data.memberName.trim(),
      phone: parsed.data.contactInfo.trim(),
      email: borrowerEmail(parsed.data.cifKey)
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:borrowerId", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const borrowerId = Number(req.params.borrowerId);
    if (!Number.isInteger(borrowerId) || borrowerId <= 0) {
      return res.status(400).json({ message: "Invalid borrower id" });
    }

    const branchId = await borrowerBranchId(borrowerId);
    if (branchId == null) {
      return res.status(404).json({ message: "Borrower not found" });
    }
    assertBranchAccess(user, branchId);

    const loanCount = await query<{ total: string }>("SELECT COUNT(*)::text AS total FROM loans WHERE borrower_id = $1", [borrowerId]);
    if (Number(loanCount.rows[0]?.total ?? 0) > 0) {
      return res.status(409).json({ message: "Cannot delete borrower with loan history, including closed loans hidden from the main loan list" });
    }

    await query("DELETE FROM borrowers WHERE id = $1", [borrowerId]);
    return res.json({ message: "Borrower deleted" });
  } catch (error) {
    return next(error);
  }
});

router.get("/:borrowerId/remarks", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const borrowerId = Number(req.params.borrowerId);
    if (!Number.isInteger(borrowerId) || borrowerId <= 0) {
      return res.status(400).json({ message: "Invalid borrower id" });
    }

    const branchId = await borrowerBranchId(borrowerId);
    if (branchId == null) {
      return res.status(404).json({ message: "Borrower not found" });
    }
    assertBranchAccess(user, branchId);

    const result = await query<{
      id: number;
      borrower_id: number;
      remark_text: string;
      remark_category: string;
      created_at: string;
      username: string | null;
    }>(
      `SELECT
         br.id,
         br.borrower_id,
         br.remark_text,
         br.remark_category,
         br.created_at,
         u.username
       FROM borrower_remarks br
       LEFT JOIN users u ON u.id = br.created_by
       WHERE br.borrower_id = $1
       ORDER BY br.created_at DESC, br.id DESC`,
      [borrowerId]
    );

    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        borrowerId: row.borrower_id,
        remark: row.remark_text,
        remarkCategory: row.remark_category,
        createdAt: row.created_at,
        createdBy: row.username ?? "System"
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/:borrowerId/remarks", authenticate, authorize(["super_admin", "branch_admin", "staff"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const borrowerId = Number(req.params.borrowerId);
    const remark = String(req.body?.remark ?? "").trim();
    if (!Number.isInteger(borrowerId) || borrowerId <= 0) {
      return res.status(400).json({ message: "Invalid borrower id" });
    }
    if (!remark) {
      return res.status(400).json({ message: "Remark is required" });
    }

    const branchId = await borrowerBranchId(borrowerId);
    if (branchId == null) {
      return res.status(404).json({ message: "Borrower not found" });
    }
    assertBranchAccess(user, branchId);

    const category = normalizeRemarkCategory(typeof req.body?.remarkCategory === "string" ? req.body.remarkCategory : undefined);
    const created = await query<{ id: number }>(
      "INSERT INTO borrower_remarks (borrower_id, remark_text, remark_category, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
      [borrowerId, remark, category, user.id]
    );

    return res.status(201).json({
      id: created.rows[0].id,
      borrowerId,
      remark,
      remarkCategory: category,
      createdBy: user.username
    });
  } catch (error) {
    return next(error);
  }
});

export { router as borrowerRouter };
