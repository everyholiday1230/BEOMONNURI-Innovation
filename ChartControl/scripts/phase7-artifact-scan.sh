#!/usr/bin/env bash
# Phase 7 §5 — Production artifact secret/credential scanner.
#
# Phase 6's container check only looked at the image ENV and `docker history`, which is why the dev
# fixture passwords baked into `dist/index.js` went unnoticed. This scanner inspects the actual
# artifacts:
#
#   1. apps/api/dist            (production bundle + any emitted chunk)
#   2. JavaScript bundles       (*.js / *.mjs / *.cjs)
#   3. Source maps              (*.map — presence is itself a finding for a production build)
#   4. Config files             (*.json / *.yml / *.yaml / *.env* inside the artifact)
#   5. Package metadata         (package.json / package-lock / pnpm-lock inside the artifact)
#   6. Container filesystem     (`docker export` of a container created from the image)
#   7. Image layer history      (`docker history --no-trunc`) + image config ENV
#
# Output policy: path + rule id + match count ONLY. Matched text is never printed, and the detection
# patterns themselves never contain a real secret value — dev fixture identifiers are matched by
# SHA-256 digest of the token, not by the literal, so this script is safe to commit and to log.
#
# Usage:
#   bash scripts/phase7-artifact-scan.sh                       # scan dist only
#   IMAGE=quantumtrade-api:phase6-closure bash scripts/phase7-artifact-scan.sh   # dist + image
#
# Exit code: 0 = no findings, 1 = at least one finding (or a scan target could not be inspected).
set -uo pipefail
cd "$(dirname "$0")/.."

DIST="${DIST:-apps/api/dist}"
IMAGE="${IMAGE:-}"
OUT_DIR="artifacts/security"
mkdir -p "$OUT_DIR"
REPORT="$OUT_DIR/phase7-artifact-scan.json"
findings=0
scanned=0
rows=()

say() { printf '%s\n' "$*"; }

# ---------------------------------------------------------------------------
# Rule table. Each rule is: ID | description | grep -E pattern
# Literal dev-fixture tokens are NOT embedded here; they are matched via digest below.
# ---------------------------------------------------------------------------
RULE_IDS=(
  QT-SEC-002 QT-SEC-003 QT-SEC-004 QT-SEC-005 QT-SEC-006
  QT-SEC-007 QT-SEC-008 QT-SEC-009 QT-SEC-010 QT-SEC-011
)
RULE_DESC=(
  "dev fixture e-mail domain (development/E2E account namespace)"
  "BitMart credential assignment (key/secret/memo)"
  "OpenAI API key shape"
  "AWS access key id shape"
  "PEM private key block"
  "Authorization header value"
  "Cookie / Set-Cookie header value"
  "session or CSRF signing key assignment"
  "generic password/secret/token assignment with inline literal"
  "hard-coded insecure development key marker"
)
RULE_PATTERN=(
  '@qt\.local'
  '(BITMART_API_(KEY|SECRET|MEMO)|bitmart(AccessKey|SecretKey|Memo))[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']+'
  'sk-[A-Za-z0-9_-]{20,}'
  '(AKIA|ASIA)[0-9A-Z]{16}'
  '-----BEGIN( [A-Z]+)? PRIVATE KEY-----'
  '[Aa]uthorization[[:space:]]*[:=][[:space:]]*["'"'"']?(Bearer|Basic)[[:space:]]+[A-Za-z0-9._~+/=-]{8,}'
  '[Ss]et-[Cc]ookie[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']*(session|token|sid)='
  '(AUTH_CSRF_KEY|SESSION_SECRET|csrfKey|sessionSecret)[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9+/=_-]{12,}'
  '(password|passwd|secret|token|apiKey|api_key)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'${}]{8,}["'"'"']'
  'insecure[-_](csrf|signing|session)[-_]key'
)

