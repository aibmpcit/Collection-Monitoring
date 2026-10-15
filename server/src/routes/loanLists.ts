import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { authenticate, authorize, type AuthedRequest } from "../middleware/auth.js";
import { getRequestUser, isSuperAdmin, PAYMENT_STATUSES, REMARK_CATEGORIES, toNumber, userBranchId } from "../services/access.js";
import { mapLoanRow } from "../services/loanRows.js";
import { PAR_BUCKET_KEYS, parBucketCondition } from "../services/parBuckets.js";

// Server-side paged lists for Collections, Dashboard, Due Monitoring and member history.
const router = Router();

const IMPORT_RUN_SELECT = `SELECT r.id, r.branch_id, r.uploaded_at, r.file_name, r.rows_in_file, r.inserted, r.updated, r.reopened,
    r.closed, r.skipped, r.remarks_imported, u.username, br.code AS branch_code, br.name AS branch_name
  FROM loan_import_runs r
  LEFT JOIN users u ON u.id = r.uploaded_by
  LEFT JOIN branches br ON br.id = r.branch_id`;

/** Recent loan uploads for the user's branch (super admins: one branch or all). */
router.get("/imports", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const parsed = z.object({
      branchId: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20)
    }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid filters" });
    const branchId = isSuperAdmin(user) ? parsed.data.branchId : userBranchId(user);
    const runs = await query<Record<string, unknown>>(
      `${IMPORT_RUN_SELECT} ${branchId !== undefined ? "WHERE r.branch_id = $1" : ""}
       ORDER BY r.uploaded_at DESC, r.id DESC LIMIT ${parsed.data.limit}`,
      branchId !== undefined ? [branchId] : []
    );
    return res.json(runs.rows.map(row => ({
      id: Number(row.id), branchId: Number(row.branch_id),
      branch: row.branch_code ? `${row.branch_code} - ${row.branch_name ?? ""}` : "",
      uploadedAt: String(row.uploaded_at ?? ""), uploadedBy: String(row.username ?? ""), fileName: String(row.file_name ?? ""),
      rowsInFile: Number(row.rows_in_file ?? 0), inserted: Number(row.inserted ?? 0), updated: Number(row.updated ?? 0),
      reopened: Number(row.reopened ?? 0), closed: Number(row.closed ?? 0), skipped: Number(row.skipped ?? 0),
      remarksImported: Number(row.remarks_imported ?? 0)
    })));
  } catch (error) {
    return next(error);
  }
});

const LOAN_LIST_COLUMNS = `
         l.id,
         l.borrower_id,
         b.branch_id,
         l.loan_account_no,
         l.loan_type,
         l.date_release,
         l.maturity_date,
         l.loan_amount,
         l.loan_balance,
         l.principal_due,
         l.penalty_due,
         l.other_charges,
         l.total,
         l.par_age,
         l.notes,
         l.principal,
         l.interest,
         l.penalty,
         l.due_date,
         l.status,
         l.action_status,
         l.action_status_at,
         asu.username AS action_status_by_name,
         l.closed_reason,
         l.closed_at,
         DATE_FORMAT(l.created_at, '%Y-%m-%dT%H:%i:%s') AS imported_at,
         recent.latest_remark_1,
         recent.latest_remark_category_1,
         recent.latest_remark_2,
         recent.latest_remark_category_2,
         b.cif_key,
         b.member_name,
         b.contact_info,
         b.address`;

// Two newest remarks per loan in one pass instead of four lookups per loan.
const RECENT_REMARKS_JOIN = `
       LEFT JOIN (
         SELECT ranked.loan_id,
           MAX(CASE WHEN ranked.position = 1 THEN ranked.remark_text END) AS latest_remark_1,
           MAX(CASE WHEN ranked.position = 1 THEN ranked.remark_category END) AS latest_remark_category_1,
           MAX(CASE WHEN ranked.position = 2 THEN ranked.remark_text END) AS latest_remark_2,
           MAX(CASE WHEN ranked.position = 2 THEN ranked.remark_category END) AS latest_remark_category_2
         FROM (
           SELECT lr.loan_id, lr.remark_text, lr.remark_category,
             ROW_NUMBER() OVER (PARTITION BY lr.loan_id ORDER BY lr.created_at DESC, lr.id DESC) AS position
           FROM loan_remarks lr
           WHERE lr.loan_id IN (SELECT id FROM page_loans)
         ) ranked
         WHERE ranked.position <= 2
         GROUP BY ranked.loan_id
       ) recent ON recent.loan_id = l.id`;

