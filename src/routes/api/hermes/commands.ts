import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";

const ALLOWED_COMMANDS = [
  "start",
  "stop",
  "restart",
  "run_task",
  "stop_run",
  "steer_run",
  "approve_run",
  "deny_run",
] as const;

const requestSchema = z.object({
  agent_id: z.string().uuid(),
  command: z.enum(ALLOWED_COMMANDS),
  payload: z.record(z.unknown()).default({}),
  note: z.string().max(2_000).default(""),
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const Route = createFileRoute("/api/hermes/commands")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization") ?? "";
        const token = authorization.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length).trim()
          : "";
        if (!token) return response({ error: "authentication required" }, 401);

        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(contentLength) && contentLength > 65_536) {
          return response({ error: "payload too large" }, 413);
        }

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return response({ error: "invalid json" }, 400);
        }
        const parsed = requestSchema.safeParse(raw);
        if (!parsed.success) return response({ error: "invalid command payload" }, 400);
        const body = parsed.data;

        if (
          body.command === "run_task" &&
          typeof body.payload.input !== "string"
        ) {
          return response({ error: "run_task requires payload.input" }, 400);
        }
        if (
          body.command === "run_task" &&
          !String(body.payload.input).trim()
        ) {
          return response({ error: "run_task requires payload.input" }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token);
        const user = auth.user;
        if (authError || !user) return response({ error: "invalid session" }, 401);

        const email = user.email?.trim().toLowerCase() ?? "";
        let authorized = email === "mathews.cruz@origoenergia.com.br";
        if (!authorized) {
          const { data: roles, error: roleError } = await supabaseAdmin
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .in("role", ["admin", "operator"]);
          if (roleError) return response({ error: "role lookup failed" }, 500);
          authorized = Boolean(roles?.length);
        }
        if (!authorized) return response({ error: "operator role required" }, 403);

        const { data: agent, error: agentError } = await supabaseAdmin
          .from("agents")
          .select("id")
          .eq("id", body.agent_id)
          .maybeSingle();
        if (agentError) return response({ error: "agent lookup failed" }, 500);
        if (!agent) return response({ error: "agent not found" }, 404);

        const { data: command, error: commandError } = await supabaseAdmin
          .from("agent_commands")
          .insert({
            agent_id: body.agent_id,
            command: body.command,
            payload: body.payload as Json,
            note: body.note,
            requested_by: user.id,
            status: "pending",
          })
          .select("*")
          .single();
        if (commandError || !command) {
          console.error("[Hermes commands] insert failed", commandError?.code);
          return response({ error: "command enqueue failed" }, 500);
        }

        const { error: auditError } = await supabaseAdmin.from("audit_log").insert({
          actor: user.id,
          actor_email: email,
          action: `command:${body.command}`,
          target: body.agent_id,
          details: {
            command_id: command.id,
            note: body.note,
          } as Json,
        });
        if (auditError) {
          console.error("[Hermes commands] audit insert failed", auditError.code);
        }

        return response({ command });
      },
    },
  },
});
