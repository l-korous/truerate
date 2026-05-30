#!/usr/bin/env bash
# TrueRate — manual fallback for the deploy workflow. Provisions Azure infra,
# builds and pushes images to ghcr.io, points Container Apps at them.
#
# Prereqs:
#   - az CLI (logged in)
#   - docker (with buildx)
#   - gh CLI (logged in as the package owner) — for the public-visibility flip
#
# Run from repo root: ./infra/deploy.sh
set -euo pipefail

RG="${RG:-truerate-rg}"
LOCATION="${LOCATION:-westeurope}"
PREFIX="${PREFIX:-truerate}"
GHCR_OWNER="${GHCR_OWNER:-$(gh api user --jq .login)}"
OWNER_LC=$(echo "$GHCR_OWNER" | tr '[:upper:]' '[:lower:]')
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)}"

# Secrets — generate strong values if not provided.
JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 32)}"
CRED_KEY="${CRED_KEY:-$(openssl rand -base64 32)}"

echo "==> Resource group: $RG ($LOCATION)"
az group create -n "$RG" -l "$LOCATION" -o none

# Existing API URL → web build arg (empty on first deploy; rebuild on next).
API_FQDN=$(az containerapp show -g "$RG" -n "${PREFIX}-api" \
  --query properties.configuration.ingress.fqdn -o tsv 2>/dev/null || true)
API_URL="${API_FQDN:+https://$API_FQDN}"
[ -z "$API_URL" ] && echo "    First deploy — web will rebuild with the real API URL on the next run."

echo "==> 1/3 Build and push images to ghcr.io"
echo "$(gh auth token)" | docker login ghcr.io -u "$GHCR_OWNER" --password-stdin
for app in api mcp; do
  docker buildx build --push --platform linux/amd64 \
    -f "apps/${app}/Dockerfile" \
    -t "ghcr.io/${OWNER_LC}/truerate-${app}:${IMAGE_TAG}" \
    -t "ghcr.io/${OWNER_LC}/truerate-${app}:latest" \
    .
done
docker buildx build --push --platform linux/amd64 \
  -f apps/web/Dockerfile \
  --build-arg "NEXT_PUBLIC_API_BASE_URL=${API_URL}" \
  -t "ghcr.io/${OWNER_LC}/truerate-web:${IMAGE_TAG}" \
  -t "ghcr.io/${OWNER_LC}/truerate-web:latest" \
  .

# Container Apps pull anonymously from ghcr.io, so the three packages must be
# PUBLIC. GitHub does not expose a REST endpoint for changing visibility on
# user-owned packages — flip them once via the web UI the first time they
# appear:
#   https://github.com/users/${OWNER_LC}/packages/container/truerate-{api,mcp,web}/settings
#   → Change visibility → Public
# If a package is private, the Bicep deploy below fails with
# 'UNAUTHORIZED: authentication required' from ghcr.io.

echo "==> 2/2 Deploy Bicep (idempotent) pointing at the new images"
az deployment group create \
  -g "$RG" \
  -f infra/main.bicep \
  -p namePrefix="$PREFIX" jwtSecret="$JWT_SECRET" credKey="$CRED_KEY" \
     apiImage="ghcr.io/${OWNER_LC}/truerate-api:${IMAGE_TAG}" \
     mcpImage="ghcr.io/${OWNER_LC}/truerate-mcp:${IMAGE_TAG}" \
     webImage="ghcr.io/${OWNER_LC}/truerate-web:${IMAGE_TAG}" \
  -o none

WEB_URL=$(az deployment group show -g "$RG" -n main --query properties.outputs.webUrl.value -o tsv)
API_OUT=$(az deployment group show -g "$RG" -n main --query properties.outputs.apiUrl.value -o tsv)
MCP_URL=$(az deployment group show -g "$RG" -n main --query properties.outputs.mcpUrl.value -o tsv)

echo
echo "    Web : $WEB_URL"
echo "    API : $API_OUT"
echo "    MCP : $MCP_URL"
echo
echo "    Images: ghcr.io/${OWNER_LC}/truerate-{api,mcp,web}:${IMAGE_TAG}"
