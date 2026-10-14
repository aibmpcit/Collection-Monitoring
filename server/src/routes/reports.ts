import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { authenticate, authorize, type AuthedRequest } from "../middleware/auth.js";
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
      loan_account_no: string | null;
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
         l.loan_account_no,
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
          loanAccountNo: row.loan_account_no ?? "",
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

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});
const summaryFilters = z.object({
  from: date, to: date,
  branchId: z.coerce.number().int().positive().optional(),
  collectorId: z.coerce.number().int().positive().optional()
}).refine(value => value.from <= value.to);

// Same groupings as the PAR age filter on the Collections page.
export const PAR_BUCKETS = [
  { key: "current", label: "Current (0)", min: 0, max: 0 },
  { key: "1-30", label: "PAR 1-30", min: 1, max: 30 },
  { key: "31-60", label: "PAR 31-60", min: 31, max: 60 },
  { key: "61-90", label: "PAR 61-90", min: 61, max: 90 },
  { key: "91-180", label: "PAR 91-180", min: 91, max: 180 },
  { key: "181-365", label: "PAR 181-365", min: 181, max: 365 },
  { key: "over-365", label: "PAR over 365", min: 366, max: null }
] as const;
const parBucketSql = `CASE ${PAR_BUCKETS.map(bucket => bucket.max === null
  ? `WHEN l.par_age >= ${bucket.min} THEN '${bucket.key}'`
  : `WHEN l.par_age BETWEEN ${bucket.min} AND ${bucket.max} THEN '${bucket.key}'`).join(" ")} ELSE 'current' END`;

