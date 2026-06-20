# Service Worker / PWA 재도입 계획

## 현재 상태 (2026-05-08)

**Service Worker는 의도적으로 비활성화되어 있습니다.**

- `static/sw.js` — no-op 자가제거 버전 (기존 SW 정리용)
- `static/js/ui.js` — `unregister()` + 모든 캐시 삭제 실행
- `static/manifest.json` — 유지됨 (재도입 시 재사용)

### 왜 비활성화했나

UI 디자인 대공사 중 (브랜드/색상/크기 등 빈번한 변경) SW의 자산 캐싱이
새 배포를 차단해 사용자가 구버전을 보는 문제가 반복 발생.

`CACHE_VER='<git-hash>'` 수동 관리 방식이 개발 속도를 못 따라감.

### 재도입 시점

- [ ] UI/디자인 변경이 거의 멈추고
- [ ] 프로덕션 배포 직전
- [ ] 또는 사용자가 "앱으로 설치하고 싶다"는 피드백을 줄 때

## 재도입 시 구현 방안

### 핵심 원칙
- HTML은 항상 network-first (`Cache-Control: no-cache` 유지)
- JS/CSS는 `?v=<timestamp>` 쿼리로 캐시 버스팅 (이미 `src/main.py`에 구현됨)
- API/WS는 캐시 안 함
- SW는 자산 로드 속도 최적화만 담당

### 권장 sw.js 구조

```js
// 버전은 파일 mtime 기반이라 수동 업데이트 불필요
const CACHE = 'chartos-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // 구버전 캐시 전부 삭제
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // 1. API/WS/HTML은 캐시하지 않음 (항상 network)
  if (url.includes('/v1/') || url.includes('/ws') ||
      e.request.mode === 'navigate') return;

  // 2. 정적 자산만 stale-while-revalidate
  //    (?v=xxx 쿼리가 붙어있으므로 버전 다르면 자동으로 다른 캐시 키)
  if (url.includes('/static/')) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const fetchPromise = fetch(e.request).then(response => {
            if (response.ok) cache.put(e.request, response.clone());
            return response;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
  }
});
```

### ui.js 재도입 코드

```js
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/static/sw.js').catch(() => {});
}
```
단순하게. 주기적 update, updatefound, controllerchange 등 복잡한 로직은 빼고 시작.

### 테스트 체크리스트

- [ ] 첫 방문 시 모든 자산 정상 로드
- [ ] 두 번째 방문 시 SW가 cache에서 즉시 반환
- [ ] `?v=<new-timestamp>` 변경 시 새 자산 요청
- [ ] API 호출은 SW를 투명하게 통과
- [ ] HTML 변경 시 새로고침으로 즉시 반영
- [ ] Chrome DevTools → Application → Service Workers에 정상 등록 표시
- [ ] Android Chrome "홈 화면에 추가" 프롬프트 표시 확인
- [ ] 오프라인 모드에서 캐시된 페이지 열림

## 관련 파일

- `static/sw.js` — 현재 no-op, 재도입 시 교체
- `static/js/ui.js` — 현재 unregister 로직, 재도입 시 register로 교체
- `static/manifest.json` — 유지 (PWA 매니페스트)
- `src/main.py` — 자동 `?v=` 버전 주입 로직 (재도입 후에도 계속 사용)
