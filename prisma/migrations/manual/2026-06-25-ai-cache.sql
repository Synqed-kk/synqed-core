-- AiCache — global AI-response cache (key = hash of input), consolidated from
-- the karute app DB. Not tenant-scoped; routes are API-key-gated, business-optional.
BEGIN;

CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key  text PRIMARY KEY,
  result     jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_cache_expires_idx ON ai_cache (expires_at);
ALTER TABLE ai_cache ENABLE ROW LEVEL SECURITY;

COMMIT;
