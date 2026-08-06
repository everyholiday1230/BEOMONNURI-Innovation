#!/usr/bin/env bash
# R3 negative control — proves .gitleaks.toml still DETECTS a real secret and is not globally disabled.
# Writes a throwaway file containing a real-shaped secret NOT covered by any allowlist entry, scans it,
# and asserts gitleaks reports >=1 finding. Cleans up. Never commits the temp file.
set -uo pipefail
cd "$(dirname "$0")/.."
GL="${GITLEAKS:-$(command -v gitleaks || echo /home/test1/bin/gitleaks)}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# A real-shaped AWS secret access key (40 base64-ish chars) — deliberately NOT any allowlisted literal.
# High-entropy random token (generated per run) assigned to a secret keyword — NOT an AWS example key
# (gitleaks default-allowlists AKIA…EXAMPLE) and NOT any allowlisted literal.
SECRET="$(head -c 30 /dev/urandom | base64 | tr -d '=+/' | head -c 40)"
printf 'generic_api_key = "%s"\n' "$SECRET" > "$TMP/leak.txt"
N=$("$GL" detect --no-banner --no-git --config .gitleaks.toml --report-format json --report-path "$TMP/r.json" --source "$TMP" >/dev/null 2>&1; python3 -c "import json;print(len(json.load(open('$TMP/r.json'))))" 2>/dev/null || echo 0)
echo "negative-control findings: $N"
if [ "$N" -ge 1 ]; then echo "PASS: real secret detected (config not globally disabled)"; exit 0; else echo "FAIL: real secret NOT detected — config is over-suppressing"; exit 1; fi
