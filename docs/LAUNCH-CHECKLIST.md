# TrueRate — Launch Checklist & Go/No-Go

**Related epics:** #23 (domain/TLS), #24 (marketing/legal), #25 (store submissions), #26 (production readiness)  
**Product model:** #1 (authoritative — read first)

This document is the gate that production launch must pass through. Every item below must be **checked off and signed off** before traffic is cut over to the custom domain and public announcements go out.

---

## How to use this document

1. Work through each section in order — infrastructure before app, app before legal, legal before stores.
2. For each item, mark it **[x]** only after personally verifying it, not after reading code.
3. Items marked **🚫 LAUNCH-BLOCKING** must be complete before the go/no-go meeting. All others are strongly recommended but can have a short post-launch tail if explicitly accepted by the owner.

---

## Section 1 — Domain, DNS & TLS (epic #23)

| # | Item | Issue | Owner | Status |
|---|------|-------|-------|--------|
| 1.1 | Domain purchased and registered | #83 | l-korous | [ ] |
| 1.2 | Custom domain configured on Container Apps (api, mcp, web) | #86 | l-korous | [ ] |
| 1.3 | Managed TLS certificate issued and valid for all three endpoints | #86 | l-korous | [ ] |
| 1.4 | DNS records propagated; `dig`/`nslookup` resolves all three FQDNs | #86 | l-korous | [ ] |
| 1.5 | Optional CDN layer configured (or explicitly deferred) | #90 | l-korous | [ ] |
| 1.6 | Old `.azurecontainerapps.io` URLs redirect or are retired | #86 | l-korous | [ ] |

**🚫 LAUNCH-BLOCKING:** 1.1, 1.2, 1.3, 1.4

---

## Section 2 — CORS & Security hardening 🚫 LAUNCH-BLOCKING

> CORS is currently open (`*`). This must be locked down before any public traffic.

| # | Item | Notes | Owner | Status |
|---|------|-------|-------|--------|
| 2.1 | API CORS `allowedOrigins` set to the production custom domain only | No wildcard `*` in production | l-korous | [ ] |
| 2.2 | MCP CORS `allowedOrigins` set to the production custom domain only | Ditto | l-korous | [ ] |
| 2.3 | `Content-Security-Policy` header configured on web app | Block inline scripts except what Next.js requires | l-korous | [ ] |
| 2.4 | `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` set | Standard hardening | l-korous | [ ] |
| 2.5 | Secrets confirmed not logged anywhere (`TRUERATE_JWT_SECRET`, `TRUERATE_CRED_KEY`) | Audit log analytics for secret substrings | l-korous | [ ] |
| 2.6 | Key Vault firewall / network rules reviewed | Minimal required access | l-korous | [ ] |

**🚫 LAUNCH-BLOCKING:** 2.1, 2.2, 2.5

---

## Section 3 — Marketing site, SEO & Legal/GDPR (epic #24)

| # | Item | Issue | Owner | Status |
|---|------|-------|-------|--------|
| 3.1 | Marketing / landing site deployed and reachable on custom domain | #94 | l-korous | [ ] |
| 3.2 | SEO: `<meta>` description, Open Graph tags, sitemap.xml, robots.txt | #98 | l-korous | [ ] |
| 3.3 | i18n: at minimum `en` copy is final; `cs`, `de`, `pl`, `sk`, `hu`, `de-AT` present or deferred | #98 | l-korous | [ ] |
| 3.4 | Terms of Service page live and linked from footer | #102 | l-korous | [ ] |
| 3.5 | Privacy Policy page live and linked from footer | #102 | l-korous | [ ] |
| 3.6 | GDPR/DPA data-processing register entry created (or confirmed not required for hobby scale) | #102 | l-korous | [ ] |
| 3.7 | Cookie consent banner implemented and functional | #102 | l-korous | [ ] |
| 3.8 | Cookie policy page live and linked from banner | #102 | l-korous | [ ] |

**🚫 LAUNCH-BLOCKING:** 3.1, 3.4, 3.5, 3.7

---

## Section 4 — Browser extension store submissions (epic #25)

| # | Item | Issue | Owner | Status |
|---|------|-------|-------|--------|
| 4.1 | Store assets (icons, screenshots, promo tile) created for all stores | #120 | l-korous | [ ] |
| 4.2 | Privacy disclosure written and consistent with Privacy Policy | #120 | l-korous | [ ] |
| 4.3 | Chrome Web Store submission submitted; review in progress or approved | #108 | l-korous | [ ] |
| 4.4 | Firefox AMO submission submitted; review in progress or approved | #111 | l-korous | [ ] |
| 4.5 | Edge Add-ons submission submitted; review in progress or approved | #114 | l-korous | [ ] |
| 4.6 | At least one store approved and extension installable by public | #108/#111/#114 | l-korous | [ ] |

**🚫 LAUNCH-BLOCKING:** 4.6 (at least one store live)

> Note: Store reviews can take days–weeks. Submit early. Launch can proceed if at least one store is live.

---

## Section 5 — Production readiness & scale (epic #26)

