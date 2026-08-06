# 04 — Data Model (proposal)

Phase 1 does not require a live database. This is a schema **proposal**; only layout + in-memory
domain objects are exercised by code. Money/price/quantity/fee use `NUMERIC` (arbitrary precision),
never floating point. All timestamps are `TIMESTAMPTZ` stored in **UTC**; UI converts to user tz.

## Domains (26)

Identity & access: `users`, `sessions`, `roles`, `permissions`, `user_preferences`.
Layout: `layouts`, `layout_versions`.
Exchange link: `exchange_connections`, `encrypted_credentials`.
Reference: `symbols`, `market_metadata`.
AI: `ai_conversations`, `ai_messages`, `ai_signals`, `signal_versions`, `chart_overlays`.
Trading: `order_drafts`, `orders`, `order_events`, `fills`, `positions`, `balances`.
Ops/notify: `alerts`, `notifications`, `subscriptions`, `usage_records`, `audit_logs`.

## Selected tables (Phase 1-relevant)

```sql
-- layouts: one active layout config per user; versioned for optimistic concurrency
CREATE TABLE layouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,
  preset_id     TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  data          JSONB NOT NULL,          -- validated by @quantumtrade/schemas LayoutSchema
  version       INTEGER NOT NULL DEFAULT 1,  -- optimistic concurrency token
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE layout_versions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layout_id  UUID NOT NULL REFERENCES layouts(id),
  version    INTEGER NOT NULL,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (layout_id, version)
);

-- encrypted_credentials: envelope encryption. Ciphertext ONLY. No plaintext ever persisted.
CREATE TABLE encrypted_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES exchange_connections(id),
  ciphertext      BYTEA NOT NULL,        -- KMS-wrapped DEK-encrypted secret
  encrypted_dek   BYTEA NOT NULL,        -- data encryption key wrapped by KMS CMK
  kms_key_id      TEXT NOT NULL,
  algo            TEXT NOT NULL DEFAULT 'AES-256-GCM',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at      TIMESTAMPTZ
);

-- orders: money columns are NUMERIC; clientOrderId enforces idempotency
CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  client_order_id TEXT NOT NULL,               -- idempotency key
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL,                -- long|short
  order_type      TEXT NOT NULL,                -- market|limit|stop|tp_sl
  status          TEXT NOT NULL,                -- see order state machine
  price           NUMERIC(38,18),
  quantity        NUMERIC(38,18) NOT NULL,
  leverage        NUMERIC(10,2),
  margin_mode     TEXT,                         -- isolated|cross
  reduce_only     BOOLEAN NOT NULL DEFAULT false,
  is_simulated    BOOLEAN NOT NULL DEFAULT true,
  ai_generated    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_order_id)             -- dedup double-submit
);

CREATE TABLE order_events (   -- append-only audit of every state transition
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES orders(id),
  from_state TEXT,
  to_state   TEXT NOT NULL,
  reason     TEXT,
  actor      TEXT NOT NULL,      -- user|system|risk|exchange
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id TEXT,
  user_id      UUID,
  action       TEXT NOT NULL,
  target       TEXT,
  meta         JSONB,           -- redacted; never secrets
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Public market data (candles/book/trades) is **not** persisted per-user; it is cached ephemerally
(Redis) and never mixed with private account data (separate channels/caches — see WS contract).
