# TrueRate — Threat Model

**Product model:** issue #1 (authoritative — read first)
**Security baseline epic:** #6 | **Observability epic:** #5
**Last reviewed:** 2026-06

---

## 1. Assets

| Asset | Description | Sensitivity |
|-------|-------------|-------------|
| **User membership vault** | Memberships, tiers, and perks the user declares; drives all benefit matching | High — personal financial profile |
| **Credential key (`TRUERATE_CRED_KEY`)** | AES-256-GCM key used to encrypt membership credentials at rest | Critical — loss enables mass decryption of all stored credentials |
| **JWT secret (`TRUERATE_JWT_SECRET`)** | HMAC secret used to sign/verify stateless JWTs | Critical — compromise enables arbitrary token forgery |
| **Encrypted membership credentials** | Third-party usernames/passwords stored as AES-256-GCM ciphertext in Cosmos | High — decrypted: access to users' loyalty accounts |
| **User identities** | Entra External ID accounts; email, display name, identity tokens | High — PII, account takeover if compromised |
| **MCP per-user URL** | Opaque bearer-token-embedded URL; grants full MCP access for that user | High — treat as a credential; must not be logged or returned publicly |
| **Program catalog** | Curated benefit templates (not user-specific); public by nature | Low — integrity matters, confidentiality does not |
| **Azure infrastructure** | Container Apps, Cosmos DB, Key Vault; the runtime environment | High — compromise enables data access or service disruption |

---

## 2. Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│  Internet / Untrusted                                           │
│                                                                 │
│   Browser (user)        AI assistant (Claude, ChatGPT, …)      │
│       │                          │                              │
│  ─────┼──────────────────────────┼──────── TLS boundary ──────  │
│       ▼                          ▼                              │
│  ┌─────────┐   HTTPS    ┌──────────────┐                        │
│  │  web    │            │   mcp app    │  per-user opaque URL   │
│  │ Next.js │            │  (Hono/HTTP) │  bearer token in URL   │
│  └────┬────┘            └──────┬───────┘                        │
│       │  JWT (Entra)           │  bearer (opaque URL)           │
│  ─────┼──────────────────────────┼──────── App boundary ──────  │
│       ▼                          ▼                              │
│  ┌───────────────────────────────────┐                          │
│  │          api app (Hono)           │  stateless JWT auth      │
│  └──────────────────┬────────────────┘                          │
│                     │                                           │
│  ───────────────────┼───────────────── Data boundary ────────  │
│                     ▼                                           │
│  ┌──────────────────────────────────┐                           │
│  │  Cosmos DB serverless            │  managed identity         │
│  │  (encrypted creds as ciphertext) │                           │
│  └──────────────────────────────────┘                           │
│                                                                 │
│  ┌──────────────────────────────────┐                           │
│  │  Azure Key Vault                 │  TRUERATE_CRED_KEY,       │
│  │                                  │  TRUERATE_JWT_SECRET      │
│  └──────────────────────────────────┘                           │
│                                                                 │
│  ┌────────────────────────────┐                                 │
│  │  Browser extension (MV3)   │  content script + bg worker    │
│  │  - content script: DOM     │  token stored in bg worker     │
│  │  - background worker: API  │  only; never content script    │
│  └────────────────────────────┘                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key trust decisions:**
- `api` and `mcp` trust a valid signed JWT / opaque URL bearer token respectively — not anything beyond that.
- Cosmos sees only ciphertext for credential fields; the application layer decrypts in-process.
- Key Vault is the only place secrets are authoritative; environment variables at runtime are derived from it.
- Extension background worker is the sole extension context that touches the API token; the content script never receives it.

---

## 3. Threats and Mitigations

Threats are rated **P0** (exploit = system compromise or mass data loss), **P1** (serious but contained), **P2** (moderate), **P3** (low / hardening).

### 3.1 Authentication & authorisation

| ID | Threat | Impact | Mitigation | Status | Issue |
|----|--------|--------|-----------|--------|-------|
| A-1 | JWT forged via weak or leaked secret | P0 — full account takeover | `TRUERATE_JWT_SECRET` stored in Key Vault; secret must be ≥ 256-bit random; rotation procedure in place | Partial — rotation runbook required | #55 |
| A-2 | MCP opaque URL shared or leaked (logs, screenshots) | P1 — full MCP access for that user | URL is opaque bearer token; must not be logged (see L-1); user can regenerate | Partial — log hygiene required | #48, #5 |
| A-3 | Authz bypass: user A reads/writes user B's vault | P0 — cross-user data access | All Cosmos queries include `userId` filter derived from JWT `sub`; never accept `userId` from request body | Required — Zod validation on all inputs | #54 |
| A-4 | Extension content script extracts API token | P1 — token exfiltration via page JS | Token lives only in background worker; content script communicates via `chrome.runtime.sendMessage` | Implemented (MV3 architecture) | — |

### 3.2 Injection

