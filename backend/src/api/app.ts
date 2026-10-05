import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import type { AuthClaims, TokenVerifier } from "../auth/privy.ts";
import type { BankAccountService } from "../bank-accounts/service.ts";
import type { Db } from "../db/pool.ts";
import { AppError, envelope } from "../lib/errors.ts";
import type { BankDirectory } from "../paycrest/client.ts";
import type { QuoteService } from "../quotes/service.ts";
import { onboardingFor, type User, type UserService } from "../users/service.ts";

export interface AppDeps {
  db: Db;
  verifier: TokenVerifier;
  users: UserService;
  bankAccounts: BankAccountService;
  directory: BankDirectory;
  quotes: QuoteService;
  corsOrigins: string[];
  logger?: boolean;
}

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

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError("validation", result.error.issues[0]?.message ?? "Invalid request.");
  return result.data;
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: deps.logger === false ? false : { redact: ["req.headers.authorization", "req.headers.cookie"] },
  });

  await app.register(cors, { origin: deps.corsOrigins, methods: ["GET", "POST", "PUT"] });

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

  return app;
}