| # | Item | Issue | Owner | Status |
|---|------|-------|-------|--------|
| 5.1 | Load test run: cold-start latency p99 < 2 s under 50 concurrent users | #125 | l-korous | [ ] |
| 5.2 | Cosmos DB throughput validated; no 429s under load test | #125 | l-korous | [ ] |
| 5.3 | Scale-to-zero confirmed: min-replicas = 0 for api, mcp, web | #125 | l-korous | [ ] |
| 5.4 | Log Analytics daily cap set (0.5 GB/day) to prevent surprise billing | — | l-korous | [ ] |
| 5.5 | On-call runbook documented and reviewed | #128 | l-korous | [ ] |
| 5.6 | Rollback runbook reviewed and tested in staging (see `docs/RUNBOOK-rollback.md`) | #27/#29 | l-korous | [ ] |
| 5.7 | Health probes returning 200 on all three services at launch time | — | l-korous | [ ] |
| 5.8 | Analytics / activation funnel instrumented | #137 | l-korous | [ ] |
| 5.9 | Alerting rule configured: alert if any service is down > 5 min | — | l-korous | [ ] |
| 5.10 | ghcr.io packages (truerate-api, truerate-mcp, truerate-web) confirmed public | `docs/DEPLOYMENT.md` | l-korous | [ ] |

**🚫 LAUNCH-BLOCKING:** 5.3, 5.4, 5.5, 5.6, 5.7, 5.10

---

## Section 6 — Functional smoke-test

Run these immediately before the go/no-go meeting on the production custom domain:

```bash
# Replace with actual production FQDNs once domain is live
PROD_API="https://api.truerate.io"     # update to real domain
PROD_MCP="https://mcp.truerate.io"     # update to real domain
PROD_WEB="https://truerate.io"         # update to real domain

echo "API health..."
curl --fail --silent --show-error "${PROD_API}/health" | jq .

echo "MCP health..."
curl --fail --silent --show-error "${PROD_MCP}/health" | jq .

echo "Web health..."
curl --fail --silent --show-error "${PROD_WEB}/api/health" | jq .
```

| # | Smoke test | Expected | Status |
|---|------------|----------|--------|
| 6.1 | `GET /health` on api returns `{"status":"ok"}` | HTTP 200 | [ ] |
| 6.2 | `GET /health` on mcp returns `{"status":"ok"}` | HTTP 200 | [ ] |
| 6.3 | `GET /api/health` on web returns `{"status":"ok"}` | HTTP 200 | [ ] |
| 6.4 | Web app loads, sign-in flow works end-to-end | No JS errors in console | [ ] |
| 6.5 | Membership vault: add/edit/delete a membership | Round-trips correctly | [ ] |
| 6.6 | MCP URL displayed in web app settings | URL is per-user and functional | [ ] |
| 6.7 | TLS cert is valid and not expiring within 30 days | Green padlock | [ ] |
| 6.8 | CORS rejection on an unlisted origin | `curl -H "Origin: https://evil.example" …` returns no CORS headers | [ ] |

**🚫 LAUNCH-BLOCKING:** All items in Section 6.

---

## Go/No-Go Criteria

The launch is **GO** when all of the following are true:

- [ ] **All 🚫 LAUNCH-BLOCKING items** across Sections 1–6 are checked off.
- [ ] CI is green on the `main` commit that will be live at launch (Typecheck & test · Build web · Playwright journey).
- [ ] No P0/P1 open bugs on the `Phase 3 — Public launch` milestone.
- [ ] Sign-offs from all owners are recorded below.

The launch is **NO-GO** if any blocking item is unchecked or any sign-off is missing.

### Sign-off table

| Area | Owner | Sign-off date | Notes |
|------|-------|--------------|-------|
| Domain / TLS / Security | l-korous | | |
| Marketing / Legal | l-korous | | |
| Extension stores | l-korous | | |
| Production readiness | l-korous | | |
| Final functional smoke | l-korous | | |

---

## Abort / Rollback Plan

If a problem is discovered during or immediately after launch:

### Immediate abort (pre-traffic-cutover)

- Do **not** update DNS to point the custom domain at the Container Apps FQDNs.
- Post a status message to any community channels explaining the delay.
- File a new GitHub issue for the blocking problem, label it `P0`, and link it from this checklist.

### Post-cutover rollback (within the first 24 hours)

1. **Revert DNS** — point the custom domain back to a holding/maintenance page, or remove the A/CNAME records to take the service offline gracefully.
2. **Rollback Container Apps** — follow `docs/RUNBOOK-rollback.md` to pin traffic to the last-good revision.
3. **Communicate** — post a status update; give an ETA for re-launch.
4. **Root-cause** — file or update the P0 issue; do not re-launch until the root cause is resolved and the fix is CI-green.

### Rollback decision thresholds

| Condition | Action |
|-----------|--------|
| Health probe failure on any service | Immediate rollback |
| > 5% of sign-in attempts failing | Immediate rollback |
| > 1% of vault read/write operations returning 5xx | Rollback within 15 minutes if not fixed |
| CORS headers missing or wrong | Immediate rollback (security) |
| Any secret leaked in logs | Immediate rollback + secret rotation (see `docs/RUNBOOK-secret-rotation.md`) |
| TLS cert invalid | Immediate rollback until cert is valid |

---

## Checklist sign-off procedure

When all items are complete:

1. The owner checks off every blocking item in this document and in the PR.
2. A final smoke test is run and results are pasted into the PR comments.
3. The go/no-go meeting (even if async, in a GitHub comment) is held and sign-offs are recorded in the table above.
4. This document is merged to `main` with the sign-off table filled in.
5. DNS is cut over and launch is announced.
