# 서드파티 고지

브라우저로 **그대로 전송하는** 서드파티 코드의 라이선스 고지를 모아 둔다.

## 왜 이 디렉토리가 필요한가

★★ MIT 는 "저작권 고지와 허가 문구를 **사본에 포함**하라" 고 요구한다. 우리는 `vendor/`
의 파일을 그대로 브라우저에 내려보내므로 그것이 배포(distribution)다. 그런데
`react.production.min.js` 의 헤더는 이렇게 적혀 있다:

> This source code is licensed under the MIT license found in the
> **LICENSE file in the root directory of this source tree.**

그 LICENSE 파일이 **동봉돼 있지 않았다.** 헤더가 가리키는 곳에 아무것도 없으면 고지
요건을 충족했다고 보기 어렵다. 그래서 전문을 여기 둔다.

## 목록

| 패키지 | 라이선스 | 브라우저 전송 | 고지 |
|---|---|---|---|
| React · React DOM | MIT | **전송** (`react.production.min.js`, `react-dom.production.min.js`) | `react/LICENSE` |
| KLineCharts | Apache-2.0 | **전송** (`klinecharts.min.js`) | `klinecharts/LICENSE`, `klinecharts/NOTICE` |
| Babel standalone | MIT | **전송하지 않음** — `index.html` 이 로드하지 않는다(JSX 를 빌드 시점에 컴파일하도록 바뀐 뒤 필요 없어졌다) | 아래 참조 |

## Babel 에 대한 메모

`vendor/babel/babel.min.js` 는 저장소에 남아 있으나 **브라우저로 전송되지 않는다.**
`index.html` 에 `<script src="vendor/babel/...">` 가 없다(확인: `grep -c 'src="vendor/babel' index.html` → 0).
JSX 는 `scripts/build-web.mjs` 가 빌드 시점에 컴파일한다.

★ 파일 자체에 라이선스 헤더가 없다(다른 vendor 파일은 있다). 배포하지 않으므로 MIT
고지 의무의 대상이 아니라고 판단하지만, 다시 로드하게 되면 그때는 고지가 필요하다.
그래서 지우지 않고 이 메모를 남긴다 — 조용히 되살아나는 것이 가장 위험하다.

정리하려면 파일을 삭제하는 것이 가장 확실하다. 되살릴 일이 없다고 판단되면 지우고
이 문단도 함께 지울 것.

## 확인 방법

브라우저로 전송되는 vendor 파일 목록:

```bash
grep -oE 'src="vendor/[^"]+"' index.html
```

이 목록에 새 항목이 생기면 위 표에 라이선스와 고지 파일을 함께 추가해야 한다.
