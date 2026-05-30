# Deployment & CI/CD

This repo ships GitHub Actions for CI and for deploying to Azure Container Apps.
Azure auth uses **OIDC federated credentials** — GitHub mints a short-lived
token that Azure trusts, so **no Azure secret is stored** in GitHub.

Container images live on **GitHub Container Registry (ghcr.io)** as **public
packages**, not on ACR. This keeps the recurring Azure bill at ~€0–€1/month for a
hobby deployment: Container Apps scale to zero when idle, Cosmos DB serverless
charges only for the requests you make, Log Analytics is capped at 0.5 GB/day,
and there's no fixed-cost registry. The compiled images contain only built
artefacts; secrets live in Key Vault and the running app, not in the image.

Everything that touches your accounts (creating the repo, the Azure app
registration + federated credentials, and the GitHub secrets) is done by **you**
via `scripts/bootstrap.sh` — it needs your credentials, so it can't be done for
you.

## One-time setup

```bash
gh auth login            # GitHub account: l-korous
az login                 # Azure account: lukas.korous@gmail.com

./scripts/bootstrap.sh
```

That script:

1. Creates the **private** repo `l-korous/truerate` and pushes `main`.
2. Creates resource group `truerate-rg`, an Entra **app registration**
   (`truerate-github-actions`) with a service principal, grants it **Owner of
   that resource group only**, and adds **federated credentials** for this repo
   (subjects `environment:production` and `ref:refs/heads/main`). Owner is
   required because the deploy Bicep creates role assignments (Key Vault
   secrets, Cosmos data role); scoping it to the single RG contains the blast
   radius.
3. Stores the GitHub Actions secrets and variables below.

Override defaults with env vars, e.g. `RG=my-rg LOCATION=germanywestcentral ./scripts/bootstrap.sh`.

## GitHub Actions configuration

Secrets (Settings → Secrets and variables → Actions → **Secrets**):

| Secret | Sensitive? | Purpose |
| --- | --- | --- |
| `AZURE_CLIENT_ID` | no (identifier) | App registration (client) ID for OIDC login. |
| `AZURE_TENANT_ID` | no (identifier) | Entra tenant ID. |
| `AZURE_SUBSCRIPTION_ID` | no (identifier) | Target subscription. |
| `TRUERATE_JWT_SECRET` | yes | Signing key for API/MCP JWTs. Random 32 bytes → Key Vault. |
| `TRUERATE_CRED_KEY` | yes | AES-256-GCM key for credential encryption. Random 32 bytes → Key Vault. |

The three Azure IDs are not sensitive, but are stored as secrets to match the
`azure/login` convention and keep them out of the run UI. **No client secret or
service-principal password exists** — that's the point of OIDC.

Variables (same screen → **Variables**) — non-sensitive, have safe defaults:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AZURE_RG` | `truerate-rg` | Resource group. |
| `AZURE_LOCATION` | `westeurope` | Azure region. |
| `AZURE_PREFIX` | `truerate` | Name prefix for all resources. |

## How OIDC auth works here

`deploy.yml` requests `permissions: id-token: write` and pins the job to the
`production` GitHub Environment. On each run, `azure/login@v2` exchanges
GitHub's OIDC token for an Azure access token, which Azure validates against the
federated credential whose subject is `repo:l-korous/truerate:environment:production`.
Nothing long-lived is stored on either side. To require approval before a
deploy, add reviewers to the `production` environment (Settings → Environments).

## Pipelines

`.github/workflows/ci.yml` — on every push and PR to `main`:

- **test** — `pnpm typecheck` then `pnpm test` (builds `@truerate/core`, runs the
  core/api/mcp/extension suites).
- **build** — production `next build` of the web app.
- **e2e** — Playwright journey, report uploaded as an artifact.

`.github/workflows/deploy.yml` — on push to `main` and manual dispatch:

1. `docker login ghcr.io` with the workflow's built-in `GITHUB_TOKEN` (no PAT).
2. `azure/login@v2` via OIDC (client/tenant/subscription IDs); ensure the RG.
3. `docker buildx build --push` for `api`, `mcp`, `web` to
   `ghcr.io/<owner>/truerate-{api,mcp,web}:<sha>` (also tagged `:latest`).
   The web image bakes the API URL at build time — empty on the very first
   deploy, then real on every subsequent deploy.
4. Flip the three packages to **public** visibility (idempotent;
   `gh api PATCH /user/packages/container/<pkg>`).
5. Deploy Bicep with the new image refs. Deployed URLs are written to the run
   summary.

### Recommended: protect `main`

Settings → Branches → rule for `main`: require PRs and require CI checks
(`test`, `build`, `e2e`) to pass before merge, so deploys only run on reviewed,
green code.

## Manual deploy (fallback)

`infra/deploy.sh` does the same provision/build/deploy from your laptop with a
logged-in `az`, `docker`, and `gh`, if you ever need to deploy outside CI.

## Cost shape

| Resource | Monthly (idle/light) |
| --- | --- |
| Container Apps × 3 (scale-to-zero) | ~€0 — fits inside the free monthly grants |
| Cosmos DB (serverless) | ~€0–1 — pay-per-RU + €0.23/GB |
| Key Vault (Standard, RBAC) | <€0.10 — pennies per 10k ops |
| Log Analytics (PerGB2018, 0.5 GB/day cap) | ~€0 — capped, normally inside free quota |
| Managed identity, env, ingress | €0 |
| **Total** | **~€0–€1/month** |

There is no Azure container registry; images are on ghcr.io (free for public
packages). The Log Analytics daily cap is a hard ceiling — once hit, ingestion
stops for the day, so a misbehaving container can't surprise-bill you.

## Rotating secrets

```bash
printf "%s" "$(openssl rand -base64 32)" | gh secret set TRUERATE_JWT_SECRET --repo l-korous/truerate
printf "%s" "$(openssl rand -base64 32)" | gh secret set TRUERATE_CRED_KEY   --repo l-korous/truerate
```

Rotating `TRUERATE_CRED_KEY` invalidates already-encrypted credentials; rotating
`TRUERATE_JWT_SECRET` invalidates existing sessions.
