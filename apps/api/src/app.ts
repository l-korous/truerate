import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
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
  type Logger,
  type Benefit,
  type HotelSearchQuery,
  type Membership,
  type PageContext,
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

// --- Auth -------------------------------------------------------------------

app.post("/auth/register", async (c) => {
  const { email, password, market } = await c.req.json<{ email: string; password: string; market?: string }>();
  if (!email || !password) throw new HTTPException(400, { message: "email and password required" });
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
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  const { getUserRepo } = await import("@truerate/core");
  const repo = await getUserRepo();
  const user = await repo.getByEmail(email ?? "");
  if (!user || !(await bcrypt.compare(password ?? "", user.passwordHash))) {
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

// Add a membership. Two shapes:
//   catalog: { programId, tier?, attributes? }  -> benefits instantiated from the catalog
//   custom : { label, benefits: Benefit-like[] } -> user-declared benefits
app.post("/memberships", requireAuth, async (c) => {
  const body = await c.req.json<any>();
  const user = await loadUser(c.get("userId"));
  let membership: Membership;

  if (body.programId) {
    const program = getProgram(body.programId);
    if (!program) throw new HTTPException(400, { message: "Unknown program" });

    const secretKeys = new Set(program.fields.filter((f) => f.secret).map((f) => f.key));
    const attributes: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.attributes ?? {})) {
      (secretKeys.has(k) ? secrets : attributes)[k] = String(v);
    }
    membership = {
      id: uuid(),
      label: body.tier ? `${program.name} - ${body.tier}` : program.name,
      programId: program.id,
      tier: body.tier,
      attributes,
      encryptedCredential: Object.keys(secrets).length ? encryptCredential(secrets) : undefined,
      benefits: instantiateBenefits(program, body.tier),
      addedAt: new Date().toISOString(),
      status: program.requiresCredential ? "unverified" : "active",
    };
  } else if (body.label && Array.isArray(body.benefits)) {
    // Custom, user-declared benefits (e.g. Hotel PECR -> 15% on pecr.cz).
    const benefits: Benefit[] = body.benefits.map((b: any) => ({
      id: uuid(),
      scope: b.scope ?? "property",
      match: b.match ?? {},
      value: b.value,
      source: "user-declared" as const,
    }));
    if (!benefits.length || benefits.some((b) => !b.value)) {
      throw new HTTPException(400, { message: "Each custom benefit needs a value" });
    }
    membership = {
      id: uuid(),
      label: String(body.label),
      attributes: {},
      benefits,
      addedAt: new Date().toISOString(),
      status: "active",
    };
  } else {
    throw new HTTPException(400, { message: "Provide programId, or label + benefits" });
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

// --- Enrichment + page matching ---------------------------------------------

app.post("/search/hotels", requireAuth, async (c) => {
  const query = await c.req.json<HotelSearchQuery>();
  validateQuery(query);
  const user = await loadUser(c.get("userId"));
  const result = await engine.enrich({ ...query, currency: query.currency ?? user.currency }, user.memberships);
  return c.json(result);
});

// The extension posts the page it is looking at (domain + optional property and
// public price). We return which of the user's benefits apply, the perks, and -
// if a price was supplied and a discount applies - an indicative member price.
app.post("/benefits/match", requireAuth, async (c) => {
  const context = await c.req.json<PageContext>();
  if (!context?.domain) throw new HTTPException(400, { message: "domain required" });
  const user = await loadUser(c.get("userId"));
  return c.json(engine.matchPage(context, user.memberships));
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

function validateQuery(q: HotelSearchQuery) {
  if (!q?.location || !q.checkIn || !q.checkOut) {
    throw new HTTPException(400, { message: "location, checkIn, checkOut required" });
  }
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
      benefits: m.benefits, // not secret; safe to expose
      hasCredential: Boolean(m.encryptedCredential),
      status: m.status,
      addedAt: m.addedAt,
      verifiedAt: m.verifiedAt,
    })),
  };
}