function mapLoanListRow(row: Record<string, unknown>) {
  return {
    ...mapLoanRow(row),
    branchId: Number(row.branch_id ?? 0),
    cifKey: String(row.cif_key ?? ""),
    memberName: String(row.member_name ?? ""),
    contactInfo: String(row.contact_info ?? ""),
    address: String(row.address ?? ""),
    latestRemarks: [
      { remark: row.latest_remark_1, remarkCategory: row.latest_remark_category_1 },
      { remark: row.latest_remark_2, remarkCategory: row.latest_remark_category_2 }
    ]
      .filter((item) => item.remark != null && String(item.remark).trim() !== "")
      .map((item) => ({
        remark: String(item.remark),
        remarkCategory: String(item.remarkCategory ?? "others")
      }))
  };
}

const loanListFilters = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(120).optional(),
  loanType: z.string().trim().max(120).optional(),
  parAge: z.enum(PAR_BUCKET_KEYS).optional(),
  // A field status, or "none" for loans nobody has acted on yet.
  actionStatus: z.enum([...PAYMENT_STATUSES, "none"]).optional(),
  branchId: z.coerce.number().int().positive().optional(),
  borrowerId: z.coerce.number().int().positive().optional(),
  includeClosed: z.literal("true").optional(),
  // Settled Accounts: loans closed because they were not in their branch's latest upload.
  settled: z.literal("true").optional(),
  idsOnly: z.literal("true").optional()
});

/**
 * Lists loans visible to the user.
 * - With `page`: one page of open loans matching the filters, plus filter options for the page.
 * - With `idsOnly=true`: every matching id, for "select all matching" actions.
 * - Otherwise: every matching loan in any status (used for a single member's history).
 */
