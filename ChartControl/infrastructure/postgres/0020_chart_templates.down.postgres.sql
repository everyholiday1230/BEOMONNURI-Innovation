-- 0020 되돌리기.
--
-- ★ 이 테이블을 지우면 사용자가 저장한 차트 템플릿이 사라진다. 되돌리기 전에
--   백업을 확인할 것 (docs/DEPLOY.md 의 되돌리기 절 참고).

DROP INDEX IF EXISTS idx_chart_templates_user_updated;
DROP TABLE IF EXISTS chart_templates;
