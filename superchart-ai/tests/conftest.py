"""pytest 공통 설정 — src 모듈 import 이전에 테스트용 환경변수를 주입한다.

conftest.py는 테스트 수집(collection) 이전에 로드되므로, 여기서 환경변수를
설정하면 src.config가 import 시점에 수행하는 보안 검증(JWT_SECRET 강도 등)을
통과할 수 있다. 실제 환경변수가 이미 설정돼 있으면 그대로 존중한다(setdefault).

주의:
- 여기 값은 오직 로컬/CI 테스트용이며 운영 비밀이 아니다.
- ENV=test 로 두면 config의 약한 시크릿 검증이 비활성화되고, admin rate-limit도
  관대한 테스트 모드(admin_helpers.ADMIN_MAX_FAILS)가 적용된다.
"""
import os

# src.* 를 import 하기 전에 환경변수를 먼저 설정해야 한다.
os.environ.setdefault("ENV", "test")
os.environ.setdefault("TESTING", "1")
os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-minimum-32-characters-long-000")
os.environ.setdefault("SECRET_KEY", "test-only-app-secret-minimum-32-characters-long-000")
os.environ.setdefault("ADMIN_KEY", "test-only-admin-key-minimum-32-characters-long-000")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://chart:chart@localhost:5432/chart_os")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
