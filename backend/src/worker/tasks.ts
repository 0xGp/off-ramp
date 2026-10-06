import type { TaskList } from "graphile-worker";

import type { PayoutFunding } from "../payouts/funding.ts";
import type { PayoutService } from "../payouts/service.ts";

interface BankAccountChanged {
  userId: string;
  bankAccountId: string;
  replacedId: string | null;
  institutionCode: string;
  accountLast4: string;
  usableFrom: string;
}

const POLL_DELAY_MS = 5_000;
const SETTLE_DELAY_MS = 4_000;
/** About two hours of polling before a payout is handed to a human. */
const MAX_POLLS = 1_440;

const FUND_DELAY_MS = 3_000;

const after = (ms: number) => new Date(Date.now() + ms);

/** One serial queue for treasury transfers, so two never race for the same nonce. */
const fundJob = (payoutId: string) => ({ queueName: "treasury", jobKey: `fund:${payoutId}` });

export function createTasks(deps: { payouts: PayoutService; funding?: PayoutFunding | null }): TaskList {
  return {
    // Email delivery is not wired yet (provider undecided); the job records the alert so it
    // is retried and visible until then. Only the last 4 digits are ever logged.
    bank_account_changed: async (payload, helpers) => {
      const event = payload as BankAccountChanged;
      helpers.logger.info(
        `bank account ${event.replacedId ? "replaced" : "added"} for user ${event.userId}: ` +
          `${event.institutionCode} ••••${event.accountLast4}, usable from ${event.usableFrom}`,
      );
    },

    payout_start: async (payload, helpers) => {
      const { depositId } = payload as { depositId: string };
      const payoutId = await deps.payouts.start(depositId);
      helpers.logger.info(`payout ${payoutId} started for deposit ${depositId}`);
      if (deps.funding) await helpers.addJob("payout_fund", { payoutId }, fundJob(payoutId));
      await helpers.addJob("payout_poll", { payoutId, polls: 0 }, { runAt: after(POLL_DELAY_MS) });
    },

    payout_fund: async (payload, helpers) => {
      const { payoutId } = payload as { payoutId: string };
      if (!deps.funding) return;
      const result = await deps.funding.fund(payoutId);
      if (!result.done) {
        await helpers.addJob("payout_fund", { payoutId }, { ...fundJob(payoutId), runAt: after(FUND_DELAY_MS) });
        return;
      }
      const detail = "txHash" in result ? result.txHash : "reason" in result ? result.reason : "";
      const log = result.outcome === "funded" || result.outcome === "not-needed" ? helpers.logger.info : helpers.logger.warn;
      log.call(helpers.logger, `payout ${payoutId} funding ${result.outcome} ${detail}`.trim());
    },

    payout_poll: async (payload, helpers) => {
      const { payoutId, polls } = payload as { payoutId: string; polls: number };
      const result = await deps.payouts.poll(payoutId);
      if (result.done) {
        helpers.logger.info(`payout ${payoutId} ${result.status}; settling escrow`);
        // Same key as the webhook path, so a payout gets one settle job whichever reports first.
        await helpers.addJob("escrow_settle", { payoutId }, { jobKey: `settle:${payoutId}` });
        return;
      }
      if (polls + 1 >= MAX_POLLS) throw new Error(`payout ${payoutId} still pending after ${MAX_POLLS} polls`);
      await helpers.addJob("payout_poll", { payoutId, polls: polls + 1 }, { runAt: after(POLL_DELAY_MS) });
    },

    escrow_settle: async (payload, helpers) => {
      const { payoutId } = payload as { payoutId: string };
      const result = await deps.payouts.settle(payoutId);
      if (result.done) {
        helpers.logger.info(`payout ${payoutId}: escrow ${result.escrow}`);
        return;
      }
      await helpers.addJob("escrow_settle", { payoutId }, { runAt: after(SETTLE_DELAY_MS), jobKey: `settle:${payoutId}` });
    },
  };
}
