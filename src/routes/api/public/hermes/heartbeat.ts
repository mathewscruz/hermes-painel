import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const payloadSchema = z.object({
  slug: z.string(),
  status: z.enum(["running", "idle", "stopped", "error", "degraded"]).optional(),
  version: z.string().optional(),
  events: z
    .array(
      z.object({
        level: z.enum(["info", "warn", "error", "debug"]).default("info"),
        message: z.string(),
      }),
    )
    .optional(),
  ack_command_ids: z.array(z.string()).optional(),
});

export const Route = createFileRoute("/api/public/hermes/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["HERMES_AGENT_SECRET"];
        const provided = request.headers.get("x-hermes-secret");
        if (!secret || provided !== secret) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const parsed = payloadSchema.safeParse(await request.json());
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "invalid payload" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const body = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: agent, error } = await supabaseAdmin
          .from("agents")
          .select("id")
          .eq("slug", body.slug)
          .maybeSingle();

        if (error || !agent) {
          return new Response(JSON.stringify({ error: "agent not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        await supabaseAdmin
          .from("agents")
          .update({
            last_heartbeat_at: new Date().toISOString(),
            ...(body.status ? { status: body.status } : {}),
            ...(body.version ? { version: body.version } : {}),
          })
          .eq("id", agent.id);

        if (body.events?.length) {
          await supabaseAdmin.from("agent_events").insert(
            body.events.map((ev) => ({
              agent_id: agent.id,
              level: ev.level,
              message: ev.message,
            })),
          );
        }

        if (body.ack_command_ids?.length) {
          await supabaseAdmin
            .from("agent_commands")
            .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
            .in("id", body.ack_command_ids);
        }

        const { data: pending } = await supabaseAdmin
          .from("agent_commands")
          .select("id, command, payload, created_at")
          .eq("agent_id", agent.id)
          .eq("status", "pending")
          .order("created_at", { ascending: true });

        return new Response(JSON.stringify({ ok: true, pending_commands: pending ?? [] }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
