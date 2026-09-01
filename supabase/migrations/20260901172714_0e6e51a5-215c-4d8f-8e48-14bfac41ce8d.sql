ALTER TABLE public.agent_commands
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS result jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS external_run_id text,
  ADD COLUMN IF NOT EXISTS command_id uuid REFERENCES public.agent_commands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_agent_external_key
  ON public.agent_runs (agent_id, external_run_id) WHERE external_run_id IS NOT NULL;

ALTER TABLE public.agent_events
  ADD COLUMN IF NOT EXISTS external_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS agent_events_agent_external_key
  ON public.agent_events (agent_id, external_event_id) WHERE external_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agent_bridge_credentials (
  agent_slug text PRIMARY KEY REFERENCES public.agents(slug) ON UPDATE CASCADE ON DELETE CASCADE,
  secret_sha256 text NOT NULL CHECK (secret_sha256 ~ '^[0-9a-f]{64}$'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_bridge_credentials TO service_role;
ALTER TABLE public.agent_bridge_credentials ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enqueue_agent_command(
  _agent_id uuid,
  _command text,
  _payload jsonb DEFAULT '{}'::jsonb,
  _note text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO public.agent_commands (agent_id, command, payload, note, requested_by, status)
  VALUES (_agent_id, _command, coalesce(_payload, '{}'::jsonb), coalesce(_note, ''), auth.uid(), 'pending')
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_agent_command(uuid, text, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_agent_commands(
  _agent_id uuid,
  _limit integer DEFAULT 20,
  _lease_seconds integer DEFAULT 300
) RETURNS TABLE (id uuid, command text, payload jsonb, note text, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH claimed AS (
    SELECT c.id
    FROM public.agent_commands c
    WHERE c.agent_id = _agent_id
      AND c.status = 'pending'
      AND (c.lease_expires_at IS NULL OR c.lease_expires_at < now())
    ORDER BY c.created_at
    LIMIT greatest(coalesce(_limit, 20), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.agent_commands u
  SET lease_expires_at = now() + make_interval(secs => greatest(coalesce(_lease_seconds, 300), 30))
  FROM claimed
  WHERE u.id = claimed.id
  RETURNING u.id, u.command, u.payload, u.note, u.created_at;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_commands(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_agent_commands(uuid, integer, integer) TO service_role;