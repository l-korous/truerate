# TrueRate — Secret Rotation Runbook

**Related issues:** #55 (rotation runbook), #6 (security epic), #1 (product model).  
**See also:** [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md), [`docs/RUNBOOK-rollback.md`](./RUNBOOK-rollback.md).

---

## Secret inventory

| Secret | Where stored | Effect of rotation |
|---|---|---|
| `TRUERATE_CRED_KEY` | GitHub Actions secret → Key Vault | Invalidates existing encrypted credentials unless re-encrypted first — **follow the full procedure below** |
| `TRUERATE_JWT_SECRET` | GitHub Actions secret → Key Vault | Invalidates all active user sessions (forced re-login) |
| `BOOKING_API_KEY` | GitHub Actions secret → Key Vault | Breaks live hotel-search; must be rotated in tandem with Booking.com portal |
| `BOOKING_AFFILIATE_ID` | GitHub Actions variable | Non-secret; update in both GitHub and Booking.com portal |
| `COSMOS_KEY` | GitHub Actions secret (dev only) | Production uses managed identity — no key; only rotate if you added a key for local dev |

> **Never store or log actual key material in this file, in code, or in commit messages.**

---

## Part 1 — `TRUERATE_CRED_KEY`: credential-encryption key

This is the most operationally significant secret because rotating it naively orphans every
already-encrypted `Membership.encryptedCredential` field in Cosmos DB.

### 1.1 How the key is used today

`packages/core/src/crypto.ts` — the sole owner of encryption/decryption logic:

- **`encryptCredential(plaintext)`** (line 28): generates a random 12-byte IV, encrypts with
  AES-256-GCM, concatenates `[IV (12 B)][GCM-tag (16 B)][ciphertext]`, and base64-encodes the
  result.
- **`decryptCredential(blob)`** (line 40): decodes the blob, extracts IV/tag/ciphertext by fixed
  offsets, decrypts with the same key.

Both functions call `loadKey()` (line 13), which reads `TRUERATE_CRED_KEY` from the environment
on every call. There is currently **no key-version header in the blob**.

Encrypted credentials are persisted in `Membership.encryptedCredential`
(`packages/core/src/types.ts`, the `Membership` interface) inside each `User` document in Cosmos DB.

### 1.2 Key-versioning design (to be implemented — see follow-up issue #TODO)

The **current unversioned blob format** is:
```
base64( [12-byte IV] [16-byte GCM tag] [ciphertext...] )
```

The **proposed versioned blob format** prepends a short text header before the base64 payload:
```
v<N>:<key-version-id>:<base64( [12-byte IV] [16-byte GCM tag] [ciphertext...] )>
```

- `v<N>` — schema version (`v2` for the first versioned format; legacy blobs without a prefix are treated as schema v1 / the initial key).
- `<key-version-id>` — a short opaque identifier for the specific 32-byte key used to encrypt this blob. Recommended: the last 8 hex characters of the Azure Key Vault secret version ID (e.g. `a3f7c200`), making it traceable without revealing key material.
- The separator `:` is safe because base64 uses only `[A-Za-z0-9+/=]`.

**Detection heuristic in `decryptCredential`:**
```typescript
if (blob.startsWith("v")) {
  // versioned: parse header, look up key by version-id
} else {
  // legacy v1: use the current TRUERATE_CRED_KEY (initial key)
}
```

**Key registry design:**
During rotation two keys coexist. The application needs access to both:
- The **active key** (encrypts new records) — `TRUERATE_CRED_KEY` in Key Vault/env.
- The **retired key** (decrypts old records) — `TRUERATE_CRED_KEY_PREV` in Key Vault/env.

After re-encryption is complete the retired key can be deleted.

