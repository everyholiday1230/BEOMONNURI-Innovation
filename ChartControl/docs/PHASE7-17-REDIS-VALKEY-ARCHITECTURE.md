# Redis / Valkey (ElastiCache) — Architecture Ledger & Reconciliation

Prompt 6 R6 산출물. 과거 "Redis 2/2 PASS", 현재 apps/api의 Redis 코드 부재, Phase 7 ElastiCache 요구사항 사이의 모순을 코드 실측으로 해소.

## 모순 해소 (조사 결과)
- **"Redis 2/2"는 실체가 있다.** `packages/cluster`에 **직접 구현한 RESP(Redis 프로토콜) 클라이언트**(`resp-client.ts` `RedisClient`, GET/SET/DEL/INCR/EVAL/PUBLISH/SUBSCRIBE/PING), `RedisSharedState`(versioned CAS), `RedisPubSub`가 있고 `packages/cluster/src/__tests__/{redis.integration,cluster}.test.ts`로 검증된다. **npm `redis`/`ioredis` 의존성이 없던 이유는 원시 RESP를 직접 구현했기 때문** — 이전 V5/V8의 "Redis 미사용" 결론은 `packages/cluster`를 누락한 불완전 판정이었고, 본 R6에서 정정한다.
- **실사용처**: `apps/market-gateway`(RedisPubSub로 팬아웃 조정), `packages/mfa/src/lockout.ts`(SharedState로 lockout 카운터). **`apps/api`는 `@quantumtrade/cluster`를 import하지 않았다** → API rate-limit/세션은 Redis 미사용 = R6가 지목한 격차.
- **ElastiCache는 실제로 필요**하다(Terraform `elasticache.tf` TLS+CMK). 따라서 Redis를 NOT_APPLICABLE로 종결할 수 없다 — 정정: **APPLICABLE, 부분 연결(gateway/lockout O, api rate-limit X→R6에서 해소)**.

## State category 원장
| State category | Current store | Production target | Consistency | TTL | Multi-instance | Failure policy |
|---|---|---|---|---|---|---|
| API rate-limit (order/admin/login) | **in-process Map (결함)** → R6 분산 limiter | Redis/Valkey atomic counter | strong(원자 INCR) | 예(window) | **필수** | **fail-closed(deny)** |
| Gateway 팬아웃 조정 | RedisPubSub(cluster) | ElastiCache pub/sub | eventual | n/a | 필수 | degrade(로컬 큐) |
| Lockout 카운터 | SharedState(cluster) / api는 SQLite `account_lockouts` | Redis SharedState 또는 PG | strong | 선택 | 권장 | fail-closed |
| Session | SQLite `sessions` | PG(BL-10) 또는 Redis | strong | 예(expiry) | 필수 | fail-closed |
| Cache(가격/카탈로그) | in-process/응답 | Redis(선택) | eventual | 예 | 선택 | degrade |
| App 영속(MFA/favorites/orders/...) | SQLite | **Managed PostgreSQL(BL-10, R5)** | strong | n/a | 필수 | fail-closed |

## R6 결정
1. **API rate-limit**: `apps/api/src/security/rate-limiter.ts` 신설 — 인터페이스 + `InMemoryRateLimiter`(dev) + `RedisRateLimiter`(prod, EVAL 원자 INCR+PEXPIRE, `packages/cluster` RedisClient 재사용) + `FailClosedRateLimiter` + `createRateLimiter`(production은 REDIS_URL 필수, Map fallback 금지, 런타임 실패 시 deny). 임시 Redis 컨테이너로 11건 검증(atomic 동시성 30/50, TTL, namespace/isolation, multi-instance 예산 공유, reconnect). **잔여**: 기존 OrderRateLimiter/AdminRateLimiter/LoginRateLimiter 호출부를 이 어댑터로 교체(라우트 await 전환) — BL-11(P2)로 추적, 어댑터·검증은 완료.
2. **Gateway/lockout**: 기존 cluster 사용 유지(추가 작업 없음).
3. **ElastiCache 유지**: 제거하지 않음(gateway pub/sub + 분산 rate-limit + 선택적 session/cache의 실제 타깃). Terraform/비용/Stage 0 문서 변경 없음.

## Multi-instance 일관성
현재 in-process Map은 N개 ECS 인스턴스에서 N×budget으로 우회 가능(강한 일관성 없음). R6 `RedisRateLimiter`는 원자 INCR로 인스턴스 전역 단일 예산을 보장 — `[multi-instance]` 테스트가 두 limiter 인스턴스가 하나의 Redis 예산(6)을 공유함을 증명.
