-- Grant Mathews administrative control and replace demo capability counters
-- with values derived from real linked executions.
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE lower(email) = 'mathews.cruz@origoenergia.com.br'
ON CONFLICT (user_id, role) DO NOTHING;

UPDATE public.agent_capabilities AS capability
SET executions_count = metrics.executions_count,
    success_count = metrics.success_count
FROM (
  SELECT capability_row.id,
         count(run.id)::integer AS executions_count,
         count(run.id) FILTER (WHERE run.status = 'success')::integer AS success_count
  FROM public.agent_capabilities AS capability_row
  LEFT JOIN public.agent_runs AS run ON run.capability_id = capability_row.id
  GROUP BY capability_row.id
) AS metrics
WHERE capability.id = metrics.id;
