# Hermes Control Bridge

Ponte de saída entre o painel Lovable/Supabase e perfis Hermes locais. O serviço não abre porta pública e não executa comandos de shell fornecidos pelo painel.

## Contrato

Comandos permitidos:

- `start`, `stop`, `restart`: operam somente os serviços systemd declarados no arquivo de configuração.
- `run_task`: inicia uma execução em `POST /v1/runs`.
- `stop_run`, `steer_run`: interrompem ou orientam uma execução pelo `run_id`.
- `approve_run`, `deny_run`: resolvem aprovações pendentes (`once`, `session` ou `deny`).

O bridge mantém SQLite local para idempotência de comandos, correlação de execuções, outbox de estados terminais e deduplicação dos eventos SSE. Toda ação com efeito colateral é registrada antes da execução e reconciliada antes de qualquer retry. Em uma queda no ponto exato do despacho, o reenvio automático é bloqueado e exige verificação/reenvio manual, priorizando não duplicar a execução.

## Instalação

1. Habilite o API Server de cada perfil em loopback, em portas diferentes, com chaves distintas.
2. Instale `hermes_control_bridge.py` em `~/.local/lib/hermes-control-bridge/`.
3. Copie `config.example.json` para `~/.config/hermes-control-bridge.json`.
4. Crie `~/.config/hermes-control-bridge.env` com permissões `0600`:

```dotenv
HERMES_MAIN_API_KEY=<chave-do-api-server-default>
HERMES_VULN_API_KEY=<chave-do-api-server-vulnerabilidades>
HERMES_MAIN_HEARTBEAT_SECRET=<segredo-por-agente>
HERMES_VULN_HEARTBEAT_SECRET=<segredo-por-agente>
```

5. No Lovable Cloud, configure `HERMES_AGENT_SECRETS` como JSON com os mesmos segredos de heartbeat, indexados pelos slugs:

```json
{
  "hermes-principal": "<HERMES_MAIN_HEARTBEAT_SECRET>",
  "hermes-vulnerabilidades": "<HERMES_VULN_HEARTBEAT_SECRET>"
}
```

6. Instale o unit file como serviço systemd do usuário e habilite-o.

Nunca coloque segredos no repositório, frontend ou `agents.config`.

## Teste

```bash
python3 bridge/hermes_control_bridge.py \
  --config ~/.config/hermes-control-bridge.json \
  --state /tmp/hermes-control-bridge-test.db \
  --once
```

O endpoint deve responder `ok`, atualizar os heartbeats e retornar somente comandos pendentes do slug autenticado.
