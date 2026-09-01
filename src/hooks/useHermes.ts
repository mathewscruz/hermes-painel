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
    const channel = supabase.channel("hermes-realtime");
    for (const table of TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        void queryClient.invalidateQueries({ queryKey: ["hermes"] });
      });
    }
    channel.subscribe();
    return () => {
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
