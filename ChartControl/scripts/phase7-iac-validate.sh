#!/usr/bin/env bash
# Phase 7 §8 — Terraform static validation. No AWS credentials required; nothing is applied.
#
# Tool locations are overridable so CI can point at its own binaries:
#   TERRAFORM=/usr/local/bin/terraform CHECKOV=/usr/bin/checkov bash scripts/phase7-iac-validate.sh
set -uo pipefail
cd "$(dirname "$0")/.."

TF_DIR="infrastructure/terraform/phase7"
OUT_DIR="artifacts/logs/phase7"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/iac-validate.log"
SUMMARY="$OUT_DIR/iac-validate-summary.tsv"

TERRAFORM="${TERRAFORM:-$(command -v terraform || echo /home/test1/bin/terraform)}"
TFLINT="${TFLINT:-$(command -v tflint || echo /home/test1/bin/tflint)}"
TFSEC="${TFSEC:-$(command -v tfsec || echo /home/test1/bin/tfsec)}"
CHECKOV="${CHECKOV:-$(command -v checkov || echo /tmp/cvenv/bin/checkov)}"

: > "$LOG"
printf 'step\ttool\tversion\texit_code\tresult\tnote\n' > "$SUMMARY"
pass=0; fail=0; skipped=0

say() { printf '%s\n' "$*" | tee -a "$LOG"; }

row() { printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" "$6" >> "$SUMMARY"; }

run_step() { # name tool version_cmd command...
  local name="$1"; local tool="$2"; local ver="$3"; shift 3
  if [ ! -x "$tool" ] && ! command -v "$tool" >/dev/null 2>&1; then
    say "SKIP  $name — $tool not installed"
    row "$name" "$tool" "unavailable" "-" "NOT_EXECUTED" "tool not installed; install attempted, see notes"
    skipped=$((skipped+1))
    return
  fi
  say ""
  say "--- $name ($tool $ver) ---"
  "$@" >> "$LOG" 2>&1
  local code=$?
  if [ "$code" -eq 0 ]; then
    say "PASS  $name"
    row "$name" "$tool" "$ver" "$code" "PASS" ""
    pass=$((pass+1))
  else
    say "FAIL  $name (exit $code)"
    row "$name" "$tool" "$ver" "$code" "FAIL" "see $LOG"
    fail=$((fail+1))
  fi
}

say "=== Phase 7 IaC static validation ==="
say "git sha : $(git rev-parse HEAD)"
say "dir     : $TF_DIR"
say "started : $(date -u +%Y-%m-%dT%H:%M:%SZ)"

TF_VER=$("$TERRAFORM" version -json 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['terraform_version'])" 2>/dev/null || echo unknown)
TFLINT_VER=$("$TFLINT" --version 2>/dev/null | head -1 | awk '{print $3}' | tr -d "\n" || echo unknown)
TFSEC_VER=$("$TFSEC" --version 2>/dev/null | head -1 | tr -d "\n" || echo unknown)
CHECKOV_VER=$("$CHECKOV" --version 2>/dev/null | head -1 || echo unknown)

run_step "terraform fmt -check" "$TERRAFORM" "$TF_VER" "$TERRAFORM" -chdir="$TF_DIR" fmt -check -recursive
run_step "terraform init -backend=false" "$TERRAFORM" "$TF_VER" "$TERRAFORM" -chdir="$TF_DIR" init -backend=false -input=false
run_step "terraform validate" "$TERRAFORM" "$TF_VER" "$TERRAFORM" -chdir="$TF_DIR" validate
run_step "tflint" "$TFLINT" "$TFLINT_VER" "$TFLINT" --chdir="$TF_DIR" --recursive
run_step "checkov" "$CHECKOV" "$CHECKOV_VER" "$CHECKOV" -d "$TF_DIR" --framework terraform --compact
run_step "tfsec" "$TFSEC" "$TFSEC_VER" "$TFSEC" "$TF_DIR" --no-colour

# terraform plan requires credentials for the target account; the Stage 0 runtime role is denied on
# every service in this configuration, so plan CANNOT run here. Recorded, never faked.
say ""
say "--- terraform plan ---"
say "NOT_EXECUTED  terraform plan requires AWS credentials with read access to the target account."
say "              Stage 0 preflight: the runtime role is AccessDenied on secretsmanager, kms, rds,"
say "              elasticache, ecr, acm, route53, logs, cloudwatch and sns. See"
say "              docs/PHASE7-02-AWS-RUNTIME-VALIDATION.md."
row "terraform plan" "$TERRAFORM" "$TF_VER" "-" "NOT_EXECUTED" "no AWS credentials / role denied on all target services"
skipped=$((skipped+1))

say ""
say "--- terraform apply ---"
say "NOT_EXECUTED  Out of scope by instruction: no AWS resource is created, modified or deleted."
row "terraform apply" "$TERRAFORM" "$TF_VER" "-" "NOT_EXECUTED" "out of scope by instruction"
skipped=$((skipped+1))

say ""
say "=== RESULT: $pass passed / $fail failed / $skipped not executed ==="
say "log     : $LOG"
say "summary : $SUMMARY"
[ "$fail" -eq 0 ] || exit 1
exit 0
