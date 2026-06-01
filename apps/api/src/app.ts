import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import {
  EnrichmentEngine,
  encryptCredential,
  getProgram,
  instantiateBenefits,
  PROGRAMS,
  summariseBenefits,
  templatesForTier,
  createLogger,
  generateCorrelationId,
  hashUserId,
  HotelSearchQuerySchema,
  PageContextSchema,
  ClientErrorReportSchema,
  BenefitInputSchema,
  type Logger,
  type Benefit,
  type Membership,
  type User,
} from "@truerate/core";
import { issueToken, requireAuth } from "./auth.js";

type AppVariables = { userId: string; email: string; correlationId: string; logger: Logger };

export const app = new Hono<{ Variables: AppVariables }>();
export const engine = new EnrichmentEngine();

/**
 * Build the CORS origin allowlist from environment variables.
 *
 * CORS_ALLOWED_ORIGINS – comma-separated list of web origins (e.g. "http://localhost:3000,https://truerate.app").
 *                         Defaults to "http://localhost:3000" when unset (local dev only).
 * CORS_EXTENSION_ID    – Chrome extension ID; when set, adds "chrome-extension://<id>" to the allowlist.
 */
function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (raw) {
    for (const o of raw.split(",")) {
      const trimmed = o.trim();
      if (trimmed) origins.add(trimmed);
    }
  } else {
    origins.add("http://localhost:3000");
  }
  const extId = process.env.CORS_EXTENSION_ID?.trim();
  if (extId) origins.add(`chrome-extension://${extId}`);
  return origins;
}

const allowedOrigins = buildAllowedOrigins();

app.use("*", cors({ origin: (o) => (allowedOrigins.has(o) ? o : null), credentials: true }));

// Correlation ID: accept from inbound header or generate; attach to every log line.
app.use("*", async (c, next) => {
  const correlationId = c.req.header("x-correlation-id") ?? generateCorrelationId();
  const reqLogger = createLogger({ correlationId, route: new URL(c.req.url).pathname });
  c.set("correlationId", correlationId);
  c.set("logger", reqLogger);
  reqLogger.info("request", { method: c.req.method });
  await next();
  c.header("x-correlation-id", correlationId);
  reqLogger.info("response", { status: c.res.status });
});

app.get("/health", (c) => c.json({ ok: true, mode: engine.mode }));

// Catalog with a plain-language summary of what each program/tier brings, so
// the web UI can show "what you'll get" before the user commits.
app.get("/programs", (c) =>
  c.json({
    programs: PROGRAMS.map((p) => ({
      ...p,
      summaryByTier: Object.fromEntries(
        (p.tiers ?? ["*"]).map((t) => [t, summariseBenefits(templatesForTier(p, t === "*" ? undefined : t))]),
      ),
    })),
  }),
);

// --- Validation helpers ------------------------------------------------------

/** Parse and validate a request body; return structured 400 on failure. */
async function parseBody<T>(schema: z.ZodType<T>, c: { req: { json(): Promise<unknown> } }): Promise<T | Response> {
  const raw = await (c.req.json() as Promise<unknown>).catch(() => null);
  const result = schema.safeParse(raw);
  if (!result.success) {
    return Response.json(
      { error: "validation_failed", issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 400 },
    );
  }
  return result.data;
}

// --- Auth -------------------------------------------------------------------

const RegisterSchema = z.object({
  email: z.string().email("invalid email"),
  password: z.string().min(8, "password must be at least 8 characters"),
  market: z.string().optional(),
});

const LoginSchema = z.object({
  email: z.string().email("invalid email"),
  password: z.string().min(1, "password required"),
});

app.post("/auth/register", async (c) => {
  const parsed = await parseBody(RegisterSchema, c);
  if (parsed instanceof Response) return parsed;
  const { email, password, market } = parsed;
  const { getUserRepo } = await import("@truerate/core");
  const repo = await getUserRepo();
  if (await repo.getByEmail(email)) throw new HTTPException(409, { message: "Account already exists" });
  const mkt = market ?? "cz";
  const user: User = {
    id: uuid(),
    email: email.toLowerCase(),
    passwordHash: await bcrypt.hash(password, 10),
    memberships: [],
    createdAt: new Date().toISOString(),
    market: mkt,
    currency: mkt === "us" ? "USD" : "EUR",
  };
  await repo.create(user);
  c.get("logger").info("user registered", { userIdHash: hashUserId(user.id), market: mkt });
  return c.json({ token: await issueToken(user.id, user.email), user: publicUser(user) });
});

