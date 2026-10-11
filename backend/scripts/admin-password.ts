/**
 * Creates the /admin password.
 *
 *   node scripts/admin-password.ts <password-file> <env-file>
 *
 * The password goes only into <password-file> (mode 600) and is never printed.
 * <env-file> (mode 600) receives ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET for the API's env.
 * A new session secret signs out every open admin session.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

import { hashAdminPassword } from "../src/admin/auth.ts";

const [passwordFile, envFile] = process.argv.slice(2);
if (!passwordFile || !envFile) {
  console.error("usage: node scripts/admin-password.ts <password-file> <env-file>");
  process.exit(1);
}

const password = randomBytes(18).toString("base64url");
writeFileSync(passwordFile, `${password}\n`, { mode: 0o600, flag: "wx" });
writeFileSync(
  envFile,
  `ADMIN_PASSWORD_HASH=${hashAdminPassword(password)}\nADMIN_SESSION_SECRET=${randomBytes(32).toString("base64url")}\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(`Password written to ${passwordFile}; env lines written to ${envFile}.`);
