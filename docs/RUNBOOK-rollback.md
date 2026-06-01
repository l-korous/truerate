# TrueRate — Rollback Runbook

**Scope:** Azure Container Apps (api, mcp, web).  
**Related issues:** #27 (multi-revision mode), #29 (auto-rollback gate), #2 (deploy epic).

---

## 1. How automatic rollback works (issue #29)

Every deploy triggers a post-deploy smoke step in `deploy.yml`:

1. The new revision starts at **0% traffic** (canary slot).
2. The smoke step `curl --fail`s each service on the canary revision's label FQDN:
   - `api` → `GET /health`
   - `mcp` → `GET /health`
   - `web` → `GET /api/health`
3. **On success:** traffic is shifted to the new revision and the old one is deactivated.
4. **On failure:** traffic stays 100% on the last-good revision; the bad revision is deactivated automatically via `az containerapp revision deactivate`.

If CI is green you do not need to intervene — the system already rolled back.

---

## 2. Confirm a problem exists before acting

```bash
# Set shared variables once
RG="${AZURE_RG:-truerate-rg}"
PREFIX="${AZURE_PREFIX:-truerate}"

# Check current live traffic weights for all three apps
for app in api mcp web; do
  echo "=== ${PREFIX}-${app} ==="
  az containerapp ingress traffic show \
    -g "$RG" -n "${PREFIX}-${app}" -o table
done
```

```bash
# Tail live logs (last 15 minutes)
for app in api mcp web; do
  echo "=== ${PREFIX}-${app} ==="
  az containerapp logs show \
    -g "$RG" -n "${PREFIX}-${app}" \
    --tail 50 --follow false 2>/dev/null | tail -20
done
```

---

## 3. List revisions and identify the last-good one

```bash
RG="${AZURE_RG:-truerate-rg}"
PREFIX="${AZURE_PREFIX:-truerate}"

# List all revisions for each app (most recent first)
for app in api mcp web; do
  echo "=== ${PREFIX}-${app} ==="
  az containerapp revision list \
    -g "$RG" -n "${PREFIX}-${app}" \
    --query "sort_by([].{Name:name, Active:properties.active, Traffic:properties.trafficWeight, Created:properties.createdTime, HealthState:properties.healthState}, &Created) | reverse(@)" \
    -o table
done
```

The **Active=true** revision receiving 100% traffic is the current live one.  
Look for the previous revision with `Active=true` or `Active=false` that was last-good.

---

## 4. Manual rollback: pin traffic to a last-good revision

Replace `<LAST_GOOD_REVISION>` with the revision name from step 3.

### 4a. Restore traffic to the last-good revision

```bash
RG="${AZURE_RG:-truerate-rg}"
PREFIX="${AZURE_PREFIX:-truerate}"
LAST_GOOD_REVISION="<LAST_GOOD_REVISION>"  # e.g. truerate-api--abc1234

# For each app that is bad — repeat as needed
APP="api"   # change to mcp or web as needed

az containerapp ingress traffic set \
  -g "$RG" -n "${PREFIX}-${APP}" \
  --revision-weight "${LAST_GOOD_REVISION}=100"
```

Verify traffic weight flipped:

```bash
az containerapp ingress traffic show \
  -g "$RG" -n "${PREFIX}-${APP}" -o table
```

### 4b. Deactivate the bad revision

```bash
BAD_REVISION="<BAD_REVISION_NAME>"   # the revision you are rolling back from

az containerapp revision deactivate \
  -g "$RG" -n "${PREFIX}-${APP}" \
  --revision "$BAD_REVISION"
```

Confirm it is inactive:

```bash
az containerapp revision show \
  -g "$RG" -n "${PREFIX}-${APP}" \
  --revision "$BAD_REVISION" \
  --query "{Active:properties.active, Health:properties.healthState}" -o table
```

### 4c. Full three-app rollback (copy-paste block)

When all three apps need to be rolled back simultaneously:

```bash
RG="${AZURE_RG:-truerate-rg}"
PREFIX="${AZURE_PREFIX:-truerate}"

# Fill in the last-good revision name for each app
API_GOOD="truerate-api--<GOOD_SUFFIX>"
MCP_GOOD="truerate-mcp--<GOOD_SUFFIX>"
WEB_GOOD="truerate-web--<GOOD_SUFFIX>"

# Fill in the bad revision name for each app
API_BAD="truerate-api--<BAD_SUFFIX>"
MCP_BAD="truerate-mcp--<BAD_SUFFIX>"
WEB_BAD="truerate-web--<BAD_SUFFIX>"

for pair in "api:$API_GOOD:$API_BAD" "mcp:$MCP_GOOD:$MCP_BAD" "web:$WEB_GOOD:$WEB_BAD"; do
  APP="${pair%%:*}"
  GOOD="${pair#*:}"; GOOD="${GOOD%:*}"
  BAD="${pair##*:}"
  echo "--- ${PREFIX}-${APP}: traffic → ${GOOD}, deactivating ${BAD}"
  az containerapp ingress traffic set \
    -g "$RG" -n "${PREFIX}-${APP}" \
    --revision-weight "${GOOD}=100"
  az containerapp revision deactivate \
    -g "$RG" -n "${PREFIX}-${APP}" \
    --revision "$BAD"
done
```

