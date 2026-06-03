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
  estimatePerkValueAllBands,
  generateMcpToken,
  hashMcpToken,
  mcpUrlForToken,
  createLogger,
  generateCorrelationId,
  hashUserId,
  HotelSearchQuerySchema,
  PageContextSchema,
  ClientErrorReportSchema,
  BenefitInputSchema,
  CatalogEntryInputSchema,
  getCatalogRepo,
  getCatalogCache,
  resetCatalogCache,
  catalogEntryToProgram,
  programToCatalogInput,
  getPartnerOrgRepo,
  getPartnerSubmissionRepo,
  getPartnerWorkflow,
  resetPartnerWorkflow,
  PartnerWorkflowError,
  type CatalogCache,
  type Logger,
  type Benefit,
  type Membership,
  type User,
  type PerkType,
  type ActivationEventName,
  type CatalogStatus,
  type PartnerOrgStatus,
  type SubmissionStatus,
} from "@truerate/core";
import { issueToken, requireAuth } from "./auth.js";
import { rateLimitMiddleware } from "./rate-limit.js";

type AppVariables = { userId: string; email: string; correlationId: string; logger: Logger };

export const app = new Hono<{ Variables: AppVariables }>();
export const engine = new EnrichmentEngine();

// Catalog cache singleton — seeded from the static PROGRAMS catalog on first
// use (idempotent via seedIfEmpty). Shared across all requests in this process.
let _catalogCache: CatalogCache | null = null;

async function getAppCatalogCache(): Promise<CatalogCache> {
  if (_catalogCache) return _catalogCache;
  const repo = await getCatalogRepo();
  await repo.seedIfEmpty(PROGRAMS.map(programToCatalogInput));
  _catalogCache = await getCatalogCache();
  return _catalogCache;
}

/** Reset catalog state — for tests only. */
export function resetAppCatalog(): void {
  _catalogCache = null;
  resetCatalogCache();
}

/** Reset partner workflow state — for tests only. */
export { resetPartnerWorkflow as resetAppPartner };

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
app.use("*", rateLimitMiddleware);

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

// Perk-value estimation table — public, no auth required.
// Returns estimated monetary value (USD) for each canonical perk type across
// 3★/4★/5★ hotel bands. Values are estimates, never prices (see issue #1).
app.get("/perks/estimates", (c) => {
  const perkTypes: PerkType[] = [
    "early_check_in", "late_check_out", "free_breakfast", "room_upgrade",
    "suite_upgrade", "lounge_access", "welcome_amenity", "free_wifi",
    "airport_transfer", "parking", "spa_credit", "guaranteed_availability",
    "points_bonus", "priority_support", "other",
  ];
  const estimates = Object.fromEntries(
    perkTypes.map((pt) => [pt, estimatePerkValueAllBands(pt)]),
  );
  return c.json({ estimates });
});

// --- Catalog read endpoints --------------------------------------------------
// Backed by CatalogRepo + TTL cache. Returns perks/discounts/conditions + perk
// value estimates only — never prices (product rule #1 / issue #1).

// GET /catalog/programs — list all published catalog entries.
// Optional ?region=CZ to filter by ISO-3166 region code (Global entries always included).
app.get("/catalog/programs", async (c) => {
  const region = c.req.query("region") || undefined;
  const cache = await getAppCatalogCache();
  const entries = await cache.listPublished(region);
  return c.json({
    programs: entries.map((e) => ({
      ...e,
      summaryByTier: Object.fromEntries(
        (e.tiers ?? ["*"]).map((t) => [
          t,
          summariseBenefits(templatesForTier(catalogEntryToProgram(e), t === "*" ? undefined : t)),
        ]),
      ),
    })),
    region: region ?? null,
  });
});