app.post("/auth/login", async (c) => {
  const parsed = await parseBody(LoginSchema, c);
  if (parsed instanceof Response) return parsed;
  const { email, password } = parsed;
  const { getUserRepo } = await import("@truerate/core");
  const repo = await getUserRepo();
  const user = await repo.getByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    c.get("logger").warn("login failed");
    throw new HTTPException(401, { message: "Invalid credentials" });
  }
  c.get("logger").info("user logged in", { userIdHash: hashUserId(user.id) });
  return c.json({ token: await issueToken(user.id, user.email), user: publicUser(user) });
});

// --- Memberships ------------------------------------------------------------

app.get("/me", requireAuth, async (c) => {
  const user = await loadUser(c.get("userId"));
  return c.json({ user: publicUser(user) });
});

// Two valid shapes for adding a membership:
//   catalog: { programId, tier?, attributes? }  -> benefits instantiated from the catalog
//   custom : { label, benefits: BenefitInput[] } -> user-declared benefits
const CatalogMembershipSchema = z.object({
  programId: z.string().min(1),
  tier: z.string().optional(),
  attributes: z.record(z.string()).optional(),
});

const CustomMembershipSchema = z.object({
  label: z.string().min(1, "label is required"),
  benefits: z.array(BenefitInputSchema).min(1, "at least one benefit required"),
});

const AddMembershipSchema = z.union([CatalogMembershipSchema, CustomMembershipSchema]);

app.post("/memberships", requireAuth, async (c) => {
  const parsed = await parseBody(AddMembershipSchema, c);
  if (parsed instanceof Response) return parsed;

  const user = await loadUser(c.get("userId"));
  let membership: Membership;

  if ("programId" in parsed) {
    const program = getProgram(parsed.programId);
    if (!program) throw new HTTPException(400, { message: "Unknown program" });

    const secretKeys = new Set(program.fields.filter((f) => f.secret).map((f) => f.key));
    const attributes: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.attributes ?? {})) {
      (secretKeys.has(k) ? secrets : attributes)[k] = String(v);
    }
    membership = {
      id: uuid(),
      label: parsed.tier ? `${program.name} - ${parsed.tier}` : program.name,
      programId: program.id,
      tier: parsed.tier,
      attributes,
      encryptedCredential: Object.keys(secrets).length ? encryptCredential(secrets) : undefined,
      benefits: instantiateBenefits(program, parsed.tier),
      addedAt: new Date().toISOString(),
      status: program.requiresCredential ? "unverified" : "active",
    };
  } else {
    const benefits: Benefit[] = parsed.benefits.map((b) => ({
      id: uuid(),
      scope: b.scope,
      match: b.match ?? {},
      value: b.value,
      source: "user-declared" as const,
    }));
    membership = {
      id: uuid(),
      label: parsed.label,
      attributes: {},
      benefits,
      addedAt: new Date().toISOString(),
      status: "active",
    };
  }

  user.memberships.push(membership);
  await saveUser(user);
  return c.json({ user: publicUser(user) });
});

app.delete("/memberships/:id", requireAuth, async (c) => {
  const user = await loadUser(c.get("userId"));
  user.memberships = user.memberships.filter((m) => m.id !== c.req.param("id"));
  await saveUser(user);
  return c.json({ user: publicUser(user) });
});

const EditMembershipSchema = z.object({
  tier: z.string().optional(),
  attributes: z.record(z.string()).optional(),
  label: z.string().min(1, "label must not be empty").optional(),
  benefits: z.array(BenefitInputSchema).min(1).optional(),
});

