#!/usr/bin/env python3
"""Outbound-only bridge between Lovable/Supabase and local Hermes profiles.

The bridge polls the authenticated heartbeat endpoint for allow-listed commands,
executes only explicit operations, and reports status/runs/events back. It never
accepts inbound network traffic and never executes shell text supplied by the
panel.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import signal
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

LOG = logging.getLogger("hermes-control-bridge")
TERMINAL_RUN_STATES = {"completed", "failed", "cancelled"}
ALLOWED_COMMANDS = {
    "start",
    "stop",
    "restart",
    "run_task",
    "stop_run",
    "steer_run",
    "approve_run",
    "deny_run",
}
_SECRET_PATTERNS = [
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"(?i)(authorization|token|password|secret)(\s*[:=]\s*)([^\s,;]+)"),
    re.compile(r"\b[A-Za-z0-9_-]{40,}\b"),
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def redact(value: Any, limit: int = 8_000) -> str:
    text = str(value)
    for pattern in _SECRET_PATTERNS:
        if pattern.groups >= 3:
            text = pattern.sub(r"\1\2[REDACTED]", text)
        else:
            text = pattern.sub("[REDACTED]", text)
    return text[:limit]


def request_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    timeout: float = 30,
) -> dict[str, Any]:
    encoded = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    request_headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Hermes-Control-Bridge/1.0",
        **(headers or {}),
    }
    if encoded is not None:
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=encoded, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read(2_000_000)
    except urllib.error.HTTPError as exc:
        detail = redact(exc.read(16_000).decode("utf-8", "replace"))
        raise RuntimeError(f"HTTP {exc.code} from {url}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error for {url}: {redact(exc.reason)}") from exc
    if not payload:
        return {}
    parsed = json.loads(payload)
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Expected JSON object from {url}")
    return parsed


@dataclass(frozen=True)
class AgentConfig:
    slug: str
    profile: str
    service: str
    api_url: str
    api_key: str
    heartbeat_secret: str
    version: str = "0.20.6"

    @staticmethod
    def from_dict(raw: dict[str, Any]) -> "AgentConfig":
        required = ["slug", "profile", "service", "api_url", "api_key_env", "heartbeat_secret_env"]
        missing = [key for key in required if not raw.get(key)]
        if missing:
            raise ValueError(f"Agent config missing: {', '.join(missing)}")
        api_key = os.environ.get(str(raw["api_key_env"]), "")
        heartbeat_secret = os.environ.get(str(raw["heartbeat_secret_env"]), "")
        if len(api_key) < 32 or len(heartbeat_secret) < 32:
            raise ValueError(f"Agent {raw['slug']} has missing or weak secrets")
        slug = str(raw["slug"])
        service = str(raw["service"])
        api_url = str(raw["api_url"]).rstrip("/")
        parsed_api = urllib.parse.urlparse(api_url)
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,62}", slug):
            raise ValueError("Invalid agent slug")
        if not re.fullmatch(r"hermes-gateway(?:-[a-z0-9-]+)?\.service", service):
            raise ValueError(f"Agent {slug} has a disallowed service name")
        if parsed_api.scheme != "http" or parsed_api.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError(f"Agent {slug} API must use loopback HTTP")
        return AgentConfig(
            slug=slug,
            profile=str(raw["profile"]),
            service=service,
            api_url=api_url,
            api_key=api_key,
            heartbeat_secret=heartbeat_secret,
            version=str(raw.get("version", "0.20.6")),
        )


@dataclass(frozen=True)
class BridgeConfig:
    panel_url: str
    poll_seconds: float
    agents: tuple[AgentConfig, ...]

    @staticmethod
    def load(path: Path) -> "BridgeConfig":
        raw = json.loads(path.read_text())
        agents = tuple(AgentConfig.from_dict(item) for item in raw.get("agents", []))
        if not agents:
            raise ValueError("At least one agent is required")
        slugs = [agent.slug for agent in agents]
        if len(slugs) != len(set(slugs)):
            raise ValueError("Duplicate agent slug")
        panel_url = str(raw["panel_url"])
        parsed_panel = urllib.parse.urlparse(panel_url)
        if parsed_panel.scheme != "https" or not parsed_panel.hostname:
            raise ValueError("Panel URL must use HTTPS")
        return BridgeConfig(
            panel_url=panel_url,
            poll_seconds=max(2.0, float(raw.get("poll_seconds", 5))),
            agents=agents,
        )


class StateStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.connection:
            self.connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS processed_commands (
                  command_id TEXT PRIMARY KEY,
                  status TEXT NOT NULL,
                  result_json TEXT NOT NULL,
                  error TEXT NOT NULL,
                  started_at TEXT NOT NULL,
                  completed_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS active_runs (
                  run_id TEXT PRIMARY KEY,
                  slug TEXT NOT NULL,
                  command_id TEXT,
                  capability_id TEXT,
                  title TEXT NOT NULL,
                  session_id TEXT,
                  started_at TEXT NOT NULL,
                  last_status TEXT NOT NULL DEFAULT 'running'
                );
                CREATE TABLE IF NOT EXISTS dispatch_intents (
                  command_id TEXT PRIMARY KEY,
                  slug TEXT NOT NULL,
                  request_json TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  run_id TEXT
                );
                CREATE TABLE IF NOT EXISTS effect_intents (
                  command_id TEXT PRIMARY KEY,
                  slug TEXT NOT NULL,
                  command TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  result_json TEXT
                );
                CREATE TABLE IF NOT EXISTS terminal_outbox (
                  run_id TEXT PRIMARY KEY,
                  slug TEXT NOT NULL,
                  update_json TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS streamed_events (
                  run_id TEXT NOT NULL,
                  event_hash TEXT NOT NULL,
                  PRIMARY KEY (run_id, event_hash)
                );
                """
            )
            active_run_columns = {
                row[1] for row in self.connection.execute("PRAGMA table_info(active_runs)")
            }
            if "capability_id" not in active_run_columns:
                self.connection.execute("ALTER TABLE active_runs ADD COLUMN capability_id TEXT")

    def command_result(self, command_id: str) -> dict[str, Any] | None:
        with self.lock:
            row = self.connection.execute(
                "SELECT * FROM processed_commands WHERE command_id = ?", (command_id,)
            ).fetchone()
        if row is None:
            return None
        return {
            "id": command_id,
            "status": row["status"],
            "result": json.loads(row["result_json"]),
            "error": row["error"],
            "started_at": row["started_at"],
            "completed_at": row["completed_at"],
        }

    def save_command_result(self, result: dict[str, Any]) -> None:
        with self.lock, self.connection:
            self.connection.execute(
                """
                INSERT OR REPLACE INTO processed_commands
                  (command_id, status, result_json, error, started_at, completed_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    result["id"],
                    result["status"],
                    json.dumps(result.get("result", {}), separators=(",", ":")),
                    result.get("error", ""),
                    result["started_at"],
                    result["completed_at"],
                ),
            )

    def add_run(
        self, run_id: str, slug: str, command_id: str, capability_id: str | None,
        title: str, session_id: str | None
    ) -> None:
        with self.lock, self.connection:
            self.connection.execute(
                """
                INSERT OR REPLACE INTO active_runs
                  (run_id, slug, command_id, capability_id, title, session_id, started_at, last_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'running')
                """,
                (run_id, slug, command_id, capability_id, title, session_id, utc_now()),
            )

    def dispatch_intent(self, command_id: str) -> sqlite3.Row | None:
        with self.lock:
            return self.connection.execute(
                "SELECT * FROM dispatch_intents WHERE command_id = ?", (command_id,)
            ).fetchone()

    def prepare_dispatch(self, command_id: str, slug: str, request: dict[str, Any]) -> None:
        with self.lock, self.connection:
            self.connection.execute(
                """
                INSERT OR IGNORE INTO dispatch_intents
                  (command_id, slug, request_json, created_at, run_id)
                VALUES (?, ?, ?, ?, NULL)
                """,
                (
                    command_id,
                    slug,
                    json.dumps(request, separators=(",", ":")),
                    utc_now(),
                ),
            )

    def finish_dispatch(self, command_id: str, run_id: str) -> None:
        with self.lock, self.connection:
            self.connection.execute(
                "UPDATE dispatch_intents SET run_id = ? WHERE command_id = ?",
                (run_id, command_id),
            )

    def effect_intent(self, command_id: str) -> sqlite3.Row | None:
        with self.lock:
            return self.connection.execute(
                "SELECT * FROM effect_intents WHERE command_id = ?", (command_id,)
            ).fetchone()

    def prepare_effect(self, command_id: str, slug: str, command: str) -> None:
        with self.lock, self.connection:
            self.connection.execute(
                """
                INSERT OR IGNORE INTO effect_intents
                  (command_id, slug, command, created_at, result_json)
                VALUES (?, ?, ?, ?, NULL)
                """,
                (command_id, slug, command, utc_now()),
            )

    def finish_effect(self, command_id: str, result: dict[str, Any]) -> None:
        with self.lock, self.connection:
            self.connection.execute(
                "UPDATE effect_intents SET result_json = ? WHERE command_id = ?",
                (json.dumps(result, separators=(",", ":")), command_id),
            )

    def queue_terminal_update(self, slug: str, update: dict[str, Any]) -> None:
        run_id = str(update["external_run_id"])
        with self.lock, self.connection:
            self.connection.execute(
                """
                INSERT OR REPLACE INTO terminal_outbox (run_id, slug, update_json, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (run_id, slug, json.dumps(update, separators=(",", ":")), utc_now()),
            )
            self.connection.execute("DELETE FROM active_runs WHERE run_id = ?", (run_id,))

    def terminal_updates(self, slug: str) -> list[dict[str, Any]]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT update_json FROM terminal_outbox WHERE slug = ? ORDER BY created_at", (slug,)
            ).fetchall()
        return [json.loads(row["update_json"]) for row in rows]

    def acknowledge_terminal_updates(self, run_ids: list[str]) -> None:
        if not run_ids:
            return
        placeholders = ",".join("?" for _ in run_ids)
        with self.lock, self.connection:
            self.connection.execute(
                f"DELETE FROM terminal_outbox WHERE run_id IN ({placeholders})", run_ids
            )

    def runs_for(self, slug: str) -> list[sqlite3.Row]:
        with self.lock:
            return list(
                self.connection.execute(
                    "SELECT * FROM active_runs WHERE slug = ? ORDER BY started_at", (slug,)
                ).fetchall()
            )

    def set_run_status(self, run_id: str, status: str, terminal: bool) -> None:
        with self.lock, self.connection:
            if terminal:
                self.connection.execute("DELETE FROM active_runs WHERE run_id = ?", (run_id,))
            else:
                self.connection.execute(
                    "UPDATE active_runs SET last_status = ? WHERE run_id = ?", (status, run_id)
                )

    def remember_event(self, run_id: str, event: dict[str, Any]) -> bool:
        digest = self.event_digest(event)
        with self.lock, self.connection:
            cursor = self.connection.execute(
                "INSERT OR IGNORE INTO streamed_events (run_id, event_hash) VALUES (?, ?)",
                (run_id, digest),
            )
        return cursor.rowcount == 1

    @staticmethod
    def event_digest(event: dict[str, Any]) -> str:
        return hashlib.sha256(
            json.dumps(event, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

    def event_seen(self, run_id: str, event: dict[str, Any]) -> bool:
        digest = self.event_digest(event)
        with self.lock:
            row = self.connection.execute(
                "SELECT 1 FROM streamed_events WHERE run_id = ? AND event_hash = ?",
                (run_id, digest),
            ).fetchone()
        return row is not None


class HermesControlBridge:
    def __init__(self, config: BridgeConfig, state: StateStore):
        self.config = config
        self.state = state
        self.stop_event = threading.Event()
        self.stream_threads: dict[str, threading.Thread] = {}
        self.agent_by_slug = {agent.slug: agent for agent in config.agents}
        self.last_session_sync: dict[str, float] = {}
        self.observed_session_status: dict[tuple[str, str], str] = {}

    def service_active(self, agent: AgentConfig) -> bool:
        completed = subprocess.run(
            ["systemctl", "--user", "is-active", "--quiet", agent.service],
            check=False,
            timeout=15,
        )
        return completed.returncode == 0

    def service_action(self, agent: AgentConfig, action: str) -> dict[str, Any]:
        if action not in {"start", "stop", "restart"}:
            raise ValueError("Unsupported service action")
        completed = subprocess.run(
            ["systemctl", "--user", action, agent.service],
            capture_output=True,
            text=True,
            check=False,
            timeout=180,
        )
        if completed.returncode != 0:
            raise RuntimeError(redact(completed.stderr or completed.stdout or "systemctl failed"))
        return {"service": agent.service, "action": action, "active": self.service_active(agent)}

    def api(self, agent: AgentConfig, path: str, *, method: str = "GET", body=None, command_id=None):
        headers = {"Authorization": f"Bearer {agent.api_key}"}
        if command_id:
            headers["Idempotency-Key"] = command_id
        return request_json(
            f"{agent.api_url}{path}", method=method, headers=headers, body=body, timeout=45
        )

    def panel(self, agent: AgentConfig, payload: dict[str, Any]) -> dict[str, Any]:
        return request_json(
            self.config.panel_url,
            method="POST",
            headers={
                "X-Hermes-Agent": agent.slug,
                "X-Hermes-Secret": agent.heartbeat_secret,
            },
            body={"slug": agent.slug, "version": agent.version, **payload},
            timeout=45,
        )

    def durable_effect(
        self,
        agent: AgentConfig,
        command_id: str,
        command: str,
        action: Callable[[], dict[str, Any]],
    ) -> dict[str, Any]:
        intent = self.state.effect_intent(command_id)
        if intent is not None:
            if intent["slug"] != agent.slug or intent["command"] != command:
                raise RuntimeError("Side-effect intent does not match this agent and command")
            if intent["result_json"]:
                recovered = json.loads(intent["result_json"])
                if isinstance(recovered, dict):
                    return recovered
            raise RuntimeError(
                "Ação anterior ficou com resultado incerto; repetição automática bloqueada "
                "para evitar efeito colateral duplicado. Verifique o agente antes de reenfileirar."
            )

        self.state.prepare_effect(command_id, agent.slug, command)
        try:
            result = action()
        except Exception as exc:
            raise RuntimeError(
                "Resultado da ação incerto; repetição automática bloqueada para evitar "
                f"duplicidade: {redact(exc)}"
            ) from exc
        self.state.finish_effect(command_id, result)
        return result

    def execute_command(self, agent: AgentConfig, command: dict[str, Any]) -> dict[str, Any]:
        command_id = str(command.get("id", ""))
        if not re.fullmatch(r"[0-9a-fA-F-]{36}", command_id):
            raise ValueError("Invalid command id")
        cached = self.state.command_result(command_id)
        if cached:
            return cached

        started_at = utc_now()
        name = str(command.get("command", ""))
        raw_payload = command.get("payload")
        payload: dict[str, Any] = raw_payload if isinstance(raw_payload, dict) else {}
        result: dict[str, Any] = {}
        status = "succeeded"
        error = ""
        try:
            if name not in ALLOWED_COMMANDS:
                raise ValueError(f"Unsupported command: {name}")
            if name in {"start", "stop", "restart"}:
                result = self.durable_effect(
                    agent, command_id, name, lambda: self.service_action(agent, name)
                )
            elif name == "run_task":
                text = str(payload.get("input", "")).strip()
                if not text:
                    raise ValueError("run_task requires payload.input")
                session_id = str(payload.get("session_id", "")).strip() or None
                capability_id = str(payload.get("capability_id", "")).strip() or None
                if capability_id and not re.fullmatch(r"[0-9a-fA-F-]{36}", capability_id):
                    raise ValueError("run_task requires a valid payload.capability_id")
                title = str(payload.get("title", "")).strip()[:500] or text[:120]
                request_body: dict[str, Any] = {"input": text}
                if session_id:
                    request_body["session_id"] = session_id
                if payload.get("instructions"):
                    request_body["instructions"] = str(payload["instructions"])
                intent = self.state.dispatch_intent(command_id)
                if intent is not None and intent["slug"] != agent.slug:
                    raise RuntimeError("Dispatch intent belongs to another agent")
                if intent is not None and intent["run_id"]:
                    run_id = str(intent["run_id"])
                elif intent is not None:
                    raise RuntimeError(
                        "Dispatch anterior ficou com resultado incerto; reenvio automático "
                        "bloqueado para evitar execução duplicada. Enfileire uma nova tarefa "
                        "somente após verificar o agente."
                    )
                else:
                    self.state.prepare_dispatch(command_id, agent.slug, request_body)
                    try:
                        response = self.api(
                            agent,
                            "/v1/runs",
                            method="POST",
                            body=request_body,
                            command_id=command_id,
                        )
                    except Exception as exc:
                        raise RuntimeError(
                            "Resultado do despacho incerto; reenvio automático bloqueado para "
                            f"evitar duplicidade: {redact(exc)}"
                        ) from exc
                    run_id = str(response.get("run_id", ""))
                    if not run_id.startswith("run_"):
                        raise RuntimeError("Hermes did not return a valid run_id")
                    self.state.finish_dispatch(command_id, run_id)
                self.state.add_run(
                    run_id, agent.slug, command_id, capability_id, title, session_id
                )
                result = {"run_id": run_id, "session_id": session_id, "status": "started"}
                self.ensure_stream(agent, run_id)
            else:
                run_id = str(payload.get("run_id", "")).strip()
                if not run_id.startswith("run_"):
                    raise ValueError(f"{name} requires a valid payload.run_id")
                quoted = urllib.parse.quote(run_id, safe="")
                if name == "stop_run":
                    result = self.durable_effect(
                        agent,
                        command_id,
                        name,
                        lambda: self.api(
                            agent,
                            f"/v1/runs/{quoted}/stop",
                            method="POST",
                            body={},
                            command_id=command_id,
                        ),
                    )
                elif name == "steer_run":
                    text = str(payload.get("input", "")).strip()
                    if not text:
                        raise ValueError("steer_run requires payload.input")
                    result = self.durable_effect(
                        agent,
                        command_id,
                        name,
                        lambda: self.api(
                            agent,
                            f"/v1/runs/{quoted}/steer",
                            method="POST",
                            body={"input": text},
                            command_id=command_id,
                        ),
                    )
                else:
                    choice = "deny" if name == "deny_run" else str(payload.get("choice", "once"))
                    if choice not in {"once", "session", "deny"}:
                        raise ValueError("Invalid approval choice")
                    result = self.durable_effect(
                        agent,
                        command_id,
                        name,
                        lambda: self.api(
                            agent,
                            f"/v1/runs/{quoted}/approval",
                            method="POST",
                            body={"choice": choice},
                            command_id=command_id,
                        ),
                    )
        except Exception as exc:
            status = "failed"
            error = redact(exc)
            result = {}

        command_result = {
            "id": command_id,
            "status": status,
            "result": result,
            "error": error,
            "started_at": started_at,
            "completed_at": utc_now(),
        }
        self.state.save_command_result(command_result)
        return command_result

    def map_run_status(self, status: str) -> str:
        return {
            "completed": "success",
            "failed": "failed",
            "cancelled": "cancelled",
            "stopping": "stopping",
            "waiting_approval": "waiting_approval",
            "awaiting_approval": "waiting_approval",
            "waiting_for_approval": "waiting_approval",
        }.get(status, "running")

    def poll_runs(self, agent: AgentConfig) -> list[dict[str, Any]]:
        updates: list[dict[str, Any]] = []
        for row in self.state.runs_for(agent.slug):
            run_id = row["run_id"]
            try:
                status_payload = self.api(
                    agent, f"/v1/runs/{urllib.parse.quote(run_id, safe='')}"
                )
            except Exception as exc:
                if "HTTP 404" in str(exc):
                    update = {
                        "external_run_id": run_id,
                        "command_id": row["command_id"],
                        "capability_id": row["capability_id"],
                        "session_id": row["session_id"],
                        "title": row["title"],
                        "status": "failed",
                        "summary": "Execução não encontrada após reinício ou expiração do API Server.",
                        "started_at": row["started_at"],
                        "finished_at": utc_now(),
                        "metadata": {"reason": "run_not_found"},
                    }
                    self.state.queue_terminal_update(agent.slug, update)
                    updates.append(update)
                    continue
                LOG.warning("run poll failed slug=%s run=%s error=%s", agent.slug, run_id, redact(exc))
                continue
            raw_status = str(status_payload.get("status", "running"))
            mapped = self.map_run_status(raw_status)
            terminal = raw_status in TERMINAL_RUN_STATES
            output = status_payload.get("output") or status_payload.get("error") or ""
            update = {
                "external_run_id": run_id,
                "command_id": row["command_id"],
                "capability_id": row["capability_id"],
                "session_id": status_payload.get("session_id") or row["session_id"],
                "title": row["title"],
                "status": mapped,
                "summary": redact(output, 16_000),
                "started_at": row["started_at"],
                "finished_at": utc_now() if terminal else None,
                "metadata": {"last_event": status_payload.get("last_event", "")},
            }
            updates.append(update)
            if terminal:
                self.state.queue_terminal_update(agent.slug, update)
            else:
                self.state.set_run_status(run_id, mapped, False)
                self.ensure_stream(agent, run_id)
        return updates

    def event_to_panel(self, event: dict[str, Any]) -> tuple[str, str]:
        event_name = str(event.get("event", "run.event"))
        tool = event.get("tool") or event.get("name") or ""
        if event_name == "tool.started":
            return "info", f"Ferramenta iniciada: {tool}"
        if event_name == "tool.completed":
            return "info", f"Ferramenta concluída: {tool}"
        if event_name in {"approval.request", "approval.requested"}:
            return "warning", "Execução aguardando aprovação humana."
        if event_name in {"run.failed", "error"}:
            return "error", redact(event.get("error") or event_name)
        return "info", redact(event.get("message") or event_name)

    def stream_run(self, agent: AgentConfig, run_id: str) -> None:
        url = f"{agent.api_url}/v1/runs/{urllib.parse.quote(run_id, safe='')}/events"
        request = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {agent.api_key}",
                "Accept": "text/event-stream",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=310) as response:
                for raw_line in response:
                    if self.stop_event.is_set():
                        break
                    line = raw_line.decode("utf-8", "replace").strip()
                    if not line.startswith("data:"):
                        continue
                    try:
                        event = json.loads(line[5:].strip())
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(event, dict) or self.state.event_seen(run_id, event):
                        continue
                    event_digest = self.state.event_digest(event)
                    level, message = self.event_to_panel(event)
                    payload: dict[str, Any] = {
                        "status": "running" if self.service_active(agent) else "stopped",
                        "events": [
                            {
                                "event_id": f"run:{event_digest}",
                                "level": level,
                                "message": message,
                                "metadata": {
                                    "run_id": run_id,
                                    "event": event.get("event", "run.event"),
                                },
                            }
                        ],
                    }
                    if event.get("event") in {"approval.request", "approval.requested"}:
                        rows = [row for row in self.state.runs_for(agent.slug) if row["run_id"] == run_id]
                        if rows:
                            row = rows[0]
                            payload["run_updates"] = [
                                {
                                    "external_run_id": run_id,
                                    "command_id": row["command_id"],
                                    "capability_id": row["capability_id"],
                                    "session_id": row["session_id"],
                                    "title": row["title"],
                                    "status": "waiting_approval",
                                    "summary": "Aguardando decisão no painel.",
                                    "started_at": row["started_at"],
                                    "metadata": {
                                        "approval_choices": event.get("choices", []),
                                    },
                                }
                            ]
                    self.panel(agent, payload)
                    self.state.remember_event(run_id, event)
        except Exception as exc:
            LOG.info("event stream ended slug=%s run=%s detail=%s", agent.slug, run_id, redact(exc))
        finally:
            self.stream_threads.pop(run_id, None)

    def ensure_stream(self, agent: AgentConfig, run_id: str) -> None:
        current = self.stream_threads.get(run_id)
        if current and current.is_alive():
            return
        thread = threading.Thread(
            target=self.stream_run,
            args=(agent, run_id),
            name=f"run-events-{run_id[-8:]}",
            daemon=True,
        )
        self.stream_threads[run_id] = thread
        thread.start()

    def collect_run_updates(self, agent: AgentConfig, poll_active: bool) -> list[dict[str, Any]]:
        merged = {
            str(update["external_run_id"]): update
            for update in self.state.terminal_updates(agent.slug)
        }
        if poll_active:
            for update in self.poll_runs(agent):
                merged[str(update["external_run_id"])] = update
        return list(merged.values())

    @staticmethod
    def epoch_to_utc(value: Any) -> str | None:
        try:
            return datetime.fromtimestamp(float(value), timezone.utc).isoformat().replace(
                "+00:00", "Z"
            )
        except (TypeError, ValueError, OSError):
            return None

    def collect_session_updates(
        self, agent: AgentConfig
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Mirror real Hermes sessions, including Telegram work, into the panel."""
        now = time.monotonic()
        if now - self.last_session_sync.get(agent.slug, 0.0) < 15.0:
            return [], []
        self.last_session_sync[agent.slug] = now

        health = self.api(agent, "/health/detailed")
        sessions_payload = self.api(agent, "/api/sessions?limit=20")
        raw_sessions = sessions_payload.get("data", [])
        sessions = [item for item in raw_sessions if isinstance(item, dict)][:20]
        gateway_busy = bool(health.get("gateway_busy"))
        current_epoch = time.time()

        updates: list[dict[str, Any]] = []
        events: list[dict[str, Any]] = []
        for index, session in enumerate(sessions):
            session_id = str(session.get("id", "")).strip()
            if not session_id or len(session_id) > 180:
                continue
            last_active = session.get("last_active")
            try:
                age_seconds = max(0.0, current_epoch - float(last_active))
            except (TypeError, ValueError):
                age_seconds = 10_000.0
            is_active = (
                index == 0
                and gateway_busy
                and session.get("ended_at") is None
                and age_seconds < 300
            )
            status = "running" if is_active else "success"
            started_at = self.epoch_to_utc(session.get("started_at")) or utc_now()
            finished_at = None
            if not is_active:
                finished_at = self.epoch_to_utc(
                    session.get("ended_at") or session.get("last_active")
                ) or utc_now()
            duration_ms = None
            if finished_at:
                try:
                    start_dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                    end_dt = datetime.fromisoformat(finished_at.replace("Z", "+00:00"))
                    duration_ms = min(
                        2_147_483_647,
                        max(0, int((end_dt - start_dt).total_seconds() * 1000)),
                    )
                except ValueError:
                    duration_ms = None

            title = str(session.get("title") or "Sessão Hermes")[:500]
            message_count = int(session.get("message_count") or 0)
            tool_count = int(session.get("tool_call_count") or 0)
            source = str(session.get("source") or "unknown")[:80]
            external_run_id = f"session:{session_id}"
            updates.append(
                {
                    "external_run_id": external_run_id,
                    "command_id": None,
                    "capability_id": None,
                    "session_id": session_id,
                    "title": title,
                    "status": status,
                    "summary": f"{source} · {message_count} mensagens · {tool_count} ferramentas",
                    "started_at": started_at,
                    "finished_at": finished_at,
                    "duration_ms": duration_ms,
                    "metadata": {
                        "source": source,
                        "message_count": message_count,
                        "tool_call_count": tool_count,
                        "api_call_count": int(session.get("api_call_count") or 0),
                        "model": str(session.get("model") or "")[:120],
                        "observed_from": "hermes_sessions_api",
                    },
                }
            )

            status_key = (agent.slug, session_id)
            previous_status = self.observed_session_status.get(status_key)
            if previous_status != status:
                event_phase = "ativa" if status == "running" else "concluída"
                events.append(
                    {
                        "event_id": f"session:{session_id}:{status}",
                        "level": "info",
                        "message": f"Sessão {event_phase}: {title}",
                        "metadata": {
                            "session_id": session_id,
                            "source": source,
                            "status": status,
                        },
                    }
                )
                self.observed_session_status[status_key] = status
        return updates, events

    def acknowledge_run_updates(self, updates: list[dict[str, Any]]) -> None:
        terminal_ids = [
            str(update["external_run_id"])
            for update in updates
            if update.get("status") in {"success", "failed", "cancelled"}
        ]
        self.state.acknowledge_terminal_updates(terminal_ids)

    def cycle_agent(self, agent: AgentConfig) -> None:
        active = self.service_active(agent)
        run_updates = self.collect_run_updates(agent, active)
        session_updates, session_events = self.collect_session_updates(agent) if active else ([], [])
        merged_updates = {
            str(update["external_run_id"]): update
            for update in [*run_updates, *session_updates]
        }
        response = self.panel(
            agent,
            {
                "status": "running" if active else "stopped",
                "events": session_events,
                "run_updates": list(merged_updates.values()),
            },
        )
        self.acknowledge_run_updates(run_updates)
        for command in response.get("pending_commands", []):
            if not isinstance(command, dict):
                continue
            result = self.execute_command(agent, command)
            level = "error" if result["status"] == "failed" else "info"
            message = (
                f"Comando {command.get('command')} falhou: {result['error']}"
                if result["status"] == "failed"
                else f"Comando {command.get('command')} concluído."
            )
            command_run_updates = self.collect_run_updates(agent, self.service_active(agent))
            self.panel(
                agent,
                {
                    "status": "running" if self.service_active(agent) else "stopped",
                    "command_results": [result],
                    "events": [
                        {
                            "event_id": f"command:{result['id']}:{result['status']}",
                            "level": level,
                            "message": message,
                            "metadata": {"command_id": result["id"]},
                        }
                    ],
                    "run_updates": command_run_updates,
                },
            )
            self.acknowledge_run_updates(command_run_updates)

    def run(self, once: bool = False) -> None:
        while not self.stop_event.is_set():
            for agent in self.config.agents:
                try:
                    self.cycle_agent(agent)
                except Exception as exc:
                    LOG.error("cycle failed slug=%s error=%s", agent.slug, redact(exc))
            if once:
                return
            self.stop_event.wait(self.config.poll_seconds)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--state", type=Path, default=Path("/var/lib/hermes-control-bridge/state.db"))
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    config = BridgeConfig.load(args.config)
    bridge = HermesControlBridge(config, StateStore(args.state))

    def stop_handler(_signum, _frame):
        bridge.stop_event.set()

    signal.signal(signal.SIGTERM, stop_handler)
    signal.signal(signal.SIGINT, stop_handler)
    bridge.run(once=args.once)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
