export type AgentStatus = "running" | "stopped" | "error" | "restarting" | "starting";
export type Health = "healthy" | "degraded" | "down" | "unknown";
export type RunStatus = "running" | "success" | "failed";
export type LogLevel = "info" | "warning" | "error";
export type CommandName = "start" | "stop" | "restart";

export interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  kind: string;
  status: string;
  version: string;
  last_heartbeat_at: string | null;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Capability {
  id: string;
  agent_id: string;
  name: string;
  description: string;
  enabled: boolean;
  executions_count: number;
  success_count: number;
  created_at: string;
}

export interface Connection {
  id: string;
  agent_id: string;
  name: string;
  target: string;
  kind: string;
  health: string;
  last_checked_at: string | null;
  created_at: string;
}

export interface Run {
  id: string;
  agent_id: string;
  capability_id: string | null;
  title: string;
  status: string;
  summary: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

export interface AgentEvent {
  id: string;
  agent_id: string;
  level: string;
  message: string;
  created_at: string;
}

export interface Command {
  id: string;
  agent_id: string;
  command: string;
  status: string;
  note: string;
  created_at: string;
  acknowledged_at: string | null;
}

export const STATUS_LABEL: Record<string, string> = {
  running: "Em execução",
  stopped: "Parado",
  error: "Com erro",
  restarting: "Reiniciando",
  starting: "Iniciando",
};

export const HEALTH_LABEL: Record<string, string> = {
  healthy: "Saudável",
  degraded: "Degradada",
  down: "Fora do ar",
  unknown: "Desconhecida",
};

export const RUN_LABEL: Record<string, string> = {
  running: "Executando",
  success: "Sucesso",
  failed: "Falhou",
};

/** Classe de cor (texto) para cada estado de agente. */
export function statusTone(status: string): string {
  switch (status) {
    case "running":
      return "text-ok";
    case "error":
      return "text-danger";
    case "restarting":
    case "starting":
      return "text-warn";
    default:
      return "text-idle";
  }
}

export function healthTone(health: string): string {
  switch (health) {
    case "healthy":
      return "text-ok";
    case "degraded":
      return "text-warn";
    case "down":
      return "text-danger";
    default:
      return "text-idle";
  }
}

export function runTone(status: string): string {
  switch (status) {
    case "success":
      return "text-ok";
    case "failed":
      return "text-danger";
    default:
      return "text-primary";
  }
}

export function levelTone(level: string): string {
  switch (level) {
    case "error":
      return "text-danger";
    case "warning":
      return "text-warn";
    default:
      return "text-muted-foreground";
  }
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(diff / 1000));
  if (s < 60) return `há ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.round(h / 24)}d`;
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}min`;
}

/** Um agente é considerado "sem sinal" após 2 minutos sem heartbeat. */
export function isStale(agent: Agent): boolean {
  if (agent.status !== "running") return false;
  if (!agent.last_heartbeat_at) return true;
  return Date.now() - new Date(agent.last_heartbeat_at).getTime() > 120_000;
}

export function successRate(cap: Capability): number {
  if (!cap.executions_count) return 0;
  return Math.round((cap.success_count / cap.executions_count) * 100);
}
