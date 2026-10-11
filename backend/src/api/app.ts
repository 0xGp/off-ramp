import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import type { ActivityService } from "../activity/service.ts";
import type { AdminAuth } from "../admin/auth.ts";
import type { AdminService } from "../admin/service.ts";
import type { AuthClaims, TokenVerifier } from "../auth/privy.ts";
import type { BankAccountService } from "../bank-accounts/service.ts";
import type { Db } from "../db/pool.ts";
import type { DepositService } from "../deposits/service.ts";
import { AppError, envelope } from "../lib/errors.ts";
import type { BankDirectory } from "../paycrest/client.ts";
import { outcomeForEvent, parseWebhook, redactWebhookData, sha256Hex, verifyPaycrestSignature } from "../paycrest/webhook.ts";
import type { PayoutService } from "../payouts/service.ts";
import type { QuoteService } from "../quotes/service.ts";
import { onboardingFor, type User, type UserService } from "../users/service.ts";

export interface AppDeps {
  db: Db;
  verifier: TokenVerifier;
  users: UserService;
  bankAccounts: BankAccountService;
  directory: BankDirectory;
  quotes: QuoteService;
  deposits: DepositService;
  payouts: PayoutService;
  activity: ActivityService;
  /** Unset leaves /v1/admin answering 404. */
  admin?: { auth: AdminAuth; service: AdminService } | null;
  /** Paycrest sender API Secret; unset rejects webhooks with 503. */
  paycrestWebhookSecret?: string;
  corsOrigins: string[];
  /** Behind a reverse proxy: take the client IP and protocol from X-Forwarded-*. */
  trustProxy?: boolean;
  logger?: boolean;
}

const ADMIN_COOKIE = "melo_admin";

function readCookie(request: FastifyRequest, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

const adminLoginInput = z.object({ password: z.string().min(1).max(200) });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  status: z.enum(["awaiting_deposit", "escrowed", "released", "refunded"]).optional(),
});

declare module "fastify" {
  interface FastifyRequest {
    auth: { claims: AuthClaims; user: User };
  }
}

const bankInput = z.object({
  institutionCode: z.string().min(1).max(32),
  accountNumber: z.string().regex(/^\d{10}$/, "Enter a 10-digit NUBAN account number."),
});

const quoteInput = z.object({
  chainId: z.number().int().positive(),
  amount: z.string().max(32),
});

