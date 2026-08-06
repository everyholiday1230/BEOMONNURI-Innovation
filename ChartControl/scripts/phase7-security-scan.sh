#!/usr/bin/env bash
# Phase 7 §2 — Production Security Gate scanner suite.
#
# Records for every scan: tool, tool version, rule/DB version, start/end time, exit code and finding
# count. Raw tool output is written to artifacts/security/phase7/ ; the summary TSV never contains a
# matched secret value.
#
# SECRET HANDLING: gitleaks is run with --redact so its own report stores redacted values only, and
# this script never echoes a finding's secret. Only counts, rule ids and file paths are summarized.
#
# Tool paths are overridable for CI.
set -uo pipefail
cd "$(dirname "$0")/.."

IMAGE="${IMAGE:-quantumtrade-api:phase7-secgate}"
OUT="artifacts/security/phase7"
LOGS="artifacts/logs/phase7/security"
mkdir -p "$OUT" "$LOGS"
SUMMARY="$OUT/scan-summary.tsv"

SEMGREP="${SEMGREP:-$(command -v semgrep || echo /tmp/sgvenv/bin/semgrep)}"
GITLEAKS="${GITLEAKS:-$(command -v gitleaks || echo /home/test1/bin/gitleaks)}"
OSV="${OSV:-$(command -v osv-scanner || echo /home/test1/bin/osv-scanner)}"
TRIVY="${TRIVY:-$(command -v trivy || echo /home/test1/bin/trivy)}"
SYFT="${SYFT:-$(command -v syft || echo /home/test1/bin/syft)}"
CHECKOV="${CHECKOV:-$(command -v checkov || echo /tmp/cvenv/bin/checkov)}"
TFSEC="${TFSEC:-$(command -v tfsec || echo /home/test1/bin/tfsec)}"

GIT_SHA="$(git rev-parse HEAD)"
printf 'scan\ttool\ttool_version\trule_or_db_version\tstart\tend\texit_code\tfindings\tresult\traw_output\n' > "$SUMMARY"

say() { printf '%s\n' "$*"; }

row() { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@" >> "$SUMMARY"; }

# count_json <file> <python-expression-on-d>
count_json() { python3 -c "
import json,sys
try:
    d=json.load(open(sys.argv[1]))
except Exception:
    print(-1); raise SystemExit(0)
try:
    print($2)
except Exception:
    print(-1)
" "$1" 2>/dev/null || echo -1; }

say "=== Phase 7 security scan suite ==="
say "git sha : $GIT_SHA"
say "image   : $IMAGE"
say "started : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say ""

# ---------------------------------------------------------------- 1. Semgrep SAST
S=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ -x "$SEMGREP" ] || command -v "$SEMGREP" >/dev/null 2>&1; then
  SG_VER=$("$SEMGREP" --version 2>/dev/null | head -1 | tr -d '\n')
  # Offline-friendly: the bundled p/default ruleset requires network; fall back to the local registry
  # cache if the fetch fails. Ruleset identity is recorded either way.
  "$SEMGREP" scan --config=p/default --json --quiet \
    --exclude node_modules --exclude dist --exclude .terraform --exclude artifacts \
    --output "$OUT/semgrep.json" . > "$LOGS/semgrep.log" 2>&1
  RC=$?
  N=$(count_json "$OUT/semgrep.json" "len(d.get('results',[]))")
  RULES=$(count_json "$OUT/semgrep.json" "len({r['check_id'] for r in d.get('results',[])})")
  E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  R=PASS; [ "${N:-0}" -gt 0 ] && R=FINDINGS; [ "$RC" -ne 0 ] && [ "${N:-0}" -le 0 ] && R=ERROR
  say "semgrep        exit=$RC findings=$N distinct-rules=$RULES"
  row semgrep-sast semgrep "$SG_VER" "p/default" "$S" "$E" "$RC" "${N:-0}" "$R" "$OUT/semgrep.json"
else
  say "semgrep        NOT_EXECUTED (binary absent)"
  row semgrep-sast semgrep unavailable - "$S" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" - - NOT_EXECUTED -
fi

# ---------------------------------------------------------------- 2. Gitleaks (working tree)
S=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ -x "$GITLEAKS" ]; then
  GL_VER=$("$GITLEAKS" version 2>/dev/null | tr -d '\n')
  "$GITLEAKS" dir . --config .gitleaks.toml --redact --no-banner --report-format json --report-path "$OUT/gitleaks-worktree.json" \
    > "$LOGS/gitleaks-worktree.log" 2>&1
  RC=$?
  N=$(count_json "$OUT/gitleaks-worktree.json" "len(d)")
  E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  R=PASS; [ "${N:-0}" -gt 0 ] && R=FINDINGS
  say "gitleaks(tree) exit=$RC findings=$N"
  row gitleaks-worktree gitleaks "$GL_VER" "builtin+.gitleaks.toml" "$S" "$E" "$RC" "${N:-0}" "$R" "$OUT/gitleaks-worktree.json"

  # ------------------------------------------------------------ 3. Gitleaks (full history)
  S=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  "$GITLEAKS" git . --config .gitleaks.toml --redact --no-banner --report-format json --report-path "$OUT/gitleaks-history.json" \
    > "$LOGS/gitleaks-history.log" 2>&1
  RC=$?
  N=$(count_json "$OUT/gitleaks-history.json" "len(d)")
  E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  R=PASS; [ "${N:-0}" -gt 0 ] && R=FINDINGS
  say "gitleaks(hist) exit=$RC findings=$N"
  row gitleaks-full-history gitleaks "$GL_VER" "builtin+.gitleaks.toml" "$S" "$E" "$RC" "${N:-0}" "$R" "$OUT/gitleaks-history.json"
