"""Capture a build's produced STRUCTURE straight from SQLite (headless-robust).

Reads ``personas`` (promoted) and falls back to ``build_sessions.agent_ir``
(draft). Normalises capabilities / connectors / credential-links / tool-tests
into a shape ``quality.py`` can assert against, independent of whether the
build promoted.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from lib import DB


def _loads(v: Any) -> Any:
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return None
    return v


def _norm_connector(c: Any) -> dict:
    """AgentIrConnector is Simple("notion") or Structured{name, service_type, ...}."""
    if isinstance(c, str):
        return {"name": c, "service_type": c, "has_credential": None}
    if isinstance(c, dict):
        name = c.get("name") or c.get("service_type")
        return {
            "name": name,
            "service_type": c.get("service_type") or name,
            "has_credential": c.get("has_credential"),
        }
    return {"name": None, "service_type": None, "has_credential": None}


def _norm_capability(uc: Any) -> dict:
    """DesignUseCase / AgentIrUseCase → {id, title, tool_hints, subscriptions, trigger}."""
    if isinstance(uc, str):
        return {"id": uc, "title": uc, "tool_hints": [], "subscriptions": [], "trigger": None}
    if not isinstance(uc, dict):
        return {"id": None, "title": None, "tool_hints": [], "subscriptions": [], "trigger": None}
    hints = uc.get("tool_hints") or uc.get("toolHints") or []
    subs = uc.get("event_subscriptions") or uc.get("eventSubscriptions") or []
    trig = uc.get("suggested_trigger") or uc.get("suggestedTrigger")
    return {
        "id": uc.get("id"),
        "title": uc.get("title") or uc.get("name"),
        "description": uc.get("description") or uc.get("summary"),
        "tool_hints": [h for h in hints if h],
        "subscriptions": subs,
        "trigger": trig,
    }


@dataclass
class CapturedBuild:
    source: str                      # "persona" | "build_session" | "missing"
    capabilities: list[dict] = field(default_factory=list)
    connectors: list[dict] = field(default_factory=list)
    credential_links: dict = field(default_factory=dict)
    tool_tests: Any = None
    setup_status: str | None = None
    persona_name: str | None = None
    raw_present: bool = False


def _connectors_from_ir(ir: dict) -> list[dict]:
    conns = ir.get("required_connectors") or ir.get("suggested_connectors") or []
    return [_norm_connector(c) for c in conns]


def capture_build(db: DB, *, session_id: str | None, persona_id: str | None) -> CapturedBuild:
    # 1) The promoted persona row (has credentialLinks + tool report).
    persona_cap: CapturedBuild | None = None
    if persona_id:
        rows = db.query("SELECT * FROM personas WHERE id = ? LIMIT 1", (persona_id,))
        if rows:
            p = rows[0]
            dc = _loads(p.get("design_context")) or {}
            ldr = _loads(p.get("last_design_result")) or {}
            ucs = dc.get("useCases") or dc.get("use_cases") or ldr.get("use_cases") or []
            persona_cap = CapturedBuild(
                source="persona",
                capabilities=[_norm_capability(u) for u in ucs],
                connectors=_connectors_from_ir(ldr),
                credential_links=dc.get("credentialLinks") or dc.get("credential_links") or {},
                tool_tests=_loads(p.get("last_test_report")),
                setup_status=p.get("setup_status"),
                persona_name=p.get("name"),
                raw_present=True,
            )
            # A fully promoted persona carries its capabilities — use it as-is.
            if persona_cap.capabilities:
                return persona_cap

    # 2) Fall back to the build session's raw IR. This covers both a never-promoted
    #    draft AND a promote-BLOCKED build (e.g. a connector tool-test failed the
    #    outcome gate) — the persona row exists but has 0 capabilities, yet the
    #    assembled agent_ir holds the full resolved design. Keep the persona's
    #    credentialLinks + tool report (real connector-resolution signal) when we
    #    have them; take capabilities + connectors from the IR.
    if session_id:
        rows = db.query("SELECT * FROM build_sessions WHERE id = ? LIMIT 1", (session_id,))
        if rows:
            ir = _loads(rows[0].get("agent_ir")) or {}
            ucs = ir.get("use_cases") or []
            if ucs or persona_cap is None:
                return CapturedBuild(
                    source="build_session" if persona_cap is None else "build_session+persona",
                    capabilities=[_norm_capability(u) for u in ucs],
                    connectors=_connectors_from_ir(ir),
                    credential_links=(persona_cap.credential_links if persona_cap else {}),
                    tool_tests=(persona_cap.tool_tests if persona_cap else None),
                    setup_status=(persona_cap.setup_status if persona_cap else None),
                    persona_name=(persona_cap.persona_name if persona_cap else None),
                    raw_present=bool(ir),
                )

    return persona_cap or CapturedBuild(source="missing")
