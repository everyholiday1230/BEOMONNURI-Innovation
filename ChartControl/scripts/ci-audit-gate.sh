#!/usr/bin/env bash
# Phase 6 CI dependency gate: PRODUCTION audit must have 0 critical AND 0 high.
# New production Critical/High → fail. Dev-only advisories are allowed but listed (see
# docs/PHASE6-17-DEPENDENCY-AUDIT.md for the approved dev exception allowlist + expiry).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
OUT="artifacts/logs/ci-audit-prod.json"; mkdir -p artifacts/logs
pnpm audit --prod --json > "$OUT" 2>/dev/null || true
read -r CRIT HIGH < <(node -e "const a=require('./$OUT');const v=a.metadata.vulnerabilities;process.stdout.write((v.critical||0)+' '+(v.high||0))")
echo "PRODUCTION audit: critical=$CRIT high=$HIGH (full JSON: $OUT)"
if [ "$CRIT" -gt 0 ] || [ "$HIGH" -gt 0 ]; then
  echo "FAIL: production dependencies must have 0 critical and 0 high vulnerabilities."
  node -e "const a=require('./$OUT');for(const v of Object.values(a.advisories||{}))if(v.severity==='high'||v.severity==='critical')console.log(' - ['+v.severity+'] '+v.module_name+' '+v.github_advisory_id+' patched='+v.patched_versions)"
  exit 1
fi
echo "PASS: 0 critical / 0 high in production dependencies."
