import type { AuthClaims } from "../auth/privy.ts";
import { withTransaction, type Db } from "../db/pool.ts";
import type { FieldCipher } from "../lib/crypto.ts";
import { AppError } from "../lib/errors.ts";
import type { BankDirectory } from "../paycrest/client.ts";
import type { User } from "../users/service.ts";

export const NUBAN = /^\d{10}$/;

/** Never includes the full account number. */
export interface BankAccountView {
  id: string;
  institutionCode: string;
  institutionName: string;
  accountName: string;
  accountLast4: string;
  verifiedAt: string;
  usableFrom: string;
  usable: boolean;
}

interface BankAccountRow {
  id: string;
  institution_code: string;
  institution_name: string;
  account_name: string;
  account_last4: string;
  account_fingerprint: Buffer;
  verified_at: Date;
  usable_from: Date;
}

export interface BankAccountPolicy {
  /** A bank change needs a login at most this old, so a stolen long-lived session can't redirect payouts. */
  freshAuthSeconds: number;
  /** A replacement account can't receive payouts until this much time has passed. */
  changeCooldownHours: number;
}

export class BankAccountService {
  readonly #db: Db;
  readonly #directory: BankDirectory;
  readonly #cipher: FieldCipher;
  readonly #policy: BankAccountPolicy;
  readonly #now: () => Date;

  constructor(db: Db, directory: BankDirectory, cipher: FieldCipher, policy: BankAccountPolicy, now = () => new Date()) {
    this.#db = db;
    this.#directory = directory;
    this.#cipher = cipher;
    this.#policy = policy;
    this.#now = now;
  }

  #view(row: BankAccountRow): BankAccountView {
    return {
      id: row.id,
      institutionCode: row.institution_code,
      institutionName: row.institution_name,
      accountName: row.account_name,
      accountLast4: row.account_last4,
      verifiedAt: row.verified_at.toISOString(),
      usableFrom: row.usable_from.toISOString(),
      usable: row.usable_from.getTime() <= this.#now().getTime(),
    };
  }

  async #active(userId: string): Promise<BankAccountRow | null> {
    const { rows } = await this.#db.query<BankAccountRow>(
      `select id, institution_code, institution_name, account_name, account_last4, account_fingerprint,
              verified_at, usable_from
       from bank_accounts where user_id = $1 and status = 'active'`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async getActive(userId: string): Promise<BankAccountView | null> {
    const row = await this.#active(userId);
    return row ? this.#view(row) : null;
  }

  async #institution(code: string) {
    const institution = (await this.#directory.listInstitutions()).find((i) => i.code === code);
    if (!institution) throw new AppError("validation", "Choose a bank from the list.");
    return institution;
  }

  /** Name check only; nothing is stored. */
  async verify(institutionCode: string, accountNumber: string): Promise<{ accountName: string; institutionName: string }> {
    if (!NUBAN.test(accountNumber)) throw new AppError("validation", "Enter a 10-digit NUBAN account number.");
    const institution = await this.#institution(institutionCode);
    const accountName = await this.#directory.verifyAccount(institution.code, accountNumber);
    return { accountName, institutionName: institution.name };
  }

  async setActive(user: User, claims: AuthClaims, institutionCode: string, accountNumber: string): Promise<BankAccountView> {
    if (!NUBAN.test(accountNumber)) throw new AppError("validation", "Enter a 10-digit NUBAN account number.");

    const fingerprint = this.#cipher.fingerprint(institutionCode, accountNumber);
    const current = await this.#active(user.id);
    if (current?.account_fingerprint.equals(fingerprint)) return this.#view(current);

    const now = this.#now();
    if (current && now.getTime() / 1000 - claims.issuedAt > this.#policy.freshAuthSeconds) {
      throw new AppError("reauth-required", "Sign in again to change your bank account.");
    }

    const { accountName, institutionName } = await this.verify(institutionCode, accountNumber);
    const usableFrom = current ? new Date(now.getTime() + this.#policy.changeCooldownHours * 3_600_000) : now;

    const row = await withTransaction(this.#db, async (tx) => {
      if (current) {
        await tx.query(`update bank_accounts set status = 'replaced', replaced_at = $2 where id = $1`, [current.id, now]);
      }
      const inserted = await tx.query<BankAccountRow>(
        `insert into bank_accounts
           (user_id, institution_code, institution_name, account_name, account_last4,
            account_number_ciphertext, account_fingerprint, verified_at, usable_from, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
         returning id, institution_code, institution_name, account_name, account_last4, account_fingerprint,
                   verified_at, usable_from`,
        [
          user.id,
          institutionCode,
          institutionName,
          accountName,
          accountNumber.slice(-4),
          this.#cipher.encrypt(accountNumber),
          fingerprint,
          now,
          usableFrom,
        ],
      );
      const created = inserted.rows[0]!;
      const event = {
        bankAccountId: created.id,
        replacedId: current?.id ?? null,
        institutionCode,
        accountLast4: created.account_last4,
        usableFrom: usableFrom.toISOString(),
      };
      await tx.query(`insert into audit_events (user_id, kind, data) values ($1, $2, $3)`, [
        user.id,
        current ? "bank_account.replaced" : "bank_account.added",
        event,
      ]);
      // Enqueued in the same transaction, so the alert exists if and only if the change does.
      await tx.query(`select graphile_worker.add_job('bank_account_changed', $1::json)`, [
        JSON.stringify({ userId: user.id, ...event }),
      ]);
      return created;
    });

    return this.#view(row);
  }
}
