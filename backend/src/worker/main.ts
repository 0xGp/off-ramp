import { run } from "graphile-worker";

import { createPool } from "../db/pool.ts";
import { prepareDatabase } from "../runtime.ts";
import { tasks } from "./tasks.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const db = createPool(url);
await prepareDatabase(db);

const runner = await run({ pgPool: db, concurrency: 5, pollInterval: 1000, taskList: tasks });

const shutdown = async () => {
  await runner.stop();
  await db.end();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await runner.promise;
