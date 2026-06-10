// Scale runner for the TrueRate synthetic-user harness (#335).
//
// Drives N personas through the full register → add-membership → MCP query
// flow against configurable API and MCP base URLs with concurrency and
// rate-limit-aware pacing.
//
// Hard rules enforced (matching product rule #1 / issue #1):
//   - No price fields in any response
//   - No 5xx HTTP status codes
//   - MCP summary must include all registered membership labels

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPersonaFactory, type TestPersona } from "./persona.js";

// ---------------------------------------------------------------------------
// MCP result typing
//
// The SDK's callTool() return has [x: string]: unknown which makes TypeScript
// treat named properties as unknown in strict mode. Cast to this local type
// which reflects only the fields we use.
// ---------------------------------------------------------------------------

interface McpToolResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
}

async function callMcpTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const raw = await client.callTool({ name, arguments: args });
  return raw as unknown as McpToolResult;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunnerConfig {
  /** Base URL for the TrueRate HTTP API (e.g. "http://localhost:8787"). */
  apiBaseUrl: string;
  /** Base URL for the TrueRate MCP server (e.g. "http://localhost:8788"). */
  mcpBaseUrl: string;
  /** Number of personas to drive. Default: 1000. */
  n?: number;
  /** Seeded PRNG seed for reproducible persona generation. Default: 0. */
  seed?: number;
  /** Max concurrent personas running at once. Default: 5. */
  concurrency?: number;
  /** Minimum delay in ms between starting each concurrent slot. Default: 0. */
  delayMs?: number;
  /** Optional prefix appended to emails to avoid collisions across runs. */
  runIdPrefix?: string;
}

export interface StepStatus {
  register: boolean;
  addMemberships: boolean;
  issueMcpUrl: boolean;
  mcpGetSummary: boolean;
  mcpSearchHotels: boolean;
}

export interface PersonaRunResult {
  handle: string;
  ok: boolean;
  durationMs: number;
  steps: StepStatus;
  /** Non-empty when ok=false. Each entry is a specific assertion failure. */
  failures: string[];
}

export interface ChannelCounts {
  registered: number;
  membershipsAdded: number;
  mcpTokensIssued: number;
  mcpSummaryCalls: number;
  mcpSearchCalls: number;
}

export interface RunReport {
  /** Total personas attempted. */
  n: number;
  /** Personas that completed all steps with no assertion failures. */
  passed: number;
  /** Personas that failed at least one step or assertion. */
  failed: number;
  /** Total wall-clock ms for the entire run. */
  durationMs: number;
  /** Median per-persona latency in ms. */
  p50Ms: number;
  /** 95th-percentile per-persona latency in ms. */
  p95Ms: number;
  /** 99th-percentile per-persona latency in ms. */
  p99Ms: number;
  /** Maximum per-persona latency in ms. */
  maxMs: number;
  /** Number of failures per step name. */
  failuresByStep: Record<string, number>;
  /** Per-channel call counts (useful for analytics verification). */
  channels: ChannelCounts;
  /** Per-persona detail (useful for debugging). */
  details: PersonaRunResult[];
}

export interface ScaleRunner {
  run(): Promise<RunReport>;
}

// ---------------------------------------------------------------------------
// Forbidden price fields (product rule #1 / issue #1)
// ---------------------------------------------------------------------------

const FORBIDDEN_PRICE_FIELDS = [
  "nightlyAmount",
  "totalAmount",
  "memberPrice",
  "basePrice",
  "finalPrice",
  "indicativePrice",
  "postDiscountPrice",
  "publicOffer",
  "nightly",
  "nightlyRate",
  "memberRate",
  "finalRate",
  "finalAmount",
  "baseRate",
  "discountedPrice",
  "discountedRate",
  "roomPrice",
  "roomRate",
];

