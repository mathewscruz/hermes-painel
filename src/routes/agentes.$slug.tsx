import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CirclePlay,
  CircleStop,
  Plug,
  Plus,
  RotateCw,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, LiveBadge } from "@/components/hermes/AppShell";
import { HealthDot, StatusPill } from "@/components/hermes/StatusPill";
import { useAuth } from "@/hooks/useAuth";
import {
  useAgents,
  useCapabilities,
  useCommands,
  useConnections,
  useEvents,
  useHermesRealtime,
  useRuns,
} from "@/hooks/useHermes";
import {
  deleteAgent,
  deleteCapability,
  deleteConnection,
  sendCommand,
  touchConnection,
  updateAgent,
  upsertCapability,
  upsertConnection,
} from "@/lib/hermes-actions";
import {
  formatDuration,
  HEALTH_LABEL,
  levelTone,
  relativeTime,
  RUN_LABEL,
  runTone,
  successRate,
} from "@/lib/hermes";
import type { CommandName } from "@/lib/hermes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/agentes/$slug")({
  head: () => ({
    meta: [
      { title: "Detalhe do agente — Hermes Control Center" },
      {
        name: "description",
        content:
          "Funções, conexões, execuções, logs ao vivo e configuração de um agente Hermes.",
      },
      { property: "og:title", content: "Detalhe do agente — Hermes" },
      {
        property: "og:description",
        content: "Funções, conexões, execuções e controle do agente Hermes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgentDetail,
});

function AgentDetail() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const { session, user, loading } = useAuth();
  const authed = !!session;

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  useHermesRealtime();
  const agents = useAgents(authed);
  const agent = (agents.data ?? []).find((a) => a.slug === slug);
  const agentId = agent?.id;

  const caps = useCapabilities(agentId, authed && !!agentId);
  const conns = useConnections(agentId, authed && !!agentId);
  const runs = useRuns(agentId, 40, authed && !!agentId);
  const events = useEvents(agentId, 60, authed && !!agentId);
  const commands = useCommands(agentId, authed && !!agentId);

  const [capName, setCapName] = useState("");
  const [capDesc, setCapDesc] = useState("");
  const [connName, setConnName] = useState("");
  const [connTarget, setConnTarget] = useState("");
  const [connKind, setConnKind] = useState("api");

  const [form, setForm] = useState({ name: "", description: "", version: "", config: "{}" });
  useEffect(() => {
    if (agent) {
      setForm({
        name: agent.name,
        description: agent.description,
        version: agent.version,
        config: JSON.stringify(agent.config ?? {}, null, 2),
      });
    }
  }, [agent]);

  if (loading || !session) {
    return (
      <div className="grid-lines flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  if (!agent) {
    return (
      <AppShell email={user?.email ?? ""}>
        <div className="panel p-8 text-center text-sm text-muted-foreground">
          {agents.isLoading ? "Carregando agente…" : "Agente não encontrado."}
        </div>
      </AppShell>
    );
  }

  async function control(command: CommandName) {
    if (!agentId) return;
    try {
      await sendCommand(agentId, command);
      toast.success(`Comando "${command}" enfileirado.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar comando");
    }
  }

  async function saveSettings() {
    if (!agentId) return;
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(form.config) as Record<string, unknown>;
    } catch {
      toast.error("A configuração precisa ser um JSON válido.");
      return;
    }
    try {
      await updateAgent(agentId, {
        name: form.name,
        description: form.description,
        version: form.version,
        config: config as never,
      });
      toast.success("Configuração salva.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    }
  }

  async function removeAgent() {
    if (!agentId) return;
    if (!window.confirm(`Remover o agente "${agent?.name}"? Esta ação não pode ser desfeita.`))
      return;
    try {
      await deleteAgent(agentId);
      toast.success("Agente removido.");
      void navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover");
    }
  }

  const pending = (commands.data ?? []).find((c) => c.status === "pending");

  return (
    <AppShell email={user?.email ?? ""}>
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Voltar para a operação
      </Link>

      <div className="panel p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{agent.name}</h1>
              <StatusPill status={agent.status} />
              <span className="font-mono text-[11px] text-muted-foreground">
                v{agent.version} · {agent.kind}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{agent.description}</p>
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              último sinal {relativeTime(agent.last_heartbeat_at)}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <LiveBadge online />
            <Button size="sm" variant="outline" onClick={() => void control("start")}>
              <CirclePlay className="size-4 text-ok" /> Iniciar
            </Button>
            <Button size="sm" variant="outline" onClick={() => void control("stop")}>
              <CircleStop className="size-4 text-danger" /> Parar
            </Button>
            <Button size="sm" variant="outline" onClick={() => void control("restart")}>
              <RotateCw className="size-4 text-warn" /> Reiniciar
            </Button>
          </div>
        </div>
        {pending ? (
          <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 font-mono text-[11px] text-warn">
            comando “{pending.command}” pendente desde {relativeTime(pending.created_at)}
          </div>
        ) : null}
      </div>

      <Tabs defaultValue="funcoes" className="mt-4">
        <TabsList>
          <TabsTrigger value="funcoes">Funções</TabsTrigger>
          <TabsTrigger value="conexoes">Conexões</TabsTrigger>
          <TabsTrigger value="execucoes">Execuções</TabsTrigger>
          <TabsTrigger value="logs">Logs ao vivo</TabsTrigger>
          <TabsTrigger value="config">Configuração</TabsTrigger>
        </TabsList>

        <TabsContent value="funcoes" className="mt-4 space-y-3">
          {(caps.data ?? []).map((cap) => (
            <div key={cap.id} className="panel flex flex-wrap items-center gap-4 p-4">
              <Zap className="size-4 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{cap.name}</div>
                <p className="text-sm text-muted-foreground">{cap.description}</p>
              </div>
              <div className="text-right">
                <div className="font-mono text-lg">{cap.executions_count}</div>
                <div className="font-mono text-[11px] uppercase text-muted-foreground">
                  execuções
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`font-mono text-lg ${successRate(cap) >= 95 ? "text-ok" : successRate(cap) >= 85 ? "text-warn" : "text-danger"}`}
                >
                  {successRate(cap)}%
                </div>
                <div className="font-mono text-[11px] uppercase text-muted-foreground">
                  sucesso
                </div>
              </div>
              <Switch
                checked={cap.enabled}
                onCheckedChange={(v) =>
                  void upsertCapability({
                    id: cap.id,
                    agent_id: cap.agent_id,
                    name: cap.name,
                    description: cap.description,
                    enabled: v,
                  })
                }
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void deleteCapability(cap.id, cap.agent_id)}
              >
                <Trash2 className="size-4 text-danger" />
              </Button>
            </div>
          ))}

          <div className="panel space-y-3 p-4">
            <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Nova função
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Nome da função"
                value={capName}
                onChange={(e) => setCapName(e.target.value)}
              />
              <Input
                placeholder="Descrição"
                value={capDesc}
                onChange={(e) => setCapDesc(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={!capName.trim() || !agentId}
              onClick={() => {
                if (!agentId) return;
                void upsertCapability({
                  agent_id: agentId,
                  name: capName,
                  description: capDesc,
                  enabled: true,
                }).then(() => {
                  setCapName("");
                  setCapDesc("");
                  toast.success("Função adicionada.");
                });
              }}
            >
              <Plus className="size-4" /> Adicionar função
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="conexoes" className="mt-4 space-y-3">
          {(conns.data ?? []).map((conn) => (
            <div key={conn.id} className="panel flex flex-wrap items-center gap-4 p-4">
              <Plug className="size-4 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{conn.name}</div>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {conn.kind} · {conn.target}
                </p>
              </div>
              <HealthDot health={conn.health} />
              <span className="font-mono text-[11px] text-muted-foreground">
                testada {relativeTime(conn.last_checked_at)}
              </span>
              <Select
                value={conn.health}
                onValueChange={(v) => void touchConnection(conn.id, v)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(HEALTH_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void deleteConnection(conn.id, conn.agent_id)}
              >
                <Trash2 className="size-4 text-danger" />
              </Button>
            </div>
          ))}

          <div className="panel space-y-3 p-4">
            <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Nova conexão
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                placeholder="Nome (ex: GLPI API)"
                value={connName}
                onChange={(e) => setConnName(e.target.value)}
              />
              <Input
                placeholder="Endereço / endpoint"
                value={connTarget}
                onChange={(e) => setConnTarget(e.target.value)}
              />
              <Input
                placeholder="Tipo (api, ldap, db…)"
                value={connKind}
                onChange={(e) => setConnKind(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={!connName.trim() || !agentId}
              onClick={() => {
                if (!agentId) return;
                void upsertConnection({
                  agent_id: agentId,
                  name: connName,
                  target: connTarget,
                  kind: connKind,
                  health: "unknown",
                }).then(() => {
                  setConnName("");
                  setConnTarget("");
                  toast.success("Conexão adicionada.");
                });
              }}
            >
              <Plus className="size-4" /> Adicionar conexão
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="execucoes" className="mt-4">
          <div className="panel divide-y divide-border">
            {(runs.data ?? []).map((run) => (
              <div key={run.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className={`w-24 font-mono text-[11px] uppercase ${runTone(run.status)}`}>
                  {RUN_LABEL[run.status] ?? run.status}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{run.title}</div>
                  <p className="truncate text-xs text-muted-foreground">{run.summary}</p>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDuration(run.duration_ms)}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {relativeTime(run.started_at)}
                </span>
              </div>
            ))}
            {(runs.data ?? []).length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma execução registrada.
              </div>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <div className="panel max-h-[600px] overflow-y-auto bg-surface p-4 font-mono text-xs">
            {(events.data ?? []).map((ev) => (
              <div key={ev.id} className="flex gap-3 py-1">
                <span className="shrink-0 text-muted-foreground">
                  {new Date(ev.created_at).toLocaleTimeString("pt-BR")}
                </span>
                <span className={`w-16 shrink-0 uppercase ${levelTone(ev.level)}`}>
                  {ev.level}
                </span>
                <span className="text-foreground/90">{ev.message}</span>
              </div>
            ))}
            {(events.data ?? []).length === 0 ? (
              <p className="text-muted-foreground">Sem eventos ainda.</p>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="config" className="mt-4 space-y-4">
          <div className="panel space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cfg-name">Nome</Label>
                <Input
                  id="cfg-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cfg-version">Versão</Label>
                <Input
                  id="cfg-version"
                  value={form.version}
                  onChange={(e) => setForm({ ...form, version: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-desc">Descrição</Label>
              <Textarea
                id="cfg-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-json">Parâmetros (JSON)</Label>
              <Textarea
                id="cfg-json"
                rows={10}
                className="font-mono text-xs"
                value={form.config}
                onChange={(e) => setForm({ ...form, config: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => void saveSettings()}>Salvar alterações</Button>
              <Button variant="outline" onClick={() => void removeAgent()}>
                <Trash2 className="size-4 text-danger" /> Remover agente
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