// GET /catalog/programs/:id — current published entry for a specific program.
app.get("/catalog/programs/:id", async (c) => {
  const programId = c.req.param("id");
  const cache = await getAppCatalogCache();
  const entry = await cache.getCurrent(programId);
  if (!entry || entry.status !== "published") {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({
    program: {
      ...entry,
      summaryByTier: Object.fromEntries(
        (entry.tiers ?? ["*"]).map((t) => [
          t,
          summariseBenefits(templatesForTier(catalogEntryToProgram(entry), t === "*" ? undefined : t)),
        ]),
      ),
    },
  });
});

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

// Field names that represent hotel/booking prices — never allowed in catalog
// payloads (product rule #1). Checked recursively before Zod parsing so that
// price fields are explicitly rejected rather than silently stripped.
const DISALLOWED_PRICE_FIELDS = new Set([
  "price", "prices",
  "nightly", "nightlyRate", "nightlyAmount",
  "totalPrice", "totalAmount",
  "memberPrice", "memberRate",
  "finalPrice", "finalRate", "finalAmount",
  "basePrice", "baseRate",
  "discountedPrice", "discountedRate",
  "roomPrice", "roomRate",
]);

/** Recursively find the first disallowed price field key; returns its path or null. */
function findPriceField(obj: unknown, path = ""): string | null {
  if (obj === null || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const found = findPriceField(obj[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (DISALLOWED_PRICE_FIELDS.has(key)) return path ? `${path}.${key}` : key;
    const found = findPriceField((obj as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
    if (found) return found;
  }
  return null;
}

/** Like parseBody but also rejects any price field in the raw payload (catalog writes). */
async function parseCatalogBody<T>(schema: z.ZodType<T>, c: { req: { json(): Promise<unknown> } }): Promise<T | Response> {
  const raw = await (c.req.json() as Promise<unknown>).catch(() => null);
  const priceField = findPriceField(raw);
  if (priceField) {
    return Response.json(
      { error: "validation_failed", issues: [{ path: [priceField], message: "price fields are not permitted in catalog entries (see product rule #1)" }] },
      { status: 400 },
    );
  }
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
  markActivation(user, "signup");
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

// --- Per-user MCP URL (issue #82) -------------------------------------------
// Each user mints one opaque token; their MCP endpoint embeds it in the path
// (https://<mcp-host>/u/<token>/mcp) because MCP desktop clients can't send
// custom auth headers. Only the token's hash is stored; the raw token/URL is
// returned exactly ONCE here. POST issues-or-rotates (always a fresh token,
// invalidating any previous one); DELETE revokes; GET reports status only.

/** Public base URL of the MCP service, used to build the personal URL. */
function mcpPublicBase(): string {
  return process.env.MCP_PUBLIC_URL ?? "http://localhost:8788";
}

app.post("/me/mcp-url", requireAuth, async (c) => {
  const user = await loadUser(c.get("userId"));
  const token = generateMcpToken();
  const createdAt = new Date().toISOString();
  user.mcpToken = { hash: hashMcpToken(token), createdAt };
  markActivation(user, "mcp_url_obtained");
  await saveUser(user);
  c.get("logger").info("mcp url issued", { userIdHash: hashUserId(user.id) });
  // url + token are shown once and never stored — the client must save them now.
  return c.json({ url: mcpUrlForToken(mcpPublicBase(), token), token, createdAt });
});

app.get("/me/mcp-url", requireAuth, async (c) => {
  const user = await loadUser(c.get("userId"));
  if (!user.mcpToken) return c.json({ active: false });
  // The raw token/URL cannot be reconstructed (only its hash is stored); the
  // user must rotate to obtain a fresh URL if they lost the previous one.
  return c.json({
    active: true,
    createdAt: user.mcpToken.createdAt,
    lastUsedAt: user.mcpToken.lastUsedAt,
  });
});

app.delete("/me/mcp-url", requireAuth, async (c) => {
  const user = await loadUser(c.get("userId"));
  user.mcpToken = undefined;
  await saveUser(user);
  c.get("logger").info("mcp url revoked", { userIdHash: hashUserId(user.id) });
  return c.body(null, 204);
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
    const cache = await getAppCatalogCache();
    const catalogEntry = await cache.getCurrent(parsed.programId);
    const program = catalogEntry ? catalogEntryToProgram(catalogEntry) : getProgram(parsed.programId);
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
  markActivation(user, "membership_added");
  await saveUser(user);
  c.get("logger").info("membership added", { userIdHash: hashUserId(user.id), count: user.memberships.length });
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
    const cache = await getAppCatalogCache();
    const catalogEntry = await cache.getCurrent(membership.programId);
    const program = catalogEntry ? catalogEntryToProgram(catalogEntry) : getProgram(membership.programId);
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
  if (markActivation(user, "extension_connected")) {
    await saveUser(user);
    c.get("logger").info("activation milestone", { event: "extension_connected", userIdHash: hashUserId(user.id) });
  }
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

// --- Activation tracking ---------------------------------------------------

const ACTIVATION_EVENT_VALUES = ["signup", "membership_added", "mcp_url_obtained", "extension_connected"] as const satisfies ActivationEventName[];

const ActivationEventSchema = z.object({
  event: z.enum(ACTIVATION_EVENT_VALUES),
});

/**
 * Set a milestone on the user document if not already set.
 * Returns true if the milestone was newly set (i.e. needs a save), false if already present.
 */
function markActivation(user: User, event: ActivationEventName): boolean {
  if (user.activationMilestones?.[event]) return false;
  if (!user.activationMilestones) user.activationMilestones = {};
  user.activationMilestones[event] = new Date().toISOString();
  return true;
}

// POST /events/activation — client-side activation event (e.g. mcp_url_obtained).
// Requires auth so events are tied to a real user.
app.post("/events/activation", requireAuth, async (c) => {
  const parsed = await parseBody(ActivationEventSchema, c);
  if (parsed instanceof Response) return parsed;

  const user = await loadUser(c.get("userId"));
  if (markActivation(user, parsed.event)) {
    await saveUser(user);
    c.get("logger").info("activation milestone", { event: parsed.event, userIdHash: hashUserId(user.id) });
  }
  return c.body(null, 204);
});

// GET /admin/funnel/activation — aggregate funnel counts across all users.
// Protected by ADMIN_SECRET header; returns 401 when the secret is absent or wrong.
app.get("/admin/funnel/activation", async (c) => {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || c.req.header("x-admin-secret") !== adminSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const { getUserRepo } = await import("@truerate/core");
  const repo = await getUserRepo();
  const counts = await repo.funnelCounts();
  return c.json({ funnel: counts, generatedAt: new Date().toISOString() });
});

// --- Admin catalog editor (CRUD + versioning + publish) ----------------------
// All routes require x-admin-secret header (CatalogEditor role; future: Entra RBAC).
// Channels (MCP, extension) continue reading from GET /catalog/programs which
// serves only published+current entries via the TTL cache.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requireCatalogEditor(c: any): Response | null {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || c.req.header("x-admin-secret") !== adminSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return null;
}

// GET /admin/catalog — list catalog entries, optionally filtered by ?status=
app.get("/admin/catalog", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const status = c.req.query("status") as CatalogStatus | undefined;
  const repo = await getCatalogRepo();

  const entries = status
    ? await repo.listByStatus(status)
    : await (async () => {
        const [draft, published, archived, inReview] = await Promise.all([
          repo.listByStatus("draft"),
          repo.listByStatus("published"),
          repo.listByStatus("archived"),
          repo.listByStatus("in-review"),
        ]);
        return [...draft, ...inReview, ...published, ...archived];
      })();

  return c.json({ entries, count: entries.length });
});

// POST /admin/catalog — create a new draft for a program
app.post("/admin/catalog", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const parsed = await parseCatalogBody(CatalogEntryInputSchema, c);
  if (parsed instanceof Response) return parsed;

  const repo = await getCatalogRepo();
  const entry = await repo.upsertDraft(parsed);
  return c.json({ entry }, 201);
});

// GET /admin/catalog/:id — get the current entry (any status) for a program
app.get("/admin/catalog/:id", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const programId = c.req.param("id");
  const repo = await getCatalogRepo();

  // Return current published entry, or any existing draft/in-review
  const history = await repo.getHistory(programId);
  if (history.length === 0) return c.json({ error: "not_found" }, 404);

  // Prefer draft/in-review over published for the editor view
  const active = history.find((e) => e.status === "draft" || e.status === "in-review")
    ?? history.find((e) => e.isCurrent)
    ?? history[0];

  return c.json({ entry: active });
});

// PUT /admin/catalog/:id — update the draft for a program (creates draft if none)
app.put("/admin/catalog/:id", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const programId = c.req.param("id");
  const parsed = await parseCatalogBody(CatalogEntryInputSchema, c);
  if (parsed instanceof Response) return parsed;

  if (parsed.programId !== programId) {
    return c.json({ error: "programId in body must match URL parameter" }, 400);
  }

  const repo = await getCatalogRepo();
  const entry = await repo.upsertDraft(parsed);
  return c.json({ entry });
});

// DELETE /admin/catalog/:id — archive the current entry for a program
app.delete("/admin/catalog/:id", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const programId = c.req.param("id");
  const repo = await getCatalogRepo();
  const current = await repo.getCurrent(programId);
  if (!current) return c.json({ error: "not_found" }, 404);

  await repo.archive(programId);

  // Invalidate cache so channels stop serving this program immediately
  const cache = await getAppCatalogCache();
  cache.invalidate(programId);

  return c.body(null, 204);
});

// POST /admin/catalog/:id/publish — promote the current draft to published
app.post("/admin/catalog/:id/publish", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const programId = c.req.param("id");
  const repo = await getCatalogRepo();

  let entry;
  try {
    entry = await repo.publish(programId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "publish failed";
    return c.json({ error: msg }, 400);
  }

  // Invalidate cache so channels pick up the new published version immediately
  const cache = await getAppCatalogCache();
  cache.invalidate(programId);

  return c.json({ entry });
});

// GET /admin/catalog/:id/history — list all versions of a program, newest first
app.get("/admin/catalog/:id/history", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const programId = c.req.param("id");
  const repo = await getCatalogRepo();
  const history = await repo.getHistory(programId);
  if (history.length === 0) return c.json({ error: "not_found" }, 404);

  return c.json({ history, programId });
});

// POST /admin/catalog/:id/restore/:version — restore a prior version as a new draft
app.post("/admin/catalog/:id/restore/:version", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const programId = c.req.param("id");
  const versionNum = parseInt(c.req.param("version"), 10);
  if (isNaN(versionNum) || versionNum < 1) {
    return c.json({ error: "version must be a positive integer" }, 400);
  }

  const repo = await getCatalogRepo();
  const snapshot = await repo.getVersion(programId, versionNum);
  if (!snapshot) return c.json({ error: "version_not_found" }, 404);

  // Build a new draft from the snapshot's content (no id/version/status/timestamps)
  const { id: _id, version: _v, isCurrent: _c, status: _s, createdAt: _ca, updatedAt: _ua, publishedAt: _pa, archivedAt: _aa, ...content } = snapshot;
  const draft = await repo.upsertDraft(content);

  return c.json({ entry: draft }, 201);
});

