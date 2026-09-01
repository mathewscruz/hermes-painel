-- Per-agent heartbeat credentials. Only SHA-256 hashes are stored; plaintext
-- secrets remain exclusively on the Hermes VM.
CREATE TABLE IF NOT EXISTS public.agent_bridge_credentials (
  agent_slug text PRIMARY KEY REFERENCES public.agents(slug) ON UPDATE CASCADE ON DELETE CASCADE,
  secret_sha256 text NOT NULL CHECK (secret_sha256 ~ '^[0-9a-f]{64}$'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_bridge_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_bridge_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_bridge_credentials TO service_role;

INSERT INTO public.agent_bridge_credentials (agent_slug, secret_sha256, is_active, updated_at)
VALUES
  ('hermes-principal', '328d46c5d8321dfc99308460174b18607f94f762223732163003c27680e0f7dc', true, now()),
  ('hermes-vulnerabilidades', 'e26eb905957406eb830c579c520bc2e93d1abe13236876f35bf8d1f20dea0573', true, now())
ON CONFLICT (agent_slug) DO UPDATE
SET secret_sha256 = EXCLUDED.secret_sha256,
    is_active = EXCLUDED.is_active,
    updated_at = now();