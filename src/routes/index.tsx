import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CirclePlay,
  CircleStop,
  Cpu,
  Plus,
  RotateCw,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, LiveBadge } from "@/components/hermes/AppShell";
import { HealthDot, StatusPill } from "@/components/hermes/StatusPill";
import { NewAgentDialog } from "@/components/hermes/NewAgentDialog";
import { useAuth } from "@/hooks/useAuth";
import {
  useAgents,
  useCommands,
  useConnections,
  useEvents,
  useHermesRealtime,
  useRuns,
} from "@/hooks/useHermes";
import { sendCommand } from "@/lib/hermes-actions";
import { isStale, levelTone, relativeTime, runTone, RUN_LABEL } from "@/lib/hermes";
import type { CommandName } from "@/lib/hermes";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hermes Control Center — operação em tempo real" },
      {
        name: "description",
        content:
          "Painel em tempo real dos agentes Hermes: status, funções, conexões, execuções e controle de start, stop e restart.",
      },
      { property: "og:title", content: "Hermes Control Center" },
      {
        property: "og:description",
        content: "Monitore e controle seus agentes Hermes em tempo real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Overview,
});

function Kpi({
  label,
  value,
  hint,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint: string;
  tone: string;
  icon: React.ElementType;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <Icon className={`size-4 ${tone}`} />
      </div>
      <div className={`mt-3 font-mono text-3xl font-bold ${tone}`}>{value}</div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Overview() {
  const navigate = useNavigate();
  const { session, user, loading } = useAuth();
  const authed = !!session;

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  useHermesRealtime();
  const agents = useAgents(authed);
  const runs = useRuns(undefined, 60, authed);
  const events = useEvents(undefined, 25, authed);
  const connections = useConnections(undefined, authed);
  const commands = useCommands(undefined, authed);
  const [openNew, setOpenNew] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const agentList = agents.data ?? [];
  const runList = runs.data ?? [];
  const connList = connections.data ?? [];
  const pendingCommands = (commands.data ?? []).filter((c) => c.status === "pending");

  const kpis = useMemo(() => {
    const dayAgo = Date.now() - 86_400_000;
    const hourAgo = Date.now() - 3_600_000;
    return {
      active: agentList.filter((a) => a.status === "running").length,
      total: agentList.length,
      today: runList.filter((r) => new Date(r.started_at).getTime() > dayAgo).length,
      failures: runList.filter(
        (r) => r.status === "failed" && new Date(r.started_at).getTime() > hourAgo,
      ).length,
      unhealthy: connList.filter((c) => c.health === "degraded" || c.health === "down").length,
    };
  }, [agentList, runList, connList]);

  async function control(agentId: string, command: CommandName) {
    setPendingId(agentId + command);
    try {
      await sendCommand(agentId, command);
      toast.success(`Comando "${command}" enfileirado. Aguardando confirmação do agente.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar comando");
    } finally {
      setPendingId(null);
    }
  }

  if (loading || !session) {
    return (
      <div className="grid-lines flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando painel…
      </div>
    );
  }

  return (
    <AppShell email={user?.email ?? undefined}>
      <NewAgentDialog open={openNew} onOpenChange={setOpenNew} />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operação Hermes</h1>
          <p className="text-sm text-muted-foreground">
            Estado atual dos agentes, execuções e integrações.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <LiveBadge online={!agents.isError} />
          <Button size="sm" onClick={() => setOpenNew(true)}>
            <Plus className="size-4" /> Novo agente
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Agentes ativos"
          value={`${kpis.active}/${kpis.total}`}
          hint="Em execução agora"
          tone="text-ok"
          icon={Cpu}
        />
        <Kpi
          label="Execuções 24h"
          value={kpis.today}
          hint="Tarefas iniciadas no período"
          tone="text-primary"
          icon={CheckCircle2}
        />
        <Kpi
          label="Falhas 1h"
          value={kpis.failures}
          hint="Execuções com erro na última hora"
          tone={kpis.failures ? "text-danger" : "text-idle"}
          icon={AlertTriangle}
        />
        <Kpi
          label="Conexões em risco"
          value={kpis.unhealthy}
          hint="Degradadas ou fora do ar"
          tone={kpis.unhealthy ? "text-warn" : "text-idle"}
          icon={Terminal}
        />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="space-y-3">
          {agentList.length === 0 && !agents.isLoading ? (
            <div className="panel p-8 text-center text-sm text-muted-foreground">
              Nenhum agente cadastrado ainda.
            </div>
          ) : null}

          {agentList.map((agent) => {
            const aConns = connList.filter((c) => c.agent_id === agent.id);
            const aRuns = runList.filter((r) => r.agent_id === agent.id);
            const running = aRuns.filter((r) => r.status === "running");
            const pending = pendingCommands.find((c) => c.agent_id === agent.id);
            const stale = isStale(agent);

            return (
              <article key={agent.id} className="panel p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/agentes/$slug"
                        params={{ slug: agent.slug }}
                        className="text-base font-semibold hover:text-primary"
                      >
                        {agent.name}
                      </Link>
                      <StatusPill status={agent.status} />
                      <span className="font-mono text-[11px] text-muted-foreground">
                        v{agent.version}
                      </span>
                      {stale ? (
                        <span className="rounded border border-warn/40 px-1.5 py-0.5 font-mono text-[10px] uppercase text-warn">
                          sem sinal
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {agent.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingId === agent.id + "start"}
                      onClick={() => void control(agent.id, "start")}
                    >
                      <CirclePlay className="size-4 text-ok" /> Iniciar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingId === agent.id + "stop"}
                      onClick={() => void control(agent.id, "stop")}
                    >
                      <CircleStop className="size-4 text-danger" /> Parar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingId === agent.id + "restart"}
                      onClick={() => void control(agent.id, "restart")}
                    >
                      <RotateCw className="size-4 text-warn" /> Reiniciar
                    </Button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                      Último sinal
                    </div>
                    <div className="mt-1 font-mono text-sm">
                      {relativeTime(agent.last_heartbeat_at)}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                      Em execução
                    </div>
                    <div className="mt-1 font-mono text-sm">
                      {running.length} tarefa{running.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                      Conexões
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {aConns.length ? (
                        aConns.map((c) => (
                          <HealthDot key={c.id} health={c.health} label={c.name} />
                        ))
                      ) : (
                        <span className="text-muted-foreground">nenhuma</span>
                      )}
                    </div>
                  </div>
                </div>

                {pending ? (
                  <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 font-mono text-[11px] text-warn">
                    comando “{pending.command}” pendente · aguardando confirmação do agente (
                    {relativeTime(pending.created_at)})
                  </div>
                ) : null}

                {running.length ? (
                  <div className="mt-3 space-y-1">
                    {running.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 text-xs">
                        <span className="size-1.5 rounded-full bg-primary live-dot" aria-hidden />
                        <span className="truncate">{r.title}</span>
                        <span className="ml-auto font-mono text-muted-foreground">
                          {relativeTime(r.started_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}

          <div className="panel p-4">
            <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Execuções recentes
            </h2>
            <div className="mt-3 divide-y divide-border">
              {runList.slice(0, 8).map((r) => {
                const agent = agentList.find((a) => a.id === r.agent_id);
                return (
                  <div key={r.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className={`font-mono text-[11px] uppercase ${runTone(r.status)}`}>
                      {RUN_LABEL[r.status] ?? r.status}
                    </span>
                    <span className="truncate">{r.title}</span>
                    <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                      {agent?.name} · {relativeTime(r.started_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="panel flex max-h-[720px] flex-col p-4">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Feed de eventos
          </h2>
          <div className="mt-3 space-y-2 overflow-y-auto font-mono text-xs">
            {(events.data ?? []).map((ev) => {
              const agent = agentList.find((a) => a.id === ev.agent_id);
              return (
                <div key={ev.id} className="border-l-2 border-border pl-3">
                  <div className="flex items-center gap-2">
                    <span className={`uppercase ${levelTone(ev.level)}`}>{ev.level}</span>
                    <span className="text-muted-foreground">{relativeTime(ev.created_at)}</span>
                  </div>
                  <p className="mt-0.5 text-foreground/90">{ev.message}</p>
                  <p className="text-muted-foreground">{agent?.name}</p>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
