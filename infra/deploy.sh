#!/usr/bin/env bash
# TrueRate — provision Azure infra, build & push images, point the apps at them.
# Prereqs: az CLI (logged in), Docker. Run from repo root: ./infra/deploy.sh
set -euo pipefail

RG="${RG:-truerate-rg}"
LOCATION="${LOCATION:-westeurope}"
PREFIX="${PREFIX:-truerate}"

# Secrets — generate strong values if not provided.
JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 32)}"
CRED_KEY="${CRED_KEY:-$(openssl rand -base64 32)}"

echo "==> Resource group: $RG ($LOCATION)"
az group create -n "$RG" -l "$LOCATION" -o none

echo "==> 1/4 Provisioning infrastructure (seed images)"
az deployment group create \
  -g "$RG" \
  -f infra/main.bicep \
  -p namePrefix="$PREFIX" jwtSecret="$JWT_SECRET" credKey="$CRED_KEY" \
  -o none

ACR=$(az deployment group show -g "$RG" -n main --query properties.outputs.acrLoginServer.value -o tsv)
WEB_URL=$(az deployment group show -g "$RG" -n main --query properties.outputs.webUrl.value -o tsv)
API_URL=$(az deployment group show -g "$RG" -n main --query properties.outputs.apiUrl.value -o tsv)
MCP_URL=$(az deployment group show -g "$RG" -n main --query properties.outputs.mcpUrl.value -o tsv)
echo "    ACR: $ACR"

echo "==> 2/4 Building and pushing images (ACR build, no local Docker needed)"
REG_NAME="${ACR%%.*}"
az acr build -r "$REG_NAME" -t truerate-api:latest -f apps/api/Dockerfile .
az acr build -r "$REG_NAME" -t truerate-mcp:latest -f apps/mcp/Dockerfile .
# Web bakes the API URL at build time.
az acr build -r "$REG_NAME" -t truerate-web:latest -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_BASE_URL="$API_URL" .

echo "==> 3/4 Pointing Container Apps at the real images"
az containerapp update -g "$RG" -n "${PREFIX}-api" --image "$ACR/truerate-api:latest" -o none
az containerapp update -g "$RG" -n "${PREFIX}-mcp" --image "$ACR/truerate-mcp:latest" -o none
az containerapp update -g "$RG" -n "${PREFIX}-web" --image "$ACR/truerate-web:latest" -o none

echo "==> 4/4 Done"
echo "    Web : $WEB_URL"
echo "    API : $API_URL"
echo "    MCP : $MCP_URL"
echo
echo "Save these secrets (also stored in Key Vault):"
echo "  JWT_SECRET=$JWT_SECRET"
echo "  CRED_KEY=$CRED_KEY"
