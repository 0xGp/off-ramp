import { loadConfig } from "../config.ts";
import { createServices, prepareDatabase } from "../runtime.ts";
import { buildApp } from "./app.ts";

const config = loadConfig();
const services = createServices(config);
await prepareDatabase(services.db);

const app = await buildApp({
  ...services,
  corsOrigins: config.CORS_ORIGINS,
  paycrestWebhookSecret: config.PAYCREST_API_SECRET,
  trustProxy: config.TRUST_PROXY,
});

const shutdown = async () => {
  await app.close();
  await services.db.end();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
