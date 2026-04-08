import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../config/db.js";
import { authenticate, authorize, type AuthedRequest } from "../middleware/auth.js";
import {
  assertBranchAccess,
  formatPaymentId,
  getRequestUser,
  isSuperAdmin,
  nextLoanAccountNo,
  normalizeRemarkCategory,
  toNumber,
  userBranchId
} from "../services/access.js";

const router = Router();

const loanSchema = z.object({
  borrowerId: z.coerce.number().int().positive(),
  loanAccountNo: z.string().trim().optional().default(""),
  loanType: z.string().trim().min(1),
  dateRelease: z.string().trim().min(1),
  maturityDate: z.string().trim().min(1),
  loanAmount: z.coerce.number().nonnegative(),
  principalDue: z.coerce.number().nonnegative(),
  penaltyDue: z.coerce.number().nonnegative(),
  interest: z.coerce.number().nonnegative(),
  otherCharges: z.coerce.number().nonnegative().default(0),
  parAge: z.coerce.number().int().nonnegative().default(0),
  status: z.enum(["active", "closed", "overdue"]).default("active"),
  notes: z.string().optional().default("")
});

const loanImportInsertSchema = z.object({
  cifKey: z.string().trim().min(2),
  loanAccountNo: z.string().trim().min(1),
  memberName: z.string().trim().min(2),
  loanType: z.string().trim().min(1),
  dateRelease: z.string().trim().min(1),
  maturityDate: z.string().trim().min(1),
  loanAmount: z.coerce.number().nonnegative(),
  principalDue: z.coerce.number().nonnegative(),
  penaltyDue: z.coerce.number().nonnegative(),
  interest: z.coerce.number().nonnegative(),
  otherCharges: z.coerce.number().nonnegative().default(0),
  parAge: z.coerce.number().int().nonnegative().default(0),
  status: z.enum(["active", "closed", "overdue"]).default("active"),
  contactInfo: z.string().trim().default(""),
  address: z.string().trim().min(1).default("NA"),
  notes: z.string().optional().default("")
});

type LoanBulkSkip = {
  row: number;
  loanId: number;
  memberId: number;
  loanAccountNo: string;
  cifKey: string;
  reason: string;
};

type BorrowerImportRecord = {
  id: number;
  branch_id: number | null;
  cif_key: string | null;
  member_name: string | null;
  contact_info: string | null;
  address: string | null;
};

type LoanImportMatchRecord = {
  id: number;
  borrower_id: number;
  branch_id: number | null;
  loan_account_no: string | null;
  cif_key: string | null;
};

function summarizeZodError(error: z.ZodError) {
  const firstIssue = error.issues[0];
  if (!firstIssue) {
    return "invalid_payload";
  }

  const path = firstIssue.path.length > 0 ? firstIssue.path.join(".") : "row";
  return `${path}: ${firstIssue.message}`;
}

function normalizeImportedLoanStatus(value: unknown): "active" | "closed" | "overdue" | string {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!raw) {
    return "active";
  }

  if (["active", "current", "open"].includes(raw)) {
    return "active";
  }

  if (["closed", "paid", "fully paid", "complete", "completed", "settled"].includes(raw)) {
    return "closed";
  }

  if (["overdue", "past due", "pastdue", "delinquent"].includes(raw)) {
    return "overdue";
  }

  return raw;
}

function normalizeImportedAddress(value: unknown): string {
  const raw = String(value ?? "").trim();
  return raw || "NA";
}

function normalizedCifKey(value: string) {
  return value.trim().toLowerCase();
}

function normalizedLoanAccountKey(value: string) {
  return value.trim().toLowerCase();
}

function loanIdBorrowerKey(loanId: number, borrowerId: number) {
  return `${loanId}:${borrowerId}`;
}

function loanCifAccountKey(cifKey: string, loanAccountNo: string) {
  return `${normalizedCifKey(cifKey)}::${normalizedLoanAccountKey(loanAccountNo)}`;
}

async function borrowerContext(borrowerId: number) {
  const result = await query<{
    id: number;
    branch_id: number | null;
    cif_key: string | null;
    member_name: string | null;
    contact_info: string | null;
    address: string | null;
  }>(
    `SELECT id, branch_id, cif_key, member_name, contact_info, address
     FROM borrowers
     WHERE id = $1
     LIMIT 1`,
    [borrowerId]
  );
  return result.rows[0] ?? null;
}

