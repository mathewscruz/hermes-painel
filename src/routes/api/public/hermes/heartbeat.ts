import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const eventSchema = z.object({
  event_id: z.string().min(1).max(128).optional(),
  level: z.enum(["info", "warning", "warn", "error", "debug"]).default("info"),
  message: z.string().min(1).max(8_000),
  metadata: z.record(z.unknown()).default({}),
});

const commandResultSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["acknowledged", "succeeded", "failed", "rejected"]),
  result: z.record(z.unknown()).default({}),
  error: z.string().max(8_000).default(""),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
});

const runUpdateSchema = z.object({
  external_run_id: z.string().min(1).max(200),
  command_id: z.string().uuid().nullable().optional(),
  session_id: z.string().max(256).nullable().optional(),
  title: z.string().min(1).max(500),
  status: z.enum(["running", "waiting_approval", "stopping", "success", "failed", "cancelled"]),
  summary: z.string().max(16_000).default(""),
  started_at: z.string().datetime().optional(),
  finished_at: z.string().datetime().nullable().optional(),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
});

const payloadSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  status: z.enum(["running", "idle", "stopped", "error", "degraded"]).optional(),
  version: z.string().max(100).optional(),
  events: z.array(eventSchema).max(100).optional(),
  command_results: z.array(commandResultSchema).max(50).optional(),
  run_updates: z.array(runUpdateSchema).max(50).optional(),
});

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

function secretForSlug(slug: string): string | undefined {
  const scoped = process.env["HERMES_AGENT_SECRETS"];
  if (scoped) {
    try {
      const parsed = JSON.parse(scoped) as Record<string, unknown>;
      const value = parsed[slug];
      if (typeof value === "string" && value.length >= 32) return value;
    } catch {
      console.error("[Hermes heartbeat] HERMES_AGENT_SECRETS is not valid JSON");
    }
  }
  return undefined;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const Route = createFileRoute("/api/public/hermes/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const claimedSlug = request.headers.get("x-hermes-agent") ?? "";
        if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(claimedSlug)) {
          return jsonResponse({ error: "unauthorized" }, 401);
        }

        const provided = request.headers.get("x-hermes-secret") ?? "";
        if (provided.length < 32) {
          return jsonResponse({ error: "unauthorized" }, 401);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const expected = secretForSlug(claimedSlug);
        let authenticated = Boolean(expected && constantTimeEqual(provided, expected));

        if (!authenticated) {
          const { data: credential, error: credentialError } = await supabaseAdmin
            .from("agent_bridge_credentials")
            .select("secret_sha256")
            .eq("agent_slug", claimedSlug)
            .eq("is_active", true)
            .maybeSingle();
          if (!credentialError && credential?.secret_sha256) {
            authenticated = constantTimeEqual(await sha256Hex(provided), credential.secret_sha256);
          }
        }

        if (!authenticated) return jsonResponse({ error: "unauthorized" }, 401);

        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(contentLength) && contentLength > 1_048_576) {
          return jsonResponse({ error: "payload too large" }, 413);
        }

        let rawBody: unknown;
        try {
          rawBody = await request.json();
        } catch {
          return jsonResponse({ error: "invalid json" }, 400);
        }

        const parsed = payloadSchema.safeParse(rawBody);
        if (!parsed.success) return jsonResponse({ error: "invalid payload" }, 400);
        const body = parsed.data;
        if (body.slug !== claimedSlug) return jsonResponse({ error: "agent mismatch" }, 403);

        const { data: agent, error } = await supabaseAdmin
          .from("agents")
          .select("id")
          .eq("slug", claimedSlug)
          .maybeSingle();

        if (error || !agent) return jsonResponse({ error: "agent not found" }, 404);
        const now = new Date().toISOString();

        const { error: heartbeatError } = await supabaseAdmin
          .from("agents")
          .update({
            last_heartbeat_at: now,
            ...(body.status ? { status: body.status } : {}),
            ...(body.version ? { version: body.version } : {}),
          })
          .eq("id", agent.id);
        if (heartbeatError) return jsonResponse({ error: "heartbeat update failed" }, 500);

        if (body.events?.length) {
          const { error: eventsError } = await supabaseAdmin.from("agent_events").upsert(
            body.events.map((event) => ({
              agent_id: agent.id,
              external_event_id: event.event_id ?? null,
              level: event.level === "warn" ? "warning" : event.level,
              message: event.message,
              metadata: event.metadata,
            })),
            { onConflict: "agent_id,external_event_id", ignoreDuplicates: true },
          );
          if (eventsError) return jsonResponse({ error: "event ingest failed" }, 500);
        }

        for (const result of body.command_results ?? []) {
          const { error: resultError } = await supabaseAdmin
            .from("agent_commands")
            .update({
              status: result.status,
              result: result.result,
              error: result.error,
              started_at: result.started_at ?? now,
              completed_at: result.completed_at ?? now,
              acknowledged_at: now,
            })
            .eq("id", result.id)
            .eq("agent_id", agent.id);
          if (resultError) return jsonResponse({ error: "command result update failed" }, 500);
        }

        for (const run of body.run_updates ?? []) {
          const { error: runError } = await supabaseAdmin.from("agent_runs").upsert(
            {
              agent_id: agent.id,
              external_run_id: run.external_run_id,
              command_id: run.command_id ?? null,
              session_id: run.session_id ?? null,
              title: run.title,
              status: run.status,
              summary: run.summary,
              started_at: run.started_at ?? now,
              finished_at: run.finished_at ?? null,
              duration_ms: run.duration_ms ?? null,
              metadata: run.metadata,
            },
            { onConflict: "agent_id,external_run_id" },
          );
          if (runError) return jsonResponse({ error: "run update failed" }, 500);
        }

        const { data: pending, error: pendingError } = await supabaseAdmin.rpc(
          "claim_agent_commands",
          {
            _agent_id: agent.id,
            _limit: 20,
            _lease_seconds: 300,
          },
        );
        if (pendingError) return jsonResponse({ error: "command fetch failed" }, 500);

        return jsonResponse({
          ok: true,
          server_time: now,
          pending_commands: (pending ?? []).map(({ id, command, payload, note, created_at }) => ({
            id,
            command,
            payload,
            note,
            created_at,
          })),
        });
      },
    },
  },
});
