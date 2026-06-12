#!/usr/bin/env bash
# Validates that the required deploy secrets/env vars are present and non-empty.
# Usage: validate-deploy-inputs.sh VAR_NAME [VAR_NAME ...]
# Each VAR_NAME is looked up in the current environment.
# Exits 1 and emits one ::error:: annotation per missing input; exits 0 otherwise.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 VAR_NAME [VAR_NAME ...]" >&2
  exit 1
fi

missing=()
for var in "$@"; do
  val="${!var:-}"
  if [[ -z "$val" ]]; then
    missing+=("$var")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "::error::${#missing[@]} required secret(s)/env var(s) are missing or empty:"
  for name in "${missing[@]}"; do
    echo "::error::  • $name"
  done
  exit 1
fi

echo "All required secrets/env vars present (${#} checked)."