async function borrowerContextByCif(cifKey: string) {
  const result = await query<{
    id: number;
    branch_id: number | null;
    cif_key: string | null;
    member_name: string | null;
    contact_info: string | null;
    address: string | null;
  }>(
    `SELECT id, branch_id, cif_key, member_name, contact_info, address
     FROM borrowers
     WHERE cif_key = $1
     LIMIT 1`,
    [cifKey]
  );
  return result.rows[0] ?? null;
}

function borrowerEmail(cifKey: string) {
  return `na+${cifKey.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}@example.com`;
}

async function loanContext(loanId: number) {
  const result = await query<{
    id: number;
    borrower_id: number;
    branch_id: number | null;
    loan_account_no: string | null;
    member_name: string | null;
  }>(
    `SELECT
       l.id,
       l.borrower_id,
       b.branch_id,
       l.loan_account_no,
       b.member_name
     FROM loans l
     INNER JOIN borrowers b ON b.id = l.borrower_id
     WHERE l.id = $1
     LIMIT 1`,
    [loanId]
  );
  return result.rows[0] ?? null;
}

function mapLoanRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    borrowerId: Number(row.borrower_id),
    loanAccountNo: String(row.loan_account_no ?? ""),
    loanType: String(row.loan_type ?? ""),
    dateRelease: String(row.date_release ?? row.due_date ?? ""),
    maturityDate: String(row.maturity_date ?? row.due_date ?? ""),
    loanAmount: toNumber(row.loan_amount ?? row.principal ?? 0),
    principalDue: toNumber(row.principal_due ?? row.principal ?? 0),
    penaltyDue: toNumber(row.penalty_due ?? row.penalty ?? 0),
    otherCharges: toNumber(row.other_charges ?? 0),
    parAge: Number(row.par_age ?? 0),
    notes: String(row.notes ?? ""),
    principal: toNumber(row.principal_due ?? row.principal ?? 0),
    interest: toNumber(row.interest ?? 0),
    penalty: toNumber(row.penalty_due ?? row.penalty ?? 0),
    dueDate: String(row.due_date ?? row.maturity_date ?? ""),
    status: String(row.status ?? "active")
  };
}

