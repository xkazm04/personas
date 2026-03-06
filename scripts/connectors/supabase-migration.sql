-- Supabase migration: connector_catalog table
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New Query)

CREATE TABLE IF NOT EXISTS connector_catalog (
  id          TEXT PRIMARY KEY,                        -- e.g. "builtin-github"
  name        TEXT NOT NULL UNIQUE,                    -- e.g. "github" (snake_case identifier)
  label       TEXT NOT NULL,                           -- e.g. "GitHub" (display name)
  summary     TEXT,                                    -- one-line description
  category    TEXT NOT NULL DEFAULT 'development',     -- e.g. "development", "messaging", "database"
  auth_type   TEXT,                                    -- e.g. "pat", "api_key", "oauth", "bot_token"
  auth_type_label TEXT,                                -- e.g. "PAT", "API Key", "OAuth"
  pricing_tier TEXT NOT NULL DEFAULT 'free',           -- "free", "freemium", "paid"
  icon_url    TEXT,                                    -- e.g. "/icons/connectors/github.svg"
  color       TEXT,                                    -- brand hex e.g. "#1F2937"
  docs_url    TEXT,                                    -- link to API docs
  is_active   BOOLEAN NOT NULL DEFAULT true,           -- soft-disable without deleting
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_connector_catalog_category ON connector_catalog(category);
CREATE INDEX IF NOT EXISTS idx_connector_catalog_pricing  ON connector_catalog(pricing_tier);
CREATE INDEX IF NOT EXISTS idx_connector_catalog_active   ON connector_catalog(is_active) WHERE is_active = true;

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_connector_catalog_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_connector_catalog_updated_at ON connector_catalog;
CREATE TRIGGER trg_connector_catalog_updated_at
  BEFORE UPDATE ON connector_catalog
  FOR EACH ROW
  EXECUTE FUNCTION update_connector_catalog_updated_at();

-- RLS: public read access, authenticated write
ALTER TABLE connector_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access"
  ON connector_catalog FOR SELECT
  USING (true);

CREATE POLICY "Authenticated insert"
  ON connector_catalog FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated update"
  ON connector_catalog FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