---

## 5. Post-rollback verification checklist

Run these immediately after restoring traffic:

```bash
RG="${AZURE_RG:-truerate-rg}"
PREFIX="${AZURE_PREFIX:-truerate}"

# Resolve FQDNs
API_FQDN=$(az containerapp show -g "$RG" -n "${PREFIX}-api" \
  --query properties.configuration.ingress.fqdn -o tsv)
MCP_FQDN=$(az containerapp show -g "$RG" -n "${PREFIX}-mcp" \
  --query properties.configuration.ingress.fqdn -o tsv)
WEB_FQDN=$(az containerapp show -g "$RG" -n "${PREFIX}-web" \
  --query properties.configuration.ingress.fqdn -o tsv)

echo "Probing api /health …"
curl --fail --silent --show-error "https://${API_FQDN}/health" | jq .

echo "Probing mcp /health …"
curl --fail --silent --show-error "https://${MCP_FQDN}/health" | jq .

echo "Probing web /api/health …"
curl --fail --silent --show-error "https://${WEB_FQDN}/api/health" | jq .
```

All three probes must return **HTTP 200** with a JSON body containing `"status":"ok"` (or equivalent) before the incident is closed.

**Checklist:**

- [ ] `api /health` returns 200
- [ ] `mcp /health` returns 200
- [ ] `web /api/health` returns 200
- [ ] Traffic weights in Azure Portal / `az containerapp ingress traffic show` show 100% on last-good revision
- [ ] Bad revision shows `active: false` in `az containerapp revision list`
- [ ] No new errors in Log Analytics / container logs for 5 minutes after rollback

---

## 6. Confirm scale-to-zero is still in effect

After rollback the last-good revision must still be able to scale to zero when idle (cost guard).

```bash
RG="${AZURE_RG:-truerate-rg}"
PREFIX="${AZURE_PREFIX:-truerate}"

for app in api mcp web; do
  echo "=== ${PREFIX}-${app} ==="
  az containerapp show -g "$RG" -n "${PREFIX}-${app}" \
    --query "properties.template.scale.{min:minReplicas,max:maxReplicas}" \
    -o table
done
```

Expected: `min = 0`, `max = 5` for every app.  
If `minReplicas` was accidentally set to a value > 0 (which would incur idle cost), correct it:

```bash
az containerapp update \
  -g "$RG" -n "${PREFIX}-${APP}" \
  --min-replicas 0
```

---

## 7. Re-deploy after the fix

Once the root cause is resolved, push the fix to `main`. The `deploy.yml` pipeline runs automatically and the canary smoke gate (issue #29) validates the new revision before shifting traffic. No manual steps are required unless the automatic pipeline fails.

---

## 8. Revision label FQDNs (multi-revision mode)

When multi-revision mode is enabled (issue #27), each revision gets a stable label-scoped FQDN of the form:

```
https://<APP_NAME>---<LABEL>.<ENVIRONMENT_FQDN>
```

Use these for direct smoke probing of a specific revision without touching traffic weights:

```bash
# Example: probe the canary revision of the api without shifting traffic
CANARY_LABEL="canary"
ENV_FQDN=$(az containerapp env show -g "$RG" -n "${PREFIX}-env" \
  --query properties.defaultDomain -o tsv)
curl --fail "https://${PREFIX}-api---${CANARY_LABEL}.${ENV_FQDN}/health"
```

---

## Quick-reference card

| Task | Command |
|---|---|
| List revisions | `az containerapp revision list -g $RG -n $APP -o table` |
| Show traffic weights | `az containerapp ingress traffic show -g $RG -n $APP -o table` |
| Pin traffic to revision | `az containerapp ingress traffic set -g $RG -n $APP --revision-weight $REV=100` |
| Deactivate bad revision | `az containerapp revision deactivate -g $RG -n $APP --revision $REV` |
| Show replica count | `az containerapp show -g $RG -n $APP --query properties.template.scale -o table` |
| Smoke probe api | `curl --fail https://$API_FQDN/health` |
| Smoke probe mcp | `curl --fail https://$MCP_FQDN/health` |
| Smoke probe web | `curl --fail https://$WEB_FQDN/api/health` |
