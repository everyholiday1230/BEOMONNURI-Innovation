// SW 완전 제거 - 어떤 요청도 가로채지 않고 스스로 unregister
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch(err) {}
    try {
      await self.registration.unregister();
    } catch(err) {}
  })());
});
// fetch 이벤트 핸들러 없음 - 모든 요청은 브라우저가 직접 처리
