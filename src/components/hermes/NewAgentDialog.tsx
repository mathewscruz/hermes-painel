import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { createAgent } from "@/lib/hermes-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function NewAgentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("automation");
  const [version, setVersion] = useState("0.20.6");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const slug = slugify(name);
      const agent = await createAgent({ name, slug, description, kind, version, config: {} });
      toast.success("Provisionamento iniciado. O agente ficará online automaticamente.");
      onOpenChange(false);
      setName("");
      setDescription("");
      void navigate({ to: "/agentes/$slug", params: { slug: agent.slug } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar agente");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo agente</DialogTitle>
          <DialogDescription>
            Cria um perfil Hermes isolado, workspace, API local, serviço e conexão com o painel.
            Funções e integrações adicionais podem ser configuradas depois.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="agent-name">Nome</Label>
            <Input
              id="agent-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hermes Backup Watch"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-desc">Descrição</Label>
            <Textarea
              id="agent-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="O que este agente faz na operação."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="agent-kind">Tipo</Label>
              <Input id="agent-kind" value={kind} onChange={(e) => setKind(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-version">Versão</Label>
              <Input
                id="agent-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim()}>
              Criar agente
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
