#!/usr/bin/env node
// Post-deploy smoke test — exercises the REAL member core loop against the
// freshly-deployed Azure environment and fails loudly if anything is broken.
//
// This is the gate that catches "deployed but broken" outages that green
// health checks miss (e.g. POST /memberships 500'ing against Cosmos while
// /health stays 200).
//
// Flow against the live URLs:
//   1. health: api/health, web/api/health, MCP returns 401 without a token
//   2. register a throwaway user
//   3. add a Booking Genius L3 membership      <-- the core action
//   4. GET /me: assert the 20% discount + perks surfaced
//   5. real MCP client (user token) → search_hotels → same Genius intelligence
//      (proves the MCP leg + shared Cosmos store across api/mcp)
//   6. assert NO price leak anywhere (product rule #1)
//   7. best-effort cleanup of the throwaway membership
//
// Exit 0 = healthy; non-zero = fail the deploy (→ rollback).
// Usage: API_URL=.. WEB_URL=.. MCP_URL=.. node apps/mcp/scripts/post-deploy-smoke.mjs

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const API = (process.env.API_URL || "").replace(/\/$/, "");
const WEB = (process.env.WEB_URL || "").replace(/\/$/, "");
const MCP = (process.env.MCP_URL || "").replace(/\/$/, "");
if (!API || !WEB || !MCP) {
  console.error("FAIL: API_URL, WEB_URL and MCP_URL env vars are all required.");
  process.exit(2);
}

const FORBIDDEN_PRICE_FIELDS = [
  "publicOffer", "nightlyAmount", "totalAmount", "basePrice", "finalPrice",
  "memberPrice", "indicativePrice", "postDiscountPrice", "savingsAmount", "totalSavings",
];
const FORBIDDEN_PRICE_TEXT = /member price|final price|indicative (member )?price|post.?discount price/i;

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.error(`  ✗ ${m}`); failures++; };
const assert = (cond, m) => { cond ? ok(m) : bad(m); };

function assertNoPrices(label, value) {
  const json = JSON.stringify(value);
  const leaked = FORBIDDEN_PRICE_FIELDS.find((f) => new RegExp(`"${f}"\\s*:`).test(json));
  if (leaked) bad(`${label}: leaked forbidden price field "${leaked}"`);
  else if (FORBIDDEN_PRICE_TEXT.test(json)) bad(`${label}: leaked forbidden price text`);
  else ok(`${label}: no price leak`);
}

async function http(method, url, { token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: res.status, json, text };
}

async function main() {
  console.log(`Post-deploy smoke @ ${new Date().toISOString()}`);
  console.log(`  API=${API}\n  WEB=${WEB}\n  MCP=${MCP}/mcp`);

  console.log("\n[1] Health");
  const apiH = await http("GET", `${API}/health`);
  assert(apiH.status === 200 && apiH.json?.ok === true, `api /health 200 ok (got ${apiH.status})`);
  const webH = await http("GET", `${WEB}/api/health`);
  assert(webH.status === 200, `web /api/health 200 (got ${webH.status})`);
  const mcpNoAuth = await http("POST", `${MCP}/mcp`, { body: {} });
  assert(mcpNoAuth.status === 401, `mcp rejects no-token with 401 (got ${mcpNoAuth.status})`);

  console.log("\n[2] Register");
  const email = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@truerate-smoke.invalid`;
  const reg = await http("POST", `${API}/auth/register`, { body: { email, password: "smoke-pass-12345" } });
  assert(reg.status === 200 && typeof reg.json?.token === "string", `register 200 + token (got ${reg.status})`);
  const token = reg.json?.token;
  if (!token) { bad("no token — cannot continue"); return; }

  console.log("\n[3] Add membership (booking_genius / Level 3) — the core action");
  const add = await http("POST", `${API}/memberships`, { token, body: { programId: "booking_genius", tier: "Level 3" } });
  assert(add.status === 200, `add-membership 200 (got ${add.status})`);
  assert((add.json?.user?.memberships?.length ?? 0) >= 1, "membership persisted on user");
  assertNoPrices("add-membership response", add.json);

  console.log("\n[4] Read back /me");
  const me = await http("GET", `${API}/me`, { token });
  assert(me.status === 200, `/me 200 (got ${me.status})`);
  const benefits = me.json?.user?.memberships?.[0]?.benefits ?? [];
  assert(benefits.some((b) => b.value?.kind === "percentDiscount" && Math.round((b.value.percentOff ?? 0) * 100) === 20), "Genius L3 surfaces a 20% discount");
  assert(benefits.some((b) => (b.value?.perks?.length ?? 0) > 0 || (b.value?.structuredPerks?.length ?? 0) > 0), "Genius L3 surfaces perk(s)");
  assertNoPrices("/me response", me.json);

  console.log("\n[5] MCP search_hotels via real MCP client");
  let mcpResult;
  try {
    const transport = new StreamableHTTPClientTransport(new URL(`${MCP}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "post-deploy-smoke", version: "1.0.0" });
    await client.connect(transport);
    mcpResult = await client.callTool({ name: "search_hotels", arguments: { domain: "booking.com", location: "Vienna" } });
    await client.close();
    ok("MCP client connected + search_hotels returned");
  } catch (e) {
    bad(`MCP client call failed: ${e?.message ?? e}`);
  }
  if (mcpResult) {
    const sc = mcpResult.structuredContent ?? {};
    assert((sc.matches ?? []).some((m) => m.discount && Math.round((m.discount.percentOff ?? 0) * 100) === 20), "MCP returns the 20% Genius discount for the web-created user");
    assert((sc.programsApplied ?? []).includes("booking_genius"), "MCP programsApplied includes booking_genius");
    assertNoPrices("MCP structuredContent", sc);
    const mcpText = mcpResult.content?.map((c) => c.text).join("\n") ?? "";
    assert(/20% off/i.test(mcpText), "MCP text surfaces '20% off'");
    assertNoPrices("MCP text", mcpText);
  }

  console.log("\n[6] Cleanup");
  const mid = add.json?.user?.memberships?.[0]?.id;
  if (mid) { await http("DELETE", `${API}/memberships/${mid}`, { token }).catch(() => {}); ok("removed smoke membership"); }
}

main()
  .then(() => {
    console.log(`\n${failures === 0 ? "PASS — live member core loop is healthy" : `FAIL — ${failures} check(s) failed`}`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error("FAIL: smoke crashed:", e); process.exit(1); });
