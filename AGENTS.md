# AGENTS.md — TrueRate

Context for any agent (or human) extending this codebase. Read this before
making product or architecture decisions. The code tells you *how* things work;
this file tells you *why*, and what not to break.

## What TrueRate is

Online search for services is anonymous. The web shows everyone the same rate,
blind to the loyalty memberships, card perks, and status tiers a given person
already holds. A traveller might have Booking.com Genius 3, Hilton Honors Gold,
Miles & More, a Raiffeisen card earning Austrian Airlines miles, and Revolut
perks (free news subscription, −10% Avis) — and never see the rates any of them
unlock at the moment of decision.

TrueRate is the layer that knows the user's whole membership stack and reveals
the rate that is *actually theirs*, across two surfaces:

1. **Browser extension** — surfaces member rates and cross-provider comparisons
   on the search pages the user already browses (MVP: Booking.com).
2. **MCP server** — gives AI assistants (Claude, ChatGPT, etc.) the user's
   membership context so "find me a hotel in Vienna" returns personalised rates
   instead of generic ones (MVP: hotels).

A web app lets users manage which memberships they hold. The membership profile
is the product's core asset.

## The actual value proposition (do not get this wrong)

On a *single* provider site where the user is logged in, that provider already
shows them their own member rate. Re-displaying Booking's Genius price on
Booking.com is not the product. The defensible value is:

- **Cross-provider comparison** — "this exact hotel is cheaper via your Hilton
  Honors direct rate than the Genius price on this Booking page." The user's
  whole stack, compared at the point of decision.
- **Perk surfacing** — reminding the user of benefits they forgot they hold
  (Revolut's −10% Avis, a card's free night, lounge access) in the relevant
  context.
- **Membership-aware AI** — the assistant doesn't know the user has Genius 3.
  TrueRate's MCP makes it act as if it does.

Any feature that only re-shows one provider's own rate on that provider's own
site is low value. Build toward the comparison across the stack.

## Data model: the benefit is the primitive

The core primitive is a **benefit** — a structured rule the user holds, e.g.
"15% at Hotel PECR (pecr.cz)", "free breakfast at Marriott", "−10% Avis". A
benefit carries a `match` (how to recognise it: brand / domain / property name /
category), a `value` (percentDiscount, fixedDiscount, perk, pointsEarn, with
conditions), and a `source` (`catalog` | `user-declared` | `provider-live`).

This is the load-bearing design decision: **the discount rule comes from the
user or from TrueRate's curated catalog, not from a live provider API.** That
means the product delivers real value with zero integration:

- **Perks are exact and need no price at all** ("you get free breakfast here").
  Lead with these — highest trust, lowest effort.
- **A declared % discount becomes an indicative price**: read the PUBLIC price
  off the page (visible to anyone, no login) and apply the rule. Always label it
  estimate / "est." — never present it as guaranteed, because real discounts
  carry conditions.

The program **catalog** (`programs.ts`) is a curated library of benefit
TEMPLATES — "what each program brings", per tier. The user selects what they
hold; TrueRate instantiates the matching benefits onto their profile
(`instantiateBenefits`). Users can also declare fully custom benefits not in the
catalog (the Hotel PECR case). The `source` field is the upgrade path: a
declared/curated benefit can later be replaced or confirmed with a
`provider-live` value — optional, not required. The matcher (`match.ts`) is pure
(no node/browser deps) and is the single place that decides what applies.

The extension uses this via `POST /benefits/match`: it sends a `PageContext`
(domain + optional property + the public price it scraped) and gets back the
applicable perks and, if a discount applies, an indicative member price.

