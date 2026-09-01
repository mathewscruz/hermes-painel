import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "operator" | "viewer";

export function useMyRoles() {
  return useQuery({
    queryKey: ["my-roles"],
    queryFn: async (): Promise<AppRole[]> => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) return [];

      // Mathews is the designated control-plane super-admin. Keep this UI
      // bootstrap aligned with the server-side has_role() fallback so a
      // missing/stale user_roles row cannot lock out the primary operator.
      if (auth.user?.email?.trim().toLowerCase() === "mathews.cruz@origoenergia.com.br") {
        return ["admin"];
      }

      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as AppRole);
    },
    staleTime: 60_000,
  });
}

export function useIsAdmin() {
  const { data, isLoading } = useMyRoles();
  return { isAdmin: (data ?? []).includes("admin"), isLoading };
}

export function useCanOperate() {
  const { data, isLoading } = useMyRoles();
  const roles = data ?? [];
  return {
    canOperate: roles.includes("admin") || roles.includes("operator"),
    isLoading,
  };
}
