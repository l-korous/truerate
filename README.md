# TrueRate

The rate that's actually yours. Online search is anonymous — it shows everyone
the same options, blind to the loyalty memberships and perks a person already
holds. TrueRate keeps a user's whole membership stack in one place and reveals
**which discounts, perks and conditions** those memberships unlock — never
prices — on two surfaces: a **browser extension** and an **MCP server** that
gives AI assistants membership-aware hotel intelligence. A web app manages the
memberships.

> New here? Read `AGENTS.md` first — it carries the business context, the value
> proposition, the threat model, and the invariants you must not break.

## Status

Runs end-to-end in **mock mode** — deterministic seed-catalog data, so the whole
product is demoable and testable without Azure or provider credentials. TrueRate
maps a user's memberships to the **discounts, perks and conditions** they unlock,
plus a per-perk **value estimate** (e.g. free early check-in ≈ $20/$40/$60 at
3/4/5★). It deliberately **never fetches or computes hotel prices** — base prices
belong to the channel or the AI assistant. See `AGENTS.md` and issue #1 for the
authoritative product model.

## Production

Deployed to **Azure Container Apps** (scale-to-zero, so the *first* request after
idle cold-starts in ~10–30 s, then it's fast):

| Surface | URL | Health check |
| --- | --- | --- |
| **Web** | https://truerate-web.victoriousdune-875f3535.westeurope.azurecontainerapps.io | open in a browser |
| **API** | https://truerate-api.victoriousdune-875f3535.westeurope.azurecontainerapps.io | `GET /health` → `{"ok":true,"mode":"mock"}` |
| **MCP** | https://truerate-mcp.victoriousdune-875f3535.westeurope.azurecontainerapps.io | `GET /health` → `{"ok":true,"mode":"mock"}` |

Images are public on `ghcr.io/l-korous/truerate-{api,mcp,web}`; every push to
`main` redeploys via the **Deploy (Azure)** GitHub Actions workflow.

### How to test it

1. **Web** — open the Web URL, **create an account**, and add a membership
   (e.g. *Marriott Bonvoy* or *Booking Genius*). The app shows which
   **discounts, perks and conditions** that membership unlocks and an estimated
   **value of each perk**. No prices are shown or computed — that's the product.
2. **Get your MCP URL** — in the web app open the **MCP URL** page, copy your
   personal URL (`…/u/<token>/mcp`), and rotate/revoke it there. The token *is*
   the credential — treat the URL as a secret.
3. **Connect an AI assistant** — add that URL to your assistant's MCP config
   (e.g. Claude Desktop). Ask about a hotel or brand; it calls TrueRate's tools
   (`search_hotels`, `get_membership_summary`) and gets back the discounts,
   perks and conditions that apply to *your* memberships — never a price.
4. **Browser extension** — load the extension, sign in, and browse a supported
   hotel/OTA site; the TrueRate panel surfaces which of your memberships apply,
   marking anything already reflected on the page (e.g. Booking Genius) as
   *already applied* rather than implying an extra discount.

> **Mock mode.** `/health` reports `"mode":"mock"`: the catalog and enrichment
> run on deterministic seed data, so everything is demoable without provider
> credentials. TrueRate never fetches hotel prices in any mode.

## Layout

```
packages/core      domain model, program catalog, crypto, Cosmos access,
                   Booking adapter, enrichment engine  (all business logic)
apps/api           Hono HTTP API — auth, membership CRUD, enrichment
apps/mcp           stateless Streamable-HTTP MCP server (hotel tools)
apps/web           Next.js membership-management app
apps/extension     WXT / Manifest V3 extension (Booking.com)
infra              Azure Bicep + deploy script (Cosmos, Container Apps, KV)
```

## Quickstart (local, mock mode)

Requires Node 20+ and pnpm (`corepack enable`).

```bash
pnpm install
cp .env.example .env
# generate the credential key the API/MCP need:
node -e "console.log('TRUERATE_CRED_KEY=' + require('crypto').randomBytes(32).toString('base64'))" >> .env
# set a JWT secret too:
echo "TRUERATE_JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env
```

Run the surfaces (separate terminals, or use a process manager):

```bash
pnpm dev:api    # http://localhost:8787  (TRUERATE_INMEMORY=true by default)
pnpm dev:mcp    # http://localhost:8788/mcp
pnpm dev:web    # http://localhost:3000
pnpm dev:ext    # loads the extension in a dev browser (WXT)
```

In the web app: create an account → add a membership (e.g. **Booking Genius** or
**Marriott Bonvoy**) → see the **discounts, perks and conditions** it unlocks and
the estimated value of each perk. (No prices — that's the product model.)

### Connecting the MCP server to an assistant

Two ways to authenticate. **Personal MCP URL** — copy `…/u/<token>/mcp` from the
web app's MCP URL page (works with desktop MCP clients that can't send custom
headers); locally that's `http://localhost:8788/u/<token>/mcp`. Or a **bearer
JWT** — point the client at `http://localhost:8788/mcp` with
`Authorization: Bearer <token>`. Tools: `search_hotels` and
`get_membership_summary` — both return applicable discounts/perks/conditions,
never prices.

### Wiring the extension to the API

The API base is injected at build time (`API_BASE_URL`, default
`http://localhost:8787`). Sign in via the extension popup, then open any
Booking.com search results page — the TrueRate panel appears bottom-right.

## Tests

```bash
pnpm test        # builds core, then node:test across packages (200+ tests)
pnpm test:e2e    # Playwright web journey (see caveat below)
```

The suites cover the enrichment engine, credential encryption, the full API
auth/membership flow, the per-user MCP URL issuance/rotation, MCP tool
registration + formatting (asserting **no price fields** ever appear), and the
extension's URL parsing. The Playwright spec drives the real UI journey
(register → add membership → view applicable perks → manage your MCP URL).

## Caveats when building/running in locked-down CI

- **`next build` fetches fonts.** The web app uses `next/font/google`
  (Fraunces + Hanken Grotesk), which downloads at build time. On a runner that
  can't reach `fonts.googleapis.com` / `fonts.gstatic.com` the build fails. Fix:
  allow those hosts, or switch `app/layout.tsx` to `next/font/local` with the
  font files vendored in.
- **Playwright downloads browsers.** `pnpm exec playwright install chromium`
  needs the Playwright browser CDN. Allow it on CI, or run E2E where it's
  reachable.

## Deploy to Azure

See `infra/README.md`. Short version: `az login && ./infra/deploy.sh`.
