#!/usr/bin/env python3
"""
Design fidelity checker.

Compares the class names used by each ORIGINAL prototype component against those used anywhere in
`apps/broker-web/src`. The prototype's markup is the source of truth for appearance, so a class the original
renders and we never render is a piece of the delivered design that is not on screen.

This exists because the port previously tracked progress by reading CSS files and reconstructing markup, which
made "is it faithful?" a judgement call. It is now a number, per component, that regresses visibly.

Deliberate exclusions are listed in EXCLUDED with the reason. Anything excluded must be justified in code, not
quietly dropped.

Usage:
    python3 scripts/design-fidelity.py            # summary table
    python3 scripts/design-fidelity.py OrderBook  # one component, listing missing classes
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

PROTO = Path("/home/test1/team_delivery/src")
MINE = Path("apps/broker-web/src")

# Components intentionally not ported, with the reason. These are excluded from the score.
EXCLUDED = {
    "TweaksPanel": "디자이너용 미리보기 도구 — role·연결상태를 클라이언트에서 덮어씀. 실거래 화면에 있으면 안 됨",
    "AppSidebar": "라우트 매니페스트 기반 Sidebar.tsx로 대체 (권한이 라우트 선언에서 나옴)",
}

# Class prefixes that belong to excluded components.
EXCLUDED_PREFIXES = ("tw-", "tweaks", "role-switcher")


def classes_in(text: str) -> set[str]:
    """Every class name appearing in className={...} or className="...", including template literals."""
    out: set[str] = set()
    for m in re.finditer(r'className=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})', text):
        blob = m.group(1) or m.group(2) or m.group(3) or ""
        # Pull quoted fragments out of expressions so `cond ? 'is-active' : ''` still counts.
        for frag in re.findall(r"[\"'`]([^\"'`]*)[\"'`]", blob) + [blob]:
            for tok in re.split(r"[\s${}?:+()!=&|]+", frag):
                tok = tok.strip()
                if tok and re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]*", tok):
                    out.add(tok)
    return out


def css_classes() -> set[str]:
    """Every class the delivered stylesheets actually define.

    Class names are read from `className` expressions, which also contain variable names
    (`isUp ? 't-long' : 't-short'`). Intersecting with the stylesheet removes those: a token that is not a
    defined class cannot be a piece of the design.
    """
    out: set[str] = set()
    for f in PROTO.glob("*.css"):
        out |= set(re.findall(r"\.([a-zA-Z][a-zA-Z0-9_-]*)", f.read_text(encoding="utf-8")))
    return out


def proto_components() -> dict[str, set[str]]:
    """Map each `window.X = function` component to the classes it renders."""
    comps: dict[str, set[str]] = {}
    for f in sorted(PROTO.glob("*.jsx")):
        src = f.read_text(encoding="utf-8")
        marks = [(m.start(), m.group(1)) for m in re.finditer(r"window\.([A-Z][A-Za-z0-9]*)\s*=\s*function", src)]
        for i, (pos, name) in enumerate(marks):
            end = marks[i + 1][0] if i + 1 < len(marks) else len(src)
            comps[name] = classes_in(src[pos:end])
    css = css_classes()
    return {k: (v & css) for k, v in comps.items()}


def mine_classes() -> set[str]:
    out: set[str] = set()
    for f in list(MINE.rglob("*.tsx")) + list(MINE.rglob("*.ts")):
        # Tests assert on classes but do not render the app; counting them would inflate the score.
        if "__tests__" in f.parts:
            continue
        out |= classes_in(f.read_text(encoding="utf-8"))
    return out


def main() -> int:
    comps = proto_components()
    ours = mine_classes()
    target = sys.argv[1] if len(sys.argv) > 1 else None

    if target:
        if target not in comps:
            print(f"'{target}' 없음. 사용 가능: {', '.join(sorted(comps))}")
            return 1
        want = comps[target]
        missing = sorted(want - ours)
        print(f"{target}: {len(want) - len(missing)}/{len(want)} 클래스 사용")
        if target in EXCLUDED:
            print(f"  [의도적 제외] {EXCLUDED[target]}")
        for c in missing:
            print(f"  ✗ {c}")
        return 0

    rows = []
    for name, want in comps.items():
        if not want:
            continue
        want = {c for c in want if not c.startswith(EXCLUDED_PREFIXES)}
        if not want:
            continue
        have = len(want & ours)
        rows.append((have / len(want), have, len(want), name))

    rows.sort()
    tot_h = sum(r[1] for r in rows if r[3] not in EXCLUDED)
    tot_w = sum(r[2] for r in rows if r[3] not in EXCLUDED)

    print(f"{'컴포넌트':<26} {'사용/전체':>10}  비율")
    for pct, have, want, name in rows:
        flag = "  [제외]" if name in EXCLUDED else ""
        bar = "█" * int(pct * 20)
        print(f"  {name:<24} {have:>4}/{want:<4} {pct * 100:>5.0f}% {bar}{flag}")
    print(f"\n  합계(제외 제거): {tot_h}/{tot_w} = {100 * tot_h // max(1, tot_w)}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
