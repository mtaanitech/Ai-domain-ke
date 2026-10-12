CREATE TABLE IF NOT EXISTS domains (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  domain_lower TEXT NOT NULL UNIQUE,
  owner TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domains_domain_lower
ON domains(domain_lower);
