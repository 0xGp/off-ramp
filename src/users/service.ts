import { getAddress, isAddress } from "viem";

import type { AuthClaims, ProfileLookup } from "../auth/privy.ts";
import { withTransaction, type Db } from "../db/pool.ts";

export interface User {
  id: string;
  privyDid: string;
  walletAddress: string | null;
  email: string | null;
  displayName: string | null;
  onboardedAt: Date | null;
}

interface UserRow {
  id: string;
  privy_did: string;
  wallet_address: string | null;
  email: string | null;
  display_name: string | null;
  onboarded_at: Date | null;
}

const COLUMNS = "id, privy_did, wallet_address, email, display_name, onboarded_at";

const toUser = (r: UserRow): User => ({
  id: r.id,
  privyDid: r.privy_did,
  walletAddress: r.wallet_address,
  email: r.email,
  displayName: r.display_name,
  onboardedAt: r.onboarded_at,
});

export type OnboardingStep = "wallet" | "bank-account";

export interface Onboarding {
  complete: boolean;
  /** The first step still missing, in the order the app asks for them. */
  nextStep: OnboardingStep | null;
}

export function onboardingFor(user: User, hasBankAccount: boolean): Onboarding {
  const nextStep: OnboardingStep | null = !user.walletAddress ? "wallet" : !hasBankAccount ? "bank-account" : null;
  return { complete: nextStep === null, nextStep };
}

export class UserService {
  readonly #db: Db;
  readonly #profiles: ProfileLookup | null;

  constructor(db: Db, profiles: ProfileLookup | null) {
    this.#db = db;
    this.#profiles = profiles;
  }

  /**
   * Creates the account on first sight. The Privy profile is fetched until the wallet and email
   * are known, because Privy may create the embedded wallet just after the first login.
   */
  async ensure(claims: AuthClaims): Promise<User> {
    const user = await withTransaction(this.#db, async (tx) => {
      const { rows } = await tx.query<UserRow & { inserted: boolean }>(
        `insert into users (privy_did) values ($1)
         on conflict (privy_did) do update set privy_did = excluded.privy_did
         returning ${COLUMNS}, (xmax = 0) as inserted`,
        [claims.userDid],
      );
      const row = rows[0]!;
      if (row.inserted) {
        await tx.query(`insert into audit_events (user_id, kind) values ($1, 'account.created')`, [row.id]);
      }
      return toUser(row);
    });
    if ((user.walletAddress && user.email) || !this.#profiles) return user;

    const profile = await this.#profiles.profile(claims.userDid);
    // Stored checksummed so the unique constraint can't be bypassed by letter case.
    const wallet = profile.walletAddress && isAddress(profile.walletAddress) ? getAddress(profile.walletAddress) : null;
    if (!wallet && !profile.email) return user;

    const updated = await this.#db.query<UserRow>(
      `update users set
         wallet_address = coalesce(wallet_address, $2),
         email = coalesce($3, email),
         display_name = coalesce($4, display_name),
         updated_at = now()
       where id = $1
       returning ${COLUMNS}`,
      [user.id, wallet, profile.email, profile.name],
    );
    return updated.rows[0] ? toUser(updated.rows[0]) : user;
  }

  /** Records the first time the account was fully set up; later calls keep the original time. */
  async markOnboarded(user: User): Promise<User> {
    if (user.onboardedAt) return user;
    return withTransaction(this.#db, async (tx) => {
      // The `is null` guard makes concurrent requests record (and audit) it exactly once.
      const { rows } = await tx.query<UserRow>(
        `update users set onboarded_at = now(), updated_at = now()
         where id = $1 and onboarded_at is null returning ${COLUMNS}`,
        [user.id],
      );
      if (!rows[0]) return user;
      await tx.query(`insert into audit_events (user_id, kind) values ($1, 'account.onboarded')`, [user.id]);
      return toUser(rows[0]);
    });
  }
}
