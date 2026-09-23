import fs from "node:fs";
import { parse } from "dotenv";
import { Client } from "pg";
import mysql from "mysql2/promise";

const sourceEnv = parse(fs.readFileSync(".env"));
const localEnv = parse(fs.readFileSync(".env.local"));
const sourceUrl = process.env.SOURCE_DATABASE_URL || sourceEnv.DATABASE_URL;
const targetUrl = process.env.MYSQL_DATABASE_URL || localEnv.DATABASE_URL;
if (!sourceUrl?.startsWith("postgres")) throw new Error("Source .env DATABASE_URL must be PostgreSQL");
if (!targetUrl?.startsWith("mysql")) throw new Error("Target .env.local DATABASE_URL must be MySQL");

const tables: Array<[string, string[]]> = [
  ["branches", ["id", "code", "name", "address", "created_at"]],
  ["users", ["id", "username", "password_hash", "role", "branch_id", "created_at"]],
  ["borrowers", ["id", "cif_key", "branch_id", "member_name", "contact_info", "address", "name", "phone", "email", "created_at"]],
  ["loans", ["id", "borrower_id", "loan_account_no", "loan_type", "date_release", "maturity_date", "loan_amount", "principal_due", "penalty_due", "other_charges", "par_age", "notes", "principal", "interest", "penalty", "due_date", "status", "created_at"]],
  ["collections", ["id", "loan_id", "amount", "or_no", "collected_at", "created_by"]],
  ["loan_remarks", ["id", "loan_id", "remark_text", "remark_category", "created_by", "created_at"]],
  ["borrower_remarks", ["id", "borrower_id", "remark_text", "remark_category", "created_by", "created_at"]]
];

const source = new Client({ connectionString: sourceUrl });
const target = await mysql.createConnection({ uri: targetUrl, dateStrings: true });
await source.connect();
try {
  await target.beginTransaction();
  await target.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const [table, columns] of tables) {
    const result = await source.query(`SELECT ${columns.join(", ")} FROM ${table} ORDER BY id`);
    for (const row of result.rows) {
      const placeholders = columns.map(() => "?").join(", ");
      const updates = columns.filter((column) => column !== "id")
        .map((column) => `${column} = VALUES(${column})`).join(", ");
      await target.query(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`,
        columns.map((column) => row[column])
      );
    }
    console.log(`${table}: ${result.rowCount} rows copied`);
  }
  await target.query("SET FOREIGN_KEY_CHECKS = 1");
  await target.commit();
} catch (error) {
  await target.rollback();
  throw error;
} finally {
  await source.end();
  await target.end();
}
