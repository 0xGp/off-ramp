import pg from "pg";

export type Db = pg.Pool;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // An idle client dropping (e.g. Postgres restart) must not crash the process; the pool reconnects.
  pool.on("error", (error) => console.error("postgres pool error:", error.message));
  return pool;
}

export async function withTransaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
