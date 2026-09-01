import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";

const RESERVED = new Set(["default", "hermes", "test", "tmp", "root", "sudo"]);

const requestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  description: z.string().trim().max(2_000).default(""),
  kind: z.string().trim().min(2).max(80).default("automation"),
  version: z.string().trim().min(1).max(100).default("0.20.6"),
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

export const Route = createFileRoute("/api/hermes/agents")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization") ?? "";
        const token = authorization.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length).trim()
          : "";
        if (!token) return response({ error: "authentication required" }, 401);

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return response({ error: "invalid json" }, 400);
        }
        const parsed = requestSchema.safeParse(raw);
        if (!parsed.success || RESERVED.has(parsed.data?.slug ?? "")) {
          return response({ error: "invalid agent configuration" }, 400);
        }
        const body = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token);
        const user = auth.user;
        if (authError || !user) return response({ error: "invalid session" }, 401);

        const email = user.email?.trim().toLowerCase() ?? "";
        let isAdmin = email === "mathews.cruz@origoenergia.com.br";
        if (!isAdmin) {
          const { data: roles, error: roleError } = await supabaseAdmin
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .eq("role", "admin");
          if (roleError) return response({ error: "role lookup failed" }, 500);
          isAdmin = Boolean(roles?.length);
        }
        if (!isAdmin) return response({ error: "admin role required" }, 403);

        const { data: existing, error: existingError } = await supabaseAdmin
          .from("agents")
          .select("id")
          .eq("slug", body.slug)
          .maybeSingle();
        if (existingError) return response({ error: "agent lookup failed" }, 500);
        if (existing) return response({ error: "agent slug already exists" }, 409);

        const { data: principal, error: principalError } = await supabaseAdmin
          .from("agents")
          .select("id")
          .eq("slug", "hermes-principal")
          .maybeSingle();
        if (principalError || !principal) {
          return response({ error: "provisioning controller unavailable" }, 503);
        }

        const requestedAt = new Date().toISOString();
        const { data: agent, error: agentError } = await supabaseAdmin
          .from("agents")
          .insert({
            name: body.name,
            slug: body.slug,
            description: body.description,
            kind: body.kind,
            version: body.version,
            status: "stopped",
            config: {
              provisioning: {
                status: "queued",
                requested_at: requestedAt,
                requested_by: user.id,
              },
            } as Json,
          })
          .select("*")
          .single();
        if (agentError || !agent) return response({ error: "agent create failed" }, 500);

        const { data: command, error: commandError } = await supabaseAdmin
          .from("agent_commands")
          .insert({
            agent_id: principal.id,
            command: "provision_agent",
            status: "pending",
            requested_by: user.id,
            note: `Provisionar agente ${body.slug}`,
            payload: {
              target_agent_id: agent.id,
              slug: body.slug,
              name: body.name,
              description: body.description,
              kind: body.kind,
              version: body.version,
            } as Json,
          })
          .select("id")
          .single();
        if (commandError || !command) {
          await supabaseAdmin.from("agents").delete().eq("id", agent.id);
          return response({ error: "provisioning enqueue failed" }, 500);
        }

        await supabaseAdmin.from("audit_log").insert({
          actor: user.id,
          actor_email: email,
          action: "agent:provision_requested",
          target: agent.id,
          details: {
            command_id: command.id,
            slug: body.slug,
          } as Json,
        });

        return response({ agent, command_id: command.id }, 202);
      },
    },
  },
});