// --- Admin partner approval (issue #75) -------------------------------------
// Partners must be approved before their submissions count.
// All routes require x-admin-secret (same guard as catalog editor).

// GET /admin/partners — list partner orgs; optional ?status=pending|active|rejected
app.get("/admin/partners", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const status = (c.req.query("status") ?? "pending") as PartnerOrgStatus;
  const repo = await getPartnerOrgRepo();
  const orgs = await repo.listByStatus(status);
  return c.json({ orgs, count: orgs.length });
});

// GET /admin/partners/:id — get a partner org
app.get("/admin/partners/:id", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const repo = await getPartnerOrgRepo();
  const org = await repo.getOrg(c.req.param("id"));
  if (!org) return c.json({ error: "not_found" }, 404);
  return c.json({ org });
});

const PartnerOrgInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  country: z.string().min(2).max(2),
  contactEmail: z.string().email(),
  status: z.enum(["pending", "active", "rejected"]).optional().default("pending"),
});

// POST /admin/partners — create a partner org (admin seeding / onboarding)
app.post("/admin/partners", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const parsed = await parseBody(PartnerOrgInputSchema, c);
  if (parsed instanceof Response) return parsed;

  const repo = await getPartnerOrgRepo();
  const existing = await repo.getOrg(parsed.id);
  if (existing) return c.json({ error: "already_exists" }, 409);

  const org = await repo.createOrg({
    id: parsed.id,
    name: parsed.name,
    country: parsed.country,
    contactEmail: parsed.contactEmail,
    status: parsed.status ?? "pending",
    createdAt: new Date().toISOString(),
  });
  return c.json({ org }, 201);
});

