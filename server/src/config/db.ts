import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import "./env.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const needsSsl = /sslmode=require/i.test(connectionString) || connectionString.includes("supabase.co");

export const db = new Pool({
  connectionString,
  ssl: needsSsl
    ? {
        rejectUnauthorized: false
      }
    : undefined
});

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  return db.query<T>(text, params);
}

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type { PoolClient, QueryResult };
