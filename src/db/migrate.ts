import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createPool, withTransaction, type Db } from "./pool.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));
// Serializes concurrent migrators (e.g. api and worker starting together).
const LOCK_ID = 7_243_001;

/** Applies pending `migrations/*.sql` in filename order, each in its own transaction. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];

  await withTransaction(db, async (client) => {
    await client.query("select pg_advisory_xact_lock($1)", [LOCK_ID]);
    const done = new Set(
      (await client.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name),
    );
    for (const file of files) {
      if (done.has(file)) continue;
      await client.query(await readFile(`${MIGRATIONS_DIR}${file}`, "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      applied.push(file);
    }
  });

  return applied;
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const db = createPool(url);
  try {
    const applied = await migrate(db);
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Up to date");
  } finally {
    await db.end();
  }
}
