# Deployment & CI/CD

This repo ships with GitHub Actions for CI and for deploying to Azure Container
Apps. Everything that touches your accounts (creating the repo, the Azure
service principal, and the GitHub secrets) is done by **you** via
`scripts/bootstrap.sh` — it needs your credentials, so it can't be done for you.

## One-time setup

Install and sign in to the two CLIs, then run the bootstrap script from the repo
root:

```bash
gh auth login            # GitHub account: l-korous
az login                 # Azure account: lukas.korous@gmail.com

./scripts/bootstrap.sh
```

That script:

1. Creates the **private** repo `l-korous/truerate` and pushes `main`.
2. Creates resource group `truerate-rg` and a service principal
   (`truerate-github-actions`) scoped as **Owner of that resource group only**.
   Owner is required because the deploy Bicep creates role assignments (ACR
   pull, Key Vault secrets access, Cosmos data role); scoping it to the single
   RG keeps the blast radius contained.
3. Stores the GitHub Actions **secrets** and **variables** below.

Override defaults with env vars, e.g. `RG=my-rg LOCATION=germanywestcentral ./scripts/bootstrap.sh`.

## GitHub Actions configuration

Secrets (Settings → Secrets and variables → Actions → **Secrets**):

| Secret | Purpose |
| --- | --- |
| `AZURE_CREDENTIALS` | Service-principal JSON used by `azure/login@v2`. Created by bootstrap; never printed. |
| `TRUERATE_JWT_SECRET` | Signing key for API/MCP JWTs. Random 32 bytes; passed to Bicep → Key Vault. |
| `TRUERATE_CRED_KEY` | AES-256-GCM key for membership credential encryption. Random 32 bytes → Key Vault. |

Variables (same screen → **Variables**) — non-sensitive, have safe defaults:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AZURE_RG` | `truerate-rg` | Resource group. |
| `AZURE_LOCATION` | `westeurope` | Azure region. |
| `AZURE_PREFIX` | `truerate` | Name prefix for all resources. |

## Pipelines

`.github/workflows/ci.yml` — on every push and PR to `main`:

- **test** — `pnpm typecheck` then `pnpm test` (builds `@truerate/core`, runs the
  core/api/mcp/extension suites).
- **build** — production `next build` of the web app.
- **e2e** — Playwright journey against an in-process API + web, with the report
  uploaded as an artifact.

`.github/workflows/deploy.yml` — on push to `main` and via manual dispatch:

1. `azure/login@v2` using `AZURE_CREDENTIALS`.
2. `az group create` (idempotent).
3. First run only: provision infrastructure from `infra/main.bicep` with seed
   images to create the ACR.
4. `az acr build` builds the `api`, `mcp`, and `web` images in the registry
   (no Docker on the runner), tagged with the commit SHA. The web image bakes in
   the API URL.
5. Re-deploy the Bicep with the real image references, so apps move to the new
   images idempotently (no image flip on redeploys). Deployed URLs are written to
   the run summary.

### Recommended: protect `main`

So deploys only happen from reviewed, green code:

- Settings → Branches → add a rule for `main`: require PRs and require the CI
  checks (`test`, `build`, `e2e`) to pass before merge.

## Manual deploy (fallback)

`infra/deploy.sh` does the same provisioning/build/deploy from your laptop with a
logged-in `az`, if you ever need to deploy outside CI.

## More secure alternative: OIDC instead of a stored secret

This setup stores a service-principal secret in `AZURE_CREDENTIALS` (as you
requested). The more secure pattern is OIDC federated credentials: no long-lived
secret in GitHub, with `azure/login@v2` exchanging a short-lived GitHub OIDC
token. To switch later: create a federated credential on the app registration
for this repo, give the deploy job `permissions: id-token: write`, and replace
the `creds:` input with `client-id` / `tenant-id` / `subscription-id`.

## Rotating secrets

```bash
printf "%s" "$(openssl rand -base64 32)" | gh secret set TRUERATE_JWT_SECRET --repo l-korous/truerate
printf "%s" "$(openssl rand -base64 32)" | gh secret set TRUERATE_CRED_KEY   --repo l-korous/truerate
```

Note: rotating `TRUERATE_CRED_KEY` invalidates already-encrypted membership
credentials. Rotating `TRUERATE_JWT_SECRET` invalidates existing sessions.