router.get("/", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const parsed = loanListFilters.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid loan filters" });
    const filter = parsed.data;
    const paged = filter.page !== undefined || filter.idsOnly === "true";

    const params: unknown[] = [];
    const scope: string[] = [];
    const add = (target: string[], expression: string, value: unknown) => {
      params.push(value);
      target.push(expression.replace("?", `$${params.length}`));
    };
    if (!isSuperAdmin(user)) add(scope, "b.branch_id = ?", userBranchId(user));
    if (isSuperAdmin(user) && filter.branchId) add(scope, "b.branch_id = ?", filter.branchId);

    const conditions = [...scope];
    if (filter.settled === "true") conditions.push("l.status = 'closed' AND l.closed_reason = 'not_in_import'");
    else if (paged && filter.includeClosed !== "true") conditions.push("l.status != 'closed'");
    if (filter.borrowerId) add(conditions, "l.borrower_id = ?", filter.borrowerId);
    if (filter.loanType) add(conditions, "l.loan_type = ?", filter.loanType);
    if (filter.parAge) conditions.push(parBucketCondition(filter.parAge));
    if (filter.actionStatus === "none") conditions.push("l.action_status IS NULL");
    else if (filter.actionStatus) add(conditions, "l.action_status = ?", filter.actionStatus);
    if (filter.search) {
      add(conditions, `LOCATE(?, CONCAT_WS(' ', b.cif_key, l.loan_account_no, b.member_name, l.loan_type, l.status,
        b.contact_info, b.address, l.notes)) > 0`, filter.search);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const order = filter.settled === "true"
      ? "ORDER BY l.closed_at DESC, COALESCE(b.member_name, ''), l.id"
      : paged
        ? "ORDER BY COALESCE(b.member_name, ''), COALESCE(l.loan_account_no, ''), l.id"
        : "ORDER BY l.id DESC";
    const matching = `FROM loans l INNER JOIN borrowers b ON b.id = l.borrower_id ${where}`;

    if (filter.idsOnly === "true") {
      const ids = await query<{ id: number }>(`SELECT l.id ${matching} ${order}`, params);
      return res.json({ ids: ids.rows.map(row => Number(row.id)) });
    }

    const pageSize = filter.pageSize;
    let page = 1;
    let total = 0;
    let limit = "";
    if (paged) {
      const counted = await query<{ total: number }>(`SELECT COUNT(*) AS total ${matching}`, params);
      total = Number(counted.rows[0]?.total ?? 0);
      page = Math.min(filter.page ?? 1, Math.max(1, Math.ceil(total / pageSize)));
      limit = `LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    }

    // Rank remarks only for the loans on this page.
    const result = await query(
      `WITH page_loans AS (SELECT l.id ${matching} ${order} ${limit})
       SELECT ${LOAN_LIST_COLUMNS}
       FROM page_loans pl
       INNER JOIN loans l ON l.id = pl.id
       INNER JOIN borrowers b ON b.id = l.borrower_id
       LEFT JOIN users asu ON asu.id = l.action_status_by
       ${RECENT_REMARKS_JOIN}
       ${order}`,
      params
    );
    const items = result.rows.map(mapLoanListRow);
    if (!paged) return res.json(items);

    // Filter options follow the branch scope only, so choosing one option never hides the others.
    const scopeParams = params.slice(0, scope.length);
    const scopeWhere = scope.length ? `WHERE ${scope.join(" AND ")}` : "";
    // Branch scope is the only scope condition, so its single parameter carries over to upload runs.
    const runWhere = scope.length ? "WHERE r.branch_id = $1" : "";
    const [types, imported, lastRun] = await Promise.all([
      query<{ loan_type: string }>(
        `SELECT DISTINCT TRIM(l.loan_type) AS loan_type FROM loans l INNER JOIN borrowers b ON b.id = l.borrower_id
         ${scopeWhere ? `${scopeWhere} AND` : "WHERE"} TRIM(COALESCE(l.loan_type, '')) != '' ORDER BY loan_type`, scopeParams),
      query<{ latest: string | null }>(
        `SELECT DATE_FORMAT(MAX(l.created_at), '%Y-%m-%dT%H:%i:%s') AS latest FROM loans l INNER JOIN borrowers b ON b.id = l.borrower_id ${scopeWhere}`,
        scopeParams),
      query<{ uploaded_at: string; file_name: string | null; username: string | null; branch_code: string | null; branch_name: string | null }>(
        `${IMPORT_RUN_SELECT} ${runWhere} ORDER BY r.uploaded_at DESC, r.id DESC LIMIT 1`,
        scopeParams)
    ]);
    const run = lastRun.rows[0];

    return res.json({
      items, total, page, pageSize,
      loanTypes: types.rows.map(row => row.loan_type),
      latestImportedAt: imported.rows[0]?.latest ?? "",
      lastImport: run ? {
        uploadedAt: run.uploaded_at, fileName: run.file_name ?? "", uploadedBy: run.username ?? "",
        branch: run.branch_code ? `${run.branch_code} - ${run.branch_name ?? ""}` : ""
      } : null
    });
  } catch (error) {
    return next(error);
  }
});

const remarkedFilters = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(120).optional(),
  // Category keys whose display label matches the search; labels live in the client.
  categories: z.string().max(2000).optional(),
  branchId: z.coerce.number().int().positive().optional(),
  idsOnly: z.literal("true").optional()
});

/** Open loans that have remarks, one row per loan with its two newest remarks, for the Remarks tab. */
router.get("/remarked", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const parsed = remarkedFilters.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid remark filters" });
    const filter = parsed.data;
    const params: unknown[] = [];
    const conditions = ["l.status != 'closed'"];
    const remarkConditions = ["r.loan_id = l.id", "TRIM(r.remark_text) != ''"];
    const add = (target: string[], expression: string, value: unknown) => {
      params.push(value);
      target.push(expression.replace("?", `$${params.length}`));
    };
    if (!isSuperAdmin(user)) add(conditions, "b.branch_id = ?", userBranchId(user));
    if (isSuperAdmin(user) && filter.branchId) add(conditions, "b.branch_id = ?", filter.branchId);
    if (filter.search) {
      const matches: string[] = [];
      add(matches, "LOCATE(?, CONCAT_WS(' ', b.member_name, l.loan_account_no, l.loan_type, r.remark_text, u.username)) > 0", filter.search);
      const categories = (filter.categories ?? "").split(",").map(value => value.trim()).filter(value => REMARK_CATEGORIES.has(value));
      if (categories.length) add(matches, "r.remark_category IN (?)", categories);
      remarkConditions.push(`(${matches.join(" OR ")})`);
    }
    const matching = `FROM loans l INNER JOIN borrowers b ON b.id = l.borrower_id
      WHERE ${conditions.join(" AND ")} AND EXISTS (
        SELECT 1 FROM loan_remarks r LEFT JOIN users u ON u.id = r.created_by WHERE ${remarkConditions.join(" AND ")})`;
    const order = "ORDER BY COALESCE(b.member_name, ''), COALESCE(l.loan_account_no, ''), l.id";

    if (filter.idsOnly === "true") {
      const ids = await query<{ id: number }>(`SELECT l.id ${matching} ${order}`, params);
      return res.json({ ids: ids.rows.map(row => Number(row.id)) });
    }

    const counted = await query<{ total: number }>(`SELECT COUNT(*) AS total ${matching}`, params);
    const total = Number(counted.rows[0]?.total ?? 0);
    const pageSize = filter.pageSize;
    const page = Math.min(filter.page, Math.max(1, Math.ceil(total / pageSize)));
    const loans = await query<{ id: number; branch_id: number | null; loan_account_no: string | null; loan_type: string | null;
      status: string; borrower_id: number; member_name: string | null }>(
      `SELECT l.id, b.branch_id, l.loan_account_no, l.loan_type, l.status, l.borrower_id, COALESCE(b.member_name, b.name) AS member_name
       ${matching} ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );

    const loanIds = loans.rows.map(row => Number(row.id));
    const remarks = loanIds.length ? await query<{ id: number; loan_id: number; remark_text: string; remark_category: string;
      created_at: string; collector_name: string | null; position: number }>(
      `SELECT ranked.* FROM (
         SELECT r.id, r.loan_id, r.remark_text, r.remark_category, r.created_at, u.username AS collector_name,
           ROW_NUMBER() OVER (PARTITION BY r.loan_id ORDER BY r.created_at DESC, r.id DESC) AS position
         FROM loan_remarks r LEFT JOIN users u ON u.id = r.created_by
         WHERE r.loan_id IN ($1) AND TRIM(r.remark_text) != ''
       ) ranked WHERE ranked.position <= 2`,
      [loanIds]
    ) : { rows: [] };

    const items = loans.rows.map(loan => {
      const recent = remarks.rows
        .filter(remark => Number(remark.loan_id) === Number(loan.id))
        .sort((a, b) => Number(a.position) - Number(b.position))
        .map(remark => ({
          id: Number(remark.id), kind: "loan_remark" as const, loan_id: Number(loan.id),
          loan_account_no: loan.loan_account_no, category: remark.remark_category, remark: remark.remark_text,
          collector_name: remark.collector_name, occurred_at: remark.created_at
        }));
      const latest = recent[0];
      return {
        ...latest,
        branch_id: Number(loan.branch_id ?? 0), loan_type: loan.loan_type, loan_status: loan.status,
        member_id: Number(loan.borrower_id), member_name: loan.member_name ?? "",
        recentRemarks: recent
      };
    }).filter(item => item.id !== undefined);

    return res.json({ items, total, page, pageSize });
  } catch (error) {
    return next(error);
  }
});

