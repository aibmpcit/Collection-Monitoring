import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import "./env.js";

let db: Pool | null = null;

function getDb() {
  if (db) {
    return db;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const needsSsl = /sslmode=require/i.test(connectionString) || connectionString.includes("supabase.co");

  db = new Pool({
    connectionString,
    ssl: needsSsl
      ? {
          rejectUnauthorized: false
        }
      : undefined
  });

  return db;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  return getDb().query<T>(text, params);
}

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDb().connect();
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
