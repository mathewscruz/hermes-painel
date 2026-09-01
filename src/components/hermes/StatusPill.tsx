import { HEALTH_LABEL, STATUS_LABEL, healthTone, statusTone } from "@/lib/hermes";

export function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider ${tone}`}
    >
      <span
        className={`size-1.5 rounded-full bg-current ${status === "running" ? "live-dot" : ""}`}
        aria-hidden
      />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function HealthDot({ health, label }: { health: string; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${healthTone(health)}`}>
      <span className="size-2 rounded-full bg-current" aria-hidden />
      {label ?? HEALTH_LABEL[health] ?? health}
    </span>
  );
}