const confirmInput = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid transaction hash."),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError("validation", result.error.issues[0]?.message ?? "Invalid request.");
  return result.data;
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: deps.logger === false ? false : { redact: ["req.headers.authorization", "req.headers.cookie"] },
    trustProxy: deps.trustProxy ?? false,
  });

  // Credentials only matter for the admin cookie; the origin allowlist still applies.
  await app.register(cors, { origin: deps.corsOrigins, methods: ["GET", "POST", "PUT"], credentials: true });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) return reply.status(error.status).send(envelope(error));
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send(envelope(new AppError("validation", "Invalid request.")));
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send(envelope(new AppError("internal", "Something went wrong.")));
  });

  app.decorateRequest("auth", null as unknown as FastifyRequest["auth"]);

  async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new AppError("unauthenticated", "Sign in to continue.");
    const claims = await deps.verifier.verify(header.slice("Bearer ".length));
    request.auth = { claims, user: await deps.users.ensure(claims) };
  }

  app.get("/healthz", async () => {
    await deps.db.query("select 1");
    return { ok: true };
  });

  app.get("/v1/banks", async () => ({ banks: await deps.directory.listInstitutions() }));

  async function me(current: User) {
    const bankAccount = await deps.bankAccounts.getActive(current.id);
    const onboarding = onboardingFor(current, bankAccount !== null);
    const user = onboarding.complete ? await deps.users.markOnboarded(current) : current;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      walletAddress: user.walletAddress,
      bankAccount,
      onboarding: { ...onboarding, completedAt: user.onboardedAt?.toISOString() ?? null },
    };
  }

  app.get("/v1/me", { preHandler: authenticate }, async (request) => me(request.auth.user));

  app.post("/v1/bank-accounts/verify", { preHandler: authenticate }, async (request) => {
    const { institutionCode, accountNumber } = parse(bankInput, request.body);
    return deps.bankAccounts.verify(institutionCode, accountNumber);
  });

  app.put("/v1/me/bank-account", { preHandler: authenticate }, async (request) => {
    const { institutionCode, accountNumber } = parse(bankInput, request.body);
    const { user, claims } = request.auth;
    await deps.bankAccounts.setActive(user, claims, institutionCode, accountNumber);
    return me(user);
  });

  app.post("/v1/quotes", { preHandler: authenticate }, async (request, reply) => {
    const input = parse(quoteInput, request.body);
    return reply.status(201).send({ quote: await deps.quotes.create(request.auth.user, input) });
  });

  app.get<{ Params: { id: string } }>("/v1/quotes/:id", { preHandler: authenticate }, async (request) => {
    const quote = await deps.quotes.get(request.auth.user, request.params.id);
    if (!quote) throw new AppError("not-found", "Quote not found.");
    return { quote };
  });

  app.post<{ Params: { id: string } }>("/v1/quotes/:id/deposit", { preHandler: authenticate }, async (request) => ({
    deposit: await deps.deposits.prepare(request.auth.user, request.params.id),
  }));

  // Own scope so only this route receives the raw body bytes the HMAC is computed over.
  await app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 256 * 1024 }, (_req, body, done) =>
      done(null, body),
    );
    scope.post("/v1/webhooks/paycrest", async (request, reply) => {
      if (!deps.paycrestWebhookSecret) {
        throw new AppError("provider-unavailable", "Paycrest webhooks aren't configured.");
      }
      const raw = request.body as Buffer;
      const signature = request.headers["x-paycrest-signature"];
      if (!Buffer.isBuffer(raw) || !verifyPaycrestSignature(raw, typeof signature === "string" ? signature : undefined, deps.paycrestWebhookSecret)) {
        request.log.warn("paycrest webhook with invalid signature");
        return reply.status(401).send(envelope(new AppError("unauthenticated", "Invalid signature.")));
      }
      const webhook = parseWebhook(raw);
      if (!webhook) throw new AppError("validation", "Malformed webhook.");

      const orderId = typeof webhook.data.id === "string" ? webhook.data.id : null;
      const result = await deps.payouts.recordProviderEvent({
        provider: "paycrest",
        event: webhook.event,
        orderId,
        status: typeof webhook.data.status === "string" ? webhook.data.status : null,
        bodySha256: sha256Hex(raw),
        data: redactWebhookData(webhook.data),
        outcome: outcomeForEvent(webhook.event),
      });
      request.log.info({ event: webhook.event, orderId, ...result }, "paycrest webhook");
      // Unknown orders are acknowledged too: retrying them for 24h wouldn't make them known.
      return { ok: true };
    });
  });

  app.get<{ Params: { id: string } }>("/v1/deposits/:id", { preHandler: authenticate }, async (request) => {
    const deposit = await deps.deposits.get(request.auth.user, request.params.id);
    if (!deposit) throw new AppError("not-found", "Deposit not found.");
    return { deposit };
  });

  app.post<{ Params: { id: string } }>("/v1/deposits/:id/confirm", { preHandler: authenticate }, async (request) => {
    const { txHash } = parse(confirmInput, request.body);
    return { deposit: await deps.deposits.confirm(request.auth.user, request.params.id, txHash as `0x${string}`) };
  });

  app.get("/v1/activity", { preHandler: authenticate }, async (request) => ({
    activity: await deps.activity.list(request.auth.user),
  }));

  app.get<{ Params: { id: string } }>("/v1/activity/:id", { preHandler: authenticate }, async (request) => {
    const item = await deps.activity.get(request.auth.user, request.params.id);
    if (!item) throw new AppError("not-found", "Cash-out not found.");
    return { activity: item };
  });

  const admin = deps.admin;
  if (admin) {
    const setCookie = (request: FastifyRequest, reply: FastifyReply, value: string, maxAge: number) => {
      const secure = request.protocol === "https" ? "; Secure" : "";
      reply.header(
        "set-cookie",
        `${ADMIN_COOKIE}=${value}; Path=/v1/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`,
      );
    };
    const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header("cache-control", "no-store");
      if (!admin.auth.verify(readCookie(request, ADMIN_COOKIE))) {
        throw new AppError("unauthenticated", "Admin sign-in required.");
      }
    };

    app.post("/v1/admin/login", async (request, reply) => {
      const { password } = parse(adminLoginInput, request.body);
      const result = admin.auth.login(password, request.ip);
      if ("error" in result) {
        request.log.warn({ ip: request.ip, reason: result.error }, "admin login refused");
        throw result.error === "rate-limited"
          ? new AppError("rate-limited", "Too many attempts. Try again in 15 minutes.")
          : new AppError("unauthenticated", "Wrong password.");
      }
      request.log.info({ ip: request.ip }, "admin login");
      setCookie(request, reply, result.token, admin.auth.maxAgeSeconds);
      return { ok: true };
    });

    app.post("/v1/admin/logout", async (request, reply) => {
      setCookie(request, reply, "", 0);
      return { ok: true };
    });

    app.get("/v1/admin/session", { preHandler: requireAdmin }, async () => ({ ok: true }));
    app.get("/v1/admin/overview", { preHandler: requireAdmin }, async () => admin.service.overview());
    app.get("/v1/admin/cashouts", { preHandler: requireAdmin }, async (request) => ({
      cashouts: await admin.service.cashouts(parse(listQuery, request.query)),
    }));
    app.get("/v1/admin/events", { preHandler: requireAdmin }, async (request) =>
      admin.service.events(parse(listQuery, request.query)),
    );
    app.get("/v1/admin/users", { preHandler: requireAdmin }, async (request) => ({
      users: await admin.service.users(parse(listQuery, request.query)),
    }));
    app.get("/v1/admin/jobs", { preHandler: requireAdmin }, async (request) => ({
      jobs: await admin.service.jobs(parse(listQuery, request.query)),
    }));
  }

  return app;
}
