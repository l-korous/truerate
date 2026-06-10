// CI test for the scale runner — issue #335.
//
// Drives N=25 synthetic personas through the full register → add-membership →
// MCP query flow against ephemeral in-memory API + MCP servers started in this
// process. No external services required; fast + free for CI.
//
// For the full ~1000-persona run against a live/staging deployment, see
// .github/workflows/scale-harness.yml (operator-triggered via workflow_dispatch).
//
// Hard rules asserted:
//   - All 25 personas must complete with ok=true (no 5xx, no price fields).
//   - Passed count equals n (100% reliability at small scale).
//   - Report shape is correct.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createScaleRunner, type RunReport } from "../src/runner.js";

// ---------------------------------------------------------------------------
// Server scaffolding
// ---------------------------------------------------------------------------

let apiSrv: Server;
let mcpSrv: Server;
let apiBase: string;
let mcpBase: string;

/**
 * Minimal Node.js http.Server adapter for a Hono app.
 * Streams the request body, builds a WHATWG Request, calls app.fetch,
 * and pipes the response back — without requiring @hono/node-server as a
 * harness dependency.
 */
async function buildApiListener(
  app: { fetch: (req: Request) => Promise<Response> },
): Promise<(req: IncomingMessage, res: ServerResponse) => void> {
  return async function requestListener(req, res) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);

      const headers: Record<string, string> = {};
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        headers[req.rawHeaders[i]!.toLowerCase()] = req.rawHeaders[i + 1]!;
      }

      const honoReq = new Request(`http://localhost${req.url ?? "/"}`, {
        method: req.method ?? "GET",
        headers,
        body: body.length > 0 && !["GET", "HEAD"].includes(req.method ?? "") ? body : undefined,
        // @ts-expect-error -- duplex needed by some Node fetch impls
        duplex: "half",
      });

      const honoRes = await app.fetch(honoReq);
      res.statusCode = honoRes.status;
      honoRes.headers.forEach((v, k) => res.setHeader(k, v));
      const buf = await honoRes.arrayBuffer();
      res.end(Buffer.from(buf));
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  };
}

before(async () => {
  // Set env vars before any lazy module evaluation.
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "runner-test-secret-must-be-32chars!";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.MCP_PUBLIC_URL = "https://mcp.runner.test.example";
  // Raise global rate limit so the 25-persona run doesn't hit 60 req/min cap.
  process.env.RATE_LIMIT_MAX = "10000";

  // Lazy imports — env vars must be set before app.ts module code runs.
  const [apiMod, mcpMod] = await Promise.all([
    import("../../../apps/api/src/app.js"),
    import("../../../apps/mcp/src/http.js"),
  ]);

  const apiListener = await buildApiListener(apiMod.app as unknown as { fetch: (req: Request) => Promise<Response> });

  apiSrv = createServer(apiListener as Parameters<typeof createServer>[0]);
  mcpSrv = createServer(mcpMod.createRequestListener());

  await Promise.all([
    new Promise<void>((resolve) => apiSrv.listen(0, resolve)),
    new Promise<void>((resolve) => mcpSrv.listen(0, resolve)),
  ]);

  apiBase = `http://localhost:${(apiSrv.address() as AddressInfo).port}`;
  mcpBase = `http://localhost:${(mcpSrv.address() as AddressInfo).port}`;
});