app.patch("/memberships/:id", requireAuth, async (c) => {
  const parsed = await parseBody(EditMembershipSchema, c);
  if (parsed instanceof Response) return parsed;

  const user = await loadUser(c.get("userId"));
  const membership = user.memberships.find((m) => m.id === c.req.param("id"));
  if (!membership) throw new HTTPException(404, { message: "Membership not found" });

  if (membership.programId) {
    const program = getProgram(membership.programId);
    if (!program) throw new HTTPException(400, { message: "Unknown program" });

    if (parsed.tier !== undefined) {
      membership.tier = parsed.tier;
      membership.label = parsed.tier ? `${program.name} - ${parsed.tier}` : program.name;
      membership.benefits = instantiateBenefits(program, parsed.tier);
    }

    if (parsed.attributes !== undefined) {
      const secretKeys = new Set(program.fields.filter((f) => f.secret).map((f) => f.key));
      const newAttributes: Record<string, string> = {};
      const newSecrets: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed.attributes)) {
        if (secretKeys.has(k)) {
          if (v) newSecrets[k] = String(v);
        } else {
          newAttributes[k] = String(v);
        }
      }
      membership.attributes = newAttributes;
      if (Object.keys(newSecrets).length) {
        membership.encryptedCredential = encryptCredential(newSecrets);
      }
    }
  } else {
    if (parsed.label !== undefined) membership.label = parsed.label;
    if (parsed.benefits !== undefined) {
      membership.benefits = parsed.benefits.map((b) => ({
        id: uuid(),
        scope: b.scope,
        match: b.match ?? {},
        value: b.value,
        source: "user-declared" as const,
      }));
    }
  }

  await saveUser(user);
  return c.json({ user: publicUser(user) });
});

// --- Enrichment + page matching ---------------------------------------------

app.post("/search/hotels", requireAuth, async (c) => {
  const parsed = await parseBody(HotelSearchQuerySchema, c);
  if (parsed instanceof Response) return parsed;
  const user = await loadUser(c.get("userId"));
  const result = await engine.enrich({
    location: parsed.location,
    checkIn: parsed.checkIn,
    checkOut: parsed.checkOut,
    adults: parsed.adults ?? 2,
    rooms: parsed.rooms ?? 1,
    currency: parsed.currency ?? user.currency,
    limit: parsed.limit,
  }, user.memberships);
  return c.json(result);
});

app.post("/benefits/match", requireAuth, async (c) => {
  const parsed = await parseBody(PageContextSchema, c);
  if (parsed instanceof Response) return parsed;
  const user = await loadUser(c.get("userId"));
  return c.json(engine.matchPage(parsed, user.memberships));
});

// --- Client-side error reporting (unauthenticated, fire-and-forget) ----------

/** Field names that must never appear in logged error context. */
const SCRUB_PATTERN = /password|token|secret|key|email|price|amount|nightly|total|credit|card|auth/i;

export function scrubContext(ctx: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(ctx).filter(([k]) => !SCRUB_PATTERN.test(k)),
  );
}

app.post("/client-errors", async (c) => {
  const raw = await c.req.json<unknown>().catch(() => null);
  const result = ClientErrorReportSchema.safeParse(raw);
  if (!result.success) {
    return c.json({ error: "invalid payload" }, 400);
  }
  const report = result.data;
  const safeContext = report.context && typeof report.context === "object"
    ? scrubContext(report.context as Record<string, unknown>)
    : undefined;
  c.get("logger").error("client error", {
    clientSource: report.source,
    clientMessage: report.message.slice(0, 500),
    clientStack: report.stack ? report.stack.slice(0, 2000) : undefined,
    clientUrl: report.url ? report.url.slice(0, 300) : undefined,
    clientCorrelationId: report.correlationId ? report.correlationId.slice(0, 50) : undefined,
    clientContext: safeContext,
  });
  return c.body(null, 204);
});

// --- helpers ----------------------------------------------------------------

async function loadUser(id: string): Promise<User> {
  const { getUserRepo } = await import("@truerate/core");
  const repo = await getUserRepo();
  const user = await repo.getById(id);
  if (!user) throw new HTTPException(404, { message: "User not found" });
  return user;
}
async function saveUser(user: User): Promise<void> {
  const { getUserRepo } = await import("@truerate/core");
  const repo = await getUserRepo();
  await repo.update(user);
}

/** Strip secrets and password hash before sending a user to the client. */
function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    market: user.market,
    currency: user.currency,
    createdAt: user.createdAt,
    memberships: user.memberships.map((m) => ({
      id: m.id,
      label: m.label,
      programId: m.programId,
      tier: m.tier,
      attributes: m.attributes,
      benefits: m.benefits,
      hasCredential: Boolean(m.encryptedCredential),
      status: m.status,
      addedAt: m.addedAt,
      verifiedAt: m.verifiedAt,
    })),
  };
}
