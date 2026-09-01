CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'automation',
  status text NOT NULL DEFAULT 'stopped',
  version text NOT NULL DEFAULT '0.1.0',
  last_heartbeat_at timestamptz,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agent_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  executions_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agent_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  name text NOT NULL,
  target text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'api',
  health text NOT NULL DEFAULT 'unknown',
  last_checked_at timestamptz,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  capability_id uuid REFERENCES public.agent_capabilities(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  summary text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer
);

CREATE TABLE public.agent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agent_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  command text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor uuid,
  actor_email text NOT NULL DEFAULT '',
  action text NOT NULL,
  target text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_runs_agent_started ON public.agent_runs (agent_id, started_at DESC);
CREATE INDEX idx_events_agent_created ON public.agent_events (agent_id, created_at DESC);
CREATE INDEX idx_commands_agent_created ON public.agent_commands (agent_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agents TO authenticated;
GRANT ALL ON public.agents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_capabilities TO authenticated;
GRANT ALL ON public.agent_capabilities TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_connections TO authenticated;
GRANT ALL ON public.agent_connections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_runs TO authenticated;
GRANT ALL ON public.agent_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_events TO authenticated;
GRANT ALL ON public.agent_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_commands TO authenticated;
GRANT ALL ON public.agent_commands TO service_role;
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth manage agents" ON public.agents FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth manage capabilities" ON public.agent_capabilities FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth manage connections" ON public.agent_connections FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth manage runs" ON public.agent_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth manage events" ON public.agent_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth manage commands" ON public.agent_commands FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth read audit" ON public.audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write audit" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON public.agents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.agents REPLICA IDENTITY FULL;
ALTER TABLE public.agent_runs REPLICA IDENTITY FULL;
ALTER TABLE public.agent_events REPLICA IDENTITY FULL;
ALTER TABLE public.agent_connections REPLICA IDENTITY FULL;
ALTER TABLE public.agent_commands REPLICA IDENTITY FULL;
ALTER TABLE public.agent_capabilities REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.agents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_connections;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_commands;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_capabilities;

INSERT INTO public.agents (id, name, slug, description, kind, status, version, last_heartbeat_at, config) VALUES
('11111111-1111-1111-1111-111111111111', 'Hermes N1 GLPI', 'hermes-n1-glpi', 'Atendimento de nivel 1 dos chamados do GLPI e execucao das rotinas de IAM.', 'service-desk', 'running', '1.4.2', now() - interval '12 seconds', '{"intervalo_poll_seg": 30, "max_chamados_por_ciclo": 15, "modo": "producao"}'::jsonb),
('22222222-2222-2222-2222-222222222222', 'Hermes VulnMgmt', 'hermes-vulnmgmt', 'Gestao de vulnerabilidades: coleta, prioriza e abre chamados de remediacao.', 'security', 'stopped', '0.3.0-beta', now() - interval '9 minutes', '{"severidade_minima": "high", "janela_scan_horas": 24, "modo": "homologacao"}'::jsonb),
('33333333-3333-3333-3333-333333333333', 'Hermes IAM Sync', 'hermes-iam-sync', 'Sincroniza usuarios, grupos e permissoes entre AD, GLPI e sistemas internos.', 'iam', 'error', '1.0.7', now() - interval '2 minutes', '{"intervalo_sync_min": 15, "dominio": "corp.local"}'::jsonb);

INSERT INTO public.agent_capabilities (id, agent_id, name, description, enabled, executions_count, success_count) VALUES
('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Triagem de chamados', 'Classifica e categoriza chamados novos do GLPI.', true, 1842, 1791),
('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Reset de senha', 'Executa reset de senha apos validacao do solicitante.', true, 634, 628),
('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Resposta automatica N1', 'Responde duvidas recorrentes com base na base de conhecimento.', true, 977, 902),
('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Coleta de vulnerabilidades', 'Importa achados do scanner e normaliza CVEs.', true, 58, 55),
('a2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Priorizacao por risco', 'Calcula criticidade combinando CVSS e exposicao do ativo.', true, 51, 49),
('a2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Abertura de remediacao', 'Cria chamado de correcao no GLPI para o time responsavel.', false, 12, 10),
('a3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Provisionamento de acesso', 'Cria contas e aplica grupos conforme a matriz de acesso.', true, 421, 398),
('a3000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'Desligamento', 'Revoga acessos de colaboradores desligados.', true, 96, 96);

INSERT INTO public.agent_connections (agent_id, name, target, kind, health, last_checked_at) VALUES
('11111111-1111-1111-1111-111111111111', 'GLPI API', 'https://glpi.corp.local/apirest.php', 'api', 'healthy', now() - interval '40 seconds'),
('11111111-1111-1111-1111-111111111111', 'Active Directory', 'ldaps://dc01.corp.local', 'ldap', 'healthy', now() - interval '1 minute'),
('11111111-1111-1111-1111-111111111111', 'Base de conhecimento', 'https://kb.corp.local', 'api', 'degraded', now() - interval '3 minutes'),
('22222222-2222-2222-2222-222222222222', 'Scanner de vulnerabilidades', 'https://scanner.corp.local/api', 'api', 'healthy', now() - interval '5 minutes'),
('22222222-2222-2222-2222-222222222222', 'CMDB', 'https://cmdb.corp.local/api', 'api', 'unknown', now() - interval '2 hours'),
('33333333-3333-3333-3333-333333333333', 'Active Directory', 'ldaps://dc01.corp.local', 'ldap', 'down', now() - interval '2 minutes'),
('33333333-3333-3333-3333-333333333333', 'GLPI API', 'https://glpi.corp.local/apirest.php', 'api', 'healthy', now() - interval '90 seconds');

INSERT INTO public.agent_runs (agent_id, capability_id, title, status, summary, started_at, finished_at, duration_ms) VALUES
('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Triagem do chamado #48211', 'running', 'Classificando chamado recebido.', now() - interval '20 seconds', NULL, NULL),
('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 'Reset de senha - m.silva', 'success', 'Senha redefinida e notificacao enviada.', now() - interval '4 minutes', now() - interval '4 minutes' + interval '9 seconds', 9000),
('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000003', 'Resposta ao chamado #48207', 'success', 'Resposta enviada com artigo KB-134.', now() - interval '11 minutes', now() - interval '11 minutes' + interval '5 seconds', 5200),
('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Triagem do chamado #48199', 'failed', 'Timeout ao consultar a base de conhecimento.', now() - interval '26 minutes', now() - interval '26 minutes' + interval '31 seconds', 31400),
('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001', 'Coleta diaria de achados', 'success', '1.284 achados importados, 212 novos.', now() - interval '3 hours', now() - interval '3 hours' + interval '7 minutes', 420000),
('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000002', 'Priorizacao do lote 2026-09', 'success', '47 vulnerabilidades criticas priorizadas.', now() - interval '2 hours', now() - interval '2 hours' + interval '2 minutes', 118000),
('33333333-3333-3333-3333-333333333333', 'a3000000-0000-0000-0000-000000000001', 'Provisionamento - j.pereira', 'failed', 'Falha de conexao com o Active Directory.', now() - interval '2 minutes', now() - interval '90 seconds', 30000),
('33333333-3333-3333-3333-333333333333', 'a3000000-0000-0000-0000-000000000002', 'Desligamento - r.costa', 'success', 'Acessos revogados em 4 sistemas.', now() - interval '55 minutes', now() - interval '55 minutes' + interval '22 seconds', 22300);

INSERT INTO public.agent_events (agent_id, level, message, created_at) VALUES
('11111111-1111-1111-1111-111111111111', 'info', 'Ciclo de poll iniciado (15 chamados na fila).', now() - interval '15 seconds'),
('11111111-1111-1111-1111-111111111111', 'info', 'Chamado #48211 classificado como Acesso/Senha.', now() - interval '40 seconds'),
('11111111-1111-1111-1111-111111111111', 'warning', 'Base de conhecimento respondendo lentamente (2.4s).', now() - interval '3 minutes'),
('11111111-1111-1111-1111-111111111111', 'info', 'Reset de senha concluido para m.silva.', now() - interval '4 minutes'),
('22222222-2222-2222-2222-222222222222', 'info', 'Agente parado manualmente para ajuste de regras.', now() - interval '9 minutes'),
('22222222-2222-2222-2222-222222222222', 'info', 'Lote de priorizacao concluido: 47 criticas.', now() - interval '2 hours'),
('33333333-3333-3333-3333-333333333333', 'error', 'Falha de bind LDAP em dc01.corp.local: connection refused.', now() - interval '2 minutes'),
('33333333-3333-3333-3333-333333333333', 'error', 'Provisionamento de j.pereira abortado apos 3 tentativas.', now() - interval '90 seconds'),
('33333333-3333-3333-3333-333333333333', 'info', 'Sincronizacao de grupos concluida (312 objetos).', now() - interval '35 minutes');

INSERT INTO public.agent_commands (agent_id, command, status, note, created_at, acknowledged_at) VALUES
('22222222-2222-2222-2222-222222222222', 'stop', 'acknowledged', 'Parada para ajuste de regras de severidade.', now() - interval '9 minutes', now() - interval '9 minutes' + interval '3 seconds'),
('33333333-3333-3333-3333-333333333333', 'restart', 'pending', 'Tentativa de recuperar conexao com o AD.', now() - interval '1 minute', NULL);