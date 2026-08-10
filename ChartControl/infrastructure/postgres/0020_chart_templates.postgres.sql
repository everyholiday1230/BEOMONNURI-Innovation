-- 0020 — 차트 템플릿 (기기 간 동기화)
--
-- 왜 필요한가
-- ----------
-- 템플릿이 `localStorage['qt.chartTemplates']` 에만 있었다. 그래서 집 PC 에서
-- 만든 지표 조합이 사무실 PC·휴대폰에서는 없다. 사용자는 같은 계정으로 로그인했으니
-- 당연히 따라올 것으로 기대한다. 즐겨찾기(user_favorites)는 이미 서버에 저장하는데
-- 템플릿만 빠져 있었다.
--
-- 설계 결정
-- --------
-- ★ 템플릿 하나를 한 행으로 둔다(JSON 배열 통째로 한 행이 아니라).
--   통째로 저장하면 두 기기가 각각 다른 템플릿을 추가할 때 마지막 저장이
--   상대의 것을 덮어 지운다. 행으로 나누면 서로 다른 이름은 공존한다.
--
-- ★ 이름을 사용자별 유일 키로 둔다. 같은 이름으로 저장하면 덮어쓰는 것이
--   사용자 기대(로컬 구현도 같은 이름을 교체했다)와 맞고, 목록에 같은 이름이
--   둘 보이는 혼란을 막는다.
--
-- ★ 지표 구성은 `payload` JSONB 에 그대로 담는다. 지표 종류·설정은 차트
--   라이브러리 스키마이고 앞으로 바뀐다. 컬럼으로 쪼개면 지표가 추가될 때마다
--   마이그레이션이 필요해진다.
--
-- ★ `schema_version` 을 함께 저장한다. 나중에 payload 형식이 바뀌면 옛 행을
--   읽을 때 변환할 수 있다. 이 값이 없으면 형식이 바뀌는 순간 옛 템플릿이
--   조용히 깨진다.
--
-- ★ 개수 상한은 애플리케이션에서 본다(DB CHECK 로 두면 상한을 바꿀 때
--   마이그레이션이 필요하고, 초과 시 사용자에게 이유를 설명하기 어렵다).

CREATE TABLE IF NOT EXISTS chart_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 사용자가 붙인 이름. 표시용이며 같은 사용자 안에서 유일하다.
  name          TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- 저장 시점의 심볼·타임프레임. 어떤 상황에서 만든 설정인지 알려준다
  -- (적용을 막지는 않는다 — 다른 심볼에 쓰고 싶을 수 있다).
  symbol        TEXT,
  timeframe     TEXT,
  -- 지표 구성 원본. 형식은 payload 안의 schema_version 이 정한다.
  payload       JSONB NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- 목록은 항상 "내 것, 최근 수정 순" 으로 읽는다.
CREATE INDEX IF NOT EXISTS idx_chart_templates_user_updated
  ON chart_templates (user_id, updated_at DESC);