The catalog (`programs.ts`) is **researched from real programs**, not invented —
each entry records `sourceUrl`, `asOf`, and `region`. The MVP seed covers
Booking Genius; Czech direct-booking hotels (Your Prague Hotels ~10%, Emblem
Prague ~20%, OREA ~15%); the chains operating in CZ (Accor ALL, IHG, Hilton,
Marriott); a premium card (Amex Platinum); and a fintech (Revolut). Two honesty
rules are baked in: only programs that advertise a headline % carry a discount
(Genius, the Czech direct rates, Accor's member rate); big-chain status is
modelled as **perks by tier**, accurately (e.g. Marriott breakfast is
Platinum+, not Gold). Card/fintech perks are account-level (status, lounge,
credits, subscriptions), modelled as global perks. **This data goes stale** —
it belongs in an ops-editable store, and the provenance fields exist to make
refresh auditable.

## Strategic position and threat model

The founding strategic decision: **TrueRate never becomes a provider API
partner.** This is deliberate and load-bearing.

- **No API dependency → no API to revoke.** The cleanest lever a provider has
  (cutting partner access) does not exist against us.
- **The extension reads/acts on the rendered UI.** Providers change UIs on their
  own cadence for their own reasons; breaking our selectors is a side effect,
  not a strategy. Our cost to re-target selectors is hours; their cost to
  meaningfully restructure is a roadmap quarter. The asymmetry favours us.
- **On MCP we never touch the provider.** TrueRate is a context/orchestration
  layer that tells the assistant how to apply the user's status when *it* calls
  whatever provider tools exist. We are not a client of the provider's MCP.

Residual risks, in rough priority:

1. **Platform risk has moved to the AI platforms and providers' own MCPs.** If
   Anthropic/OpenAI ship native "membership memory," or a provider's own MCP
   becomes loyalty-aware, that erodes the MCP wedge. Watch this closely; it is
   the real competitive threat, not provider API cutoffs.
2. **Browser-store policy.** Honey-class extensions drew scrutiny for injecting
   affiliate links and last-click attribution games. TrueRate must NOT do this.
   We surface information; we do not hijack attribution or rewrite checkout. Stay
   clean here and store risk stays low.
3. **DOM-maintenance treadmill.** Selector drift on Booking and future OTAs is a
   maintenance cost, not an existential threat. Keep selectors isolated and
   testable (see `utils/booking-url.ts` for the pattern: pure, unit-tested
   functions, no browser globals).
4. **Cold-start data quality.** Value scales with how completely we model a
   user's stack. Onboarding completeness is a top product metric. The web app's
   add-membership flow is the most important screen in the product.

## What's hard, and what the benefit model removes

The benefit primitive (above) deliberately carves the hard part down. You do NOT
need provider integration to ship real value:

- **Perks** come straight from the user's declared/catalog benefits — exact, no
  fetch.
- **Indicative prices** come from applying a declared discount to the PUBLIC
  price, which is readable without login.

What genuinely remains hard is only the **exact transacted price** after a
real discount is applied (with its true conditions). That is now an OPTIONAL
upgrade, not a precondition for the product, expressed as `source:
"provider-live"` on a benefit. The two ways to get it later:

- `packages/core/src/providers/booking.ts` → `liveProperties()` (Demand API
  scaffold; schema unverified, validate against real partner docs) — public
  rates only; this does not need the user's memberships.
- The authenticated-session approach (reading the exact rate the user sees while
  logged in) belongs in the extension, acting in the user's own browser context.
  This is the only path that touches authenticated data, and it is opt-in.

The MVP runs in MOCK mode by default (`BookingProvider.isMock`), producing
deterministic public rates so the whole product is demoable without partner
access. Member value is layered on by matching the user's benefits — so the demo
already exercises the real value path, not a stub of it.

## Monetisation (deferred, but constrains design)

Not built, deliberately. The founder's stance: be first, amass end users, let
monetisation clarify. Likely shapes, in order of defensibility: B2C
subscription; referral/affiliate (careful — see store-policy risk); B2B2C deals
with loyalty programs. Design implication: do not couple the data model or the
extension to an affiliate-injection model, as that forecloses the clean B2C
path and raises store risk.

## Architecture map

Monorepo (pnpm + turbo). Surfaces share one core engine.

- `packages/core` — domain model centred on the **benefit** primitive, the
  curated program catalog (benefit templates + `instantiateBenefits`), the pure
  **matcher** (`match.ts`, no node/browser deps), credential encryption
  (AES-256-GCM), Cosmos data access (with in-memory fallback), the Booking
  adapter (public rates + brand only), and the enrichment engine (which layers
  benefits over public rates and exposes `matchPage` for the extension). **All
  business logic lives here.** The API, MCP, and (type-only) extension depend on
  it. Add a provider by implementing `HotelProvider` and registering it in
  `EnrichmentEngine`.
- `apps/api` — Hono HTTP API: auth (JWT, stateless), membership creation from
  catalog templates OR custom user-declared benefits, secret-field encryption,
  `POST /search/hotels`, and `POST /benefits/match` (page context → matched
  benefits). `app.ts` is importable for tests; `index.ts` is the server entry.
- `apps/mcp` — stateless Streamable-HTTP MCP server. `server.ts` builds the
  per-user tool set (`search_hotels`, `get_membership_summary`); `index.ts` is
  the HTTP wiring + bearer-token auth.
- `apps/web` — Next.js membership-management app. Onboarding is the key screen.
- `apps/extension` — WXT / Manifest V3. Booking.com content script injects a
  Shadow-DOM panel; background worker is the only place that holds the token.

## Conventions and invariants (don't violate)

- **Secrets never leave encrypted.** Membership credentials are AES-256-GCM
  encrypted in `core/crypto.ts` before persistence and are stripped from every
  client-facing payload (`publicUser` in `api/app.ts`). The DB only ever sees
  ciphertext. Never log or return a decrypted credential.
- **Stateless auth, no session store.** JWT only. This is why there is no Redis.
  Keep it that way until a concrete need appears (e.g. token revocation lists),
  then add a managed cache, not a self-run one.
- **Managed services only.** Cosmos DB serverless, Container Apps, Key Vault. No
  self-operated Postgres, no self-operated cache. Prefer managed identity over
  connection strings/keys in Azure.
- **One engine, many surfaces.** Enrichment and matching logic must stay in
  `core` (the engine + the pure `match.ts`). If you find yourself deciding which
  benefits apply, or computing savings, in the API, MCP, or extension, move it
  down.
- **The benefit is the primitive; the rule is the user's.** Value is delivered
  by matching declared/catalog benefits against a target — not by fetching real
  rates. Keep `match.ts` pure (no node/browser deps). Never present a declared
  discount as a guaranteed price: discounts are `indicative`, perks are exact.
  Live-fetched rates, if ever added, must set `source: "provider-live"`.
- **Benefits are not secret.** They are safe to return to clients. Only
  credentials are encrypted. Don't conflate the two.
- **Provider isolation.** Each provider is a `HotelProvider` returning PUBLIC
  rates + brand only; member value is layered by the engine. A failing provider
  must never sink a search (the engine already swallows per-provider errors).
- **Mock parity.** Mock mode must always produce sane, deterministic data so the
  product stays demoable and tests stay stable.
- **Writing style for any user-facing or doc copy:** declarative, compressed, no
  marketing language. Short sentences. State insights plainly.

## Testing

`pnpm test` builds core then runs node:test suites across packages (38 tests:
core 19, api 12, mcp 3, extension 4). `pnpm test:e2e` runs the Playwright web
journey (needs a network that can reach the Google Fonts and Playwright browser
CDNs). When you add a provider or change enrichment/matching, add core tests
first — the engine and `match.ts` are where regressions hurt most.

## Near-term expansion backlog (suggested order)

1. Optional `provider-live` benefits: confirm/replace a declared or catalog
   benefit with the exact transacted rate (extension authenticated-session read,
   or a per-user authorised provider fetch). Upgrade, not a blocker.
1. Expand the catalog: more Czech independents and chains, Czech bank premium
   cards (ČSOB, KB, Česká spořitelna, Air Bank), card-network tiers (Visa
   Infinite, Mastercard World Elite), and airline programs. Move it to an
   ops-editable store and add a periodic re-verification job keyed on `asOf`.
2. A second provider (Hilton direct) to make cross-provider comparison real —
   this is what unlocks the actual value proposition.
3. Extension: cross-provider comparison UI (not just Genius re-display).
4. Onboarding polish + program catalog expansion (move catalog to Cosmos so
   non-engineers can edit it).
5. Entra External ID for managed auth, replacing the hand-rolled JWT.
