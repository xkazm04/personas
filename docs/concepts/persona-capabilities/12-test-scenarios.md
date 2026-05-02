# 12 — Test scenarios suite

> Inventory of the live E2E phase drivers under `tools/test-mcp/`,
> with the canonical flow steps and current status for each scenario.
>
> **Companion file: `test-scenarios.xlsx`** — same data in a
> manual-comparison grid. Each scenario block carries: a title row, a
> summary row, the **exact `INTENT` prompt** the driver passes to
> `startBuildFromIntent` (so you can paste it into the desktop app and
> walk the build by hand), then the flow steps + status + notes
> columns. Open it side-by-side with the desktop app to spot any
> false-green claims.
>
> Regenerate the xlsx with:
> ```bash
> python tools/test-mcp/generate_test_scenarios_xlsx.py
> ```

---

## Driver shape (canonical skeleton)

Every Phase driver under `tools/test-mcp/e2e_phase_*.py` follows the
same skeleton — duplicate it when adding a new one rather than
abstracting (these are one-shot scripts):

```python
# 1. Force UTF-8 stdout (Windows cp1252 chokes on non-ASCII)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

# 2. INTENT + ANSWERS dict + acceptance config

# 3. Pipeline
step_preflight()            # GET /health
step_start_build()          # bridge.startBuildFromIntent(intent)
step_answer_dimensions()    # poll-and-answer-loop with max_rounds=30
step_wait_for_agent_ir()    # 60s defensive poll — see C8 §Lessons #2
step_test_and_promote()     # bridge.triggerBuildTest + promoteBuildDraft
step_assert_acceptance()    # call getPersonaDetail + parse design_context
step_dry_run()              # optional — simulateBuildDraft + getSimulationArtefacts
step_synthesize_review()    # Phase D2 only — synthesizeManualReview
step_wait_for_verdict()     # Phase D2 only — poll listManualReviews
step_assert_audit_tag()     # Phase D2 only — getPolicyEventsForExecution
step_cleanup()              # deleteAgent unless --no-persona-cleanup
```

---

## Scenario index

| Phase | Scenario | UCs | Status (latest run) | Driver |
|---|---|---|---|---|
| A.1 | Inbox Triage | 2 | ok (C6) | `e2e_phase_a.py --scenario inbox` |
| A.2 | Project Coordinator | 4 | ok (C6) | `e2e_phase_a.py --scenario coordinator` |
| B | Chained personas X→Y→Z | 3 personas, 3 UCs | ok (C6) | `e2e_phase_b.py` |
| C | Output diversity (vector_db / notion / github / titlebar) | 1 each | ok (C6) | `e2e_phase_c.py --scenario <name>` |
| D | auto_triage build-shape | 1 | ok (C7) | `e2e_phase_d.py` |
| **D2** | **auto_triage runtime E2E** | 1 | **ok (C8 — verified 2026-04-28: verdict landed in 8s, policy_events tagged)** | `e2e_phase_d2.py` |
| E | Preload-error reload | n/a | **deferred-manual** (WebView2 stale-chunk repro not scriptable) | (manual checklist) |
| F | Multi-language build (cz / es / de / fr) | 1 each | ok (C7) | `e2e_phase_f.py` |
| G | Dry-run preview | 1 | ok (C7) | `e2e_phase_g.py` |
| H | Webhook trigger + smee auto-bind | 1 | ok (C7) | `e2e_phase_h.py` |
| I | Clockify monthly-invoice | 2 | ok (C7) — 7 acceptance gates green | `e2e_phase_i.py` |
| **J** | **Documentation archiver (webhook + reference)** | 2 | **ok (C8 — verified 2026-04-28: all 5 gates green, smee_relays auto-bind verified)** | `e2e_phase_j.py` |
| **K** | **Video narration (build-shape)** | 1 | **ok (C8 — verified 2026-04-28: gemini + elevenlabs landed, manual trigger). Runtime blocked on ElevenLabs TTS impl + ffmpeg connector exposure.** | `e2e_phase_k.py` |

---

## Status legend

| Value | Meaning |
|---|---|
| `ok` | Driver is green on its most recent live run |
| `ok (build-shape only)` | Build pipeline lands the expected design, but runtime execution is blocked on a separate prerequisite (e.g. Phase K needs TTS + video composition) |
| `deferred` | Scenario not yet implemented; tracked in `10-deferred-backlog.md` |
| `deferred-manual` | Cannot be scripted end-to-end; manual checklist in the relevant handoff |
| `flaky` | Has passed but not reliably (e.g. LLM nondeterminism on a soft gate) |
| `red` | Driver exists but most recent run failed; root cause documented |

When the xlsx says `ok` for a step but you can't reproduce it manually,
file that as a "false-green" — the driver's gate is too permissive or
the LLM happened to land on a passing shape. Write the discrepancy in
the next handoff under "Test scenario gaps".

---

## Where each phase came from

| Wave | Phases shipped | Doc |
|---|---|---|
| C5 (2026-04-25 / 2026-04-26) | (precursor — 5 simple smoke scenarios, no formal Phase suite) | `C5-handoff-2026-04-25-EOD.md` / `C5-handoff-2026-04-26.md` |
| C6 (2026-04-27) | A.1, A.2, B, C × 4 | `C6-handoff-2026-04-27.md` |
| C7 (2026-04-28) | D, F, G, H, I | `C7-handoff-2026-04-28.md` |
| C8 (2026-04-28) | D2, J, K | `C8-handoff-2026-04-28.md` |

Phase E was carved out as deferred-manual at C7 — the WebView2
stale-chunk repro requires forcing a `tauri-cli` rebuild while the
WebView is open, which can't be scripted from the test bridge.

---

## Maintaining the suite

**When you add a new phase driver:**
1. Mirror the canonical skeleton above (one-shot script, defensive
   `wait_for_agent_ir`, UTF-8 stdout reconfigure, JSON report flag).
2. Add a row to the scenario index table above.
3. Re-run `python tools/test-mcp/generate_test_scenarios_xlsx.py` to
   refresh the xlsx.
4. Cross-reference from the C-handoff doc that introduces the phase.

**When a phase regresses:**
1. Note `red` status in the table + a one-line reason.
2. Don't delete the driver — it's evidence of the regression.
3. Update the matching handoff's "Open follow-ups" with the
   reproduction steps.

**When a phase's contract changes** (e.g. a new acceptance gate is
added, a UC count expectation flips):
1. Update the driver in-place.
2. Update the flow-steps row in this doc and re-generate the xlsx.
3. Note the contract change in the next handoff under "Driver
   contract updates".

---

## File map

| File | Purpose |
|---|---|
| `tools/test-mcp/e2e_phase_a.py` … `e2e_phase_k.py` | Phase drivers (one .py per scenario or scenario family) |
| `tools/test-mcp/e2e_phase_d2.py` | Phase D2 — auto_triage runtime E2E |
| `tools/test-mcp/generate_test_scenarios_xlsx.py` | xlsx generator (writes `docs/concepts/persona-capabilities/test-scenarios.xlsx`) |
| `docs/concepts/persona-capabilities/test-scenarios.xlsx` | Manual-comparison checklist (regenerated from generator script) |
| `src/test/automation/bridge.ts` | JS-side bridge methods (`synthesizeManualReview`, `simulateBuildDraft`, `smeeRelayList`, etc.) |
| `src-tauri/src/test_automation.rs` | HTTP server forwarding bridge calls to JS |
| `src-tauri/src/commands/testing/synthesize_review.rs` | C8 test-only command for Phase D2 |
| `logs/phase-*.json` | Per-run JSON reports (git-ignored; kept locally) |
