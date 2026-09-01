import { supabase } from "@/integrations/supabase/client";
import type { CommandName } from "@/lib/hermes";

async function logAudit(action: string, target: string, details: Record<string, unknown> = {}) {
  const { data } = await supabase.auth.getUser();
  await supabase.from("audit_log").insert({
    actor: data.user?.id ?? null,
    actor_email: data.user?.email ?? "",
    action,
    target,
    details,
  });
}

export async function sendCommand(agentId: string, command: CommandName, note = "") {
  const { error } = await supabase
    .from("agent_commands")
    .insert({ agent_id: agentId, command, status: "pending", note });
  if (error) throw error;

  await supabase.from("agent_events").insert({
    agent_id: agentId,
    level: "info",
    message: `Comando "${command}" enviado pelo painel.`,
  });
  await logAudit(`command:${command}`, agentId, { note });
}

export interface AgentInput {
  name: string;
  slug: string;
  description: string;
  kind: string;
  version: string;
  config: Record<string, unknown>;
}

export async function createAgent(input: AgentInput) {
  const { data, error } = await supabase
    .from("agents")
    .insert({ ...input, status: "stopped" })
    .select()
    .single();
  if (error) throw error;
  await logAudit("agent:create", data.id, { name: input.name });
  return data;
}

export async function updateAgent(id: string, input: Partial<AgentInput>) {
  const { error } = await supabase.from("agents").update(input).eq("id", id);
  if (error) throw error;
  await logAudit("agent:update", id, input as Record<string, unknown>);
}

export async function deleteAgent(id: string) {
  const { error } = await supabase.from("agents").delete().eq("id", id);
  if (error) throw error;
  await logAudit("agent:delete", id);
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
  await logAudit(id ? "capability:update" : "capability:create", input.agent_id, {
    name: input.name,
  });
}

export async function deleteCapability(id: string, agentId: string) {
  const { error } = await supabase.from("agent_capabilities").delete().eq("id", id);
  if (error) throw error;
  await logAudit("capability:delete", agentId, { id });
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
  await logAudit(id ? "connection:update" : "connection:create", input.agent_id, {
    name: input.name,
  });
}

export async function deleteConnection(id: string, agentId: string) {
  const { error } = await supabase.from("agent_connections").delete().eq("id", id);
  if (error) throw error;
  await logAudit("connection:delete", agentId, { id });
}

/** Marca a conexão como testada agora (checagem manual pelo painel). */
export async function touchConnection(id: string, health: string) {
  const { error } = await supabase
    .from("agent_connections")
    .update({ health, last_checked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