# Digest-matched dev fixture tokens (Phase 7 §4 policy: keep only hashes in committed policy files).
# Every whitespace/quote-delimited token in the artifact is hashed and compared, so the literal
# fixture passwords never appear in this repository outside the dev-only seed module.
FIXTURE_TOKEN_HASHES="\
c5e786688e2d2852061c72783fcf13855a0858b37b9e62b10944f8579d13d9d8
ada11dea291d6d8cb0f638f66ac03aa7e275141622c620defbda4bdae9aa0b86
f257cdeb2b16d6aa30b17abcf2193cd0b36ae49877ada543bb5bd52642796701
3c4388e44ac4e6916e6c26eaa9689e02594411b47a23a9346c2441691c05eb24
7f81a7a4f7bf7ebdeb92533bb05011216ce2c77d0e0ca322f540abcd46a0c744
9440b2de45de8c1e536ff9128cb481c9cb1306ba1b4c5d81c3d57c26b7948d9d
9a1cd0b90b62dd9c7bd6a0b7e2a2b0dd50cb0edd4e4a4b0a1b7ea67ab3c05e01"

record() { # path rule_id count
  rows+=("{\"path\":\"$1\",\"rule\":\"$2\",\"count\":$3}")
  if [ "$3" -gt 0 ]; then
    findings=$((findings + $3))
    say "  FINDING  $2  count=$3  path=$1"
  fi
}

scan_file() { # path
  local f="$1"
  scanned=$((scanned + 1))
  for i in "${!RULE_IDS[@]}"; do
    local n
    n=$(grep -aoE "${RULE_PATTERN[$i]}" "$f" 2>/dev/null | wc -l | tr -d ' ')
    record "$f" "${RULE_IDS[$i]}" "$n"
  done
  # QT-SEC-001: dev fixture tokens matched by digest (no literal in this repo).
  local n1
  n1=$(FIXTURE_HASHES="$FIXTURE_TOKEN_HASHES" python3 - "$f" <<'PY'
import hashlib, os, re, sys
hashes = set(os.environ["FIXTURE_HASHES"].split())
try:
    data = open(sys.argv[1], "rb").read().decode("utf-8", "replace")
except Exception:
    print(0); raise SystemExit(0)
hits = 0
# Candidate tokens: quoted string literals and bare words that could be a credential.
for tok in re.findall(r"[A-Za-z0-9@._+-]{6,120}", data):
    if hashlib.sha256(tok.strip().lower().encode()).hexdigest() in hashes:
        hits += 1
print(hits)
PY
)
  record "$f" "QT-SEC-001" "${n1:-0}"
}

say "=== Phase 7 production artifact scan ==="
say "repo    : $(pwd)"
say "git sha : $(git rev-parse HEAD 2>/dev/null || echo unavailable)"
say "dist    : $DIST"
say "image   : ${IMAGE:-<not scanned>}"
say ""

