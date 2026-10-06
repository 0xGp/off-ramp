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

const shutdown = async () => {
  await runner.stop();
  await db.end();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await runner.promise;