router.get("/", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const params: unknown[] = [];
    const where = user.role === "super_admin" ? "" : "WHERE b.branch_id = $1";
    if (user.role !== "super_admin") {
      params.push(Number(user.branchId ?? 0));
    }

    const result = await query(
      `SELECT
         l.id,
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
         l.status,
         b.cif_key,
         b.member_name,
         b.contact_info,
         b.address
       FROM loans l
       INNER JOIN borrowers b ON b.id = l.borrower_id
       ${where}
       ORDER BY l.id DESC`,
      params
    );

    return res.json(
      result.rows.map((row) => ({
        ...mapLoanRow(row),
        cifKey: String(row.cif_key ?? ""),
        memberName: String(row.member_name ?? ""),
        contactInfo: String(row.contact_info ?? ""),
        address: String(row.address ?? "")
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const parsed = loanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid loan payload" });
    }

    const borrower = await borrowerContext(parsed.data.borrowerId);
    if (!borrower) {
      return res.status(404).json({ message: "Borrower not found" });
    }
    assertBranchAccess(user, Number(borrower.branch_id ?? 0));

    const created = await withTransaction(async (client) => {
      const loanAccountNo = parsed.data.loanAccountNo.trim() || (await nextLoanAccountNo(client));
      const result = await client.query<{ id: number }>(
        `INSERT INTO loans (
           borrower_id, loan_account_no, loan_type, date_release, maturity_date, loan_amount,
           principal_due, penalty_due, interest, other_charges, par_age, notes, principal, penalty, due_date, status
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
         ) RETURNING id`,
        [
          parsed.data.borrowerId,
          loanAccountNo,
          parsed.data.loanType.trim(),
          parsed.data.dateRelease.trim(),
          parsed.data.maturityDate.trim(),
          parsed.data.loanAmount,
          parsed.data.principalDue,
          parsed.data.penaltyDue,
          parsed.data.interest,
          parsed.data.otherCharges,
          parsed.data.parAge,
          parsed.data.notes ?? "",
          parsed.data.principalDue,
          parsed.data.penaltyDue,
          parsed.data.maturityDate.trim(),
          parsed.data.status
        ]
      );

      return {
        id: result.rows[0].id,
        loanAccountNo
      };
    });

    return res.status(201).json({
      id: created.id,
      borrowerId: parsed.data.borrowerId,
      loanAccountNo: created.loanAccountNo,
      loanType: parsed.data.loanType.trim(),
      dateRelease: parsed.data.dateRelease.trim(),
      maturityDate: parsed.data.maturityDate.trim(),
      loanAmount: parsed.data.loanAmount,
      principalDue: parsed.data.principalDue,
      penaltyDue: parsed.data.penaltyDue,
      interest: parsed.data.interest,
      otherCharges: parsed.data.otherCharges,
      parAge: parsed.data.parAge,
      status: parsed.data.status,
      notes: parsed.data.notes ?? ""
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
      return res.status(400).json({ message: "No valid loan rows found in file" });
    }
    const importRows = rows as Array<Record<string, unknown>>;

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const skippedRows: LoanBulkSkip[] = [];
    const explicitLoanIds = Array.from(
      new Set(
        importRows.map((row) => Number(row?.loanId ?? 0)).filter((loanId) => Number.isInteger(loanId) && loanId > 0)
      )
    );
    const importedBorrowerIds = Array.from(
      new Set(
        importRows
          .map((row) => Number(row?.memberId ?? row?.borrowerId ?? 0))
          .filter((borrowerId) => Number.isInteger(borrowerId) && borrowerId > 0)
      )
    );
    const importedCifKeys = Array.from(
      new Set(
        importRows
          .map((row) => String(row?.cifKey ?? "").trim())
          .filter((cifKey) => cifKey.length > 0)
      )
    );
    const importedLoanAccountNos = Array.from(
      new Set(
        importRows
          .map((row) => String(row?.loanAccountNo ?? "").trim())
          .filter((loanAccountNo) => loanAccountNo.length > 0)
      )
    );

    await withTransaction(async (client) => {
      const borrowersById = new Map<number, BorrowerImportRecord>();
      const borrowersByCif = new Map<string, BorrowerImportRecord>();
      const loansById = new Map<number, LoanImportMatchRecord>();
      const loansByIdBorrower = new Map<string, LoanImportMatchRecord>();
      const loansByCifAccount = new Map<string, LoanImportMatchRecord>();
      const loansByAccountNo = new Map<string, LoanImportMatchRecord>();

      const syncCachedLoansForBorrower = (borrower: BorrowerImportRecord) => {
        for (const loan of Array.from(loansById.values())) {
          if (loan.borrower_id !== borrower.id) continue;
          cacheLoan({
            ...loan,
            branch_id: borrower.branch_id,
            cif_key: borrower.cif_key
          });
        }
      };

      const cacheBorrower = (borrower: BorrowerImportRecord) => {
        const previous = borrowersById.get(borrower.id);
        if (previous?.cif_key && previous.cif_key !== borrower.cif_key) {
          borrowersByCif.delete(normalizedCifKey(previous.cif_key));
        }

        borrowersById.set(borrower.id, borrower);
        if (borrower.cif_key) {
          borrowersByCif.set(normalizedCifKey(borrower.cif_key), borrower);
        }
      };

      const cacheLoan = (loan: LoanImportMatchRecord) => {
        const previous = loansById.get(loan.id);
        if (previous) {
          loansByIdBorrower.delete(loanIdBorrowerKey(previous.id, previous.borrower_id));
          if (previous.cif_key && previous.loan_account_no) {
            loansByCifAccount.delete(loanCifAccountKey(previous.cif_key, previous.loan_account_no));
          }
          if (previous.loan_account_no) {
            loansByAccountNo.delete(normalizedLoanAccountKey(previous.loan_account_no));
          }
        }

        loansById.set(loan.id, loan);
        loansByIdBorrower.set(loanIdBorrowerKey(loan.id, loan.borrower_id), loan);
        if (loan.cif_key && loan.loan_account_no) {
          loansByCifAccount.set(loanCifAccountKey(loan.cif_key, loan.loan_account_no), loan);
        }
        if (loan.loan_account_no) {
          loansByAccountNo.set(normalizedLoanAccountKey(loan.loan_account_no), loan);
        }
      };

      const upsertBorrower = async (params: {
        borrowerId?: number;
        cifKey: string;
        memberName: string;
        contactInfo: string;
        address: string;
        branchId: number;
      }) => {
        let borrower =
          (params.borrowerId && params.borrowerId > 0 ? borrowersById.get(params.borrowerId) : null) ??
          borrowersByCif.get(normalizedCifKey(params.cifKey)) ??
          null;

        if (borrower) {
          const result = await client.query<BorrowerImportRecord>(
            `UPDATE borrowers
             SET cif_key = $1,
                 branch_id = $2,
                 member_name = $3,
                 contact_info = $4,
                 address = $5,
                 name = $6,
                 phone = $7,
                 email = $8
             WHERE id = $9
             RETURNING id, branch_id, cif_key, member_name, contact_info, address`,
            [
              params.cifKey,
              borrower.branch_id ?? params.branchId,
              params.memberName,
              params.contactInfo,
              params.address,
              params.memberName,
              params.contactInfo,
              borrowerEmail(params.cifKey),
              borrower.id
            ]
          );

          borrower = result.rows[0] ?? null;
          if (borrower) {
            cacheBorrower(borrower);
            syncCachedLoansForBorrower(borrower);
          }
          return borrower;
        }

        const insertedBorrower = await client.query<BorrowerImportRecord>(
          `INSERT INTO borrowers (cif_key, branch_id, member_name, contact_info, address, name, phone, email)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, branch_id, cif_key, member_name, contact_info, address`,
          [
            params.cifKey,
            params.branchId,
            params.memberName,
            params.contactInfo,
            params.address,
            params.memberName,
            params.contactInfo,
            borrowerEmail(params.cifKey)
          ]
        );

        borrower = insertedBorrower.rows[0] ?? null;
        if (borrower) {
          cacheBorrower(borrower);
          syncCachedLoansForBorrower(borrower);
        }
        return borrower;
      };

      if (importedBorrowerIds.length > 0 || importedCifKeys.length > 0) {
        const borrowerResult = await client.query<BorrowerImportRecord>(
          `SELECT id, branch_id, cif_key, member_name, contact_info, address
           FROM borrowers
           WHERE id = ANY($1::int[]) OR cif_key = ANY($2::text[])`,
          [importedBorrowerIds, importedCifKeys]
        );
        borrowerResult.rows.forEach(cacheBorrower);
      }

      if (explicitLoanIds.length > 0 || importedLoanAccountNos.length > 0) {
        const loanResult = await client.query<LoanImportMatchRecord>(
          `SELECT l.id, l.borrower_id, b.branch_id, l.loan_account_no, b.cif_key
           FROM loans l
           INNER JOIN borrowers b ON b.id = l.borrower_id
           WHERE l.id = ANY($1::int[]) OR l.loan_account_no = ANY($2::text[])`,
          [explicitLoanIds, importedLoanAccountNos]
        );
        loanResult.rows.forEach(cacheLoan);

        const missingBorrowerIds = Array.from(
          new Set(
            loanResult.rows
              .map((row) => row.borrower_id)
              .filter((borrowerId) => borrowerId > 0 && !borrowersById.has(borrowerId))
          )
        );

        if (missingBorrowerIds.length > 0) {
          const relatedBorrowers = await client.query<BorrowerImportRecord>(
            `SELECT id, branch_id, cif_key, member_name, contact_info, address
             FROM borrowers
             WHERE id = ANY($1::int[])`,
            [missingBorrowerIds]
          );
          relatedBorrowers.rows.forEach(cacheBorrower);
        }
      }

      for (const [index, row] of importRows.entries()) {
        const rowNumber = index + 2;
        const explicitLoanId = Number(row?.loanId ?? 0);
        const borrowerId = Number(row?.memberId ?? row?.borrowerId ?? 0);
        const cifKey = String(row?.cifKey ?? "").trim();
        const loanAccountNo = String(row?.loanAccountNo ?? "").trim();
        const memberName = String(row?.memberName ?? "").trim();
        const contactInfo = String(row?.contactInfo ?? "").trim();
        const address = normalizeImportedAddress(row?.address);
        const normalizedStatus = normalizeImportedLoanStatus(row?.status);
        const resolvedBranchId = isSuperAdmin(user) ? Number(row?.branchId ?? 0) : userBranchId(user);
        const hasLoanAndBorrowerIds = explicitLoanId > 0 && borrowerId > 0;
        const hasCifAndAccountNo = Boolean(cifKey && loanAccountNo);
        const pushSkip = (reason: string) => {
          skipped += 1;
          skippedRows.push({
            row: rowNumber,
            loanId: explicitLoanId,
            memberId: borrowerId,
            loanAccountNo,
            cifKey,
            reason
          });
        };

        try {
          if (!hasLoanAndBorrowerIds && !hasCifAndAccountNo) {
            pushSkip("missing_loan_id_and_member_id_or_cif_key_and_loan_account_no");
            continue;
          }

          let matchedLoan = hasLoanAndBorrowerIds ? loansByIdBorrower.get(loanIdBorrowerKey(explicitLoanId, borrowerId)) ?? null : null;
          if (!matchedLoan && hasCifAndAccountNo) {
            matchedLoan = loansByCifAccount.get(loanCifAccountKey(cifKey, loanAccountNo)) ?? null;
          }

          if (matchedLoan) {
            let borrower = borrowersById.get(matchedLoan.borrower_id) ?? null;
            if (!borrower) {
              pushSkip("matched_borrower_not_found");
              continue;
            }

            try {
              assertBranchAccess(user, Number(matchedLoan.branch_id ?? borrower.branch_id ?? 0));
            } catch {
              pushSkip("matched_branch_forbidden");
              continue;
            }

            if (cifKey && memberName) {
              const branchId = Number(borrower.branch_id ?? resolvedBranchId ?? 0);
              if (branchId > 0) {
                const updatedBorrower = await upsertBorrower({
                  borrowerId: borrower.id,
                  cifKey,
                  memberName,
                  contactInfo,
                  address,
                  branchId
                });
                if (!updatedBorrower) {
                  pushSkip("borrower_upsert_failed");
                  continue;
                }
                borrower = updatedBorrower;
              }
            }

            const parsed = loanSchema.safeParse({
              borrowerId: borrower.id,
              loanAccountNo,
              loanType: String(row?.loanType ?? "").trim(),
              dateRelease: String(row?.dateRelease ?? "").trim(),
              maturityDate: String(row?.maturityDate ?? "").trim(),
              loanAmount: Number(row?.loanAmount ?? 0),
              principalDue: Number(row?.principalDue ?? 0),
              penaltyDue: Number(row?.penaltyDue ?? 0),
              interest: Number(row?.interest ?? 0),
              otherCharges: Number(row?.otherCharges ?? 0),
              parAge: Number(row?.parAge ?? 0),
              status: normalizedStatus,
              notes: String(row?.notes ?? "")
            });

            if (!parsed.success) {
              pushSkip(`invalid_update_payload: ${summarizeZodError(parsed.error)}`);
              continue;
            }

            const duplicateLoan = loansByAccountNo.get(normalizedLoanAccountKey(loanAccountNo));
            if (duplicateLoan && duplicateLoan.id !== matchedLoan.id) {
              pushSkip("duplicate_loan_account_no");
              continue;
            }

            await client.query(
              `UPDATE loans
               SET borrower_id = $1, loan_account_no = $2, loan_type = $3, date_release = $4, maturity_date = $5, loan_amount = $6,
                   principal_due = $7, penalty_due = $8, interest = $9, other_charges = $10, par_age = $11, notes = $12,
                   principal = $13, penalty = $14, due_date = $15, status = $16
               WHERE id = $17`,
              [
                borrower.id,
                loanAccountNo,
                parsed.data.loanType.trim(),
                parsed.data.dateRelease.trim(),
                parsed.data.maturityDate.trim(),
                parsed.data.loanAmount,
                parsed.data.principalDue,
                parsed.data.penaltyDue,
                parsed.data.interest,
                parsed.data.otherCharges,
                parsed.data.parAge,
                parsed.data.notes ?? "",
                parsed.data.principalDue,
                parsed.data.penaltyDue,
                parsed.data.maturityDate.trim(),
                parsed.data.status,
                matchedLoan.id
              ]
            );

            matchedLoan = {
              id: matchedLoan.id,
              borrower_id: borrower.id,
              branch_id: borrower.branch_id,
              loan_account_no: loanAccountNo,
              cif_key: borrower.cif_key ?? cifKey
            };
            cacheLoan(matchedLoan);
            updated += 1;
            continue;
          }

          const insertPayload = loanImportInsertSchema.safeParse({
            cifKey,
            loanAccountNo,
            memberName,
            loanType: String(row?.loanType ?? "").trim(),
            dateRelease: String(row?.dateRelease ?? "").trim(),
            maturityDate: String(row?.maturityDate ?? "").trim(),
            loanAmount: Number(row?.loanAmount ?? 0),
            principalDue: Number(row?.principalDue ?? 0),
            penaltyDue: Number(row?.penaltyDue ?? 0),
            interest: Number(row?.interest ?? 0),
            otherCharges: Number(row?.otherCharges ?? 0),
            parAge: Number(row?.parAge ?? 0),
            status: normalizedStatus,
            contactInfo,
            address,
            notes: String(row?.notes ?? "")
          });

          if (!insertPayload.success) {
            pushSkip(`invalid_insert_payload: ${summarizeZodError(insertPayload.error)}`);
            continue;
          }

          if (resolvedBranchId <= 0) {
            pushSkip("missing_branch");
            continue;
          }

          const borrower = await upsertBorrower({
            borrowerId: borrowerId > 0 ? borrowerId : undefined,
            cifKey: insertPayload.data.cifKey,
            memberName: insertPayload.data.memberName,
            contactInfo: insertPayload.data.contactInfo,
            address: insertPayload.data.address,
            branchId: resolvedBranchId
          });

          if (!borrower) {
            pushSkip("borrower_upsert_failed");
            continue;
          }

          try {
            assertBranchAccess(user, Number(borrower.branch_id ?? resolvedBranchId));
          } catch {
            pushSkip("borrower_branch_forbidden");
            continue;
          }

          const duplicateLoan = loansByAccountNo.get(normalizedLoanAccountKey(insertPayload.data.loanAccountNo));
          if (duplicateLoan) {
            pushSkip("duplicate_loan_account_no");
            continue;
          }

          const insertedLoan = await client.query<{ id: number }>(
            `INSERT INTO loans (
               borrower_id, loan_account_no, loan_type, date_release, maturity_date, loan_amount,
               principal_due, penalty_due, interest, other_charges, par_age, notes, principal, penalty, due_date, status
             ) VALUES (
               $1, $2, $3, $4, $5, $6,
               $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
             )
             RETURNING id`,
            [
              borrower.id,
              insertPayload.data.loanAccountNo,
              insertPayload.data.loanType,
              insertPayload.data.dateRelease,
              insertPayload.data.maturityDate,
              insertPayload.data.loanAmount,
              insertPayload.data.principalDue,
              insertPayload.data.penaltyDue,
              insertPayload.data.interest,
              insertPayload.data.otherCharges,
              insertPayload.data.parAge,
              insertPayload.data.notes ?? "",
              insertPayload.data.principalDue,
              insertPayload.data.penaltyDue,
              insertPayload.data.maturityDate,
              insertPayload.data.status
            ]
          );

          cacheLoan({
            id: insertedLoan.rows[0].id,
            borrower_id: borrower.id,
            branch_id: borrower.branch_id,
            loan_account_no: insertPayload.data.loanAccountNo,
            cif_key: borrower.cif_key ?? insertPayload.data.cifKey
          });
          inserted += 1;
        } catch (error) {
          pushSkip(error instanceof Error ? error.message : "unexpected_error");
        }
      }
    });

    return res.json({ inserted, updated, skipped, skippedRows });
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
      return res.status(400).json({ message: "No loan ids provided" });
    }

    let deleted = 0;
    const skipped: Array<{ id: number; reason: string }> = [];

    for (const loanId of ids) {
      const context = await loanContext(loanId);
      if (!context) {
        skipped.push({ id: loanId, reason: "not_found" });
        continue;
      }
      try {
        assertBranchAccess(user, Number(context.branch_id ?? 0));
      } catch {
        skipped.push({ id: loanId, reason: "forbidden" });
        continue;
      }

      try {
        await withTransaction(async (client) => {
          await client.query("DELETE FROM collections WHERE loan_id = $1", [loanId]);
          await client.query("DELETE FROM loans WHERE id = $1", [loanId]);
        });
        deleted += 1;
      } catch {
        skipped.push({ id: loanId, reason: "delete_failed" });
      }
    }

    return res.json({ deleted, skipped });
  } catch (error) {
    return next(error);
  }
});

router.get("/:loanId", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const loanId = Number(req.params.loanId);
    if (!Number.isInteger(loanId) || loanId <= 0) {
      return res.status(400).json({ message: "Invalid loan id" });
    }

    const result = await query(
      `SELECT
         l.id,
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
         l.status,
         b.branch_id,
         b.cif_key,
         b.member_name,
         b.contact_info,
         b.address
       FROM loans l
       INNER JOIN borrowers b ON b.id = l.borrower_id
       WHERE l.id = $1
       LIMIT 1`,
      [loanId]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ message: "Loan not found" });
    }
    assertBranchAccess(user, Number(row.branch_id ?? 0));

    return res.json({
      ...mapLoanRow(row),
      cifKey: String(row.cif_key ?? ""),
      memberName: String(row.member_name ?? ""),
      contactInfo: String(row.contact_info ?? ""),
      address: String(row.address ?? "")
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:loanId", authenticate, authorize(["super_admin", "branch_admin", "staff"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const loanId = Number(req.params.loanId);
    if (!Number.isInteger(loanId) || loanId <= 0) {
      return res.status(400).json({ message: "Invalid loan id" });
    }

    const context = await loanContext(loanId);
    if (!context) {
      return res.status(404).json({ message: "Loan not found" });
    }
    assertBranchAccess(user, Number(context.branch_id ?? 0));

    const parsed = loanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid loan payload" });
    }

    await query(
      `UPDATE loans
       SET loan_account_no = $1, loan_type = $2, date_release = $3, maturity_date = $4, loan_amount = $5, principal_due = $6,
           penalty_due = $7, interest = $8, other_charges = $9, par_age = $10, notes = $11, principal = $12, penalty = $13,
           due_date = $14, status = $15
       WHERE id = $16`,
      [
        parsed.data.loanAccountNo.trim(),
        parsed.data.loanType.trim(),
        parsed.data.dateRelease.trim(),
        parsed.data.maturityDate.trim(),
        parsed.data.loanAmount,
        parsed.data.principalDue,
        parsed.data.penaltyDue,
        parsed.data.interest,
        parsed.data.otherCharges,
        parsed.data.parAge,
        parsed.data.notes ?? "",
        parsed.data.principalDue,
        parsed.data.penaltyDue,
        parsed.data.maturityDate.trim(),
        parsed.data.status,
        loanId
      ]
    );

    return res.json({ message: "Loan updated" });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:loanId", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const loanId = Number(req.params.loanId);
    if (!Number.isInteger(loanId) || loanId <= 0) {
      return res.status(400).json({ message: "Invalid loan id" });
    }

    const context = await loanContext(loanId);
    if (!context) {
      return res.status(404).json({ message: "Loan not found" });
    }
    assertBranchAccess(user, Number(context.branch_id ?? 0));

    await withTransaction(async (client) => {
      await client.query("DELETE FROM collections WHERE loan_id = $1", [loanId]);
      await client.query("DELETE FROM loans WHERE id = $1", [loanId]);
    });

    return res.json({ message: "Loan deleted" });
  } catch (error) {
    return next(error);
  }
});

