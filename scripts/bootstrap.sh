#!/usr/bin/env bash
#
# TrueRate one-time setup. Run this on YOUR machine, signed in to YOUR accounts.
# It is the part that needs your credentials, so it cannot be done for you.
#
#   Prerequisites (install + sign in first):
#     - GitHub CLI:  gh auth login          (account: l-korous)
#     - Azure CLI:   az login               (account: lukas.korous@gmail.com)
#     - git, openssl
#
#   Usage (from the repo root):
#     ./scripts/bootstrap.sh
#
# What it does:
#   1. Creates the private GitHub repo l-korous/truerate and pushes main.
#   2. Creates an Azure resource group + a service principal scoped to it.
#   3. Stores the Azure credential and app secrets as GitHub Actions secrets,
#      and the resource-group/location/prefix as Actions variables.
# After it finishes, pushing to main runs CI and deploys via GitHub Actions.

set -euo pipefail

# ── Config (override via env) ────────────────────────────────────────────────
GH_OWNER="${GH_OWNER:-l-korous}"
REPO="${REPO:-truerate}"
RG="${RG:-truerate-rg}"
LOCATION="${LOCATION:-westeurope}"
PREFIX="${PREFIX:-truerate}"
SP_NAME="${SP_NAME:-truerate-github-actions}"

say() { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
die() { printf "\n\033[1;31mERROR: %s\033[0m\n" "$*" >&2; exit 1; }

# ── Preflight ─────────────────────────────────────────────────────────────────
command -v gh  >/dev/null || die "GitHub CLI (gh) not installed."
command -v az  >/dev/null || die "Azure CLI (az) not installed."
command -v git >/dev/null || die "git not installed."
command -v openssl >/dev/null || die "openssl not installed."

gh auth status >/dev/null 2>&1 || die "Not signed in to GitHub. Run: gh auth login"
az account show >/dev/null 2>&1 || die "Not signed in to Azure. Run: az login"

SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
say "Azure subscription: $SUBSCRIPTION_ID"
say "GitHub owner: $GH_OWNER   Repo: $REPO (private)"

# ── 1. Git repo + push ──────────────────────────────────────────────────────
if [ ! -d .git ]; then
  say "Initialising git repository"
  git init -q
  git add -A
  git commit -qm "Initial commit: TrueRate monorepo"
fi
git branch -M main

if gh repo view "$GH_OWNER/$REPO" >/dev/null 2>&1; then
  say "Repo $GH_OWNER/$REPO already exists — pushing"
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$GH_OWNER/$REPO.git"
  git push -u origin main
else
  say "Creating private repo and pushing"
  gh repo create "$GH_OWNER/$REPO" --private --source=. --remote=origin --push
fi

# ── 2. Azure: app registration + federated credentials (OIDC, no secret) ─────

# Ensure the resource providers the Bicep uses are registered on this subscription.
# On a brand-new subscription these are NotRegistered, and the deploy would fail
# with MissingSubscriptionRegistration on first run.
say "Registering required Azure resource providers"
for ns in Microsoft.App Microsoft.ManagedIdentity Microsoft.DocumentDB \
          Microsoft.KeyVault Microsoft.OperationalInsights Microsoft.Authorization; do
  state="$(az provider show --namespace "$ns" --query registrationState -o tsv 2>/dev/null || echo NotRegistered)"
  if [ "$state" != "Registered" ]; then
    printf '  %s ... ' "$ns"
    az provider register --namespace "$ns" --wait -o none && echo Registered
  fi
done

say "Creating resource group $RG ($LOCATION)"
az group create -n "$RG" -l "$LOCATION" -o none

TENANT_ID="$(az account show --query tenantId -o tsv)"

# Reuse the app registration if it already exists (idempotent re-runs).
APP_ID="$(az ad app list --display-name "$SP_NAME" --query "[0].appId" -o tsv 2>/dev/null || true)"
if [ -z "$APP_ID" ]; then
  say "Creating app registration '$SP_NAME'"
  APP_ID="$(az ad app create --display-name "$SP_NAME" --query appId -o tsv)"
fi
# Ensure a service principal exists for the app (idempotent).
az ad sp show --id "$APP_ID" >/dev/null 2>&1 || az ad sp create --id "$APP_ID" -o none

# The deploy pipeline's Bicep creates role assignments (Key Vault secrets,
# Cosmos data role), which requires Owner on the scope. Scoping Owner to this
# single resource group keeps the blast radius to TrueRate's own resources.
SCOPE="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG"
say "Granting the app Owner on $RG only"
# Use --assignee-object-id with the SP's object id (not the app id with --assignee,
# which goes through Microsoft Graph and is racy against just-created SPs). Tolerate
# only the idempotent "already exists" error; surface anything else.
SP_OID="$(az ad sp show --id "$APP_ID" --query id -o tsv)"
out=$(az role assignment create --assignee-object-id "$SP_OID" --assignee-principal-type ServicePrincipal --role Owner --scope "$SCOPE" --subscription "$SUBSCRIPTION_ID" -o none 2>&1) \
  || echo "$out" | grep -qi 'already exists\|RoleAssignmentExists' \
  || { echo "$out" >&2; die "Failed to grant Owner role on $RG. The deploy pipeline will not be able to log in. See error above."; }

# Federated credentials: let GitHub Actions exchange its OIDC token for Azure
# access, with no stored secret. The subject must match how the workflow runs.
# deploy.yml pins `environment: production`, so that subject is what's used;
# we also add the main-branch subject as a belt-and-braces fallback.
add_fic() {
  local name="$1" subject="$2"
  az ad app federated-credential list --id "$APP_ID" --query "[].subject" -o tsv 2>/dev/null | grep -qx "$subject" && return 0
  az ad app federated-credential create --id "$APP_ID" --parameters "{
    \"name\": \"$name\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"$subject\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" -o none
}
say "Adding GitHub OIDC federated credentials"
add_fic "truerate-gha-env-prod" "repo:$GH_OWNER/$REPO:environment:production"
add_fic "truerate-gha-main"      "repo:$GH_OWNER/$REPO:ref:refs/heads/main"

# ── 3. GitHub Actions secrets + variables ─────────────────────────────────────
say "Storing GitHub Actions secrets (OIDC identifiers + app secrets)"
printf "%s" "$APP_ID"          | gh secret set AZURE_CLIENT_ID       --repo "$GH_OWNER/$REPO"
printf "%s" "$TENANT_ID"       | gh secret set AZURE_TENANT_ID       --repo "$GH_OWNER/$REPO"
printf "%s" "$SUBSCRIPTION_ID" | gh secret set AZURE_SUBSCRIPTION_ID --repo "$GH_OWNER/$REPO"
printf "%s" "$(openssl rand -base64 32)" | gh secret set TRUERATE_JWT_SECRET --repo "$GH_OWNER/$REPO"
printf "%s" "$(openssl rand -base64 32)" | gh secret set TRUERATE_CRED_KEY   --repo "$GH_OWNER/$REPO"

say "Storing GitHub Actions variables"
gh variable set AZURE_RG       --repo "$GH_OWNER/$REPO" --body "$RG"
gh variable set AZURE_LOCATION --repo "$GH_OWNER/$REPO" --body "$LOCATION"
gh variable set AZURE_PREFIX   --repo "$GH_OWNER/$REPO" --body "$PREFIX"

say "Done."
cat <<EOF

  Repository : https://github.com/$GH_OWNER/$REPO  (private)
  Auth       : OIDC federated credentials (no stored Azure secret)
  Secrets set: AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID,
               TRUERATE_JWT_SECRET, TRUERATE_CRED_KEY
  Variables  : AZURE_RG=$RG, AZURE_LOCATION=$LOCATION, AZURE_PREFIX=$PREFIX

  Note: the deploy job uses a "production" GitHub Environment. The first run may
  prompt you to approve it (Settings → Environments) if you add reviewers.

  Next:
    - The push above already triggered CI.
    - To deploy (also runs on push to main):
        gh workflow run "Deploy (Azure)" --repo $GH_OWNER/$REPO
        gh run watch --repo $GH_OWNER/$REPO

  New role assignments can take a minute to propagate; if the first deploy fails
  on an auth/role error, re-run it.
EOF