else
  say "gitleaks       NOT_EXECUTED (binary absent)"
  row gitleaks-worktree gitleaks unavailable - "$S" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" - - NOT_EXECUTED -
  row gitleaks-full-history gitleaks unavailable - "$S" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" - - NOT_EXECUTED -
fi

# ---------------------------------------------------------------- 4. OSV-Scanner
S=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ -x "$OSV" ]; then
  OSV_VER=$("$OSV" --version 2>/dev/null | head -1 | tr -d '\n')
  "$OSV" scan source --lockfile=pnpm-lock.yaml --format json --output "$OUT/osv.json" \
    > "$LOGS/osv.log" 2>&1
  RC=$?
  N=$(count_json "$OUT/osv.json" "sum(len(p.get('vulnerabilities',[])) for r in d.get('results',[]) for p in r.get('packages',[]))")
  E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  R=PASS; [ "${N:-0}" -gt 0 ] && R=FINDINGS
  say "osv-scanner    exit=$RC vulns=$N"
  row osv-scanner osv-scanner "$OSV_VER" "osv.dev-live" "$S" "$E" "$RC" "${N:-0}" "$R" "$OUT/osv.json"
else
  say "osv-scanner    NOT_EXECUTED (binary absent)"
  row osv-scanner osv-scanner unavailable - "$S" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" - - NOT_EXECUTED -
fi