const OrgActionSchema = z.object({
  adminId: z.string().min(1).optional(),
});

const OrgRejectSchema = z.object({
  reason: z.string().min(1, "reason is required"),
  adminId: z.string().min(1).optional(),
});

// POST /admin/partners/:id/approve — approve a pending partner org
app.post("/admin/partners/:id/approve", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const parsed = await parseBody(OrgActionSchema, c);
  if (parsed instanceof Response) return parsed;

  const workflow = await getPartnerWorkflow();
  try {
    const org = await workflow.approveOrg(c.req.param("id"), parsed.adminId ?? "admin");
    return c.json({ org });
  } catch (err) {
    if (err instanceof PartnerWorkflowError) {
      const status = err.code === "org_not_found" ? 404 : 400;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});

// POST /admin/partners/:id/reject — reject a pending partner org with a reason
app.post("/admin/partners/:id/reject", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const parsed = await parseBody(OrgRejectSchema, c);
  if (parsed instanceof Response) return parsed;

  const workflow = await getPartnerWorkflow();
  try {
    const org = await workflow.rejectOrg(c.req.param("id"), parsed.adminId ?? "admin", parsed.reason);
    return c.json({ org });
  } catch (err) {
    if (err instanceof PartnerWorkflowError) {
      const status = err.code === "org_not_found" ? 404 : 400;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});

// --- Admin submission review queue (issue #75) ------------------------------

// GET /admin/submissions — list submissions; optional ?status=submitted|in_review|approved|rejected
app.get("/admin/submissions", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const status = (c.req.query("status") ?? "submitted") as SubmissionStatus;
  const repo = await getPartnerSubmissionRepo();
  const submissions = await repo.listByStatus(status);
  return c.json({ submissions, count: submissions.length });
});

// GET /admin/submissions/:id — get a submission
app.get("/admin/submissions/:id", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const repo = await getPartnerSubmissionRepo();
  const sub = await repo.get(c.req.param("id"));
  if (!sub) return c.json({ error: "not_found" }, 404);
  return c.json({ submission: sub });
});

