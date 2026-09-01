import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from hermes_control_bridge import (
    AgentConfig,
    BridgeConfig,
    HermesControlBridge,
    StateStore,
    redact,
)


class FakeBridge(HermesControlBridge):
    def __init__(self, config, state):
        super().__init__(config, state)
        self.api_calls = []
        self.service_calls = []

    def service_active(self, agent):
        return True

    def service_action(self, agent, action):
        self.service_calls.append((agent.slug, action))
        return {"action": action, "active": True}

    def api(self, agent, path, *, method="GET", body=None, command_id=None):
        self.api_calls.append((agent.slug, path, method, body, command_id))
        if path == "/v1/runs":
            return {"run_id": "run_123456", "status": "started"}
        return {"ok": True}

    def ensure_stream(self, agent, run_id):
        return None

    def collect_journal_events(self, agent):
        return [], None


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.agent = AgentConfig(
            slug="hermes-vulnerabilidades",
            profile="vulnerabilidades",
            service="hermes-gateway-vulnerabilidades.service",
            api_url="http://127.0.0.1:8643",
            api_key="a" * 48,
            heartbeat_secret="b" * 48,
        )
        self.config = BridgeConfig(
            panel_url="https://example.invalid/api/public/hermes/heartbeat",
            poll_seconds=5,
            agents=(self.agent,),
        )
        self.state = StateStore(Path(self.temp.name) / "state.db")
        self.bridge = FakeBridge(self.config, self.state)

    def command(self, name, payload=None):
        return {
            "id": "11111111-1111-4111-8111-111111111111",
            "command": name,
            "payload": payload or {},
        }

    def test_run_task_is_idempotent(self):
        command = self.command("run_task", {"input": "Audite o host", "title": "Auditoria"})
        first = self.bridge.execute_command(self.agent, command)
        second = self.bridge.execute_command(self.agent, command)
        self.assertEqual("succeeded", first["status"])
        self.assertEqual(first, second)
        self.assertEqual(1, len(self.bridge.api_calls))
        self.assertEqual("run_123456", first["result"]["run_id"])
        runs = self.state.runs_for(self.agent.slug)
        self.assertEqual(1, len(runs))
        self.assertEqual("Auditoria", runs[0]["title"])
        self.assertEqual("run_123456", self.state.dispatch_intent(command["id"])["run_id"])

    def test_uncertain_dispatch_is_not_retried(self):
        command = self.command("run_task", {"input": "Audite o host"})
        self.state.prepare_dispatch(command["id"], self.agent.slug, {"input": "Audite o host"})
        result = self.bridge.execute_command(self.agent, command)
        self.assertEqual("failed", result["status"])
        self.assertIn("reenvio automático", result["error"])
        self.assertEqual([], self.bridge.api_calls)

    def test_dispatch_with_persisted_run_id_is_recovered(self):
        command = self.command("run_task", {"input": "Audite o host", "title": "Recuperada"})
        self.state.prepare_dispatch(command["id"], self.agent.slug, {"input": "Audite o host"})
        self.state.finish_dispatch(command["id"], "run_recovered")
        result = self.bridge.execute_command(self.agent, command)
        self.assertEqual("succeeded", result["status"])
        self.assertEqual("run_recovered", result["result"]["run_id"])
        self.assertEqual([], self.bridge.api_calls)
        self.assertEqual(1, len(self.state.runs_for(self.agent.slug)))

    def test_service_actions_are_allowlisted(self):
        result = self.bridge.execute_command(self.agent, self.command("restart"))
        self.assertEqual("succeeded", result["status"])
        self.assertEqual([(self.agent.slug, "restart")], self.bridge.service_calls)

    def test_provision_command_uses_typed_handler(self):
        payload = {
            "target_agent_id": "22222222-2222-4222-8222-222222222222",
            "slug": "novo-agente",
            "name": "Novo Agente",
        }
        called = []
        self.bridge.provision_agent = lambda agent, body: called.append((agent.slug, body)) or {
            "slug": body["slug"],
            "active": True,
        }
        result = self.bridge.execute_command(self.agent, self.command("provision_agent", payload))
        self.assertEqual("succeeded", result["status"])
        self.assertEqual("novo-agente", result["result"]["slug"])
        self.assertEqual([(self.agent.slug, payload)], called)

    def test_only_principal_can_provision(self):
        with self.assertRaisesRegex(ValueError, "Only hermes-principal"):
            self.bridge.provision_agent(
                self.agent,
                {
                    "target_agent_id": "22222222-2222-4222-8222-222222222222",
                    "slug": "novo-agente",
                    "name": "Novo Agente",
                },
            )

    def test_uncertain_side_effect_is_not_repeated(self):
        command = self.command("restart")
        self.state.prepare_effect(command["id"], self.agent.slug, "restart")
        result = self.bridge.execute_command(self.agent, command)
        self.assertEqual("failed", result["status"])
        self.assertIn("repetição automática bloqueada", result["error"])
        self.assertEqual([], self.bridge.service_calls)

    def test_completed_side_effect_is_recovered_without_repeating(self):
        command = self.command("restart")
        recovered = {"action": "restart", "active": True}
        self.state.prepare_effect(command["id"], self.agent.slug, "restart")
        self.state.finish_effect(command["id"], recovered)
        result = self.bridge.execute_command(self.agent, command)
        self.assertEqual("succeeded", result["status"])
        self.assertEqual(recovered, result["result"])
        self.assertEqual([], self.bridge.service_calls)

    def test_unsupported_command_fails_without_execution(self):
        result = self.bridge.execute_command(self.agent, self.command("shell", {"cmd": "id"}))
        self.assertEqual("failed", result["status"])
        self.assertIn("Unsupported command", result["error"])
        self.assertEqual([], self.bridge.api_calls)
        self.assertEqual([], self.bridge.service_calls)

    def test_control_run_requires_run_id(self):
        result = self.bridge.execute_command(self.agent, self.command("stop_run"))
        self.assertEqual("failed", result["status"])
        self.assertIn("payload.run_id", result["error"])

    def test_status_mapping(self):
        self.assertEqual("success", self.bridge.map_run_status("completed"))
        self.assertEqual("waiting_approval", self.bridge.map_run_status("awaiting_approval"))
        self.assertEqual("waiting_approval", self.bridge.map_run_status("waiting_for_approval"))
        self.assertEqual("running", self.bridge.map_run_status("queued"))

    def test_real_approval_event_name(self):
        level, message = self.bridge.event_to_panel({"event": "approval.request"})
        self.assertEqual("warning", level)
        self.assertIn("aprovação", message)

    def test_event_is_remembered_only_once(self):
        event = {"event": "tool.completed", "tool": "web_search"}
        self.assertFalse(self.state.event_seen("run_1", event))
        self.assertTrue(self.state.remember_event("run_1", event))
        self.assertTrue(self.state.event_seen("run_1", event))
        self.assertFalse(self.state.remember_event("run_1", event))

    def test_journal_events_are_incremental_and_redacted(self):
        cursor = "s=journal-cursor-1"
        line = json.dumps(
            {
                "__CURSOR": cursor,
                "PRIORITY": "4",
                "MESSAGE": "gateway warning token=super-secret-value",
            }
        )
        with patch(
            "hermes_control_bridge.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout=line + "\n", stderr=""),
        ):
            events, latest = HermesControlBridge.collect_journal_events(self.bridge, self.agent)
        self.assertEqual(cursor, latest)
        self.assertEqual("warning", events[0]["level"])
        self.assertIn("[REDACTED]", events[0]["message"])
        self.assertNotIn("super-secret-value", events[0]["message"])
        self.state.save_journal_cursor(self.agent.slug, latest)
        self.assertEqual(cursor, self.state.journal_cursor(self.agent.slug))

    def test_missing_run_is_closed_after_gateway_restart(self):
        self.state.add_run(
            "run_missing",
            self.agent.slug,
            self.command("run_task")["id"],
            None,
            "Tarefa",
            None,
        )

        def missing(*_args, **_kwargs):
            raise RuntimeError("HTTP 404 from local API")

        self.bridge.api = missing
        updates = self.bridge.poll_runs(self.agent)
        self.assertEqual("failed", updates[0]["status"])
        self.assertEqual("run_not_found", updates[0]["metadata"]["reason"])
        self.assertEqual([], self.state.runs_for(self.agent.slug))
        self.assertEqual(1, len(self.state.terminal_updates(self.agent.slug)))

    def test_terminal_update_remains_until_panel_confirms(self):
        update = {
            "external_run_id": "run_terminal",
            "command_id": None,
            "session_id": None,
            "title": "Tarefa",
            "status": "success",
            "summary": "Concluída",
            "started_at": "2026-09-01T00:00:00+00:00",
            "finished_at": "2026-09-01T00:01:00+00:00",
            "metadata": {},
        }
        self.state.queue_terminal_update(self.agent.slug, update)

        def panel_failure(*_args, **_kwargs):
            raise RuntimeError("panel unavailable")

        self.bridge.panel = panel_failure
        with self.assertRaisesRegex(RuntimeError, "panel unavailable"):
            self.bridge.cycle_agent(self.agent)
        self.assertEqual(1, len(self.state.terminal_updates(self.agent.slug)))

        self.bridge.panel = lambda *_args, **_kwargs: {"pending_commands": []}
        self.bridge.cycle_agent(self.agent)
        self.assertEqual([], self.state.terminal_updates(self.agent.slug))

    def test_redaction(self):
        text = redact("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789AB")
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz", text)
        self.assertIn("[REDACTED]", text)

    def test_config_requires_strong_secrets(self):
        path = Path(self.temp.name) / "config.json"
        path.write_text(
            json.dumps(
                {
                    "panel_url": "https://example.invalid/heartbeat",
                    "agents": [
                        {
                            "slug": "x",
                            "profile": "default",
                            "service": "hermes-gateway.service",
                            "api_url": "http://127.0.0.1:8642",
                            "api_key_env": "TEST_API_KEY",
                            "heartbeat_secret_env": "TEST_HEARTBEAT",
                        }
                    ],
                }
            )
        )
        with patch.dict(os.environ, {"TEST_API_KEY": "short", "TEST_HEARTBEAT": "short"}):
            with self.assertRaisesRegex(ValueError, "missing or weak"):
                BridgeConfig.load(path)

    def test_config_rejects_remote_agent_api(self):
        raw = {
            "panel_url": "https://panel.example",
            "agents": [
                {
                    "slug": "hermes-test",
                    "profile": "test",
                    "service": "hermes-gateway-test.service",
                    "api_url": "https://attacker.example",
                    "api_key_env": "TEST_API_KEY",
                    "heartbeat_secret_env": "TEST_HEARTBEAT",
                }
            ],
        }
        path = Path(self.temp.name) / "remote.json"
        path.write_text(json.dumps(raw))
        with patch.dict(os.environ, {"TEST_API_KEY": "a" * 40, "TEST_HEARTBEAT": "b" * 40}):
            with self.assertRaisesRegex(ValueError, "loopback"):
                BridgeConfig.load(path)


if __name__ == "__main__":
    unittest.main()
