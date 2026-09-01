-- Prevent lockout of the designated primary control-plane administrator when
-- the user_roles row is missing or the role query is stale.

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE lower(trim(email)) = 'mathews.cruz@origoenergia.com.br'
ON CONFLICT (user_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = _user_id AND role = _role
    )
    OR (
      _role = 'admin'::public.app_role
      AND EXISTS (
        SELECT 1
        FROM auth.users
        WHERE id = _user_id
          AND lower(trim(email)) = 'mathews.cruz@origoenergia.com.br'
      )
    )
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)
  TO authenticated, service_role;
