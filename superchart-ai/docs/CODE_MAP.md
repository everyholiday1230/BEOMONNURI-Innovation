# 코드 맵 — 범온 AI 슈퍼차트

## 프론트엔드 구조

### src_backup/main-app.js (4635줄)
| 줄 | 섹션 | 설명 |
|---|---|---|
| 1-36 | 상태 관리 | curSymbol, curTf, 전역 상태 |
| 37-150 | Auth Store | 로그인/로그아웃/토큰 관리 |
| 151-233 | Header | TF 변경, 심볼 표시 |
| 282-345 | 차트 | loadCandles, 차트 초기화 |
| 346-644 | 오버레이 지표 | EMA/SMA/BB/리본 등 계산 |
| 645-690 | 커스텀 MA | 사용자 추가 MA |
| 691-1417 | 서브차트 지표 | RSI/MACD/스토캐스틱/다이버전스 등 |
| 1418-1583 | 거래밀집구간 | OB 로드 + 표시 |
| 1584-1862 | 매수 스캐너 | 복합 시그널 |
| 1863-2095 | 범온 지표 | 강도측정/과열분석/매매압력 |
| 2096-2234 | 설정 저장 | 서버 저장/로드 |
| 2236-2507 | 지표 설정 UI | indConfigs, showIndSettings |
| 2508-2735 | 이벤트 핸들러 | 클릭/키보드/드래그 |
| 2736-3006 | 2분할 차트 | 듀얼 차트 모드 |
| 3011-3259 | WebSocket | 실시간 데이터 수신 |
| 3260-3490 | WS 모니터 | 연결 상태 관리 |
| 3491-3658 | 초기화 | 앱 부팅 시퀀스 |
| 3659-3779 | 30초 인터벌 | 주기적 갱신 |
| 3780-4187 | 자동매매 | Ladder/봇 시그널 |
| 4188-4465 | 범온MA | 이동평균선 로드 |
| 4466-4635 | AI 패널 | AI 분석 UI |

### src_backup/compare.js (1187줄)
- 비교 오버레이 (원본/1달/1년)
- openSettings 함수 (서랍 설정 패널)
- _subDefaults (지표 기본값)

### src_backup/chart-engine.js (1178줄)
- ChartCore 클래스 (캔버스 렌더링)
- 서브차트 렌더링
- 마우스/터치 인터랙션

### static/js/modules/ (분리된 모듈)
| 파일 | 역할 |
|---|---|
| watchlist.js | 종목 목록 |
| realtime.js | 실시간 가격 |
| ai-panel.js | AI 분석 |
| strategy.js | 매매전략 |
| referral-ui.js | 레퍼럴 시스템 |
| data-actions.js | 데이터 액션 |
| chart-extras.js | 차트 부가기능 |
| hotmap.js | 히트맵 |
| fetch.js | API 호출 래퍼 |
| utils.js | 유틸리티 |

## 백엔드 구조

### src/main.py (803줄)
- FastAPI 앱 생성 + 미들웨어 등록
- 페이지 라우트 (/, /chart/{symbol}, /admin 등)
- 에러 핸들러
- WebSocket 엔드포인트

### src/api/ (20개 모듈)
| 파일 | 역할 |
|---|---|
| charts.py | 캔들/티커 API |
| charts_indicators.py | 범온 지표 계산 |
| charts_signals.py | 시그널 API |
| auth.py | 인증 (로그인/가입) |
| auth_admin.py | 어드민 API |
| referral.py | 레퍼럴 시스템 |
| alerts.py | 가격 알림 |
| analysis.py | AI 분석 |
| symbols.py | 종목 관리 |
| ops/ops.py | 운영 API |

### src/services/ (63개 모듈)
- beom_candle.py — 범온캔들 계산
- beom_ma.py — 범온MA 계산
- beom_sub.py — 강도측정/과열분석
- trade_zone.py — 거래밀집구간
- strategy_autobot.py — 자동매매 전략
- redis_cache.py — 캐시 관리

## 수정 시 주의사항

1. **JS 수정**: `src_backup/` 원본 수정 → `bash scripts/build.sh` 실행
2. **CSS 수정**: `static/css/main.src.css` 수정 → esbuild 미니파이
3. **API 수정**: 서버 재시작 필요 (`sudo systemctl restart chart-os`)
4. **절대 하지 말 것**: `sed`로 JS 파일 내용 변경, `static/js/main-app.js` 직접 수정