router.get("/:loanId/payments", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const loanId = Number(req.params.loanId);
    const context = await loanContext(loanId);
    if (!context) {
      return res.status(404).json({ message: "Loan not found" });
    }
    assertBranchAccess(user, Number(context.branch_id ?? 0));

    const result = await query<{
      id: number;
      loan_id: number;
      amount: string | number;
      or_no: string | null;
      collected_at: string;
      username: string | null;
    }>(
      `SELECT
         c.id,
         c.loan_id,
         c.amount,
         c.or_no,
         c.collected_at,
         u.username
       FROM collections c
       LEFT JOIN users u ON u.id = c.created_by
       WHERE c.loan_id = $1
       ORDER BY c.collected_at DESC, c.id DESC`,
      [loanId]
    );

    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        paymentId: formatPaymentId(row.id),
        loanId: row.loan_id,
        amount: toNumber(row.amount),
        orNo: row.or_no ?? "",
        collectedBy: row.username ?? "System",
        collectedAt: row.collected_at
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/:loanId/payments", authenticate, authorize(["super_admin", "branch_admin", "staff"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const loanId = Number(req.params.loanId);
    const amount = Number(req.body?.amount ?? 0);
    const orNo = String(req.body?.orNo ?? req.body?.or_no ?? "").trim();
    const collectedAtRaw = String(req.body?.collectedAt ?? "").trim();

    const context = await loanContext(loanId);
    if (!context) {
      return res.status(404).json({ message: "Loan not found" });
    }
    assertBranchAccess(user, Number(context.branch_id ?? 0));

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Payment amount must be greater than 0" });
    }
    if (orNo.length > 80) {
      return res.status(400).json({ message: "OR No is too long" });
    }

    let collectedAt = new Date().toISOString();
    if (collectedAtRaw) {
      const parsedDate = new Date(collectedAtRaw);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: "Invalid payment date/time" });
      }
      collectedAt = parsedDate.toISOString();
    }

    const created = await query<{ id: number }>(
      "INSERT INTO collections (loan_id, amount, or_no, collected_at, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [loanId, amount, orNo || null, collectedAt, user.id]
    );

    return res.status(201).json({
      id: created.rows[0].id,
      paymentId: formatPaymentId(created.rows[0].id),
      loanId,
      amount,
      orNo,
      collectedBy: user.username,
      collectedAt
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:loanId/penalty", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const loanId = Number(req.params.loanId);
    const penalty = Number(req.body?.penalty ?? -1);

    const context = await loanContext(loanId);
    if (!context) {
      return res.status(404).json({ message: "Loan not found" });
    }
    assertBranchAccess(user, Number(context.branch_id ?? 0));

    if (!Number.isFinite(penalty) || penalty < 0) {
      return res.status(400).json({ message: "Penalty must be a positive number" });
    }

    await query("UPDATE loans SET penalty_due = $1, penalty = $1 WHERE id = $2", [penalty, loanId]);
    return res.json({ message: "Penalty updated" });
  } catch (error) {
    return next(error);
  }
});

