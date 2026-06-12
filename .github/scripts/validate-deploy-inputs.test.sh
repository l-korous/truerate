#!/usr/bin/env bash
# Unit tests for validate-deploy-inputs.sh
# Runs standalone; exits non-zero on any failure.
set -euo pipefail

SCRIPT="$(dirname "$0")/validate-deploy-inputs.sh"
pass=0; fail=0

# run_script <env-pairs> <args...>
# env-pairs is a space-separated list of KEY=value pairs passed as a single arg
run_script() {
  local env_pairs="$1"; shift
  local out exit_code=0
  if [[ -n "$env_pairs" ]]; then
    out=$(env -i PATH="$PATH" $env_pairs bash "$SCRIPT" "$@" 2>&1) || exit_code=$?
  else
    out=$(env -i PATH="$PATH" bash "$SCRIPT" "$@" 2>&1) || exit_code=$?
  fi
  printf '%s\n%d' "$out" "$exit_code"
}

assert_exit() {
  local desc="$1" want="$2" env_pairs="$3"; shift 3
  local result exit_code
  result=$(run_script "$env_pairs" "$@")
  exit_code="${result##*$'\n'}"
  if [[ "$exit_code" -eq "$want" ]]; then
    echo "  PASS: $desc"
    (( pass++ )) || true
  else
    echo "  FAIL: $desc (expected exit $want, got $exit_code)"
    (( fail++ )) || true
  fi
}

assert_output_contains() {
  local desc="$1" want="$2" env_pairs="$3"; shift 3
  local result out
  result=$(run_script "$env_pairs" "$@")
  out="${result%$'\n'*}"
  if echo "$out" | grep -qF "$want"; then
    echo "  PASS: $desc"
    (( pass++ )) || true
  else
    echo "  FAIL: $desc (expected output to contain '$want')"
    echo "    actual: $out"
    (( fail++ )) || true
  fi
}

echo "==> validate-deploy-inputs.sh"

# No args → usage error
assert_exit "no args → exit 1" 1 ""

# All required vars set → success
assert_exit "all vars present → exit 0" 0 "A=x B=y C=z" A B C

# One var missing → exit 1
assert_exit "one missing → exit 1" 1 "A=x C=z" A B C

# Multiple vars missing → exit 1
assert_exit "multiple missing → exit 1" 1 "A=x" A B C

# Empty string counts as missing
assert_exit "empty var counts as missing → exit 1" 1 "A=x B= C=z" A B C

# Output names the missing var
assert_output_contains "output names missing var" "MISSING_VAR" \
  "PRESENT=ok" PRESENT MISSING_VAR

# Output names all missing vars when multiple are absent
assert_output_contains "output names first missing" "FIRST" \
  "" FIRST SECOND

assert_output_contains "output names second missing" "SECOND" \
  "" FIRST SECOND

echo ""
echo "Results: ${pass} passed, ${fail} failed"
[[ $fail -eq 0 ]]