router.get("/summary", authenticate, authorize(["super_admin", "branch_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const user = getRequestUser(req);
    const parsed = summaryFilters.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid report filters or date range" });
    const { from, to, collectorId } = parsed.data;
    const branchId = isSuperAdmin(user) ? parsed.data.branchId : userBranchId(user);

    // $1/$2 are the date range, followed by the branch and collector when present.
    const params: unknown[] = [from, to];
    const scoped = branchId !== undefined;
    if (scoped) params.push(branchId);
    const branchFilter = scoped ? `AND b.branch_id = $${params.length}` : "";
    if (collectorId) params.push(collectorId);
    const collectorIndex = params.length;
    const loanBranchParams = scoped ? [branchId] : [];
    const loanBranchFilter = scoped ? "AND b.branch_id = $1" : "";
    const collectionSource = `FROM collections c
      JOIN loans l ON l.id = c.loan_id
      JOIN borrowers b ON b.id = l.borrower_id
      WHERE c.collected_at >= $1 AND c.collected_at < DATE_ADD($2, INTERVAL 1 DAY) ${branchFilter}
      ${collectorId ? `AND c.created_by = $${collectorIndex}` : ""}`;
    const remarkSource = `FROM (
        SELECT r.remark_category, r.created_by, r.created_at, b.id AS member_id, b.branch_id
        FROM loan_remarks r JOIN loans l ON l.id = r.loan_id JOIN borrowers b ON b.id = l.borrower_id
        UNION ALL
        SELECT r.remark_category, r.created_by, r.created_at, b.id, b.branch_id
        FROM borrower_remarks r JOIN borrowers b ON b.id = r.borrower_id
      ) b
      WHERE b.created_at >= $1 AND b.created_at < DATE_ADD($2, INTERVAL 1 DAY) ${branchFilter}
      ${collectorId ? `AND b.created_by = $${collectorIndex}` : ""}`;

    const [totals, remarkTotals, portfolio, byBranch, byCollector, byDay, byCategory, parCollected, parPortfolio] = await Promise.all([
      query<{ amount: number; payments: number; members: number; loans: number }>(
        `SELECT COALESCE(SUM(c.amount), 0) AS amount, COUNT(*) AS payments,
           COUNT(DISTINCT b.id) AS members, COUNT(DISTINCT l.id) AS loans ${collectionSource}`, params),
      query<{ remarks: number; members: number }>(
        `SELECT COUNT(*) AS remarks, COUNT(DISTINCT b.member_id) AS members ${remarkSource}`, params),
      query<{ status: string; loans: number; balance: number }>(
        `SELECT l.status, COUNT(*) AS loans, COALESCE(SUM(l.loan_balance), 0) AS balance
         FROM loans l JOIN borrowers b ON b.id = l.borrower_id
         WHERE 1 = 1 ${loanBranchFilter}
         GROUP BY l.status`, loanBranchParams),
      query<{ branch_id: number | null; branch_name: string | null; amount: number; payments: number; members: number }>(
        `SELECT b.branch_id, br.name AS branch_name, COALESCE(SUM(c.amount), 0) AS amount,
           COUNT(*) AS payments, COUNT(DISTINCT b.id) AS members
         ${collectionSource.replace("WHERE", "LEFT JOIN branches br ON br.id = b.branch_id WHERE")}
         GROUP BY b.branch_id, br.name ORDER BY amount DESC`, params),
      query<{ user_id: number | null; username: string | null; role: string | null; amount: number; payments: number; members: number }>(
        `SELECT c.created_by AS user_id, u.username, u.role, COALESCE(SUM(c.amount), 0) AS amount,
           COUNT(*) AS payments, COUNT(DISTINCT b.id) AS members
         ${collectionSource.replace("WHERE", "LEFT JOIN users u ON u.id = c.created_by WHERE")}
         GROUP BY c.created_by, u.username, u.role ORDER BY amount DESC`, params),
      query<{ day: string; amount: number; payments: number }>(
        `SELECT DATE_FORMAT(c.collected_at, '%Y-%m-%d') AS day, COALESCE(SUM(c.amount), 0) AS amount, COUNT(*) AS payments
         ${collectionSource}
         GROUP BY day ORDER BY day ASC`, params),
      query<{ category: string; remarks: number; members: number }>(
        `SELECT b.remark_category AS category, COUNT(*) AS remarks, COUNT(DISTINCT b.member_id) AS members
         ${remarkSource}
         GROUP BY b.remark_category ORDER BY remarks DESC`, params),
      query<{ bucket: string; members: number; payments: number; amount: number }>(
        `SELECT ${parBucketSql} AS bucket, COUNT(DISTINCT b.id) AS members, COUNT(*) AS payments,
           COALESCE(SUM(c.amount), 0) AS amount
         ${collectionSource}
         GROUP BY bucket`, params),
      query<{ bucket: string; members: number; loans: number }>(
        `SELECT ${parBucketSql} AS bucket, COUNT(DISTINCT b.id) AS members, COUNT(*) AS loans
         FROM loans l JOIN borrowers b ON b.id = l.borrower_id
         WHERE l.status != 'closed' ${loanBranchFilter}
         GROUP BY bucket`, loanBranchParams)
    ]);

    const statusTotals = (status: string) => portfolio.rows.find(row => row.status === status);
    const total = totals.rows[0];
    const remarks = remarkTotals.rows[0];
    return res.json({
      from, to, branchId: branchId ?? null, collectorId: collectorId ?? null,
      summary: {
        collected: toNumber(total?.amount ?? 0),
        payments: toNumber(total?.payments ?? 0),
        membersPaid: toNumber(total?.members ?? 0),
        loansPaid: toNumber(total?.loans ?? 0),
        remarks: toNumber(remarks?.remarks ?? 0),
        membersFollowedUp: toNumber(remarks?.members ?? 0),
        activeLoans: toNumber(statusTotals("active")?.loans ?? 0),
        activeBalance: toNumber(statusTotals("active")?.balance ?? 0),
        overdueLoans: toNumber(statusTotals("overdue")?.loans ?? 0),
        overdueBalance: toNumber(statusTotals("overdue")?.balance ?? 0)
      },
      byBranch: byBranch.rows.map(row => ({
        branchId: row.branch_id, branchName: row.branch_name ?? "No branch",
        amount: toNumber(row.amount), payments: toNumber(row.payments), members: toNumber(row.members)
      })),
      byCollector: byCollector.rows.map(row => ({
        userId: row.user_id, username: row.username ?? "Unattributed", role: row.role ?? "",
        amount: toNumber(row.amount), payments: toNumber(row.payments), members: toNumber(row.members)
      })),
      byDay: byDay.rows.map(row => ({ day: row.day, amount: toNumber(row.amount), payments: toNumber(row.payments) })),
      byCategory: byCategory.rows.map(row => ({ category: row.category, remarks: toNumber(row.remarks), members: toNumber(row.members) })),
      byParAge: PAR_BUCKETS.map(bucket => {
        const collected = parCollected.rows.find(row => row.bucket === bucket.key);
        const open = parPortfolio.rows.find(row => row.bucket === bucket.key);
        return {
          bucket: bucket.key, label: bucket.label,
          membersCollected: toNumber(collected?.members ?? 0),
          payments: toNumber(collected?.payments ?? 0),
          amount: toNumber(collected?.amount ?? 0),
          openMembers: toNumber(open?.members ?? 0),
          openLoans: toNumber(open?.loans ?? 0)
        };
      })
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/users", authenticate, authorize(["super_admin"]), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = summaryFilters.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid report filters or date range" });
    const { from, to, branchId } = parsed.data;
    const params: unknown[] = [from, to];
    if (branchId) params.push(branchId);
    const inRange = (column: string) => `${column} >= $1 AND ${column} < DATE_ADD($2, INTERVAL 1 DAY)`;

    const result = await query<{
      id: number; username: string; role: string; branch_name: string | null;
      logins: number | null; visits: number | null; screen_seconds: number | null; last_seen_at: string | null;
      payments: number | null; collected: number | null; remarks: number | null;
    }>(
      `SELECT u.id, u.username, u.role, br.name AS branch_name,
         a.logins, a.visits, a.screen_seconds, a.last_seen_at,
         p.payments, p.collected, r.remarks
       FROM users u
       LEFT JOIN branches br ON br.id = u.branch_id
       LEFT JOIN (
         SELECT user_id, SUM(logins) AS logins, SUM(visits) AS visits,
           SUM(screen_seconds) AS screen_seconds, MAX(last_seen_at) AS last_seen_at
         FROM user_activity_daily WHERE day BETWEEN $1 AND $2 GROUP BY user_id
       ) a ON a.user_id = u.id
       LEFT JOIN (
         SELECT created_by, COUNT(*) AS payments, SUM(amount) AS collected
         FROM collections WHERE ${inRange("collected_at")} GROUP BY created_by
       ) p ON p.created_by = u.id
       LEFT JOIN (
         SELECT created_by, COUNT(*) AS remarks FROM (
           SELECT created_by, created_at FROM loan_remarks
           UNION ALL
           SELECT created_by, created_at FROM borrower_remarks
         ) all_remarks WHERE ${inRange("created_at")} GROUP BY created_by
       ) r ON r.created_by = u.id
       ${branchId ? "WHERE u.branch_id = $3" : ""}
       ORDER BY u.username ASC`,
      params
    );

    const users = result.rows.map(row => {
      const payments = toNumber(row.payments ?? 0);
      const remarks = toNumber(row.remarks ?? 0);
      return {
        id: row.id, username: row.username, role: row.role, branchName: row.branch_name ?? "No branch",
        logins: toNumber(row.logins ?? 0), visits: toNumber(row.visits ?? 0),
        screenSeconds: toNumber(row.screen_seconds ?? 0), lastSeenAt: row.last_seen_at,
        payments, remarks, actions: payments + remarks, collected: toNumber(row.collected ?? 0)
      };
    });
    const byRole: Record<string, number> = {};
    users.forEach(user => { byRole[user.role] = (byRole[user.role] ?? 0) + 1; });

    return res.json({
      totals: {
        users: users.length,
        byRole,
        activeUsers: users.filter(user => user.logins + user.visits + user.screenSeconds + user.actions > 0).length,
        logins: users.reduce((sum, user) => sum + user.logins, 0),
        visits: users.reduce((sum, user) => sum + user.visits, 0),
        screenSeconds: users.reduce((sum, user) => sum + user.screenSeconds, 0)
      },
      users
    });
  } catch (error) {
    return next(error);
  }
});

export { router as reportsRouter };
