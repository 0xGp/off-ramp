// Confirms a deposit whose onchain transaction succeeded but whose in-app confirm failed,
// exactly as POST /v1/deposits/:id/confirm would. Confirming queues the payout, so it is a
// dry run unless --yes is passed.
// Usage: node --env-file=.env scripts/confirm-deposit.ts --id <deposit id> --tx <0x hash> [--yes]
import { parseArgs } from "node:util";

import { loadConfig } from "../src/config.ts";
import { createServices } from "../src/runtime.ts";
import type { User } from "../src/users/service.ts";

const { values } = parseArgs({ options: { id: { type: "string" }, tx: { type: "string" }, yes: { type: "boolean" } } });
if (!values.id || !/^0x[0-9a-fA-F]{64}$/.test(values.tx ?? "")) {
  throw new Error("usage: --id <deposit id> --tx <0x transaction hash> [--yes]");
}

const services = createServices(loadConfig());
try {
  const { rows } = await services.db.query<{ user_id: string; status: string; amount_units: string; chain_id: number }>(
    "select user_id, status, amount_units, chain_id from deposits where id = $1",
    [values.id],
  );
  const deposit = rows[0];
  if (!deposit) throw new Error(`deposit ${values.id} not found`);
  console.log(`deposit ${values.id}: ${deposit.status}, ${deposit.amount_units} units on chain ${deposit.chain_id}`);

  if (!values.yes) {
    console.log("dry run: pass --yes to confirm it and queue the payout");
  } else {
    const view = await services.deposits.confirm({ id: deposit.user_id } as User, values.id, values.tx as `0x${string}`);
    console.log(`now ${view.status}, tx ${view.txHash}; payout queued`);
  }
} finally {
  await services.db.end();
}