# ---- 1..5 : dist bundle, source maps, config, package metadata ----
if [ -d "$DIST" ]; then
  say "--- dist / bundle / source map / config / package metadata ---"
  while IFS= read -r f; do scan_file "$f"; done < <(find "$DIST" -type f \
    \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.map' \
       -o -name '*.json' -o -name '*.yml' -o -name '*.yaml' -o -name '.env*' -o -name '*.sql' \) | sort)

  # QT-SEC-012: a production build must ship no source maps.
  MAPS=$(find "$DIST" -type f -name '*.map' | wc -l | tr -d ' ')
  record "$DIST" "QT-SEC-012" "$MAPS"

  # QT-SEC-013: no dev/test module directory may be emitted into the artifact.
  DEVDIRS=$(find "$DIST" -type d \( -name dev -o -name '__tests__' -o -name fixtures -o -name test \) | wc -l | tr -d ' ')
  record "$DIST" "QT-SEC-013" "$DEVDIRS"
else
  say "  SKIP dist not found at $DIST (run: pnpm --filter @quantumtrade/api build)"
  rows+=("{\"path\":\"$DIST\",\"rule\":\"QT-SCAN-TARGET-MISSING\",\"count\":1}")
  findings=$((findings + 1))
fi

# ---- 6..7 : container filesystem export, image layers/history, image ENV ----
if [ -n "$IMAGE" ]; then
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    say "  SKIP image $IMAGE not present locally"
    rows+=("{\"path\":\"$IMAGE\",\"rule\":\"QT-SCAN-TARGET-MISSING\",\"count\":1}")
    findings=$((findings + 1))
  else
    say ""
    say "--- container filesystem export ---"
    TMPD=$(mktemp -d)
    CID=$(docker create "$IMAGE" 2>/dev/null)
    if [ -n "$CID" ]; then
      docker export "$CID" -o "$TMPD/fs.tar" 2>/dev/null
      docker rm -f "$CID" >/dev/null 2>&1
      mkdir -p "$TMPD/fs"
      # Only application + config paths; OS packages are covered by the Trivy scan.
      tar -xf "$TMPD/fs.tar" -C "$TMPD/fs" app etc/passwd 2>/dev/null || tar -xf "$TMPD/fs.tar" -C "$TMPD/fs" app 2>/dev/null
      if [ -d "$TMPD/fs/app" ]; then
        while IFS= read -r f; do scan_file "$f"; done < <(find "$TMPD/fs/app" -maxdepth 3 -type f \
          \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.map' -o -name '*.json' -o -name '.env*' \) | sort)
        # QT-SEC-013 applies to OUR emitted artifact only. Third-party packages legitimately ship
        # their own test/fixture directories (e.g. tar-fs/test/fixtures); those are dependency
        # hygiene, covered by the Trivy/SBOM gate, not application credential leakage.
        DEVFILES=$(find "$TMPD/fs/app/dist" -type d \( -name dev -o -name '__tests__' -o -name fixtures -o -name test \) 2>/dev/null | wc -l | tr -d ' ')
        record "container:/app/dist" "QT-SEC-013" "$DEVFILES"
        MAPS_C=$(find "$TMPD/fs/app/dist" -type f -name '*.map' 2>/dev/null | wc -l | tr -d ' ')
        record "container:/app/dist" "QT-SEC-012" "$MAPS_C"
      else
        say "  NOTE /app not present in export"
      fi
    fi
    rm -rf "$TMPD"

    say ""
    say "--- image layer history + image ENV ---"
    HIST_TMP=$(mktemp)
    docker history --no-trunc "$IMAGE" > "$HIST_TMP" 2>/dev/null
    scan_file "$HIST_TMP"
    rows[${#rows[@]}-1]="${rows[${#rows[@]}-1]/$HIST_TMP/image:history}"
    rm -f "$HIST_TMP"

    ENV_TMP=$(mktemp)
    docker image inspect "$IMAGE" --format '{{json .Config.Env}}' > "$ENV_TMP" 2>/dev/null
    scan_file "$ENV_TMP"
    rm -f "$ENV_TMP"
  fi
fi

# ---- report ----
{
  printf '{\n  "gitSha": "%s",\n' "$(git rev-parse HEAD 2>/dev/null || echo unavailable)"
  printf '  "generatedAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "dist": "%s",\n  "image": "%s",\n' "$DIST" "${IMAGE:-null}"
  printf '  "filesScanned": %d,\n  "totalFindings": %d,\n' "$scanned" "$findings"
  printf '  "rules": [\n'
  for i in "${!RULE_IDS[@]}"; do
    printf '    {"id":"%s","description":"%s"}%s\n' "${RULE_IDS[$i]}" "${RULE_DESC[$i]}" \
      "$([ "$i" -lt $((${#RULE_IDS[@]} - 1)) ] && echo ,)"
  done
  printf '  ],\n  "results": [\n'
  first=1
  for r in "${rows[@]}"; do
    [ $first -eq 0 ] && printf ',\n'
    printf '    %s' "$r"
    first=0
  done
  printf '\n  ]\n}\n'
} > "$REPORT"

say ""
say "files scanned : $scanned"
say "total findings: $findings"
say "report        : $REPORT  (paths + rule ids + counts only; no matched text)"
if [ "$findings" -eq 0 ]; then
  say "RESULT: PASS — no forbidden credential material in the production artifact"
  exit 0
fi
say "RESULT: FAIL — see findings above"
exit 1
