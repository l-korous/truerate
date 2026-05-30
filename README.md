# TrueRate

The rate that's actually yours. Online search is anonymous — it shows everyone
the same price, blind to the loyalty memberships and perks a person already
holds. TrueRate keeps a user's whole membership stack in one place and reveals
the real rate, on two surfaces: a **browser extension** (Booking.com, in this
MVP) and an **MCP server** that gives AI assistants membership-aware hotel
search. A web app manages the memberships.

> New here? Read `AGENTS.md` first — it carries the business context, the value
> proposition, the threat model, and the invariants you must not break.

## Status

Runs end-to-end **today in mock mode** — no Azure, no provider credentials. The
enrichment engine produces deterministic, realistic anonymous-vs-member rate
deltas so the whole product is demoable and testable. The genuinely hard part —
fetching a user's *real* authenticated member rate — is stubbed and clearly
marked in `packages/core/src/providers/booking.ts`. That is the business, not a
loose end; see `AGENTS.md`.

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

In the web app: create an account → add a **Booking.com Genius** membership at
**Level 3** → open the **Try it** tab → *Reveal my rates*. You'll see the
anonymous price struck through against the member rate and the saving.

### Connecting the MCP server to an assistant

The MCP server authenticates with a TrueRate JWT as a bearer token (the same
token the web app issues). Point your assistant's MCP client at
`http://localhost:8788/mcp` with `Authorization: Bearer <token>`. Tools:
`search_hotels` and `get_membership_summary`.

### Wiring the extension to the API

The API base is injected at build time (`API_BASE_URL`, default
`http://localhost:8787`). Sign in via the extension popup, then open any
Booking.com search results page — the TrueRate panel appears bottom-right.

## Tests

```bash
pnpm test        # builds core, then node:test across packages (34 tests)
pnpm test:e2e    # Playwright web journey (see caveat below)
```

The suites cover the enrichment engine, credential encryption, the full API
auth/membership/search flow, MCP tool registration + formatting, and the
extension's Booking URL parser. The Playwright spec drives the real UI journey
(register → add membership → reveal savings).

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
