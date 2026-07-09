"""Correctness (hard assertions) + a judge bundle for the LLM quality pass.

Two layers, deliberately separate:

* ``evaluate_assertions`` — deterministic PASS/FAIL/WARN checks derived from the
  fixture's ``expected`` block. These GATE correctness. Vault-dependent checks
  (credential links, live tool-tests) are ``warn`` severity so a missing vault
  credential is recorded, not scored as a build regression.
* ``judge_bundle`` — emits a markdown bundle per run for a Claude-Code-as-judge
  pass (athena convention: no API key; the operator's Claude session reads the
  bundle and scores the rubric). Judging QUALITY, not correctness.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

from .capture import CapturedBuild
from .driver import BuildRun


NATIVE_WEB_HINTS = {
    "web_search", "websearch", "web_fetch", "webfetch",
    "web_scraping", "web", "rss", "http_request",
}
# Connectors that must NEVER appear — the build was told web search is native.
EXTERNAL_SEARCH_DENYLIST = {
    "serpapi", "tavily", "serper", "brave_search", "brave",
    "google_search", "googlesearch", "bing_search", "bing", "exa",
}


@dataclass
class AssertionResult:
    key: str
    passed: bool
    severity: str          # "gate" | "warn"
    expected: str
    actual: str

    def as_dict(self) -> dict:
        return asdict(self)


def _service_types(cap: CapturedBuild) -> set[str]:
    return {(c.get("service_type") or "").lower() for c in cap.connectors if c.get("service_type")}


def _classify_web_research(cap: CapturedBuild, reaction_service_types: set[str]) -> list[dict]:
    """Caps whose tool_hints are native web tools and that don't drive a
    credential connector reaction."""
    out = []
    for c in cap.capabilities:
        hints = {h.lower() for h in c.get("tool_hints", [])}
        if hints & NATIVE_WEB_HINTS and not (hints & reaction_service_types):
            out.append(c)
    return out


def _tool_test_status(cap: CapturedBuild, service_type: str) -> str:
    """Best-effort read of the last_test_report for a connector's status."""
    tr = cap.tool_tests
    if not tr:
        return "unknown"
    entries = []
    if isinstance(tr, dict):
        entries = tr.get("results") or tr.get("tools") or tr.get("connectors") or []
    elif isinstance(tr, list):
        entries = tr
    for e in entries:
        if not isinstance(e, dict):
            continue
        blob = " ".join(str(e.get(k, "")) for k in ("name", "connector", "service_type", "tool")).lower()
        if service_type in blob:
            return str(e.get("status") or e.get("result") or "unknown")
    return "unknown"


def evaluate_assertions(fixture: dict, cap: CapturedBuild) -> list[AssertionResult]:
    exp = fixture.get("expected", {})
    reactions = exp.get("connector_reactions", [])
    reaction_sts = {r["service_type"].lower() for r in reactions}
    present_sts = _service_types(cap)
    results: list[AssertionResult] = []

    def add(key, passed, sev, expected, actual):
        results.append(AssertionResult(key, bool(passed), sev, str(expected), str(actual)))

    # 1. capability count
    min_caps = exp.get("min_capabilities", 0)
    add("capabilities_count", len(cap.capabilities) >= min_caps, "gate",
        f">= {min_caps}", len(cap.capabilities))

    # 2. web-research capability count
    want_web = (exp.get("web_research_capabilities") or {}).get("count", 0)
    web_caps = _classify_web_research(cap, reaction_sts)
    add("web_research_caps", len(web_caps) >= want_web, "gate",
        f">= {want_web}", f"{len(web_caps)} ({[c.get('id') for c in web_caps]})")

    # 3-4. each reaction connector present in required_connectors
    for r in reactions:
        st = r["service_type"].lower()
        add(f"connector_present:{st}", st in present_sts, "gate",
            f"service_type '{st}' in required_connectors", sorted(present_sts))

    # 5-6. credential link resolves (vault-dependent → warn)
    links = {k.lower(): v for k, v in (cap.credential_links or {}).items()}
    for r in reactions:
        if not r.get("expect_credential_link"):
            continue
        st = r["service_type"].lower()
        name = r["connector_name"].lower()
        resolved = links.get(st) or links.get(name)
        add(f"credential_link:{st}", bool(resolved), "warn",
            f"credentialLinks['{name}'] resolves", resolved or "MISSING (vault credential?)")

    # 7. no external search connector hallucinated
    bad = present_sts & EXTERNAL_SEARCH_DENYLIST
    add("no_external_search_connector", not bad, "gate",
        "no serpapi/tavily/google_search/…", sorted(bad) or "none")

    # 8. tool-test outcome per reaction (vault-dependent → warn)
    for r in reactions:
        st = r["service_type"].lower()
        want = r.get("expect_tool_test", "pass")
        got = _tool_test_status(cap, st)
        ok = (got.lower() in ("pass", "passed", "ok", "success")) if want == "pass" else True
        add(f"tool_test:{st}", ok, "warn", f"{want}", got)

    # 9. setup_status
    want_setup = exp.get("setup_status")
    if want_setup:
        add("setup_status", cap.setup_status == want_setup, "warn",
            want_setup, cap.setup_status)

    return results


def gate_pass_rate(results: list[AssertionResult]) -> float:
    gates = [r for r in results if r.severity == "gate"]
    if not gates:
        return 1.0
    return round(sum(1 for r in gates if r.passed) / len(gates), 3)


def judge_bundle(fixture: dict, cap: CapturedBuild, run: BuildRun, results: list[AssertionResult]) -> str:
    """Markdown bundle for the Claude-Code-as-judge quality pass (see judge-prompt.md)."""
    lines: list[str] = []
    lines.append(f"# Build-bench judge bundle — {fixture['id']} / variant={run.variant}")
    lines.append("")
    lines.append(f"- terminal phase: **{run.terminal_phase}** (ok={run.ok})")
    lines.append(f"- total build time: **{run.total_seconds}s**")
    lines.append(f"- capture source: {cap.source} · setup_status={cap.setup_status}")
    if run.error_message:
        lines.append(f"- error: {run.error_message}")
    lines.append("")
    lines.append("## Intent (what the user asked for)")
    lines.append("")
    lines.append("```\n" + fixture.get("intent", "").strip() + "\n```")
    lines.append("")
    lines.append(f"## Resolved capabilities ({len(cap.capabilities)})")
    for c in cap.capabilities:
        lines.append(f"- **{c.get('title') or c.get('id')}** — hints={c.get('tool_hints')} "
                     f"trigger={ (c.get('trigger') or {}) if isinstance(c.get('trigger'), dict) else c.get('trigger')}")
        if c.get("description"):
            lines.append(f"  - {c['description']}")
    lines.append("")
    lines.append("## Connectors + credential links")
    lines.append(f"- required_connectors: {[c.get('service_type') for c in cap.connectors]}")
    lines.append(f"- credentialLinks: {cap.credential_links}")
    lines.append("")
    lines.append("## Hard assertions")
    for r in results:
        mark = "PASS" if r.passed else ("WARN" if r.severity == "warn" else "FAIL")
        lines.append(f"- [{mark}] {r.key}: expected {r.expected} · actual {r.actual}")
    lines.append("")
    lines.append("## Score this (0-3 each) per the rubric")
    for d in fixture.get("rubric", {}).get("dimensions", []):
        lines.append(f"- **{d['key']}** (weight {d['weight']}): {d['prompt']}")
    lines.append("")
    lines.append("Write your verdict JSON to `verdicts/{fixture}/{variant}-{run}.json` — see judge-prompt.md.")
    return "\n".join(lines)