router.get("/:loanId/remarks", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const loanId = Number(req.params.loanId);
    const context = await loanContext(loanId);
    if (!context) {
      return res.status(404).json({ message: "Loan not found" });
    }
    assertBranchAccess(user, Number(context.branch_id ?? 0));

    const result = await query<{
      id: number;
      loan_id: number;
      remark_text: string;
      remark_category: string;
      created_at: string;
      created_by: string | null;
    }>(
      `SELECT
         lr.id,
         lr.loan_id,
         lr.remark_text,
         lr.remark_category,
         lr.created_at,
         COALESCE(u.username, 'System') AS created_by
       FROM loan_remarks lr
       LEFT JOIN users u ON u.id = lr.created_by
       WHERE lr.loan_id = $1
       ORDER BY lr.created_at DESC, lr.id DESC`,
      [loanId]
    );

    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        loanId: row.loan_id,
        remark: row.remark_text,
        remarkCategory: row.remark_category,
        createdAt: row.created_at,
        createdBy: row.created_by ?? "System"
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/:loanId/remarks", authenticate, authorize(["super_admin", "branch_admin", "staff"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const loanId = Number(req.params.loanId);
    const remark = String(req.body?.remark ?? "").trim();
    const category = normalizeRemarkCategory(typeof req.body?.remarkCategory === "string" ? req.body.remarkCategory : undefined);

    const context = await loanContext(loanId);
    if (!context) {
      return res.status(404).json({ message: "Loan not found" });
    }
    assertBranchAccess(user, Number(context.branch_id ?? 0));

    if (!remark) {
      return res.status(400).json({ message: "Remark is required" });
    }
    if (remark.length > 2000) {
      return res.status(400).json({ message: "Remark is too long" });
    }

    const created = await query<{ id: number }>(
      "INSERT INTO loan_remarks (loan_id, remark_text, remark_category, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
      [loanId, remark, category, user.id]
    );

    return res.status(201).json({
      id: created.rows[0].id,
      loanId,
      remark,
      remarkCategory: category,
      createdBy: user.username
    });
  } catch (error) {
    return next(error);
  }
});

export { router as loanRouter };
