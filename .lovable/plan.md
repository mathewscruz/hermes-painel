# Painel de Controle Hermes

Um centro de comando em tempo real para acompanhar e controlar seus agentes (N1 do GLPI/IAM, gestão de vulnerabilidades e os próximos que virão).

## O que será construído

### 1. Backend (Lovable Cloud)
Banco de dados com realtime ativado, guardando:

- **Agentes** — nome, descrição, tipo, status (rodando / parado / erro / reiniciando), versão, último heartbeat, configuração.
- **Capacidades/funções** — as funções principais que cada agente executa (ex: "triagem de chamado", "reset de senha", "provisionamento de acesso"), com contagem de execuções e taxa de sucesso.
- **Conexões** — integrações do agente (GLPI, AD/IAM, scanner de vulnerabilidades, etc.), com status de saúde e último teste.
- **Execuções** — cada tarefa que um agente rodou: início, fim, duração, resultado, resumo.
- **Eventos/logs** — stream de acontecimentos por agente, com nível (info/aviso/erro).
- **Comandos** — fila de start / stop / restart que o agente lê e confirma.

Acesso protegido por login (só usuários autenticados enxergam e controlam). Agentes externos escrevem status por um endpoint dedicado com chave própria.

### 2. Tempo real
As telas assinam mudanças no banco: status, execuções e logs aparecem sem recarregar a página. Indicador de "conectado ao vivo" e alerta quando um agente para de dar sinal.

### 3. Telas

- **Visão geral** — cards de cada agente com status ao vivo, execuções em andamento, saúde das conexões, contadores (agentes ativos, execuções hoje, erros na última hora) e um feed global de eventos.
- **Detalhe do agente** — funções principais com métricas, lista de conexões com teste de saúde, histórico de execuções, console de logs ao vivo, e os botões de iniciar / parar / reiniciar.
- **Mapa da estrutura** — diagrama mostrando agentes e os sistemas a que se conectam, com as linhas mudando de cor conforme a saúde.
- **Configuração do agente** — editar nome, descrição, parâmetros, funções e conexões; criar novo agente; remover agente (com confirmação).

### 4. Controles
Os botões gravam um comando na fila e o painel mostra o estado "pendente → confirmado" até o agente responder. Toda ação fica registrada em auditoria (quem fez, quando).

## Visual
Centro de comando escuro: fundo profundo, tipografia técnica, acentos em verde/âmbar/vermelho para status, densidade alta de informação sem poluição. Vou gerar direções de design e te mostrar antes de aplicar.

## Detalhes técnicos
- Tabelas Postgres no Lovable Cloud com RLS por usuário autenticado, GRANTs explícitos e Realtime habilitado nas tabelas de status/execução/log.
- Leituras via TanStack Query + subscriptions realtime; mutações (comandos, CRUD de agente) via server functions autenticadas.
- Endpoint de ingestão em `/api/public/hermes/heartbeat` protegido por chave secreta, para os agentes reportarem status e execuções.
- Dados de demonstração semeados na migração para o painel já nascer populado enquanto os agentes reais não estiverem publicando.

## Fora deste escopo (fica para depois)
- Alterar o código dos agentes Hermes em si — aqui entregamos o painel e o contrato de integração.