| ID | Threat | Impact | Mitigation | Status | Issue |
|----|--------|--------|-----------|--------|-------|
| I-1 | NoSQL injection into Cosmos queries | P1 — data exfiltration or corruption | Use parameterised SDK calls only; never interpolate user input into query strings | Required — enforce via Zod + code review | #54 |
| I-2 | Prompt injection via membership name/perk fields reaching MCP tool responses | P1 — AI assistant manipulation | MCP tools return structured JSON, not freeform text containing user data as prose; sanitise string fields in tool output | Required | #54 |
| I-3 | Path/header injection in API routes | P2 — unexpected behaviour | Hono route params validated with Zod; reject unknown fields | Required | #54 |

### 3.3 Data exfiltration & secret leakage

| ID | Threat | Impact | Mitigation | Status | Issue |
|----|--------|--------|-----------|--------|-------|
| D-1 | Decrypted credential logged | P0 — bulk credential exposure | Credentials decrypted only for outbound calls; never logged; `publicUser` strips encrypted fields from API responses; log review on every PR | Required — log hygiene checklist | #48, #5 |
| D-2 | `TRUERATE_CRED_KEY` or `TRUERATE_JWT_SECRET` logged or returned in response | P0 | Secrets consumed from Key Vault at startup; never passed to user-facing code paths; no `console.*` of env vars | Required | #48, #55 |
| D-3 | Cosmos leaks ciphertext to wrong user | P1 — ciphertext exposed (not plaintext) | All queries scope by `userId`; see A-3 | Required | #54 |
| D-4 | Extension reads logged-in third-party session cookies/rates | P1 — violates product rule #1; privacy/ToS risk | Extension reads only rendered DOM of public page; no `cookies` permission; content script does not call provider APIs | MVP rule — enforced in manifest review | — |

### 3.4 CORS & network-level abuse

| ID | Threat | Impact | Mitigation | Status | Issue |
|----|--------|--------|-----------|--------|-------|
| C-1 | Wildcard CORS on api/mcp allows any origin | P1 — CSRF-like exfiltration from malicious page | Lock `allowedOrigins` to known web origin + extension ID; wildcard only in local/dev | Planned | #52 |
| C-2 | MCP endpoint called from any browser origin | P1 | MCP CORS locked to extension ID and web origin | Planned | #52 |
| C-3 | Missing `Content-Security-Policy` on web app | P2 — XSS escalation | CSP configured in Next.js headers; block inline scripts | Planned | #52 |

### 3.5 Rate limiting & denial of service

| ID | Threat | Impact | Mitigation | Status | Issue |
|----|--------|--------|-----------|--------|-------|
| R-1 | Unauthenticated flood of api/mcp endpoints | P1 — Cosmos RU exhaustion, cost spike | Rate limiting per-IP + per-user on all routes | Planned | #53 |
| R-2 | Authenticated user abuses benefit-matching in a loop | P2 — cost, fairness | Per-user rate limit on `/benefits/match` and MCP tools | Planned | #53 |

### 3.6 Supply-chain & infrastructure

| ID | Threat | Impact | Mitigation | Status | Issue |
|----|--------|--------|-----------|--------|-------|
| S-1 | Malicious npm dependency | P1 | Dependabot alerts enabled; `pnpm audit` in CI; pin major versions | Ongoing | — |
| S-2 | Compromised ghcr.io image | P0 | Images built by CI only; sign with cosign (future); no push from developer laptops to prod tag | Partial | — |
| S-3 | Key Vault firewall open | P1 — secret read by external actor | Key Vault network rules: Container Apps managed identity only; developer access via PIM | Required | #6 |

### 3.7 Product-rule violations (introduced by agents)

| ID | Threat | Impact | Mitigation | Status | Issue |
|----|--------|--------|-----------|--------|-------|
| P-1 | Agent PR introduces price handling (fetch/return final prices) | P0 — violates product rule #1; legal/trust risk | "No price handling" item in security checklist; CI review; CLAUDE.md rule | Enforced via checklist | #1 |
| P-2 | Agent logs PII (email, name, IP) in plain text | P1 — GDPR exposure | Logging hygiene checklist item; structured logs use opaque IDs | Planned | #48, #5 |

---

## 4. Out of scope (MVP)

- Authenticated provider session reading (explicitly deferred per #1 rule 4).
- DDoS at network layer (mitigated by Azure Front Door / Container Apps infrastructure, not application code).
- Browser-store policy review (separate process).
- Penetration testing (post-Phase 0).

---

## 5. References

- Product rules: issue #1
- Security baseline epic: #6
  - #52 Lock CORS
  - #53 Rate limiting
  - #54 Zod input validation
  - #55 Secret rotation runbook + cred-key versioning
  - #56 This document
- Observability epic: #5
  - #48 Structured logging + correlation IDs
- Secret rotation runbook: `docs/RUNBOOK-secret-rotation.md`
- Rollback runbook: `docs/RUNBOOK-rollback.md`
- Launch checklist (security section): `docs/LAUNCH-CHECKLIST.md` §2
