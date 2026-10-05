import type { TaskList } from "graphile-worker";

interface BankAccountChanged {
  userId: string;
  bankAccountId: string;
  replacedId: string | null;
  institutionCode: string;
  accountLast4: string;
  usableFrom: string;
}

export const tasks: TaskList = {
  // Email delivery is not wired yet (provider undecided); the job records the alert so it
  // is retried and visible until then. Only the last 4 digits are ever logged.
  bank_account_changed: async (payload, helpers) => {
    const event = payload as BankAccountChanged;
    helpers.logger.info(
      `bank account ${event.replacedId ? "replaced" : "added"} for user ${event.userId}: ` +
        `${event.institutionCode} ••••${event.accountLast4}, usable from ${event.usableFrom}`,
    );
  },
};
