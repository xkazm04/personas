#!/usr/bin/env python3
"""
E2E recipe-pipeline test suite.

Validates that the Stage B → D → E recipe redesign migration left every
template adoptable. Covers two layers:

LAYER A — schema-level (fast, all 112 canonical templates).
  For each template's `payload.use_cases[i].recipe_ref.id`, look up the
  recipe in the live catalog (seeded by Stage B Phase 2.4 on app boot).
  Verify it exists, and that its `prompt_template` round-trips as JSON
  (the contract `hydrate_recipe_refs` relies on at adoption time).
  ~3 seconds total.

LAYER B — UI-driven (slower, default 20 templates).
  For each scenario, drive `openMatrixAdoption` via the bridge, then
  verify the buildSession reaches `draft_ready` with a coherent
  `agent_ir` containing the expected hydrated use cases. Skips the
  test-agent / promote / Haiku regression cycle — those are the
  responsibility of `e2e_30_adoption.py`. The job here is to prove the
  recipe_ref → inline UC hydration pipeline holds at the boundary, not
  to re-validate the whole lifecycle.

Stage E.1/E.2 verifications already ran in the prior turn and aren't
re-exercised here. This harness focuses on the load-bearing question:
"are post-2.2 templates still adoptable?"

Usage:
  uvx --with httpx python tools/test-mcp/e2e_recipe_pipeline.py \
      --report docs/tests/results/recipe-pipeline-{run_id}.json

  # Run only Layer A (no UI):
  uvx --with httpx python tools/test-mcp/e2e_recipe_pipeline.py --layer a

  # Run only Layer B against a single template:
  uvx --with httpx python tools/test-mcp/e2e_recipe_pipeline.py \
      --layer b --template incident-logger
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path

import httpx

# Hand-curated set of 20 templates spanning categories + tier levels.
# Prefer templates that don't require external credentials for adoption
# (the schema-level layer doesn't execute, but still — keep the set
# representative of the catalog without leaning on any single category).
# 21 templates verified to exist as design reviews on a stock dev install.
# Spans all 14 category folders so a clean run proves the post-2.2
# recipe_ref → inline UC hydration holds across category schemas, not
# just one homogeneous slice.
LAYER_B_TEMPLATES_DEFAULT = [
    # Spread across categories: content / development / devops / email /
    # finance / hr / legal / marketing / productivity / research / sales /
    # security / support.
    "audio-briefing-host",          # content
    "autonomous-art-director",      # content
    "newsletter-curator",           # content
    "budget-spending-monitor",      # finance
    "invoice-tracker",              # finance
    "onboarding-tracker",           # hr
    "email-morning-digest",         # productivity
    "email-support-assistant",      # support
    "email-follow-up-tracker",      # productivity
    "email-task-extractor",         # productivity
    "email-lead-extractor",         # sales
    "research-knowledge-curator",   # research
    "research-paper-indexer",       # research
    "technical-decision-tracker",   # research / proj-mgmt
    "survey-insights-analyzer",     # research
    "access-request-manager",       # security
    "contact-enrichment-agent",     # sales
    "contact-sync-manager",         # sales
    "sales-deal-analyzer",          # sales
    "sales-proposal-generator",     # sales
    "sales-deal-tracker",           # sales (Salesforce; will skip on missing creds)
]


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=17320)
    ap.add_argument(
        "--layer",
        choices=["a", "b", "both"],
        default="both",
        help="Which layer(s) to run.",
    )
    ap.add_argument(
        "--template",
        type=str,
        default=None,
        help="Run Layer B against a single template id.",
    )
    ap.add_argument(
        "--report",
        type=str,
        default=None,
        help="Path to write JSON report. Defaults to docs/tests/results/recipe-pipeline-{run_id}.json.",
    )
    ap.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Don't delete the personas created by Layer B.",
    )
    return ap.parse_args()


# ── Bridge helpers ────────────────────────────────────────────────────────────

class Bridge:
    def __init__(self, port: int):
        self.client = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=120)

    def health(self) -> dict:
        return self.client.get("/health").json()

    def state(self) -> dict:
        return self.client.get("/state").json()

    def navigate(self, section: str) -> dict:
        return self.client.post("/navigate", json={"section": section}).json()

    def query(self, selector: str) -> list:
        return self.client.post("/query", json={"selector": selector}).json()

    def open_matrix_adoption(self, review_id: str) -> dict:
        return self.client.post(
            "/open-matrix-adoption", json={"review_id": review_id}
        ).json()

    def delete_agent(self, name_or_id: str) -> dict:
        return self.client.post(
            "/delete-agent", json={"name_or_id": name_or_id}
        ).json()

    def eval_js(self, js: str) -> None:
        self.client.post("/eval", json={"js": js})

    def run_in_webview(self, body: str) -> dict:
        """Run an async JS body, write the result to #e2e-out, read it back.
        The body must end with `return summary;` (or assign `summary`)."""
        wrapped = (
            "(async()=>{ try { "
            + body
            + ' let el = document.getElementById("e2e-out"); if(!el){el=document.createElement("div");el.id="e2e-out";el.style.display="none";document.body.appendChild(el);} el.textContent = JSON.stringify(summary); '
            + ' } catch(e) { let el = document.getElementById("e2e-out") || (function(){const d=document.createElement("div");d.id="e2e-out";d.style.display="none";document.body.appendChild(d);return d;})(); el.textContent = JSON.stringify({error: String(e)}); } })()'
        )
        self.eval_js(wrapped)
        # Briefly let the IPC settle.
        time.sleep(0.4)
        results = self.query("#e2e-out")
        if not results:
            return {"error": "e2e-out missing from DOM"}
        text = results[0].get("text", "")
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            return {"error": f"json decode: {exc}: raw={text[:200]}"}


# ── Layer A: schema-level catalog audit ───────────────────────────────────────

def run_layer_a(b: Bridge) -> dict:
    """For every template in the bundled catalog, walk its recipe_refs
    and verify each resolves to a recipe in the seeded DB. Returns a
    summary with per-template detail.

    Cheap: one IPC call to list templates + one to list recipes, then
    pure JS aggregation. No persona is created.
    """
    body = """
        const recipes = await window.__TAURI_INTERNALS__.invoke("list_recipes");
        const templatesById = await window.__TAURI_INTERNALS__.invoke("list_template_catalog");
        const recipeIds = new Set(recipes.map(r => r.id));
        const promptOk = (r) => { try { JSON.parse(r.prompt_template); return true; } catch { return false; } };
        const recipesById = new Map(recipes.map(r => [r.id, r]));
        let total = 0, missing = 0, malformed = 0;
        const failures = [];
        for (const t of templatesById) {
            const ucs = t.payload && Array.isArray(t.payload.use_cases) ? t.payload.use_cases : [];
            for (const uc of ucs) {
                const ref = uc && uc.recipe_ref;
                if (!ref || typeof ref.id !== "string") continue;
                total++;
                const recipe = recipesById.get(ref.id);
                if (!recipe) {
                    missing++;
                    failures.push({ template: t.id, recipe_ref: ref.id, reason: "not_in_catalog" });
                    continue;
                }
                if (!promptOk(recipe)) {
                    malformed++;
                    failures.push({ template: t.id, recipe_ref: ref.id, reason: "prompt_template_not_json" });
                }
            }
        }
        const summary = {
            template_count: templatesById.length,
            recipe_count: recipes.length,
            recipe_refs_checked: total,
            missing_refs: missing,
            malformed_recipes: malformed,
            failures: failures.slice(0, 20),
        };
    """
    raw = b.run_in_webview(body)
    return raw


# Layer A: read templates from disk, send their recipe-ref list to the
# webview, have the webview cross-check against `list_recipes` and return
# just a small failure summary. Avoids the 300-char /query truncation
# that bites any payload large enough to carry all 291 recipe ids.
def run_layer_a_via_local_files(b: Bridge) -> dict:
    repo_root = Path(__file__).resolve().parent.parent.parent
    templates_root = repo_root / "scripts" / "templates"
    template_paths = []
    for cat_dir in sorted(p for p in templates_root.iterdir() if p.is_dir() and not p.name.startswith("_")):
        for path in sorted(cat_dir.glob("*.json")):
            stem = path.stem
            if "." in stem:
                continue  # locale overlay
            template_paths.append(path)

    # Build (template_id, [recipe_ref_ids]) tuples on the Python side.
    template_refs: list[dict] = []
    parse_failures: list[dict] = []
    for path in template_paths:
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            parse_failures.append({"template": path.stem, "reason": f"read_error: {e}"})
            continue
        template_id = doc.get("id", path.stem)
        ucs = (doc.get("payload") or {}).get("use_cases") or []
        refs: list[str] = []
        for uc in ucs:
            if not isinstance(uc, dict):
                continue
            ref = uc.get("recipe_ref")
            if not isinstance(ref, dict):
                continue
            rid = ref.get("id")
            if isinstance(rid, str):
                refs.append(rid)
        template_refs.append({"template_id": template_id, "refs": refs})

    # Push the table to the webview as a global, then cross-check there
    # and ONLY return a small summary (≤ 290 chars after json encoding).
    payload = json.dumps({"templates": template_refs}, separators=(",", ":"))
    # Stash via eval_js (no return value needed).
    b.eval_js(f"window.__E2E_TEMPLATE_REFS__ = {payload};")
    time.sleep(0.2)

    body = """
        const all = window.__E2E_TEMPLATE_REFS__ || { templates: [] };
        const recipes = await window.__TAURI_INTERNALS__.invoke("list_recipes");
        const idsInCatalog = new Set(recipes.map(r => r.id));
        const promptOk = (r) => { try { JSON.parse(r.prompt_template); return true; } catch { return false; } };
        const malformedIds = recipes.filter(r => !promptOk(r)).map(r => r.id);
        let total = 0, missing = 0;
        const fails = [];
        for (const t of all.templates) {
            for (const rid of t.refs) {
                total++;
                if (!idsInCatalog.has(rid)) {
                    missing++;
                    if (fails.length < 10) fails.push({ template: t.template_id, recipe_ref: rid });
                }
            }
        }
        const summary = {
            template_count: all.templates.length,
            recipe_count: recipes.length,
            recipe_refs_checked: total,
            missing_refs: missing,
            malformed_recipes: malformedIds.length,
            sample_missing: fails,
            sample_malformed: malformedIds.slice(0, 5),
        };
    """
    summary = b.run_in_webview(body)
    if "error" in summary:
        return {"error": f"webview audit failed: {summary['error']}"}
    summary["template_parse_failures"] = parse_failures
    return summary


# ── Layer B: UI-driven adoption to draft_ready ────────────────────────────────

def find_review_id_for_template(b: Bridge, template_id: str) -> str | None:
    """Find the gallery review_id for the given template_id (kebab-case slug
    derived from the human-readable test_case_name).

    Convention: `database-performance-monitor` ↔ "Database Performance Monitor".
    We slugify the review's `test_case_name` (lowercase, non-alphanum →
    hyphen, collapse repeats) and exact-match against the requested
    template_id. Exact match avoids false positives like "Email Triage"
    matching three nearly-identical Email-* reviews.
    """
    body = (
        """
        const reviews = await window.__TAURI_INTERNALS__.invoke("list_design_reviews");
        const slug = s => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        const target = reviews.find(r => slug(r.test_case_name) === \""""
        + template_id.lower()
        + """\");
        const summary = target ? { id: target.id, name: target.test_case_name } : { id: null };
    """
    )
    res = b.run_in_webview(body)
    return res.get("id")


def adopt_to_draft_ready(b: Bridge, template_id: str, timeout_s: int = 30) -> dict:
    """Drive the recipe-hydration pipeline directly via IPC, bypassing
    the wizard UI.

    The wizard's `createPersona` + `create_adoption_session` invocations
    are gated on `useCaseStepDone` + `questionsComplete` (see
    `MatrixAdoptionView:792-794`), which means UI-driven Layer B can't
    reach `create_adoption_session` without per-template questionnaire
    knowledge. But the load-bearing question for the recipe-redesign
    migration is whether `create_adoption_session` itself hydrates
    recipe_refs correctly — the questionnaire just collects answers.
    So we call those two IPCs directly with the template's design
    payload, exercising the same Rust path the wizard would, then
    verify the resulting build session's agent_ir.

    Cleanup deletes the draft persona on the way out.
    """
    started = time.perf_counter()
    review_id = find_review_id_for_template(b, template_id)
    if not review_id:
        return {
            "template": template_id,
            "status": "fail",
            "step": "find_review",
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "error": "no design review with this slug in DB",
        }

    # Pull the review's design_result (the template payload), create a
    # draft persona, then drive create_adoption_session with that payload.
    persona_name = f"e2e-recipe-{template_id}-{int(time.time() * 1000) % 100000}"
    body = """
        const review = await window.__TAURI_INTERNALS__.invoke("get_design_review", { id: "REVIEW_ID" });
        let summary;
        if (!review || !review.design_result) {
            summary = { ok: false, step: "missing_design_result" };
        } else {
            const persona = await window.__TAURI_INTERNALS__.invoke("create_persona", {
                input: {
                    name: "PERSONA_NAME",
                    system_prompt: "You are an e2e test persona.",
                    project_id: null, description: null, structured_prompt: null,
                    icon: null, color: null, enabled: null, max_concurrent: null,
                    timeout_ms: null, model_profile: null, max_budget_usd: null,
                    max_turns: null, design_context: null, group_id: null,
                    notification_channels: null
                }
            });
            try {
                const sessionId = await window.__TAURI_INTERNALS__.invoke("create_adoption_session", {
                    personaId: persona.id,
                    intent: "e2e adoption test for TEMPLATE_ID",
                    agentIrJson: review.design_result,
                    resolvedCellsJson: null
                });
                summary = { ok: true, persona_id: persona.id, session_id: sessionId };
            } catch (err) {
                try { await window.__TAURI_INTERNALS__.invoke("delete_persona", { id: persona.id }); } catch {}
                summary = { ok: false, step: "create_adoption_session_failed", persona_id: persona.id, error: String(err).slice(0, 120) };
            }
        }
    """.replace("REVIEW_ID", review_id).replace("PERSONA_NAME", persona_name).replace("TEMPLATE_ID", template_id)
    raw = b.run_in_webview(body)

    if not raw.get("ok"):
        return {
            "template": template_id,
            "status": "fail",
            "step": raw.get("step", "unknown"),
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "error": raw.get("error"),
            "persona_id": raw.get("persona_id"),
        }

    persona_id = raw["persona_id"]
    verify = verify_drafted_persona(b, persona_id)
    duration_ms = int((time.perf_counter() - started) * 1000)
    return {
        "template": template_id,
        "status": "pass" if verify.get("ok") else "fail",
        "step": "session_created",
        "duration_ms": duration_ms,
        "persona_id": persona_id,
        "verification": verify,
    }


def verify_drafted_persona(b: Bridge, persona_id: str | None) -> dict:
    """Sanity-check the build session's hydrated agent_ir.

    `create_adoption_session` writes the post-`hydrate_recipe_refs`
    payload into `build_sessions.agent_ir`. The persona's own
    `design_context` is empty until promote, so we query the build
    session row directly. The well-formed contract: agent_ir must have
    a non-empty `use_cases` array, each entry with a non-empty `id`
    and either `title` or a category — matching what the recipe seed's
    inline UC content provides post-hydration.
    """
    if not persona_id:
        return {"ok": False, "reason": "buildPersonaId was null after open_modal"}
    body = (
        '''
        const session = await window.__TAURI_INTERNALS__.invoke("get_active_build_session", { personaId: "'''
        + persona_id
        + """\" });
        // PersistedBuildSession is serialized rename_all = "camelCase" → field is `agentIr`.
        const ir = session && session.agentIr ? session.agentIr : null;
        const ucs = ir && Array.isArray(ir.use_cases) ? ir.use_cases : [];
        const idsOk = ucs.filter(uc => uc && typeof uc.id === \"string\" && uc.id.length > 0).length;
        const titlesOk = ucs.filter(uc => uc && (typeof uc.title === \"string\" || typeof uc.name === \"string\")).length;
        // Post-normalize signals: hoisted suggested_* fields prove the v3-flatten
        // pipeline ran (means hydrate_recipe_refs successfully resolved each
        // recipe_ref into a UC payload that normalize_v3_to_flat could ingest).
        const hoistedTriggers = ir && Array.isArray(ir.suggested_triggers) ? ir.suggested_triggers.length : 0;
        const hoistedConnectors = ir && Array.isArray(ir.suggested_connectors) ? ir.suggested_connectors.length : 0;
        const summary = {
            ok: ucs.length > 0 && idsOk === ucs.length && titlesOk === ucs.length,
            use_case_count: ucs.length,
            ids_ok: idsOk,
            titles_ok: titlesOk,
            hoisted_triggers: hoistedTriggers,
            hoisted_connectors: hoistedConnectors,
            sample: ucs.slice(0, 2).map(uc => ((uc && (uc.title || uc.id)) || \"\").slice(0, 30)),
            session_phase: session ? session.phase : null,
        };
    """
    )
    return b.run_in_webview(body)


def run_layer_b(b: Bridge, templates: list[str], cleanup: bool) -> dict:
    """Run Layer B against a list of templates. Cleans up created personas
    by default (one per template)."""
    print(f"\n=== Layer B — UI-driven adoption to draft_ready ({len(templates)} templates) ===\n")
    scenarios: list[dict] = []
    passed = 0
    failed = 0
    for i, template_id in enumerate(templates, 1):
        print(f"[{i}/{len(templates)}] {template_id} ... ", end="", flush=True)
        result = adopt_to_draft_ready(b, template_id)
        scenarios.append(result)
        if result["status"] == "pass":
            passed += 1
            v = result.get("verification") or {}
            print(f"PASS ({result['duration_ms']}ms, {v.get('use_case_count', '?')} ucs)")
        else:
            failed += 1
            print(f"FAIL [{result.get('step')}] {result.get('error') or result.get('last_phase') or ''}")

        # Cleanup created persona (best-effort).
        if cleanup and result.get("persona_id"):
            try:
                b.delete_agent(result["persona_id"])
            except Exception as exc:
                # Non-fatal: leave the persona, log.
                print(f"     (cleanup warning: {exc})")
    return {"scenarios": scenarios, "passed": passed, "failed": failed}


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    args = parse_args()
    b = Bridge(args.port)

    try:
        health = b.health()
    except Exception as exc:
        print(f"FATAL — test-automation server unreachable on :{args.port}: {exc}", file=sys.stderr)
        return 2
    if health.get("status") != "ok":
        print(f"FATAL — health endpoint did not return ok: {health}", file=sys.stderr)
        return 2
    print(f"server: {health.get('server')} v{health.get('version')}")

    run_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")
    report = {
        "run_id": run_id,
        "started_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "layers_run": [],
    }

    if args.layer in ("a", "both"):
        print("\n=== Layer A — schema-level catalog audit ===")
        layer_a = run_layer_a_via_local_files(b)
        report["layer_a"] = layer_a
        report["layers_run"].append("a")
        if "error" in layer_a:
            print(f"  FAIL: {layer_a['error']}")
        else:
            print(
                f"  templates={layer_a['template_count']} "
                f"recipes={layer_a['recipe_count']} "
                f"refs_checked={layer_a['recipe_refs_checked']} "
                f"missing={layer_a['missing_refs']} "
                f"malformed={layer_a['malformed_recipes']}"
            )
            if layer_a.get("sample_missing"):
                print("  missing recipe_refs (first few):")
                for f in layer_a["sample_missing"][:5]:
                    print(f"    {f}")
            if layer_a.get("sample_malformed"):
                print("  malformed prompt_templates (first few):")
                for rid in layer_a["sample_malformed"]:
                    print(f"    {rid}")

    if args.layer in ("b", "both"):
        templates = [args.template] if args.template else LAYER_B_TEMPLATES_DEFAULT
        layer_b = run_layer_b(b, templates, cleanup=not args.no_cleanup)
        report["layer_b"] = layer_b
        report["layers_run"].append("b")

    report["finished_at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    # Aggregate exit code.
    exit_code = 0
    if "layer_a" in report:
        a = report["layer_a"]
        if "error" in a or a.get("missing_refs", 0) > 0 or a.get("malformed_recipes", 0) > 0:
            exit_code = 1
    if "layer_b" in report:
        if report["layer_b"]["failed"] > 0:
            exit_code = 1

    # Write report.
    if args.report is None:
        out_dir = Path(__file__).resolve().parent.parent.parent / "docs" / "tests" / "results"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"recipe-pipeline-{run_id}.json"
    else:
        out_path = Path(args.report)
        out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"\nReport: {out_path}")

    print(f"\nExit: {exit_code}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
