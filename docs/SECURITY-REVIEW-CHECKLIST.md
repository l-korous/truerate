# TrueRate — Security Review Checklist for Agent PRs

**Use this checklist on every agent PR before marking it ready for review.**
**Threat model:** `docs/THREAT-MODEL.md` | **Product rules:** issue #1

A PR may not be marked ready if any **BLOCKING** item is unresolved.

---

## How to use

1. Copy this checklist into the PR description (or run through it mentally and check each item).
2. For each item, check it only after actually verifying — not from reasoning alone.
3. Items marked **🚫 BLOCKING** must pass before the PR is marked ready.

---

## Section 1 — No price handling 🚫 BLOCKING

These items enforce product rule #1 (issue #1). A violation here is not a style issue; it is a product violation.

- [ ] **1.1** The PR does not fetch hotel prices from any provider API.
- [ ] **1.2** The PR does not compute or return a post-discount, "final", or "indicative member price" in any surface (core, api, mcp, web, extension).
- [ ] **1.3** Any perk-value estimate added uses only the fixed tiers: ≈$20 at 3★ / ≈$40 at 4★ / ≈$60 at 5★ (or is explicitly justified in the PR as an authorised extension).
- [ ] **1.4** The extension does not read the user's logged-in session or authenticated rate from any third-party provider (MVP rule).

---

## Section 2 — Authentication & authorisation 🚫 BLOCKING

- [ ] **2.1** All API and MCP routes that access user data require and validate a JWT / opaque bearer token; no route is accidentally left open.
- [ ] **2.2** Cosmos queries always include a `userId` filter derived from the JWT `sub` claim. `userId` is never accepted from the request body or query string.
- [ ] **2.3** The PR does not introduce any path where user A can read or modify user B's vault data.
- [ ] **2.4** New JWT claims or token-verification logic is reviewed for bypass conditions.

---

## Section 3 — CORS 🚫 BLOCKING (after #52 is merged)

> Until #52 lands, wildcard CORS is the status quo. Once #52 merges, these items become blocking.

- [ ] **3.1** `allowedOrigins` for api and mcp is set to the known web origin and extension ID only. Wildcard `*` is not present except in local/dev configuration.
- [ ] **3.2** New endpoints added to api or mcp inherit the existing CORS middleware and are not accidentally excluded.
- [ ] **3.3** `Content-Security-Policy` header on the web app is not weakened by this PR.

---

## Section 4 — Rate limiting

> Planned in #53. Once #53 merges, item 4.1 becomes blocking.

- [ ] **4.1** New API or MCP endpoints are covered by the rate-limiting middleware. A new route does not bypass rate limiting.
- [ ] **4.2** Any endpoint that triggers Cosmos reads/writes has a per-user rate limit in place or a justified exception noted in the PR.

---

## Section 5 — Input validation with Zod 🚫 BLOCKING (after #54 is merged)

- [ ] **5.1** Every request body and route parameter on new or modified API/MCP endpoints is validated with a Zod schema.
- [ ] **5.2** Zod schemas use `.strict()` or explicitly strip unknown fields; no pass-through of unvalidated data to Cosmos or downstream logic.
- [ ] **5.3** String fields that reach MCP tool output (visible to AI assistants) are sanitised to prevent prompt-injection payloads.
- [ ] **5.4** Cosmos queries use the SDK's parameterised call pattern; no user input is interpolated into query strings.

---

## Section 6 — Secret & key handling 🚫 BLOCKING

- [ ] **6.1** No secret value (`TRUERATE_CRED_KEY`, `TRUERATE_JWT_SECRET`, or any credential) is hardcoded in source, test fixtures, or config files.
- [ ] **6.2** Secrets are consumed from environment variables or Key Vault only; never derived from user input or stored in Cosmos in plaintext.
- [ ] **6.3** New credential fields added to the data model are encrypted with `core/crypto.ts` before persistence and decrypted only when needed for outbound calls.
- [ ] **6.4** The MCP per-user opaque URL is not logged, included in error messages, or returned in any non-user-settings response.

---

## Section 7 — Logging hygiene 🚫 BLOCKING

> Structured logging is tracked in #48 / epic #5. Items here apply now regardless.

- [ ] **7.1** No `console.log` / `console.error` call in this PR emits a decrypted credential, the JWT secret, the cred key, or the MCP opaque URL.
- [ ] **7.2** No log line includes raw PII: user email, display name, IP address, or full membership credential. Use opaque IDs (`userId`, correlation IDs) instead.
- [ ] **7.3** No hotel price (fetched or computed) appears in any log line.
- [ ] **7.4** Error responses returned to clients do not leak internal stack traces, secret values, or Cosmos query internals.

---

## Section 8 — Phase 0 gating

- [ ] **8.1** This PR does not expose a new public-facing surface (new Container App, new subdomain, public API endpoint) without the security baseline (#6) being in place for that surface.
- [ ] **8.2** If this PR adds a new channel or surface, CORS, rate limiting, and Zod validation are implemented for it in the same PR or a linked blocking issue exists.

---

## Section 9 — General security hygiene

- [ ] **9.1** No new npm dependency with known HIGH or CRITICAL CVEs is introduced (`pnpm audit` passes).
- [ ] **9.2** Extension manifest does not request permissions beyond what the feature requires (`cookies` permission not added without explicit justification and security review).
- [ ] **9.3** Extension content script does not receive or store the API auth token; only the background worker holds it.
- [ ] **9.4** Cosmos schema changes are backward-compatible within a single deploy (required for zero-downtime).

---

## Reviewer sign-off

When all applicable items are checked:

```
Security checklist reviewed by: <github-handle>
Date: <YYYY-MM-DD>
Notes: <any deferred items or exceptions with linked issues>
```

---

## References

- Product rules (no prices, no logged-in session reads): issue #1
- Threat model: `docs/THREAT-MODEL.md`
- Security baseline epic: #6
  - #52 Lock CORS to known origins
  - #53 Rate limiting on API + MCP
  - #54 Zod input validation
  - #55 Secret rotation runbook + cred-key versioning
- Observability epic (logging): #5
  - #48 Structured logging + correlation IDs
- Secret rotation runbook: `docs/RUNBOOK-secret-rotation.md`
- Launch checklist: `docs/LAUNCH-CHECKLIST.md`
