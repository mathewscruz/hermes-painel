import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { CommandName } from "@/lib/hermes";

export async function sendCommand(
  agentId: string,
  command: CommandName,
  payload: Json = {},
  note = "",
) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) throw new Error("Sessão expirada. Entre novamente no painel.");

  const response = await fetch("/api/hermes/commands", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agent_id: agentId,
      command,
      payload,
      note,
    }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    command?: unknown;
    error?: string;
  };
  if (!response.ok) throw new Error(result.error || "Falha ao enfileirar comando");
  return result.command;
}

export interface AgentInput {
  name: string;
  slug: string;
  description: string;
  kind: string;
  version: string;
  config: Json;
}

export async function createAgent(input: AgentInput) {
  const { data, error } = await supabase
    .from("agents")
    .insert({ ...input, status: "stopped" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateAgent(id: string, input: Partial<AgentInput>) {
  const { error } = await supabase.from("agents").update(input).eq("id", id);
  if (error) throw error;
}

export async function deleteAgent(id: string) {
  const { error } = await supabase.from("agents").delete().eq("id", id);
  if (error) throw error;
}

export async function upsertCapability(input: {
  id?: string;
  agent_id: string;
  name: string;
  description: string;
  enabled: boolean;
}) {
  const { id, ...rest } = input;
  const { error } = id
    ? await supabase.from("agent_capabilities").update(rest).eq("id", id)
    : await supabase.from("agent_capabilities").insert(rest);
  if (error) throw error;
}

export async function deleteCapability(id: string) {
  const { error } = await supabase.from("agent_capabilities").delete().eq("id", id);
  if (error) throw error;
}

export async function upsertConnection(input: {
  id?: string;
  agent_id: string;
  name: string;
  target: string;
  kind: string;
  health: string;
}) {
  const { id, ...rest } = input;
  const { error } = id
    ? await supabase.from("agent_connections").update(rest).eq("id", id)
    : await supabase.from("agent_connections").insert(rest);
  if (error) throw error;
}

export async function deleteConnection(id: string) {
  const { error } = await supabase.from("agent_connections").delete().eq("id", id);
  if (error) throw error;
}

/** Marca a conexão como testada agora (checagem manual pelo painel). */
export async function touchConnection(id: string, health: string) {
  const { error } = await supabase
    .from("agent_connections")
    .update({ health, last_checked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
