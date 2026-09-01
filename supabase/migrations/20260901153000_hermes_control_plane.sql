-- Control-plane contract for Hermes agents.
-- Adds structured commands/runs and replaces permissive authenticated-user RLS.

ALTER TABLE public.agent_commands
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS result jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS external_run_id text,
  ADD COLUMN IF NOT EXISTS command_id uuid REFERENCES public.agent_commands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.agent_events
  ADD COLUMN IF NOT EXISTS external_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_agent_external
  ON public.agent_runs (agent_id, external_run_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_agent_external
  ON public.agent_events (agent_id, external_event_id);

CREATE INDEX IF NOT EXISTS idx_commands_pending
  ON public.agent_commands (agent_id, created_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.validate_run_command_agent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.command_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.agent_commands
    WHERE id = NEW.command_id AND agent_id = NEW.agent_id
  ) THEN
    RAISE EXCEPTION 'run command_id must belong to the same agent' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_run_command_agent ON public.agent_runs;
CREATE TRIGGER validate_run_command_agent
  BEFORE INSERT OR UPDATE OF command_id, agent_id ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.validate_run_command_agent();

-- Remove the original broad policies. Any authenticated account could previously
-- mutate runtime state and forge events/runs.
DROP POLICY IF EXISTS "auth manage agents" ON public.agents;
DROP POLICY IF EXISTS "auth manage capabilities" ON public.agent_capabilities;
DROP POLICY IF EXISTS "auth manage connections" ON public.agent_connections;
DROP POLICY IF EXISTS "auth manage runs" ON public.agent_runs;
DROP POLICY IF EXISTS "auth manage events" ON public.agent_events;
DROP POLICY IF EXISTS "auth manage commands" ON public.agent_commands;
DROP POLICY IF EXISTS "auth read audit" ON public.audit_log;
DROP POLICY IF EXISTS "auth write audit" ON public.audit_log;
DROP POLICY IF EXISTS "auth read roles" ON public.user_roles;

CREATE POLICY "users read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "authenticated read agents" ON public.agents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read capabilities" ON public.agent_capabilities
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read connections" ON public.agent_connections
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read runs" ON public.agent_runs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read events" ON public.agent_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read commands" ON public.agent_commands
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read audit" ON public.audit_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admins manage agents" ON public.agents
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins manage capabilities" ON public.agent_capabilities
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins manage connections" ON public.agent_connections
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Runtime tables are written only through the server-side service-role endpoint.
REVOKE INSERT, UPDATE, DELETE ON public.agent_runs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.agent_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.agent_commands FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated;

CREATE OR REPLACE FUNCTION public.audit_control_plane_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _record jsonb;
  _target text;
BEGIN
  -- Service-role heartbeats and migrations do not represent interactive admin changes.
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    _record := to_jsonb(OLD);
  ELSE
    _record := to_jsonb(NEW);
  END IF;
  _target := coalesce(_record->>'agent_id', _record->>'user_id', _record->>'id', '');

  INSERT INTO public.audit_log (actor, actor_email, action, target, details)
  VALUES (
    auth.uid(),
    coalesce(auth.jwt()->>'email', ''),
    TG_TABLE_NAME || ':' || lower(TG_OP),
    _target,
    jsonb_build_object(
      'record_id', _record->>'id',
      'table', TG_TABLE_NAME,
      'operation', TG_OP
    )
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_control_plane_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_agents_mutation ON public.agents;
CREATE TRIGGER audit_agents_mutation
  AFTER INSERT OR UPDATE OR DELETE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.audit_control_plane_mutation();

DROP TRIGGER IF EXISTS audit_capabilities_mutation ON public.agent_capabilities;
CREATE TRIGGER audit_capabilities_mutation
  AFTER INSERT OR UPDATE OR DELETE ON public.agent_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.audit_control_plane_mutation();

DROP TRIGGER IF EXISTS audit_connections_mutation ON public.agent_connections;
CREATE TRIGGER audit_connections_mutation
  AFTER INSERT OR UPDATE OR DELETE ON public.agent_connections
  FOR EACH ROW EXECUTE FUNCTION public.audit_control_plane_mutation();

DROP TRIGGER IF EXISTS audit_user_roles_mutation ON public.user_roles;
CREATE TRIGGER audit_user_roles_mutation
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_control_plane_mutation();

CREATE OR REPLACE FUNCTION public.enqueue_agent_command(
  _agent_id uuid,
  _command text,
  _payload jsonb DEFAULT '{}'::jsonb,
  _note text DEFAULT ''
)
RETURNS public.agent_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.agent_commands;
  _email text;
  _is_admin boolean;
  _is_operator boolean;
  _allowed text[] := ARRAY[
    'start', 'stop', 'restart', 'run_task', 'stop_run',
    'steer_run', 'approve_run', 'deny_run'
  ];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  _is_admin := public.has_role(auth.uid(), 'admin');
  _is_operator := public.has_role(auth.uid(), 'operator');
  IF NOT (_is_admin OR _is_operator) THEN
    RAISE EXCEPTION 'operator role required' USING ERRCODE = '42501';
  END IF;

  IF NOT (_command = ANY(_allowed)) THEN
    RAISE EXCEPTION 'unsupported command: %', _command USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(coalesce(_payload, '{}'::jsonb)) <> 'object'
     OR pg_column_size(coalesce(_payload, '{}'::jsonb)) > 65536 THEN
    RAISE EXCEPTION 'payload must be an object no larger than 64 KiB' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE id = _agent_id) THEN
    RAISE EXCEPTION 'agent not found' USING ERRCODE = 'P0002';
  END IF;

  IF _command = 'run_task' AND length(trim(coalesce(_payload->>'input', ''))) = 0 THEN
    RAISE EXCEPTION 'run_task requires payload.input' USING ERRCODE = '22023';
  END IF;

  IF _command = 'run_task' AND length(_payload->>'input') > 32000 THEN
    RAISE EXCEPTION 'run_task payload.input is too long' USING ERRCODE = '22023';
  END IF;

  IF _command IN ('stop_run', 'steer_run', 'approve_run', 'deny_run')
     AND length(trim(coalesce(_payload->>'run_id', ''))) = 0 THEN
    RAISE EXCEPTION '% requires payload.run_id', _command USING ERRCODE = '22023';
  END IF;

  IF _command = 'steer_run' AND length(trim(coalesce(_payload->>'input', ''))) = 0 THEN
    RAISE EXCEPTION 'steer_run requires payload.input' USING ERRCODE = '22023';
  END IF;

  IF _command = 'steer_run' AND length(_payload->>'input') > 8000 THEN
    RAISE EXCEPTION 'steer_run payload.input is too long' USING ERRCODE = '22023';
  END IF;

  IF length(coalesce(_payload->>'run_id', '')) > 200 THEN
    RAISE EXCEPTION 'payload.run_id is too long' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(email, '') INTO _email FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.agent_commands (agent_id, command, status, requested_by, note, payload)
  VALUES (_agent_id, _command, 'pending', auth.uid(), left(coalesce(_note, ''), 2000), coalesce(_payload, '{}'::jsonb))
  RETURNING * INTO _row;

  INSERT INTO public.audit_log (actor, actor_email, action, target, details)
  VALUES (
    auth.uid(),
    _email,
    'command:' || _command,
    _agent_id::text,
    jsonb_build_object('command_id', _row.id, 'note', _note)
  );

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_agent_command(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_agent_command(uuid, text, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_agent_commands(
  _agent_id uuid,
  _limit integer DEFAULT 20,
  _lease_seconds integer DEFAULT 300
)
RETURNS SETOF public.agent_commands
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT id
    FROM public.agent_commands
    WHERE agent_id = _agent_id
      AND (
        status = 'pending'
        OR (
          status = 'claimed'
          AND started_at < now() - make_interval(secs => greatest(_lease_seconds, 30))
        )
      )
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT least(greatest(_limit, 1), 50)
  )
  UPDATE public.agent_commands AS commands
  SET status = 'claimed', started_at = now(), error = ''
  FROM candidates
  WHERE commands.id = candidates.id
  RETURNING commands.*;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_commands(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agent_commands(uuid, integer, integer) TO service_role;