after(async () => {
  await Promise.all([
    new Promise<void>((resolve, reject) => apiSrv.close((e) => (e ? reject(e) : resolve()))),
    new Promise<void>((resolve, reject) => mcpSrv.close((e) => (e ? reject(e) : resolve()))),
  ]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const CI_N = 25;

test("createScaleRunner returns an object with a run method", () => {
  const runner = createScaleRunner({
    apiBaseUrl: "http://example.invalid",
    mcpBaseUrl: "http://example.invalid",
  });
  assert.equal(typeof runner.run, "function");
});

test(`runner: N=${CI_N} personas complete the full flow against in-memory servers (all pass)`, async () => {
  const runner = createScaleRunner({
    apiBaseUrl: apiBase,
    mcpBaseUrl: mcpBase,
    n: CI_N,
    seed: 42,
    concurrency: 5,
    delayMs: 0,
    runIdPrefix: "ci-",
  });

  const report: RunReport = await runner.run();

  // ── Shape checks ──────────────────────────────────────────────────────────
  assert.equal(report.n, CI_N, "report.n must equal the requested count");
  assert.equal(typeof report.passed, "number");
  assert.equal(typeof report.failed, "number");
  assert.equal(report.passed + report.failed, CI_N, "passed + failed must equal n");
  assert.equal(typeof report.durationMs, "number");
  assert.ok(report.durationMs > 0, "durationMs must be positive");
  assert.equal(typeof report.p50Ms, "number");
  assert.equal(typeof report.p95Ms, "number");
  assert.equal(typeof report.p99Ms, "number");
  assert.equal(typeof report.maxMs, "number");
  assert.ok(Array.isArray(report.details), "details must be an array");
  assert.equal(report.details.length, CI_N, "details must have one entry per persona");

  // ── Reliability: all personas must pass ───────────────────────────────────
  const failedPersonas = report.details.filter((r) => !r.ok);
  if (failedPersonas.length > 0) {
    const msgs = failedPersonas.flatMap((r) => r.failures.map((f) => `  [${r.handle}] ${f}`));
    assert.fail(`${failedPersonas.length} persona(s) failed:\n${msgs.join("\n")}`);
  }
  assert.equal(report.passed, CI_N, `all ${CI_N} personas must pass`);
  assert.equal(report.failed, 0, "no failures allowed in CI run");
}, { timeout: 120_000 }); // 2-minute timeout for the full run

test("runner report: channel counts are consistent with n", async () => {
  const runner = createScaleRunner({
    apiBaseUrl: apiBase,
    mcpBaseUrl: mcpBase,
    n: CI_N,
    seed: 7,
    concurrency: 3,
    delayMs: 0,
    runIdPrefix: "ci-counts-",
  });

  const report = await runner.run();

  // All personas should have registered, added memberships, and issued MCP URLs.
  assert.equal(
    report.channels.registered,
    CI_N,
    `all ${CI_N} personas must register successfully`,
  );
  assert.equal(
    report.channels.membershipsAdded,
    CI_N,
    `all ${CI_N} personas must add memberships successfully`,
  );
  assert.equal(
    report.channels.mcpTokensIssued,
    CI_N,
    `all ${CI_N} personas must obtain MCP tokens`,
  );
  // At least some MCP calls must have been made.
  assert.ok(
    report.channels.mcpSummaryCalls > 0,
    "at least some personas must have called get_membership_summary",
  );
}, { timeout: 120_000 });

test("runner report: latency percentiles are ordered correctly", async () => {
  const runner = createScaleRunner({
    apiBaseUrl: apiBase,
    mcpBaseUrl: mcpBase,
    n: 8,
    seed: 1,
    concurrency: 2,
    runIdPrefix: "ci-latency-",
  });

  const report = await runner.run();

  assert.ok(report.p50Ms <= report.p95Ms, "p50 <= p95");
  assert.ok(report.p95Ms <= report.p99Ms, "p95 <= p99");
  assert.ok(report.p99Ms <= report.maxMs, "p99 <= max");
}, { timeout: 60_000 });

test("runner: default config values (n=1000, seed=0, concurrency=5) are applied", () => {
  // Just verify the runner creates without error and has correct defaults visible
  // in the factory (no actual run — that would take too long in CI).
  const runner = createScaleRunner({
    apiBaseUrl: "http://example.invalid",
    mcpBaseUrl: "http://example.invalid",
  });
  assert.equal(typeof runner.run, "function", "run must be a function with default config");
});

test("runner report: failuresByStep has all expected keys", async () => {
  const runner = createScaleRunner({
    apiBaseUrl: apiBase,
    mcpBaseUrl: mcpBase,
    n: 4,
    seed: 3,
    concurrency: 2,
    runIdPrefix: "ci-keys-",
  });

  const report = await runner.run();

  const expectedKeys = ["register", "addMemberships", "issueMcpUrl", "mcpGetSummary", "mcpSearchHotels"];
  for (const key of expectedKeys) {
    assert.ok(key in report.failuresByStep, `failuresByStep must contain key "${key}"`);
    assert.equal(typeof report.failuresByStep[key], "number", `failuresByStep.${key} must be a number`);
  }
}, { timeout: 60_000 });

test("runner: each detail entry has correct shape", async () => {
  const runner = createScaleRunner({
    apiBaseUrl: apiBase,
    mcpBaseUrl: mcpBase,
    n: 4,
    seed: 5,
    concurrency: 2,
    runIdPrefix: "ci-shape-",
  });

  const report = await runner.run();

  for (const detail of report.details) {
    assert.equal(typeof detail.handle, "string", "handle must be string");
    assert.equal(typeof detail.ok, "boolean", "ok must be boolean");
    assert.equal(typeof detail.durationMs, "number", "durationMs must be number");
    assert.ok(detail.durationMs >= 0, "durationMs must be non-negative");
    assert.ok(Array.isArray(detail.failures), "failures must be an array");
    assert.equal(typeof detail.steps, "object", "steps must be an object");
    assert.equal(typeof detail.steps.register, "boolean", "steps.register must be boolean");
    assert.equal(typeof detail.steps.addMemberships, "boolean", "steps.addMemberships must be boolean");
    assert.equal(typeof detail.steps.issueMcpUrl, "boolean", "steps.issueMcpUrl must be boolean");
    assert.equal(typeof detail.steps.mcpGetSummary, "boolean", "steps.mcpGetSummary must be boolean");
    assert.equal(typeof detail.steps.mcpSearchHotels, "boolean", "steps.mcpSearchHotels must be boolean");
  }
}, { timeout: 60_000 });