function assertNoPriceFields(payload: unknown, label: string): string[] {
  const raw = JSON.stringify(payload);
  const violations: string[] = [];
  for (const field of FORBIDDEN_PRICE_FIELDS) {
    if (raw.includes(`"${field}"`)) {
      violations.push(`${label}: forbidden price field "${field}" (product rule #1)`);
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Program → hotel search context mapping
//
// Provides a search context for programs that match hotel queries so the
// runner can verify the discount/perks surface for relevant personas.
// Programs not listed here (e.g. subscription-category programs like revolut)
// do not produce hotel search matches and are skipped.
// ---------------------------------------------------------------------------

const PROGRAM_SEARCH_CONTEXTS: Record<string, Record<string, string | number>> = {
  booking_genius: { domain: "booking.com", location: "Prague" },
  marriott_bonvoy: { brand: "Marriott", location: "Vienna" },
  hilton_honors: { brand: "Hilton", location: "Amsterdam" },
  ihg_one_rewards: { brand: "InterContinental", location: "Budapest" },
  accor_all: { brand: "Novotel", location: "Prague" },
  emblem_prague: { domain: "emblemprague.com", location: "Prague" },
  your_prague_hotels: { domain: "praguehotels.eu", location: "Prague" },
  orea_hotels: { domain: "orea.cz", location: "Czech Republic" },
  hotels_com_one_key: { domain: "hotels.com", location: "Prague" },
};

// ---------------------------------------------------------------------------
// Concurrency helpers
// ---------------------------------------------------------------------------

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  delayMs: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const queue = [...items.map((item, i) => ({ item, i }))];
  const workers: Promise<void>[] = [];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) break;
      if (delayMs > 0) await sleep(delayMs);
      await fn(entry.item, entry.i);
    }
  }

  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedMs.length) - 1;
  return sortedMs[Math.max(0, idx)]!;
}

// ---------------------------------------------------------------------------
// Per-persona flow
// ---------------------------------------------------------------------------