/** Every remark id on the given loans the user may manage, so "delete selected" covers older remarks too. */
router.post("/remarked/remark-ids", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const parsed = z.object({ loanIds: z.array(z.number().int().positive()).min(1).max(10000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Valid loan ids are required" });
    const params: unknown[] = [parsed.data.loanIds];
    let branchFilter = "";
    if (!isSuperAdmin(user)) {
      params.push(userBranchId(user));
      branchFilter = "AND b.branch_id = $2";
    }
    const result = await query<{ id: number }>(
      `SELECT r.id FROM loan_remarks r JOIN loans l ON l.id = r.loan_id JOIN borrowers b ON b.id = l.borrower_id
       WHERE r.loan_id IN ($1) ${branchFilter}`,
      params
    );
    return res.json({ ids: result.rows.map(row => Number(row.id)) });
  } catch (error) {
    return next(error);
  }
});

const dueSoonFilters = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(8)
});

/** Open loans maturing today or later, soonest first, for Dashboard and Due Monitoring. */
router.get("/due-soon", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const parsed = dueSoonFilters.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid page" });
    const { pageSize } = parsed.data;
    const params: unknown[] = [];
    const branchFilter = isSuperAdmin(user) ? "" : "AND b.branch_id = $1";
    if (!isSuperAdmin(user)) params.push(userBranchId(user));
    const source = `FROM loans l INNER JOIN borrowers b ON b.id = l.borrower_id
      WHERE l.status != 'closed' AND COALESCE(l.maturity_date, l.due_date) >= CURRENT_DATE ${branchFilter}`;
    const outstanding = "COALESCE(l.principal_due, l.principal) + l.interest + COALESCE(l.penalty_due, l.penalty) + COALESCE(l.other_charges, 0)";

    const counted = await query<{ total: number }>(`SELECT COUNT(*) AS total ${source}`, params);
    const total = Number(counted.rows[0]?.total ?? 0);
    const page = Math.min(parsed.data.page, Math.max(1, Math.ceil(total / pageSize)));
    const rows = await query(
      `SELECT l.*, b.member_name, b.branch_id,
         DATEDIFF(COALESCE(l.maturity_date, l.due_date), CURRENT_DATE) AS days_until_due,
         ${outstanding} AS outstanding
       ${source}
       ORDER BY days_until_due ASC, outstanding DESC, l.id ASC
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );

    return res.json({
      items: rows.rows.map(row => ({
        ...mapLoanRow(row),
        memberName: String(row.member_name ?? ""),
        daysUntilDue: Number(row.days_until_due ?? 0),
        outstanding: toNumber(row.outstanding ?? 0)
      })),
      total, page, pageSize
    });
  } catch (error) {
    return next(error);
  }
});

export { router as loanListRouter };