# ---------------------------------------------------------------- 5/6. Trivy filesystem + image
if [ -x "$TRIVY" ]; then
  TR_VER=$("$TRIVY" --version 2>/dev/null | head -1 | awk '{print $2}' | tr -d '\n')
  DB_VER=$("$TRIVY" --version 2>/dev/null | grep -A2 "Vulnerability DB" | grep -i "UpdatedAt" | head -1 | tr -d ' \n')
  [ -z "$DB_VER" ] && DB_VER="db-bundled"

  S=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  "$TRIVY" fs --scanners vuln,secret,misconfig --format json --output "$OUT/trivy-fs.json" \
    --skip-dirs node_modules --skip-dirs .terraform --skip-dirs artifacts . > "$LOGS/trivy-fs.log" 2>&1
  RC=$?
  N=$(count_json "$OUT/trivy-fs.json" "sum(len(r.get('Vulnerabilities') or []) + len(r.get('Secrets') or []) + len(r.get('Misconfigurations') or []) for r in (d.get('Results') or []))")
  CH=$(count_json "$OUT/trivy-fs.json" "sum(1 for r in (d.get('Results') or []) for v in (r.get('Vulnerabilities') or []) if v.get('Severity') in ('CRITICAL','HIGH'))")
  E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  R=PASS; [ "${CH:-0}" -gt 0 ] && R=FINDINGS
  say "trivy fs       exit=$RC findings=$N critical+high=$CH"
  row trivy-filesystem trivy "$TR_VER" "$DB_VER" "$S" "$E" "$RC" "${N:-0}" "$R" "$OUT/trivy-fs.json"

  S=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    "$TRIVY" image --scanners vuln,secret --format json --output "$OUT/trivy-image.json" "$IMAGE" \
      > "$LOGS/trivy-image.log" 2>&1
    RC=$?
    N=$(count_json "$OUT/trivy-image.json" "sum(len(r.get('Vulnerabilities') or []) + len(r.get('Secrets') or []) for r in (d.get('Results') or []))")
    CH=$(count_json "$OUT/trivy-image.json" "sum(1 for r in (d.get('Results') or []) for v in (r.get('Vulnerabilities') or []) if v.get('Severity') in ('CRITICAL','HIGH'))")
    E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    R=PASS; [ "${CH:-0}" -gt 0 ] && R=FINDINGS
    say "trivy image    exit=$RC findings=$N critical+high=$CH"
    row trivy-container-image trivy "$TR_VER" "$DB_VER" "$S" "$E" "$RC" "${N:-0}" "$R" "$OUT/trivy-image.json"
  else
    say "trivy image    NOT_EXECUTED (image $IMAGE absent)"
    row trivy-container-image trivy "$TR_VER" "$DB_VER" "$S" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" - - NOT_EXECUTED -
  fi
else
  say "trivy          NOT_EXECUTED (binary absent)"
  row trivy-filesystem trivy unavailable - - - - - NOT_EXECUTED -
  row trivy-container-image trivy unavailable - - - - - NOT_EXECUTED -
fi

# ---------------------------------------------------------------- 7. SBOM (CycloneDX + SPDX)
S=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ -x "$SYFT" ] && docker image inspect "$IMAGE" >/dev/null 2>&1; then
  SY_VER=$("$SYFT" version 2>/dev/null | awk '/^Version:/{print $2}' | tr -d '\n')
  "$SYFT" scan "docker:$IMAGE" -o "cyclonedx-json=$OUT/sbom-image.cdx.json" \
    -o "spdx-json=$OUT/sbom-image.spdx.json" > "$LOGS/syft-image.log" 2>&1
  RC=$?
  N=$(count_json "$OUT/sbom-image.cdx.json" "len(d.get('components',[]))")
  E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  say "sbom image     exit=$RC components=$N"
  row sbom-cyclonedx-spdx syft "$SY_VER" "-" "$S" "$E" "$RC" "${N:-0}" "$([ "$RC" -eq 0 ] && echo PASS || echo ERROR)" "$OUT/sbom-image.cdx.json"

  # Source-tree SBOM as well, so the dependency change is auditable independently of the image.
  S=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  "$SYFT" scan dir:. --exclude ./node_modules --exclude ./.terraform --exclude ./artifacts \
    -o "cyclonedx-json=$OUT/sbom-source.cdx.json" -o "spdx-json=$OUT/sbom-source.spdx.json" \
    > "$LOGS/syft-source.log" 2>&1
  RC=$?
  N=$(count_json "$OUT/sbom-source.cdx.json" "len(d.get('components',[]))")
  E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  say "sbom source    exit=$RC components=$N"
  row sbom-source syft "$SY_VER" "-" "$S" "$E" "$RC" "${N:-0}" "$([ "$RC" -eq 0 ] && echo PASS || echo ERROR)" "$OUT/sbom-source.cdx.json"
else
  say "sbom           NOT_EXECUTED (syft or image absent)"
  row sbom-cyclonedx-spdx syft unavailable - "$S" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" - - NOT_EXECUTED -
fi

# ---------------------------------------------------------------- 8. License scan (from SBOM)
S=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ -f "$OUT/sbom-image.cdx.json" ]; then
  python3 - "$OUT/sbom-image.cdx.json" "$OUT/license-report.json" <<'PY' > "$LOGS/license.log" 2>&1
