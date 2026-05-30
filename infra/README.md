# Infrastructure

Azure, biased toward managed services: no self-run Postgres, no self-run cache.

## What gets created

| Resource | Role | Why this choice |
|---|---|---|
| Cosmos DB (NoSQL, serverless) | User + membership store | Fully managed, pay-per-request, scales with usage, fast enough that no cache is needed at MVP scale. `disableLocalAuth` is on — access is via managed identity only. |
| Container Apps (env + api/mcp/web) | Serverless containers | No cluster to operate, scales to/from low replica counts, per-app ingress. |
| Container Registry (Basic) | Image store | Source for the three app images. |
| Key Vault (RBAC) | `jwt-secret`, `cred-key` | Secrets never live in app config; apps read them via managed identity. |
| User-assigned managed identity | AcrPull + KV Secrets User + Cosmos Data Contributor | One identity, no keys/connection strings anywhere. |
| Log Analytics | Container Apps logs | Standard observability. |

## Deploy

```bash
az login
./infra/deploy.sh                 # RG, LOCATION, PREFIX overridable via env
```

The script provisions infra with a seed image, runs `az acr build` for all three
apps (server-side build — no local Docker required), then points the Container
Apps at the real images. It prints the web/API/MCP URLs and the generated
secrets at the end.

## Before you deploy

- **Validate the template** — this Bicep was authored without an `az` CLI to
  compile it. Run `az bicep build -f infra/main.bicep` once to catch any API
  version drift before the first deploy.
- **No Cosmos key in app config.** `packages/core/src/db.ts` uses
  `DefaultAzureCredential` when `COSMOS_KEY` is absent. In Container Apps the
  user-assigned identity is present, so the SDK authenticates with AAD against
  the data-plane role the Bicep assigns. Locally, set `COSMOS_KEY` (or
  `TRUERATE_INMEMORY=true`) instead.
- **`NEXT_PUBLIC_API_BASE_URL` is build-time.** The web image bakes it in via the
  `--build-arg` in `deploy.sh`. If the API URL changes, rebuild the web image.
- **Lock CORS.** `apps/api` allows any origin for local dev. Before production,
  restrict it to the web app origin and the published extension id.

## Production hardening (next steps)

- Swap hand-rolled JWT auth for Microsoft Entra External ID.
- Put Front Door / custom domains in front of the apps; restrict ingress.
- Add Cosmos continuous backup and a second region if availability needs it.
- Add a deployment slot / revision-based rollout for the apps.

## Scaling & cost

All three Container Apps run with `minReplicas: 0` (scale-to-zero). With external
ingress, Container Apps wakes a replica on the first incoming request, so idle
cost is ~$0 — at the price of a cold start (typically a second or two) on the
first request after a period of no traffic. This is the right default
pre-launch.

When a surface needs warm latency (e.g. the MCP server or API once you have
users), set its `minReplicas: 1`. One always-on 0.5 vCPU / 1 GiB replica is
roughly $13/month. See `docs/DEPLOYMENT.md` for the full cost breakdown.