The follow-up code issue (#170) must update `crypto.ts` to:
1. Accept a keyset (`Map<string, Buffer>` keyed by version-id) instead of a single `loadKey()` call.
2. Tag every new blob with the active key's version-id.
3. Resolve the correct key by version-id on decrypt; fall back to the current key for legacy blobs.
4. Export a `reEncryptCredential(blob)` helper that decrypts with the old key and re-encrypts with the new one.

### 1.3 Rotation procedure (step-by-step)

**Prerequisites:**
- You are logged in: `az login` + `gh auth login`.
- You have Owner rights on `truerate-rg`.
- No in-flight re-encryption job is running.

---

#### Step 1 — Pre-flight: record current state

```bash
RG="${AZURE_RG:-truerate-rg}"
KV="${AZURE_PREFIX:-truerate}-kv"

# Confirm the current active key version
az keyvault secret show --vault-name "$KV" --name TRUERATE-CRED-KEY \
  --query "{version:id, created:attributes.created}" -o table

# Snapshot the count of encrypted memberships (Cosmos)
# (run from a machine with COSMOS_ENDPOINT and managed identity or COSMOS_KEY)
# Use the re-encryption job's dry-run flag — see Step 5.
```

---

#### Step 2 — Generate the new key

```bash
NEW_KEY="$(openssl rand -base64 32)"
# Keep NEW_KEY only in this shell session — it must not be written to disk or logged.
```

---

#### Step 3 — Store the new key in Key Vault and GitHub; preserve the old key

```bash
RG="${AZURE_RG:-truerate-rg}"
KV="${AZURE_PREFIX:-truerate}-kv"

# Retrieve the current key (needed to populate TRUERATE_CRED_KEY_PREV)
OLD_KEY="$(az keyvault secret show --vault-name "$KV" --name TRUERATE-CRED-KEY \
  --query value -o tsv)"
OLD_VERSION="$(az keyvault secret show --vault-name "$KV" --name TRUERATE-CRED-KEY \
  --query id -o tsv | awk -F/ '{print $NF}')"

# Store the old key under a "prev" slot so the application can still decrypt
az keyvault secret set --vault-name "$KV" --name TRUERATE-CRED-KEY-PREV \
  --value "$OLD_KEY" --output none
printf "%s" "$OLD_KEY" | gh secret set TRUERATE_CRED_KEY_PREV --repo l-korous/truerate

# Store the NEW key as the active key
az keyvault secret set --vault-name "$KV" --name TRUERATE-CRED-KEY \
  --value "$NEW_KEY" --output none
NEW_VERSION="$(az keyvault secret show --vault-name "$KV" --name TRUERATE-CRED-KEY \
  --query id -o tsv | awk -F/ '{print $NF}')"

printf "%s" "$NEW_KEY" | gh secret set TRUERATE_CRED_KEY --repo l-korous/truerate

echo "Old version: $OLD_VERSION"
echo "New version: $NEW_VERSION"
# Record these for the rollback note; do NOT commit them.
unset OLD_KEY NEW_KEY
```

> At this point the old key material has left your shell. Both keys are in Key Vault only.

---

#### Step 4 — Deploy the dual-key-aware application revision

Trigger a deploy by pushing to `main` (or dispatch `deploy.yml` manually).  
The new revision must load **both** `TRUERATE_CRED_KEY` and `TRUERATE_CRED_KEY_PREV` from the
environment and be able to:
- **Encrypt new records** with the new key (tagged with the new version-id).
- **Decrypt existing records** with either key (by reading the version-id from the blob header, or
  falling back to the old key for legacy blobs).

This requires the follow-up code changes (issue #170, see §1.2). Until those are in place, **do not
rotate the key in production** — skip to the rollback section.

Verify the new revision is healthy before proceeding:

```bash
API_FQDN=$(az containerapp show -g "$RG" -n "${PREFIX:-truerate}-api" \
  --query properties.configuration.ingress.fqdn -o tsv)
curl --fail "https://${API_FQDN}/health"
```

---

#### Step 5 — Re-encrypt all records (migration job)

Run the re-encryption Container Apps Job (to be implemented — see follow-up issue):

```bash
RG="${AZURE_RG:-truerate-rg}"
PREFIX="${AZURE_PREFIX:-truerate}"

# Dry-run first (counts records, does not write)
az containerapp job start \
  -g "$RG" -n "${PREFIX}-reencrypt-job" \
  --environment-variables "DRY_RUN=true"

# Review the job output before proceeding
az containerapp job execution show ... # (use the execution name from the previous command)

# Execute the actual re-encryption
az containerapp job start \
  -g "$RG" -n "${PREFIX}-reencrypt-job" \
  --environment-variables "DRY_RUN=false"
```

The job iterates every `User` document in Cosmos DB, detects memberships whose
`encryptedCredential` still carries the old version-id (or no version-id for legacy blobs),
calls `reEncryptCredential()`, and writes the updated document back. It is idempotent: records
already on the new key are skipped.

Monitor completion:

```bash
az containerapp job execution list \
  -g "$RG" -n "${PREFIX}-reencrypt-job" \
  --query "[].{Name:name, Status:properties.status, Started:properties.startTime}" \
  -o table
```

---

#### Step 6 — Verify: no records remain on the old key

```bash
# The re-encryption job emits a final summary log line with the count of
# records migrated and any errors. Inspect it:
az containerapp job logs show -g "$RG" -n "${PREFIX}-reencrypt-job" \
  --execution <EXECUTION_NAME>

# Expected: "Re-encryption complete: N records migrated, 0 errors"
```

Also do a spot-check: log in as a test user and verify their memberships load correctly.

---

#### Step 7 — Remove the retired key

Only after **Step 6 is clean**:

```bash
RG="${AZURE_RG:-truerate-rg}"
KV="${AZURE_PREFIX:-truerate}-kv"

# Remove the old key from Key Vault (soft-delete; recoverable for 90 days by default)
az keyvault secret delete --vault-name "$KV" --name TRUERATE-CRED-KEY-PREV

# Remove from GitHub Actions secrets
gh secret delete TRUERATE_CRED_KEY_PREV --repo l-korous/truerate

# Trigger a new deploy so the running revision no longer loads TRUERATE_CRED_KEY_PREV
```

---

#### Step 8 — Post-rotation checklist

- [ ] New `TRUERATE_CRED_KEY` version confirmed in Key Vault.
- [ ] Old `TRUERATE-CRED-KEY-PREV` deleted from Key Vault.
- [ ] Re-encryption job: 0 errors, all records migrated.
- [ ] Application revision restarted without `TRUERATE_CRED_KEY_PREV` in env.
- [ ] Smoke test: `GET /health` on all three apps returns 200.
- [ ] Spot-check: a test user's encrypted membership decrypts correctly.
- [ ] Rotation event recorded in the incident/change log.

---

### 1.4 Rollback

If the new key causes decryption failures before re-encryption is complete:

1. **Pin traffic to the last-good revision** (the one using the old key) — see
   [`RUNBOOK-rollback.md §4`](./RUNBOOK-rollback.md).
2. **Restore the old key as the active key** in Key Vault:
   ```bash
   # Re-promote the old key (retrieve it from TRUERATE-CRED-KEY-PREV)
   OLD_KEY="$(az keyvault secret show --vault-name "$KV" --name TRUERATE-CRED-KEY-PREV \
     --query value -o tsv)"
   az keyvault secret set --vault-name "$KV" --name TRUERATE-CRED-KEY \
     --value "$OLD_KEY" --output none
   printf "%s" "$OLD_KEY" | gh secret set TRUERATE_CRED_KEY --repo l-korous/truerate
   unset OLD_KEY
   ```
3. Redeploy. The application now encrypts and decrypts with the old key again.
4. Investigate the failure, fix the code issue (wrong version-id, bad keyset wiring, etc.),
   then repeat the rotation procedure from Step 1.

---

## Part 2 — `TRUERATE_JWT_SECRET`: JWT signing key

**Effect of rotation:** all active sessions are immediately invalidated; users must log in again.
There is no persistent ciphertext to re-encrypt — this is the simpler case.

```bash
KV="${AZURE_PREFIX:-truerate}-kv"

# Generate and store new JWT secret
NEW_JWT="$(openssl rand -base64 32)"
az keyvault secret set --vault-name "$KV" --name TRUERATE-JWT-SECRET \
  --value "$NEW_JWT" --output none
printf "%s" "$NEW_JWT" | gh secret set TRUERATE_JWT_SECRET --repo l-korous/truerate
unset NEW_JWT

# Trigger redeploy
# Sessions issued before the deploy will fail validation and prompt re-login.
```

**Rollback:** revert to the previous Key Vault version:
```bash
az keyvault secret recover --vault-name "$KV" --name TRUERATE-JWT-SECRET
```
(Only if the version was deleted; otherwise just re-set the old value from a known backup.)

**Checklist:**
- [ ] New secret in Key Vault and GitHub.
- [ ] Deploy completed; `/health` returns 200.
- [ ] Verify a login round-trip works end-to-end.
- [ ] Users notified if the session invalidation is expected to affect many active users.

---

## Part 3 — `BOOKING_API_KEY`: Booking.com API key

Rotation must be coordinated with the Booking.com partner portal — you cannot rotate unilaterally.

1. In the **Booking.com Connectivity Portal**, generate a new API key.
2. Update in Key Vault and GitHub **before** revoking the old one:
   ```bash
   KV="${AZURE_PREFIX:-truerate}-kv"
   printf "%s" "<NEW_KEY>" | az keyvault secret set --vault-name "$KV" \
     --name BOOKING-API-KEY --value "$(cat)" --output none
   printf "%s" "<NEW_KEY>" | gh secret set BOOKING_API_KEY --repo l-korous/truerate
   ```
3. Deploy so the running revision picks up the new key.
4. Smoke-test: trigger a hotel search query and verify a 200 response.
5. Only then revoke the old key in the Booking.com portal.

**Rollback:** if the new key fails, the old key is still active in the Booking.com portal until
you explicitly revoke it. Re-set the old value in Key Vault / GitHub and redeploy.

---

## Part 4 — `COSMOS_KEY` (local dev only)

Production uses **managed identity** (`DefaultAzureCredential` in `packages/core/src/db.ts`
lines 35–36); no Cosmos key is set in the production environment. `COSMOS_KEY` is only used for
local development against a real Cosmos account.

If you need to rotate the local dev key:
1. Azure Portal → Cosmos DB account → Keys → Regenerate key.
2. Update your local `.env` or shell profile.
3. No redeploy required; this key is never in GitHub secrets or Key Vault.

---

## Quick-reference card

| Action | Command sketch |
|---|---|
| Generate a new 32-byte key | `openssl rand -base64 32` |
| Store in Key Vault | `az keyvault secret set --vault-name $KV --name $NAME --value "$VAL"` |
| Store in GitHub secrets | `printf "%s" "$VAL" \| gh secret set $NAME --repo l-korous/truerate` |
| List Key Vault secret versions | `az keyvault secret list-versions --vault-name $KV --name $NAME -o table` |
| Soft-delete a Key Vault secret | `az keyvault secret delete --vault-name $KV --name $NAME` |
| Recover a soft-deleted secret | `az keyvault secret recover --vault-name $KV --name $NAME` |
| Trigger a manual deploy | `gh workflow run deploy.yml --repo l-korous/truerate` |
