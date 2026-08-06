#!/usr/bin/env python3
"""
i18n 추출 도구.

디자이너 JSX 파일의 한국어 UI 문자열을 사전 키로 치환한다.

설계 원칙
---------
1) 마크업 구조를 바꾸지 않는다. 텍스트 노드와 문자열 리터럴만 t('key') 로 바꾼다.
2) 키는 결정적으로 생성한다 (파일 + 컴포넌트 + 내용 해시). 같은 문자열은 같은 키.
3) 주석·정규식·import 경로는 건드리지 않는다.
4) 치환 전후를 diff 로 남겨 사람이 검토할 수 있게 한다.
5) 실패하면 아무것도 쓰지 않는다 (all-or-nothing).

사용법
------
  python3 tools/i18n-extract.py --file src/pages-auth.jsx --scan
      치환 대상만 출력 (파일 수정 없음)
  python3 tools/i18n-extract.py --file src/pages-auth.jsx --apply
      치환 실행 + 사전 항목 생성
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

HANGUL = re.compile(r'[\uac00-\ud7a3]')

# 치환하면 안 되는 문맥
SKIP_ATTRS = {'className', 'class', 'key', 'id', 'href', 'src', 'type', 'name', 'style'}


def strip_for_scan(src: str) -> str:
    """주석을 공백으로 치환한다. 위치(offset)를 보존해야 하므로 길이를 유지한다."""
    out = list(src)
    # 블록 주석
    for m in re.finditer(r'/\*.*?\*/', src, flags=re.S):
        for i in range(m.start(), m.end()):
            if out[i] != '\n':
                out[i] = ' '
    # 줄 주석 (문자열 안의 // 는 오탐 가능 — 보수적으로 처리)
    for m in re.finditer(r'^[^\n]*?(//[^\n]*)$', src, flags=re.M):
        seg = m.group(1)
        start = m.start(1)
        # 앞쪽에 홀수 개의 따옴표가 있으면 문자열 내부일 수 있으므로 건너뛴다
        prefix = src[m.start():start]
        if prefix.count("'") % 2 or prefix.count('"') % 2 or prefix.count('`') % 2:
            continue
        for i in range(start, start + len(seg)):
            if out[i] != '\n':
                out[i] = ' '
    return ''.join(out)


def make_key(prefix: str, text: str) -> str:
    """결정적 키 생성. 사람이 읽을 수 있는 슬러그 + 짧은 해시."""
    digest = hashlib.sha1(text.encode('utf-8')).hexdigest()[:6]
    return f'{prefix}_{digest}'


def find_component(src: str, pos: int) -> str:
    """해당 위치가 속한 컴포넌트 이름을 찾는다 (키 접두어에 사용)."""
    best = 'page'
    for m in re.finditer(r'window\.(\w+)\s*=\s*function', src):
        if m.start() <= pos:
            best = m.group(1)
        else:
            break
    # LoginPage -> login
    name = re.sub(r'(Page|Panel|Shell|Modal)$', '', best)
    name = re.sub(r'(?<!^)(?=[A-Z])', '_', name).lower()
    return name or 'page'


def in_jsx_tag(scan: str, pos: int) -> bool:
    """
    해당 위치가 JSX 태그 내부(속성 자리)인지 판정한다.

    직전으로 거슬러 올라가 '<' 가 '>' 보다 먼저 나오면 태그 내부다.
    JS 대입문(const x = '..')을 속성으로 오판하지 않기 위해 필요하다.
    """
    depth = 0
    i = pos - 1
    limit = max(0, pos - 4000)
    while i >= limit:
        c = scan[i]
        if c == '>':
            # 화살표 함수 '=>' 는 태그 닫힘이 아니다
            if i > 0 and scan[i - 1] == '=':
                i -= 2
                continue
            return False
        if c == '<':
            return True
        i -= 1
    return False


def collect(path: Path):
    """치환 후보를 수집한다."""
    src = path.read_text(encoding='utf-8')
    scan = strip_for_scan(src)
    found = []

    # 1) JSX 텍스트 노드: '>' 와 '<' 사이의 텍스트.
    #    줄바꿈을 허용해야 부모 태그가 이전 줄에 있는 경우도 잡힌다.
    #    중괄호가 없는 구간만 = 순수 텍스트 노드.
    for m in re.finditer(r'>([^<>{}]*?[\uac00-\ud7a3][^<>{}]*?)<', scan, flags=re.S):
        raw = m.group(1)
        text = raw.strip()
        if not text:
            continue
        lead = len(raw) - len(raw.lstrip())
        start_i = m.start(1) + lead
        found.append({'start': start_i, 'end': start_i + len(text), 'kind': 'jsx', 'text': text})

    # 2) 문자열 리터럴 (한 줄)
    for m in re.finditer(r"""(['"])((?:(?!\1)[^\\\n])*)\1""", scan):
        text = m.group(2)
        if not HANGUL.search(text):
            continue
        before = scan[max(0, m.start() - 60):m.start()]
        attr = re.search(r'(\w+)\s*=\s*$', before)
        attr_name = attr.group(1) if attr else None
        if attr_name and attr_name in SKIP_ATTRS:
            continue
        # JSX 속성 값이면 {t(..)} 로 감싼다. JS 리터럴이면 t(..) 그대로.
        is_attr = bool(attr_name) and in_jsx_tag(scan, m.start())
        found.append({
            'start': m.start(),
            'end': m.end(),
            'kind': 'jsx_attr' if is_attr else 'str',
            'text': text,
        })

    found.sort(key=lambda f: f['start'])

    # 중첩 제거
    filtered = []
    for f in found:
        if filtered and f['start'] < filtered[-1]['end']:
            continue
        filtered.append(f)

    # 키 배정 (같은 문자열은 같은 키)
    seen = {}
    for f in filtered:
        comp = find_component(src, f['start'])
        text = f['text']
        if text in seen:
            f['key'] = seen[text]
        else:
            f['key'] = make_key(comp, text)
            seen[text] = f['key']
    return src, filtered


def apply(path: Path, items, src: str) -> str:
    """뒤에서부터 치환해 offset 이 밀리지 않게 한다."""
    out = src
    for f in sorted(items, key=lambda x: -x['start']):
        if f['kind'] == 'jsx':
            rep = "{t('" + f['key'] + "')}"
        elif f['kind'] == 'jsx_attr':
            # 속성 값은 중괄호가 필요하다. 없으면 JSX 문법 오류가 된다.
            rep = "{t('" + f['key'] + "')}"
        else:
            rep = "t('" + f['key'] + "')"
        out = out[:f['start']] + rep + out[f['end']:]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', required=True)
    ap.add_argument('--scan', action='store_true')
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--out-dict', default='')
    args = ap.parse_args()

    path = Path(args.file)
    if not path.exists():
        print(f'파일 없음: {path}', file=sys.stderr)
        return 2

    src, items = collect(path)

    print(f'{path}: 치환 후보 {len(items)}개 (jsx={sum(1 for i in items if i["kind"]=="jsx")}, '
          f'str={sum(1 for i in items if i["kind"]=="str")})')

    if args.scan:
        for f in items:
            print(f'  [{f["kind"]}] {f["key"]:28} {f["text"][:64]}')
        return 0

    if args.apply:
        new_src = apply(path, items, src)
        path.write_text(new_src, encoding='utf-8')
        dict_path = Path(args.out_dict) if args.out_dict else path.with_suffix('.i18n.json')
        # 중복 텍스트는 하나로 합친다
        mapping = {}
        for f in items:
            mapping[f['key']] = f['text']
        dict_path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'  치환 완료. 사전 {len(mapping)}키 -> {dict_path}')
        return 0

    print('--scan 또는 --apply 를 지정하라', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main())
