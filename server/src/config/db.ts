import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
import "./env.js";

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface QueryClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

let db: Pool | null = null;

function mysqlQuery(text: string, params: unknown[]) {
  const ordered: unknown[] = [];
  const normalized = text
    .replace(/=\s*ANY\(\$(\d+)::(?:text|int)\[\]\)/gi, "IN ($$$1)")
    .replace(/::(?:text|int|boolean)/gi, "")
    .replace(/\s+RETURNING\s+[\s\S]+$/i, "");
  const sql = normalized.replace(/\$(\d+)/g, (_match, index: string) => {
    const value = params[Number(index) - 1];
    if (Array.isArray(value)) {
      if (value.length === 0) return "NULL";
      ordered.push(...value);
      return value.map(() => "?").join(", ");
    }
    ordered.push(value);
    return "?";
  });
  return { sql, params: ordered };
}

async function run<T>(executor: Pool | PoolConnection, text: string, params: unknown[] = []): Promise<QueryResult<T>> {
  const converted = mysqlQuery(text, params);
  const [result] = await executor.query(converted.sql, converted.params);
  if (Array.isArray(result)) {
    const rows = result as (T & RowDataPacket)[];
    return { rows, rowCount: rows.length };
  }
  const header = result as ResultSetHeader;
  const rows = /\bRETURNING\b/i.test(text) && header.insertId
    ? ([{ id: header.insertId }] as T[])
    : [];
  return { rows, rowCount: header.affectedRows };
}

function getDb() {
  if (db) {
    return db;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  db = mysql.createPool({ uri: connectionString, connectionLimit: 10, dateStrings: true, decimalNumbers: true });

  return db;
}

export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  return run<T>(getDb(), text, params);
}

export async function withTransaction<T>(handler: (client: QueryClient) => Promise<T>): Promise<T> {
  const connection = await getDb().getConnection();
  const client: QueryClient = { query: (text, params = []) => run(connection, text, params) };
  try {
    await connection.beginTransaction();
    const result = await handler(client);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function closeDatabase() {
  if (!db) return;
  await db.end();
  db = null;
}