const SubmissionApproveSchema = z.object({
  publishedProgramId: z.string().min(1, "publishedProgramId is required"),
  adminId: z.string().min(1).optional(),
});

const SubmissionRejectSchema = z.object({
  reason: z.string().min(1, "reason is required"),
  adminId: z.string().min(1).optional(),
});

// POST /admin/submissions/:id/approve — approve a submission (makes it available to catalog editor)
app.post("/admin/submissions/:id/approve", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const parsed = await parseBody(SubmissionApproveSchema, c);
  if (parsed instanceof Response) return parsed;

  const workflow = await getPartnerWorkflow();
  try {
    const submission = await workflow.approve(
      c.req.param("id"),
      parsed.publishedProgramId,
      parsed.adminId ?? "admin",
    );
    return c.json({ submission });
  } catch (err) {
    if (err instanceof PartnerWorkflowError) {
      const status = err.code === "submission_not_found" ? 404 : 400;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});

// POST /admin/submissions/:id/reject — reject a submission with a reason
app.post("/admin/submissions/:id/reject", async (c) => {
  const authErr = requireCatalogEditor(c);
  if (authErr) return authErr;

  const parsed = await parseBody(SubmissionRejectSchema, c);
  if (parsed instanceof Response) return parsed;

  const workflow = await getPartnerWorkflow();
  try {
    const submission = await workflow.reject(
      c.req.param("id"),
      parsed.reason,
      parsed.adminId ?? "admin",
    );
    return c.json({ submission });
  } catch (err) {
    if (err instanceof PartnerWorkflowError) {
      const status = err.code === "submission_not_found" ? 404 : 400;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
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
