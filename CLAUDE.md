# TrueRate — working agreement for agents

**Authoritative product model: GitHub issue [#1](https://github.com/l-korous/truerate/issues/1) (pinned). Read it first.**
If anything here or in `AGENTS.md` conflicts with #1, **#1 wins**.

## Non-negotiable product rules
- **TrueRate never handles prices.** Never fetch hotel prices; never compute or return a
  post-discount / "final" / "indicative" price in any surface (core, API, MCP, web, extension).
  Base prices come from third parties and are handled by the channel or the AI assistant.
- TrueRate outputs **which discounts (%), perks, and conditions apply**, plus at most an
  **estimated monetary value of a perk** (e.g. free early check-in ≈ $20 / $40 / $60 at 3★ / 4★ / 5★).
  The consumer (AI assistant or the user) does any price math.
- One **user-controlled vault** of memberships & perks; channels (extension, MCP, future) read from it.
- **MCP** = pure intelligence (per-user URL; applicable discounts/perks/conditions + perk-value
  estimates; **no prices**).
- **Extension** = Genius-aware (do not imply a discount Booking already applied when the user is
  logged in); no final-price math; no logged-in third-party session reading (MVP).
- ⚠️ Any passage in `AGENTS.md` about an "indicative member price", applying a % to a scraped public
  price, `/benefits/match` returning a member price, or cross-provider **price** comparison is
  **superseded** by the rules above.

## How we work (agents write 100% of the code — safely)
- Every change maps to a GitHub **issue**. **One PR per issue. Never push to `main`.**
- Branch name: `claude/<issue-number>-<slug>`. PR body checks off the issue's Acceptance Criteria
  and Definition of Done.
- A PR may merge only when **CI is green** (Typecheck & test · Build web · Playwright journey) and it
  **adds/updates tests**. The **synthetic-user harness** (issue #4 cluster) is the e2e backbone;
  core logic gets unit tests.
- **Order of work:** the **`MVP — core loop`** milestone first → then **Phase 0** hardening before any
  public exposure → then later phases. Pick issues labelled `MVP` first.
- **No price handling** may be (re)introduced (see #1).

## Engineering invariants (still in force)
- Secrets never leave encrypted; never log or return decrypted credentials; **never print secrets**.
- **Managed services only** (Cosmos serverless, Container Apps, Key Vault, Container Apps Jobs);
  prefer managed identity over keys.
- **One engine:** matching / perk-intelligence / value-estimation lives in `packages/core`;
  channels (api, mcp, web, extension) stay thin.
- **Minimal Azure cost:** scale-to-zero, serverless, cron Jobs for scraping, ghcr.io images.
  Do not add always-on resources without justifying it in the PR.
- **Deploys are zero-downtime (blue/green target — epic #2).** Don't break the deploy. Cosmos
  schema changes must be backward-compatible within a single deploy.

## Running agents on this repo
- **Cloud, on your Max plan (recommended, watchable):** https://claude.ai/code → select this repo,
  reference an issue (e.g. "implement #69"), watch it work, review the PR.
- **Issue-triggered:** comment **`@claude`** on an issue or PR (GitHub Action in
  `.github/workflows/claude.yml`; requires the `CLAUDE_CODE_OAUTH_TOKEN` repo secret and the Claude
  GitHub App). Runs on GitHub Actions minutes.
