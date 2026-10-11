import { run } from "graphile-worker";

import { loadConfig } from "../config.ts";
import { createServices, prepareDatabase } from "../runtime.ts";
import { createTasks } from "./tasks.ts";

const config = loadConfig();
const services = createServices(config);
const { db } = services;
await prepareDatabase(db);

const runner = await run({
  pgPool: db,
  concurrency: 5,
  pollInterval: 1000,
  taskList: createTasks({ payouts: services.payouts, funding: services.funding }),
});

const startedAt = new Date();
const beat = () =>
  db
    .query(
      `insert into service_heartbeats (name, pid, started_at, seen_at) values ('worker', $1, $2, now())
       on conflict (name) do update set pid = excluded.pid, started_at = excluded.started_at, seen_at = now()`,
      [process.pid, startedAt],
    )
    .catch((error: unknown) => console.error("heartbeat failed", error));
await beat();
const heartbeat = setInterval(beat, 15_000);

const shutdown = async () => {
  clearInterval(heartbeat);
  await runner.stop();
  await db.end();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await runner.promise;
