-- 0040 되돌리기. 오류 기록은 운영 자료일 뿐이므로 테이블째 지운다.
DROP INDEX IF EXISTS ops_errors_last_seen_idx;
DROP TABLE IF EXISTS ops_errors;
