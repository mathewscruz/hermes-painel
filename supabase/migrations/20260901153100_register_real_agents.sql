-- Replace only the fixed demo records from the initial seed with the two real profiles.

UPDATE public.agents
SET
  name = 'Órigo Agente Principal',
  slug = 'hermes-principal',
  description = 'Orquestrador principal da Órigo para GLPI, gestão de acessos, IAM e rotinas operacionais autorizadas.',
  kind = 'orchestrator',
  status = 'stopped',
  version = '0.20.6',
  last_heartbeat_at = NULL,
  config = '{"profile":"default","control_plane":"lovable","mode":"production"}'::jsonb
WHERE id = '11111111-1111-1111-1111-111111111111'
  AND slug = 'hermes-n1-glpi';

UPDATE public.agents
SET
  name = 'Órigo GEVUL',
  slug = 'hermes-vulnerabilidades',
  description = 'Agente isolado para gestão de vulnerabilidades, exposição, priorização de risco e acompanhamento de remediações.',
  kind = 'security',
  status = 'stopped',
  version = '0.20.6',
  last_heartbeat_at = NULL,
  config = '{"profile":"vulnerabilidades","control_plane":"lovable","mode":"production"}'::jsonb
WHERE id = '22222222-2222-2222-2222-222222222222'
  AND slug = 'hermes-vulnmgmt';

-- Remove only rows whose values exactly match the original demo seed.
DELETE FROM public.agent_runs
WHERE (agent_id = '11111111-1111-1111-1111-111111111111' AND title IN (
  'Triagem do chamado #48211',
  'Reset de senha - m.silva',
  'Resposta ao chamado #48207',
  'Triagem do chamado #48199'
)) OR (agent_id = '22222222-2222-2222-2222-222222222222' AND title IN (
  'Coleta diaria de achados',
  'Priorizacao do lote 2026-09'
)) OR (agent_id = '33333333-3333-3333-3333-333333333333' AND title IN (
  'Provisionamento - j.pereira',
  'Desligamento - r.costa'
));

DELETE FROM public.agent_events
WHERE (agent_id = '11111111-1111-1111-1111-111111111111' AND message IN (
  'Ciclo de poll iniciado (15 chamados na fila).',
  'Chamado #48211 classificado como Acesso/Senha.',
  'Base de conhecimento respondendo lentamente (2.4s).',
  'Reset de senha concluido para m.silva.'
)) OR (agent_id = '22222222-2222-2222-2222-222222222222' AND message IN (
  'Agente parado manualmente para ajuste de regras.',
  'Lote de priorizacao concluido: 47 criticas.'
)) OR (agent_id = '33333333-3333-3333-3333-333333333333' AND message IN (
  'Falha de bind LDAP em dc01.corp.local: connection refused.',
  'Provisionamento de j.pereira abortado apos 3 tentativas.',
  'Sincronizacao de grupos concluida (312 objetos).'
));

DELETE FROM public.agent_commands
WHERE agent_id = '22222222-2222-2222-2222-222222222222'
  AND command = 'stop'
  AND note = 'Parada para ajuste de regras de severidade.';

DELETE FROM public.agent_commands
WHERE agent_id = '33333333-3333-3333-3333-333333333333'
  AND command = 'restart'
  AND note = 'Tentativa de recuperar conexao com o AD.';

DELETE FROM public.agent_capabilities
WHERE id IN (
  'a1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000003',
  'a2000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000002',
  'a2000000-0000-0000-0000-000000000003',
  'a3000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000002'
);

INSERT INTO public.agent_capabilities (agent_id, name, description, enabled)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Orquestração operacional', 'Coordena tarefas, valida resultados e encaminha ações aos domínios responsáveis.', true),
  ('11111111-1111-1111-1111-111111111111', 'GLPI e gestão de acessos', 'Opera fluxos autorizados de atendimento, GLPI e IAM com validação posterior.', true),
  ('11111111-1111-1111-1111-111111111111', 'Integrações corporativas', 'Consulta e opera integrações cadastradas conforme escopo e credenciais mínimas.', true),
  ('22222222-2222-2222-2222-222222222222', 'Gestão de vulnerabilidades', 'Normaliza, correlaciona e prioriza achados técnicos.', true),
  ('22222222-2222-2222-2222-222222222222', 'Investigação e evidências', 'Coleta evidências verificáveis e diferencia observação, hipótese e recomendação.', true),
  ('22222222-2222-2222-2222-222222222222', 'Acompanhamento de remediação', 'Planeja e acompanha correções sem alterar GLPI/IAM automaticamente.', true);

DELETE FROM public.agent_connections
WHERE (agent_id = '11111111-1111-1111-1111-111111111111' AND target IN (
  'https://glpi.corp.local/apirest.php',
  'ldaps://dc01.corp.local',
  'https://kb.corp.local'
)) OR (agent_id = '22222222-2222-2222-2222-222222222222' AND target IN (
  'https://scanner.corp.local/api',
  'https://cmdb.corp.local/api'
)) OR (agent_id = '33333333-3333-3333-3333-333333333333' AND target IN (
  'ldaps://dc01.corp.local',
  'https://glpi.corp.local/apirest.php'
));

-- Delete the unused demo agent only when no non-seed child record remains.
DELETE FROM public.agents AS agent
WHERE agent.id = '33333333-3333-3333-3333-333333333333'
  AND agent.slug = 'hermes-iam-sync'
  AND agent.name = 'Hermes IAM Sync'
  AND agent.version = '1.0.7'
  AND NOT EXISTS (SELECT 1 FROM public.agent_runs WHERE agent_id = agent.id)
  AND NOT EXISTS (SELECT 1 FROM public.agent_events WHERE agent_id = agent.id)
  AND NOT EXISTS (SELECT 1 FROM public.agent_commands WHERE agent_id = agent.id)
  AND NOT EXISTS (SELECT 1 FROM public.agent_capabilities WHERE agent_id = agent.id)
  AND NOT EXISTS (SELECT 1 FROM public.agent_connections WHERE agent_id = agent.id);

INSERT INTO public.agent_connections (agent_id, name, target, kind, health)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Hermes API Server', '127.0.0.1:8642', 'local-api', 'unknown'),
  ('11111111-1111-1111-1111-111111111111', 'Telegram principal', 'gateway:telegram', 'messaging', 'unknown'),
  ('22222222-2222-2222-2222-222222222222', 'Hermes API Server', '127.0.0.1:8643', 'local-api', 'unknown'),
  ('22222222-2222-2222-2222-222222222222', 'Telegram GEVUL', 'gateway:telegram', 'messaging', 'unknown');
