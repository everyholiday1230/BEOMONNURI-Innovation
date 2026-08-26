ALTER TABLE legal_documents DROP CONSTRAINT IF EXISTS legal_documents_kind_check;
ALTER TABLE legal_documents ADD CONSTRAINT legal_documents_kind_check
  CHECK (kind IN ('terms', 'privacy', 'risk', 'security'));
