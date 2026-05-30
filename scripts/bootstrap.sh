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

# ── 2. Azure resource group + service principal ───────────────────────────────
say "Creating resource group $RG ($LOCATION)"
az group create -n "$RG" -l "$LOCATION" -o none

# The deploy pipeline's Bicep creates role assignments (ACR pull, Key Vault
# secrets, Cosmos data role), which requires Owner on the scope. Scoping Owner to
# this single resource group keeps the blast radius to TrueRate's own resources.
SCOPE="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG"
say "Creating service principal '$SP_NAME' (Owner on $RG only)"

CREDS_FILE="$(mktemp)"
trap 'rm -f "$CREDS_FILE"' EXIT
# Newer Azure CLI uses --json-auth; older uses --sdk-auth. Both emit the JSON
# shape that azure/login@v2 expects in the `creds` field.
if ! az ad sp create-for-rbac --name "$SP_NAME" --role Owner --scopes "$SCOPE" \
      --json-auth -o json > "$CREDS_FILE" 2>/dev/null; then
  az ad sp create-for-rbac --name "$SP_NAME" --role Owner --scopes "$SCOPE" \
      --sdk-auth -o json > "$CREDS_FILE"
fi

# ── 3. GitHub Actions secrets + variables ─────────────────────────────────────
say "Storing GitHub Actions secrets"
gh secret set AZURE_CREDENTIALS   --repo "$GH_OWNER/$REPO" < "$CREDS_FILE"
printf "%s" "$(openssl rand -base64 32)" | gh secret set TRUERATE_JWT_SECRET --repo "$GH_OWNER/$REPO"
printf "%s" "$(openssl rand -base64 32)" | gh secret set TRUERATE_CRED_KEY   --repo "$GH_OWNER/$REPO"

say "Storing GitHub Actions variables"
gh variable set AZURE_RG       --repo "$GH_OWNER/$REPO" --body "$RG"
gh variable set AZURE_LOCATION --repo "$GH_OWNER/$REPO" --body "$LOCATION"
gh variable set AZURE_PREFIX   --repo "$GH_OWNER/$REPO" --body "$PREFIX"

say "Done."
cat <<EOF

  Repository : https://github.com/$GH_OWNER/$REPO  (private)
  Secrets set: AZURE_CREDENTIALS, TRUERATE_JWT_SECRET, TRUERATE_CRED_KEY
  Variables  : AZURE_RG=$RG, AZURE_LOCATION=$LOCATION, AZURE_PREFIX=$PREFIX

  Next:
    - The push above already triggered CI.
    - To deploy: trigger the "Deploy (Azure)" workflow (it also runs on push to main):
        gh workflow run "Deploy (Azure)" --repo $GH_OWNER/$REPO
    - Watch it:
        gh run watch --repo $GH_OWNER/$REPO

  The TRUERATE_JWT_SECRET / TRUERATE_CRED_KEY were generated and stored directly
  as repo secrets (never printed). They are also written to Key Vault on deploy.
EOF