async function runPersona(
  persona: TestPersona,
  runIdSuffix: string,
  apiBase: string,
  mcpBase: string,
): Promise<PersonaRunResult> {
  const start = Date.now();
  const failures: string[] = [];
  const steps: StepStatus = {
    register: false,
    addMemberships: false,
    issueMcpUrl: false,
    mcpGetSummary: false,
    mcpSearchHotels: false,
  };

  let jwtToken: string | null = null;
  let rawMcpToken: string | null = null;

  // ── 1. Register ─────────────────────────────────────────────────────────────
  try {
    const email = `${persona.handle}-${runIdSuffix}@truerate-test.local`;
    const res = await fetch(`${apiBase}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "harness-scale-pw-1234",
        market: persona.market.toLowerCase(),
      }),
    });
    if (!res.ok) {
      failures.push(`register: HTTP ${res.status}`);
    } else {
      const body = (await res.json()) as { token?: string };
      if (!body.token) {
        failures.push("register: missing JWT token in response");
      } else {
        jwtToken = body.token;
        steps.register = true;
      }
    }
  } catch (err) {
    failures.push(`register: ${String(err)}`);
  }

  if (!jwtToken) {
    return { handle: persona.handle, ok: false, durationMs: Date.now() - start, steps, failures };
  }

  // ── 2. Add memberships ──────────────────────────────────────────────────────
  let allMembershipsAdded = true;
  for (const m of persona.memberships) {
    if (!m.programId) continue;
    try {
      const body: Record<string, unknown> = { programId: m.programId };
      if (m.tier) body.tier = m.tier;

      const res = await fetch(`${apiBase}/memberships`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwtToken}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        failures.push(`addMembership(${m.programId}): HTTP ${res.status}`);
        allMembershipsAdded = false;
      }
    } catch (err) {
      failures.push(`addMembership(${m.programId}): ${String(err)}`);
      allMembershipsAdded = false;
    }
  }
  steps.addMemberships = allMembershipsAdded;

  // ── 3. Issue MCP URL ────────────────────────────────────────────────────────
  try {
    const res = await fetch(`${apiBase}/me/mcp-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwtToken}`,
      },
    });
    if (!res.ok) {
      failures.push(`issueMcpUrl: HTTP ${res.status}`);
    } else {
      const body = (await res.json()) as { token?: string };
      if (!body.token) {
        failures.push("issueMcpUrl: missing token in response");
      } else {
        rawMcpToken = body.token;
        steps.issueMcpUrl = true;
      }
    }
  } catch (err) {
    failures.push(`issueMcpUrl: ${String(err)}`);
  }

  if (!rawMcpToken) {
    return { handle: persona.handle, ok: false, durationMs: Date.now() - start, steps, failures };
  }

  // ── 4–5. MCP calls ──────────────────────────────────────────────────────────
  const mcpUrl = `${mcpBase}/u/${encodeURIComponent(rawMcpToken)}/mcp`;
  const client = new Client({ name: "truerate-scale-runner", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));

  try {
    await client.connect(transport);

    // ── 4. get_membership_summary ──────────────────────────────────────────
    try {
      const summaryResult = await callMcpTool(client, "get_membership_summary", {});
      const priceViolations = assertNoPriceFields(summaryResult, `${persona.handle}/summary`);
      failures.push(...priceViolations);

      if (!summaryResult.isError) {
        steps.mcpGetSummary = true;

        // Verify that each membership label appears in the summary text.
        const text = (summaryResult.content[0] as { type: string; text?: string } | undefined)?.text ?? "";
        for (const m of persona.memberships) {
          // Extract the program name from the membership label (before " — " or " - ").
          const programName = m.label.split(/\s+[—-]\s+/)[0]!.trim();
          // Flexible check: first word of the program name should appear.
          const firstWord = programName.split(/\s+/)[0]!;
          if (firstWord.length >= 3 && !text.toLowerCase().includes(firstWord.toLowerCase())) {
            failures.push(
              `${persona.handle}/summary: membership "${programName}" not found in summary text`,
            );
          }
        }
      } else {
        failures.push(`${persona.handle}/summary: MCP tool returned isError=true`);
      }
    } catch (err) {
      failures.push(`${persona.handle}/summary: ${String(err)}`);
    }

    // ── 5. search_hotels for each matchable program ────────────────────────
    let anySearchDone = false;
    for (const m of persona.memberships) {
      const ctx = m.programId ? PROGRAM_SEARCH_CONTEXTS[m.programId] : undefined;
      if (!ctx) continue;

      try {
        const searchResult = await callMcpTool(client, "search_hotels", ctx as Record<string, unknown>);
        const priceViolations = assertNoPriceFields(
          searchResult,
          `${persona.handle}/search(${m.programId})`,
        );
        failures.push(...priceViolations);

        if (searchResult.isError) {
          failures.push(
            `${persona.handle}/search(${m.programId}): MCP tool returned isError=true`,
          );
        } else {
          anySearchDone = true;
          // Check the no-prices disclaimer is present in the formatted text.
          const text =
            (searchResult.content[0] as { type: string; text?: string } | undefined)?.text ?? "";
          if (text && !/prices are not returned/i.test(text)) {
            failures.push(
              `${persona.handle}/search(${m.programId}): no-prices disclaimer missing in formatted text`,
            );
          }
        }
      } catch (err) {
        failures.push(`${persona.handle}/search(${m.programId}): ${String(err)}`);
      }
    }
    // Mark mcpSearchHotels true if at least one searchable program ran without error.
    if (anySearchDone) steps.mcpSearchHotels = true;
  } finally {
    try {
      await transport.close();
    } catch {
      // ignore close errors
    }
  }

  const ok = failures.length === 0;
  return {
    handle: persona.handle,
    ok,
    durationMs: Date.now() - start,
    steps,
    failures,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createScaleRunner(config: RunnerConfig): ScaleRunner {
  const {
    apiBaseUrl,
    mcpBaseUrl,
    n = 1000,
    seed = 0,
    concurrency = 5,
    delayMs = 0,
    runIdPrefix = "",
  } = config;

  const apiBase = apiBaseUrl.replace(/\/$/, "");
  const mcpBase = mcpBaseUrl.replace(/\/$/, "");

  return {
    async run(): Promise<RunReport> {
      const factory = createPersonaFactory();
      const personas = factory.build(n, seed);

      const runId = `${runIdPrefix}${seed}-${Date.now()}`;
      const results: PersonaRunResult[] = new Array(n);
      const runStart = Date.now();

      await runWithConcurrency(personas, concurrency, delayMs, async (persona, i) => {
        const runIdSuffix = `${runId}-${i}`;
        results[i] = await runPersona(persona, runIdSuffix, apiBase, mcpBase);
      });

      factory.teardown();

      const runDuration = Date.now() - runStart;
      const passed = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok).length;

      // Compute latency percentiles.
      const sortedMs = results.map((r) => r.durationMs).sort((a, b) => a - b);

      // Failure counts per step.
      const failuresByStep: Record<string, number> = {
        register: 0,
        addMemberships: 0,
        issueMcpUrl: 0,
        mcpGetSummary: 0,
        mcpSearchHotels: 0,
      };
      for (const r of results) {
        if (!r.ok) {
          for (const [step, ok] of Object.entries(r.steps)) {
            if (!ok) failuresByStep[step] = (failuresByStep[step] ?? 0) + 1;
          }
        }
      }

      // Channel counts.
      const channels: ChannelCounts = {
        registered: results.filter((r) => r.steps.register).length,
        membershipsAdded: results.filter((r) => r.steps.addMemberships).length,
        mcpTokensIssued: results.filter((r) => r.steps.issueMcpUrl).length,
        mcpSummaryCalls: results.filter((r) => r.steps.mcpGetSummary).length,
        mcpSearchCalls: results.filter((r) => r.steps.mcpSearchHotels).length,
      };

      return {
        n,
        passed,
        failed,
        durationMs: runDuration,
        p50Ms: percentile(sortedMs, 50),
        p95Ms: percentile(sortedMs, 95),
        p99Ms: percentile(sortedMs, 99),
        maxMs: sortedMs[sortedMs.length - 1] ?? 0,
        failuresByStep,
        channels,
        details: results,
      };
    },
  };
}
