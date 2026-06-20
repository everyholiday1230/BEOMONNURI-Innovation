# Cloudflare CDN 설정 가이드

## 1. Cloudflare 가입 + 도메인 추가
1. https://dash.cloudflare.com 가입
2. "Add a Site" → `beomonnuri.com` 입력
3. Free 플랜 선택

## 2. DNS 설정
- A 레코드: `beomonnuri.com` → 서버 IP (프록시 ON = 주황 구름)
- A 레코드: `www` → 서버 IP (프록시 ON)
- 네임서버를 Cloudflare 제공 NS로 변경 (도메인 등록기관에서)

## 3. SSL/TLS
- SSL/TLS → Full (strict) 선택
- Edge Certificates → Always Use HTTPS ON

## 4. 캐싱 규칙
- Caching → Configuration → Browser Cache TTL: 1 month
- Page Rules:
  - `*beomonnuri.com/static/*` → Cache Level: Cache Everything, Edge TTL: 1 month

## 5. 성능
- Speed → Optimization:
  - Auto Minify: JS, CSS, HTML 모두 ON
  - Brotli: ON
  - Early Hints: ON
  - Rocket Loader: OFF (차트 JS와 충돌 가능)

## 6. 보안
- Security → Settings:
  - Security Level: Medium
  - Challenge Passage: 30 minutes
  - Browser Integrity Check: ON

## 7. WebSocket
- Network → WebSockets: ON (기본 활성화됨)

## 효과
- 정적 파일: 전세계 300+ PoP에서 서빙 (한국 사용자 ~5ms)
- DDoS 방어: 무료 플랜도 Layer 3/4 무제한 방어
- gzip/Brotli: 자동 압축
- SSL: 무료 인증서 자동 갱신
