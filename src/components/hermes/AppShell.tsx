import { Link, useNavigate } from "@tanstack/react-router";
import { Activity, LogOut, Network, Radar } from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export function LiveBadge({ online }: { online: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
      <span
        className={`size-1.5 rounded-full ${online ? "live-dot bg-ok" : "bg-idle"}`}
        aria-hidden
      />
      {online ? "ao vivo" : "offline"}
    </span>
  );
}

export function AppShell({ children, email }: { children: ReactNode; email?: string }) {
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    void navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen grid-lines">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2">
            <Radar className="size-5 text-primary" />
            <span className="font-mono text-sm font-bold uppercase tracking-[0.25em] text-foreground">
              Hermes
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              to="/"
              activeOptions={{ exact: true }}
              activeProps={{ className: "bg-surface-2 text-foreground" }}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Activity className="size-4" /> Operação
            </Link>
            <Link
              to="/mapa"
              activeProps={{ className: "bg-surface-2 text-foreground" }}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Network className="size-4" /> Estrutura
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {email ? (
              <span className="hidden font-mono text-xs text-muted-foreground sm:block">
                {email}
              </span>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              <LogOut className="size-4" /> Sair
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-6">{children}</main>
    </div>
  );
}
