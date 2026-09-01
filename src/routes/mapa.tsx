import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { Server } from "lucide-react";
import { AppShell, LiveBadge } from "@/components/hermes/AppShell";
import { HealthDot, StatusPill } from "@/components/hermes/StatusPill";
import { useAuth } from "@/hooks/useAuth";
import { useAgents, useConnections, useHermesRealtime } from "@/hooks/useHermes";
import { relativeTime } from "@/lib/hermes";

export const Route = createFileRoute("/mapa")({
  head: () => ({
    meta: [
      { title: "Mapa da estrutura Hermes" },
      {
        name: "description",
        content:
          "Visualize como os agentes Hermes se conectam aos sistemas: GLPI, Active Directory, scanners e CMDB.",
      },
      { property: "og:title", content: "Mapa da estrutura Hermes" },
      {
        property: "og:description",
        content: "Agentes e integrações da estrutura Hermes em um só diagrama.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MapPage,
});

function MapPage() {
  const navigate = useNavigate();
  const { session, user, loading } = useAuth();
  const authed = !!session;

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  useHermesRealtime();
  const agents = useAgents(authed);
  const connections = useConnections(undefined, authed);

  const systems = useMemo(() => {
    const map = new Map<string, { name: string; healths: string[]; agents: Set<string> }>();
    for (const c of connections.data ?? []) {
      const entry = map.get(c.name) ?? { name: c.name, healths: [], agents: new Set<string>() };
      entry.healths.push(c.health);
      entry.agents.add(c.agent_id);
      map.set(c.name, entry);
    }
    return [...map.values()];
  }, [connections.data]);

  if (loading || !session) {
    return (
      <div className="grid-lines flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  function worst(healths: string[]) {
    if (healths.includes("down")) return "down";
    if (healths.includes("degraded")) return "degraded";
    if (healths.includes("unknown")) return "unknown";
    return "healthy";
  }

  return (
    <AppShell email={user?.email ?? ""}>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Estrutura Hermes</h1>
          <p className="text-sm text-muted-foreground">
            Como cada agente se liga aos sistemas da operação.
          </p>
        </div>
        <div className="ml-auto">
          <LiveBadge online />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_auto_1fr]">
        <section className="space-y-3">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Agentes
          </h2>
          {(agents.data ?? []).map((agent) => {
            const aConns = (connections.data ?? []).filter((c) => c.agent_id === agent.id);
            return (
              <Link
                key={agent.id}
                to="/agentes/$slug"
                params={{ slug: agent.slug }}
                className="panel block p-4 transition-colors hover:border-primary/60"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{agent.name}</span>
                  <StatusPill status={agent.status} />
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {aConns.length} conexões · sinal {relativeTime(agent.last_heartbeat_at)}
                </p>
                <div className="mt-3 space-y-1">
                  {aConns.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-muted-foreground">└─</span>
                      <HealthDot health={c.health} label={c.name} />
                      <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">
                        {c.kind}
                      </span>
                    </div>
                  ))}
                </div>
              </Link>
            );
          })}
        </section>

        <div
          className="hidden w-px bg-gradient-to-b from-transparent via-border to-transparent lg:block"
          aria-hidden
        />

        <section className="space-y-3">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Sistemas conectados
          </h2>
          {systems.map((sys) => (
            <div key={sys.name} className="panel flex items-center gap-3 p-4">
              <Server className="size-4 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{sys.name}</div>
                <p className="font-mono text-[11px] text-muted-foreground">
                  usado por {sys.agents.size} agente{sys.agents.size === 1 ? "" : "s"}
                </p>
              </div>
              <HealthDot health={worst(sys.healths)} />
            </div>
          ))}
          {systems.length === 0 ? (
            <div className="panel p-6 text-center text-sm text-muted-foreground">
              Nenhuma conexão cadastrada.
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
