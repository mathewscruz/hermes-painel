import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Agent, AgentEvent, Capability, Command, Connection, Run } from "@/lib/hermes";

const TABLES = [
  "agents",
  "agent_capabilities",
  "agent_connections",
  "agent_runs",
  "agent_events",
  "agent_commands",
] as const;

/** Assina todas as tabelas do Hermes e invalida os caches em tempo real. */
export function useHermesRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ["hermes"] });
    };

    let channel = supabase.channel("hermes-realtime-" + Math.random().toString(36).slice(2));
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      for (const table of TABLES) {
        channel.on("postgres_changes", { event: "*", schema: "public", table }, invalidate);
      }
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") invalidate();
        if (
          !closed &&
          (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
        ) {
          retry = setTimeout(() => {
            void supabase.removeChannel(channel);
            channel = supabase.channel(
              "hermes-realtime-" + Math.random().toString(36).slice(2),
            );
            connect();
          }, 3000);
        }
      });
    };
    connect();

    // Rede/aba voltando: garante dados frescos mesmo se algum evento se perdeu.
    const onFocus = () => invalidate();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);
}


export function useAgents(enabled = true) {
  return useQuery({
    queryKey: ["hermes", "agents"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("agents").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Agent[];
    },
  });
}

export function useCapabilities(agentId?: string, enabled = true) {
  return useQuery({
    queryKey: ["hermes", "capabilities", agentId ?? "all"],
    enabled,
    queryFn: async () => {
      let q = supabase.from("agent_capabilities").select("*").order("name");
      if (agentId) q = q.eq("agent_id", agentId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Capability[];
    },
  });
}

export function useConnections(agentId?: string, enabled = true) {
  return useQuery({
    queryKey: ["hermes", "connections", agentId ?? "all"],
    enabled,
    queryFn: async () => {
      let q = supabase.from("agent_connections").select("*").order("name");
      if (agentId) q = q.eq("agent_id", agentId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Connection[];
    },
  });
}

export function useRuns(agentId?: string, limit = 30, enabled = true) {
  return useQuery({
    queryKey: ["hermes", "runs", agentId ?? "all", limit],
    enabled,
    queryFn: async () => {
      let q = supabase
        .from("agent_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);
      if (agentId) q = q.eq("agent_id", agentId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Run[];
    },
  });
}

export function useEvents(agentId?: string, limit = 40, enabled = true) {
  return useQuery({
    queryKey: ["hermes", "events", agentId ?? "all", limit],
    enabled,
    queryFn: async () => {
      let q = supabase
        .from("agent_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (agentId) q = q.eq("agent_id", agentId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as AgentEvent[];
    },
  });
}

export function useCommands(agentId?: string, enabled = true) {
  return useQuery({
    queryKey: ["hermes", "commands", agentId ?? "all"],
    enabled,
    queryFn: async () => {
      let q = supabase
        .from("agent_commands")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (agentId) q = q.eq("agent_id", agentId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Command[];
    },
  });
}

export function usePendingCommands(enabled = true) {
  return useQuery({
    queryKey: ["hermes", "commands", "pending-all"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_commands")
        .select("*")
        .in("status", ["pending", "claimed"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Command[];
    },
  });
}

export function useActiveRuns(enabled = true) {
  return useQuery({
    queryKey: ["hermes", "runs", "active-all"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_runs")
        .select("*")
        .eq("status", "running")
        .order("started_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Run[];
    },
  });
}

export function useDashboardMetrics(enabled = true) {
  return useQuery({
    queryKey: ["hermes", "dashboard-metrics"],
    enabled,
    queryFn: async () => {
      const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
      const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
      const [agents, active, today, failures, unhealthy] = await Promise.all([
        supabase.from("agents").select("id", { count: "exact", head: true }),
        supabase.from("agents").select("id", { count: "exact", head: true }).eq("status", "running"),
        supabase.from("agent_runs").select("id", { count: "exact", head: true }).gte("started_at", dayAgo),
        supabase.from("agent_runs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("started_at", hourAgo),
        supabase.from("agent_connections").select("id", { count: "exact", head: true }).in("health", ["degraded", "down"]),
      ]);
      const firstError = [agents, active, today, failures, unhealthy].find((item) => item.error)?.error;
      if (firstError) throw firstError;
      return {
        total: agents.count ?? 0,
        active: active.count ?? 0,
        today: today.count ?? 0,
        failures: failures.count ?? 0,
        unhealthy: unhealthy.count ?? 0,
      };
    },
  });
}
