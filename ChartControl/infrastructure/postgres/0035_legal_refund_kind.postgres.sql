-- 0035 — legal_documents.kind 에 'refund' 허용 (환불정책 문서)
-- 기존 CHECK 는 terms/privacy/risk/security 만 허용해 refund 문서 시딩이 실패한다.
ALTER TABLE legal_documents DROP CONSTRAINT IF EXISTS legal_documents_kind_check;
ALTER TABLE legal_documents ADD CONSTRAINT legal_documents_kind_check
  CHECK (kind IN ('terms', 'privacy', 'risk', 'security', 'refund'));
