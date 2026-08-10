-- 0018 되돌리기.
--
-- ★★ 경고: 동의 기록이 사라진다.
--
--   user_legal_consents 는 "누가 언제 어느 약관에 동의했는가" 의 유일한 증거다.
--   분쟁이 생기면 이것을 제시해야 한다. 지우면 복구할 방법이 없다.
--
--   되돌리기 전에 반드시 내보내기:
--     \copy (SELECT * FROM user_legal_consents) TO 'consents.csv' CSV HEADER
--     \copy (SELECT * FROM legal_documents) TO 'legal_docs.csv' CSV HEADER

DROP INDEX IF EXISTS idx_consent_user;
DROP TABLE IF EXISTS user_legal_consents;

DROP INDEX IF EXISTS idx_legal_live;
DROP TABLE IF EXISTS legal_documents;
