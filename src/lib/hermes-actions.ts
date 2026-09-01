import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { CommandName } from "@/lib/hermes";

export async function sendCommand(
  agentId: string,
  command: CommandName,
  payload: Json = {},
  note = "",
) {
  const { data, error } = await supabase.rpc("enqueue_agent_command", {
    _agent_id: agentId,
    _command: command,
    _payload: payload,
    _note: note,
  });
  if (error) throw error;
  return data;
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
