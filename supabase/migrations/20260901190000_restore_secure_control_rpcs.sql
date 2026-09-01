-- Restore the final, role-checked control RPCs after an older migration
-- reintroduced SECURITY INVOKER implementations later in migration order.

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE lower(trim(email)) = 'mathews.cruz@origoenergia.com.br'
ON CONFLICT (user_id, role) DO NOTHING;

DROP FUNCTION IF EXISTS public.enqueue_agent_command(uuid, text, jsonb, text);

CREATE FUNCTION public.enqueue_agent_command(
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
  VALUES (
    _agent_id,
    _command,
    'pending',
    auth.uid(),
    left(coalesce(_note, ''), 2000),
    coalesce(_payload, '{}'::jsonb)
  )
  RETURNING * INTO _row;

  INSERT INTO public.audit_log (actor, actor_email, action, target, details)
  VALUES (
    auth.uid(),
    _email,
    'command:' || _command,
    _agent_id::text,
    jsonb_build_object('command_id', _row.id, 'note', left(coalesce(_note, ''), 2000))
  );

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_agent_command(uuid, text, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_agent_command(uuid, text, jsonb, text)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.claim_agent_commands(uuid, integer, integer);

CREATE FUNCTION public.claim_agent_commands(
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

REVOKE ALL ON FUNCTION public.claim_agent_commands(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agent_commands(uuid, integer, integer)
  TO service_role;