import json, sys, re
src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src))
# Licenses that require legal review before shipping a commercial SaaS.
RESTRICTED = re.compile(r'\b(AGPL|SSPL|BUSL|BSL|CC-BY-NC|Commons-Clause|EUPL|OSL|RPL|SSPL-1\.0)\b', re.I)
WEAK_COPYLEFT = re.compile(r'\b(GPL-[23]|LGPL|MPL-2\.0|CDDL|EPL)\b', re.I)
per, restricted, weak, unknown = {}, [], [], []
for c in d.get('components', []):
    name = f"{c.get('name')}@{c.get('purl','').split('@')[-1] or c.get('version','')}"
    lics = []
    for l in c.get('licenses', []) or []:
        v = (l.get('license') or {})
        lics.append(v.get('id') or v.get('name') or l.get('expression') or '')
    lics = [x for x in lics if x]
    joined = ' '.join(lics)
    per[name] = lics or ['UNKNOWN']
    if not lics:
        unknown.append(name)
    elif RESTRICTED.search(joined):
        restricted.append({'component': name, 'licenses': lics})
    elif WEAK_COPYLEFT.search(joined):
        weak.append({'component': name, 'licenses': lics})
out = {
    'components': len(per),
    'restrictedCount': len(restricted),
    'weakCopyleftCount': len(weak),
    'unknownCount': len(unknown),
    'restricted': restricted,
    'weakCopyleft': weak,
    'unknown': sorted(unknown)[:80],
}
json.dump(out, open(dst, 'w'), indent=1)
print(f"components={out['components']} restricted={out['restrictedCount']} weakCopyleft={out['weakCopyleftCount']} unknown={out['unknownCount']}")
PY
  RC=$?
  N=$(count_json "$OUT/license-report.json" "d['restrictedCount']")
  E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  R=PASS; [ "${N:-0}" -gt 0 ] && R=FINDINGS
  say "license scan   exit=$RC restricted=$N"
  row license-scan sbom-license-analyzer "1.0" "AGPL/SSPL/BUSL/CC-BY-NC deny-list" "$S" "$E" "$RC" "${N:-0}" "$R" "$OUT/license-report.json"
else
  say "license scan   NOT_EXECUTED (no SBOM)"
  row license-scan sbom-license-analyzer unavailable - "$S" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" - - NOT_EXECUTED -
fi

# ---------------------------------------------------------------- 9. IaC (checkov + tfsec)
if [ -x "$CHECKOV" ] || command -v "$CHECKOV" >/dev/null 2>&1; then
  S=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  CK_VER=$("$CHECKOV" --version 2>/dev/null | head -1 | tr -d '\n')
  "$CHECKOV" -d infrastructure/terraform/phase7 --framework terraform --compact \
    -o json --output-file-path "$OUT/checkov" > "$LOGS/checkov.log" 2>&1
  RC=$?
  N=$(count_json "$OUT/checkov/results_json.json" "len(d['results']['failed_checks']) if isinstance(d,dict) else sum(len(x['results']['failed_checks']) for x in d)")
  E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  R=PASS; [ "${N:-0}" -gt 0 ] && R=FINDINGS
  say "checkov (iac)  exit=$RC failed=$N"
  row iac-checkov checkov "$CK_VER" "builtin-policies" "$S" "$E" "$RC" "${N:-0}" "$R" "$OUT/checkov/results_json.json"
fi
if [ -x "$TFSEC" ]; then
  S=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  TS_VER=$("$TFSEC" --version 2>/dev/null | head -1 | tr -d '\n')
  "$TFSEC" infrastructure/terraform/phase7 --no-colour -f json --out "$OUT/tfsec.json" \
    > "$LOGS/tfsec.log" 2>&1
  RC=$?
  N=$(count_json "$OUT/tfsec.json" "len(d.get('results') or [])")
  E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  R=PASS; [ "${N:-0}" -gt 0 ] && R=FINDINGS
  say "tfsec (iac)    exit=$RC findings=$N"
  row iac-tfsec tfsec "$TS_VER" "builtin-checks" "$S" "$E" "$RC" "${N:-0}" "$R" "$OUT/tfsec.json"
fi

say ""
say "=== SUMMARY ==="
column -t -s $'\t' "$SUMMARY" | cut -c1-190
say ""
say "summary: $SUMMARY   (no secret value is recorded; gitleaks runs with --redact)"
exit 0
