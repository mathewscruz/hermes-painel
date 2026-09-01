import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";

const requestSchema = z.object({
  agent_id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  secret_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  profile: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  service: z.string().regex(/^hermes-gateway-[a-z0-9_-]+\.service$/),
  api_port: z.number().int().min(1024).max(65_535),
  version: z.string().min(1).max(100),
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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/public/hermes/register-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const claimedSlug = request.headers.get("x-hermes-agent") ?? "";
        const provided = request.headers.get("x-hermes-secret") ?? "";
        if (claimedSlug !== "hermes-principal" || provided.length < 32) {
          return response({ error: "unauthorized" }, 401);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let expected: string | undefined;
        const scoped = process.env["HERMES_AGENT_SECRETS"];
        if (scoped) {
          try {
            const parsed = JSON.parse(scoped) as Record<string, unknown>;
            if (typeof parsed[claimedSlug] === "string") expected = parsed[claimedSlug] as string;
          } catch {
            expected = undefined;
          }
        }
        let authenticated = Boolean(expected && constantTimeEqual(provided, expected));
        if (!authenticated) {
          const { data: credential } = await supabaseAdmin
            .from("agent_bridge_credentials")
            .select("secret_sha256")
            .eq("agent_slug", claimedSlug)
            .eq("is_active", true)
            .maybeSingle();
          if (credential?.secret_sha256) {
            authenticated = constantTimeEqual(await sha256Hex(provided), credential.secret_sha256);
          }
        }
        if (!authenticated) return response({ error: "unauthorized" }, 401);

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return response({ error: "invalid json" }, 400);
        }
        const parsed = requestSchema.safeParse(raw);
        if (!parsed.success) return response({ error: "invalid registration payload" }, 400);
        const body = parsed.data;

        const { data: agent, error: agentError } = await supabaseAdmin
          .from("agents")
          .select("id,slug,config")
          .eq("id", body.agent_id)
          .eq("slug", body.slug)
          .maybeSingle();
        if (agentError) return response({ error: "agent lookup failed" }, 500);
        if (!agent) return response({ error: "agent not found" }, 404);

        const { data: existing, error: credentialLookupError } = await supabaseAdmin
          .from("agent_bridge_credentials")
          .select("id")
          .eq("agent_slug", body.slug)
          .maybeSingle();
        if (credentialLookupError) return response({ error: "credential lookup failed" }, 500);

        const credentialRecord = {
          agent_slug: body.slug,
          secret_sha256: body.secret_sha256,
          is_active: true,
          updated_at: new Date().toISOString(),
        };
        const credentialWrite = existing
          ? await supabaseAdmin
              .from("agent_bridge_credentials")
              .update(credentialRecord)
              .eq("id", existing.id)
          : await supabaseAdmin.from("agent_bridge_credentials").insert(credentialRecord);
        if (credentialWrite.error) return response({ error: "credential registration failed" }, 500);

        const currentConfig =
          agent.config && typeof agent.config === "object" && !Array.isArray(agent.config)
            ? (agent.config as Record<string, unknown>)
            : {};
        const { error: updateError } = await supabaseAdmin
          .from("agents")
          .update({
            version: body.version,
            config: {
              ...currentConfig,
              provisioning: {
                status: "registered",
                registered_at: new Date().toISOString(),
                profile: body.profile,
                service: body.service,
                api_port: body.api_port,
              },
            } as Json,
          })
          .eq("id", body.agent_id);
        if (updateError) return response({ error: "agent registration failed" }, 500);

        const eventId = `provisioned:${body.slug}`;
        const { data: existingEvent } = await supabaseAdmin
          .from("agent_events")
          .select("id")
          .eq("agent_id", body.agent_id)
          .eq("external_event_id", eventId)
          .maybeSingle();
        if (!existingEvent) {
          await supabaseAdmin.from("agent_events").insert({
            agent_id: body.agent_id,
            external_event_id: eventId,
            level: "info",
            message: `Agente ${body.slug} provisionado na infraestrutura Hermes.`,
            metadata: {
              profile: body.profile,
              service: body.service,
              api_port: body.api_port,
            } as Json,
          });
        }

        return response({ ok: true, agent_id: body.agent_id, slug: body.slug });
      },
    },
  },
});
