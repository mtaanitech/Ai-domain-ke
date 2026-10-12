CREATE TABLE IF NOT EXISTS public.domains (
    id BIGSERIAL PRIMARY KEY,
    domain TEXT NOT NULL,
    owner TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.domains
ADD COLUMN IF NOT EXISTS domain_lower TEXT
GENERATED ALWAYS AS (LOWER(domain)) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS domains_domain_lower_unique
ON public.domains (domain_lower);

ALTER TABLE public.domains ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.domains FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.domains_id_seq FROM anon, authenticated;
