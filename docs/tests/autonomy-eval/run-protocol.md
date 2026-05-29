# Run Protocol & Harness Data Model

**Parent:** [`README.md`](./README.md) · **Defines:** the reproducible run procedure, the on-disk bundle/scorecard/experiment schemas, and the concrete gather queries. Written so a future session can build the harness from this alone.

---

## 1. Prerequisites

- App running with the test-automation bridge: `npm run tauri:dev:test` (lite + `test-automation`, HTTP on `:17320`; zombie-fallback `:17321`). Harness honors `PERSONAS_BASE`.
- The 7 teams adopted from `sdlc-lifecycle` and pinned to their repos in `C:\Users\mkdol\xprice` (done — memory `project_xprice_7_teams`).
- DB paths for verification: `C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db` (executions, personas, reviews, memories, teams, events, pipeline_runs) and `…/personas_data.db` (companion brain: goals, approvals).
- A seed selected from `docs/test/seeds/` (§6).

---

## 2. Run lifecycle (the procedure)

One run = one `(team, seed)` pair over a bounded window. Steps map to README layers.

```
RUN <team> <seed> [--minutes 30]
  0. PRE-FLIGHT
     - health-lint every member (rubric §4). Any BLOCKER ⇒ abort, write BROKEN bundle, stop.
     - snapshot config_hash(members) = hash of each member's
       {structured_prompt, design_context, subscriptions, tools, triggers, codebase pin}
     - code-track: snapshot each pinned repo's git HEAD + clean-tree state (read-only;
       NEVER stash/modify — diff is computed against this snapshot at gather)
     - record run metadata { run_id, team, seed_id, started_at, window_min, app_version }
  1. SEED
     - inject the goal the way a user would: the team's entry persona's run input,
       or `assign_team` for the goal. (Both are real paths; record which.)
  2. SUSTAIN (window)
     - let the team cascade on its own machinery (triggers + chain + subscriptions).
     - ORCHESTRATE concurrently (auto-approval-policy.md): poll gates + stalls on a
       heartbeat (e.g. every 10–20s); resolve per policy; append every action to the
       audit log; record a heartbeat timeline (active execs, pending gates, goal count).
     - the harness does NOT fire individual personas during the window (that wouldn't be
       the autonomy under test). Its only mid-run actions are policy gate-resolution +
       stall detection.
  3. GATHER (at window end + a drain grace period)
     - assert config_hash unchanged (no mid-run human edits).
     - collect all rows + artifacts for the window (§4) into run-<id>/ bundle.
  4. EVALUATE
     - score the bundle (rubric) → scorecard.json + scorecard.md ; trajectory slices.
  5. (REACT happens between runs, not here — §7)
```

A run is **immutable** once gathered: EVALUATE and re-EVALUATE always read the bundle, never the live DB. Re-scoring a bundle after a rubric change is allowed (and versioned).

---

## 3. Harness layout (`scripts/test/`)

Proposed module split (Node/TS, reuses the bridge client patterns already in `tests/playwright/*.mjs` and `src/test/automation/bridge.ts`):

```
scripts/test/
  bridge.mjs          # thin client over :1732x (health, invokeCommand, query, click-testid…)
  db.mjs              # read-only SQLite open of personas.db / personas_data.db (better-sqlite3 or sql.js)
  health-lint.mjs     # rubric §4 — per-member structural checks (also a standalone report)
  run.mjs             # the lifecycle (§2): pre-flight → seed → sustain+orchestrate → gather
  orchestrate.mjs     # auto-approval-policy.md: poll + resolve gates, stall watchdog, goal-cap, audit log
  gather.mjs          # §4 queries → bundle
  evaluate/
    index.mjs         # roll-up → scorecard
    code-track.mjs    # §1.A deterministic: run repo build/lint/test, score the diff
    doc-track.mjs     # §1.B grounding checks + LLM judge (fixed prompt from docs/test/judge/)
    team.mjs          # §2 team dims
    trajectory.mjs    # §3 decay slicing
  react/
    template.mjs      # edit scripts/templates/* → regen checksums → re-adopt fresh team
    persona-lab.mjs   # lab_improve_prompt / lab_accept_matrix_draft / update_persona, before/after
  seeds.mjs           # load + validate docs/test/seeds/*
```

Small in-app additions (separate worktree/PR when built): batch-approve command, stall-diagnosis query, `companion_approval` audit columns, the health-lint as a Tauri command (so it's reusable in-product later). See auto-approval §7 and rubric §4.

---

## 4. Gather queries (truth from SQLite)

All keyed on the run window `[started_at, gathered_at]` and the team's persona-id set `P`. Read-only.

| Bundle file | Source | Key query (shape) |
|---|---|---|
| `executions.json` | `persona_executions` + `execution_traces` | `WHERE persona_id IN P AND created_at >= started_at`; join traces by `execution_id`; pull `chain_trace_id` |
| `logs/<exec_id>.log` | `log_file_path` files | copy each execution's log file into the bundle |
| `reviews.json` | `persona_manual_reviews` (+ `review_messages`) | `WHERE persona_id IN P AND created_at >= started_at` |
| `memories.json` | `persona_memories` + `team_memories` | `WHERE persona_id IN P AND created_at >= started_at` (capture the `learned`/review-sourced ones) |
| `approvals.json` | `companion_approval` (personas_data.db) | rows created/resolved in window; join the orchestrator audit log for provenance |
| `handoffs.json` | `persona_events` + `pipeline_runs.node_statuses` | the team graph actually traversed; reconstruct from `chain_trace_id` |
| `diffs/<repo>.patch` | git | `git diff <pre-snapshot HEAD>..` in each pinned repo (code-track) |
| `orchestrator-audit.jsonl` | harness | every gate decision (auto-approval §8) |
| `heartbeat.jsonl` | harness | per-tick {active_execs, pending_gates, active_goals} |
| `run.json` | harness | metadata + config_hash (start & end) + seed id + costs |

`success:true` from any command is **never** trusted — the bundle is built from row/file/diff reads (memory `feedback_test_before_deliver`: "success true does not mean match").

---

## 5. Scorecard schema (`scorecard.json`)

```jsonc
{
  "run_id": "...", "team": "...", "seed_id": "...", "rubric_version": "1",
  "verdict": "PRODUCTION|PROMISING|NOT-READY|BROKEN",
  "health_lint": { "passed": true, "blockers": [], "warnings": [...] },
  "personas": [
    { "persona_id": "...", "role": "architect", "tracks": ["doc"],
      "output_grade": 78,
      "code_track": null,
      "doc_track": { "grounding_gate": 100, "correctness": 80, "actionability": 75,
                     "specificity": 70, "role_fidelity": 85, "evidence": ["exec_…", "ADR §3"] } }
  ],
  "team": { "goal_closure": 60, "convergence": 55, "handoff_health": 90,
            "work_density": 70, "memory_hygiene": 65, "no_collision": 100 },
  "trajectory": { "decay": "mild", "curves": { "...dim...": [early, mid, late] } },
  "autonomy": { "score": 72, "interventions": { "auto_approve": 11, "review_resolve": 4,
                "escalate": 1, "deny": 0, "rescue": 1, "goal_cap": 0 }, "cost": 28 },
  "lowest_dims": ["convergence", "goal_closure", "doc.specificity"],  // React targets
  "cost_usd": 3.41, "duration_min": 30
}
```

Plus `scorecard.md` — the human-readable version with evidence pointers inline.

---

## 6. Seed bank (`docs/test/seeds/*.json`)

```jsonc
{
  "id": "ai-paralegal/add-citation-validator",
  "repo": "ai-paralegal",
  "goal": "Add a citation-format validator for legal references and document the decision.",
  "tracks": ["code", "doc"],
  "exercises_roles": ["architect", "reviewer", "docs"],
  "repo_cmds": { "build": "npm run build", "lint": "npm run lint", "test": "npm test" },
  "held_out": false,        // held-out seeds are never used as React-tuning targets
  "acceptance_hint": "validator module + tests + an ADR grounded in the repo's existing ref handling"
}
```

Rules: seeds are realistic SDLC asks sized for the window; each cites the repo's real build/lint/test commands; `held_out: true` seeds are reserved for certification (never React-tuned against). Certification (README §6) runs **held-out** seeds.

---

## 7. Experiment record (React phase — `experiments/*.json`)

Every template or persona-via-lab adjustment is a logged experiment with a before/after delta:

```jsonc
{
  "id": "exp-...", "target_dimension": "doc.specificity",
  "mechanism": "persona-lab" /* or "template" */,
  "target": { "team": "...", "persona_id": "...", "role": "architect" },
  "change_summary": "tightened architect instructions to cite concrete repo files",
  "change_ref": "update_persona payload / template diff path",
  "before": { "run_id": "...", "score": 60 },
  "after":  { "run_id": "...", "score": 74 },
  "delta": +14,
  "validation": { "held_out_team_regressed": false },  // template changes only
  "decision": "accepted" /* or "reverted" */
}
```

Reactions that don't move the score (or regress a held-out team for template changes) are **reverted** — no cargo-cult accumulation (README §4.5). The experiment log is the audit trail of how a team got from baseline to (hopefully) `PRODUCTION`.

---

## 8. Certification record (`certifications/<team>.json`)

Written only when a team hits **3 consecutive `PRODUCTION` runs on held-out seeds**:

```jsonc
{
  "team": "...", "certified_at": "...", "rubric_version": "1",
  "runs": ["run_a", "run_b", "run_c"],          // the 3 consecutive, held-out
  "scores": [82, 85, 81], "autonomy": [80, 78, 83], "decay": ["flat","flat","mild-ok"],
  "config": { "template_state": "git sha / template versions",
              "persona_states": { "persona_id": "structured_prompt+design_context hash" } },
  "caveats": ["30-min proxy; long-haul not yet run", "..."],
  "honest_claim": "This team produced production-quality outputs across 3 independent held-out
                   goals with autonomy-cost ≤ budget and no quality decay. This is necessary,
                   not sufficient, evidence for 'works for weeks' (see README §7)."
}
```

The certification is deliberately **caveated** — it backs a claim to users only as far as the evidence honestly reaches.

---

## 9. First concrete action (P1)

When implementation starts: build `health-lint.mjs` + `db.mjs` + `gather.mjs` (read-only) and point them at the **existing 7 teams as-is** to produce `docs/test/runs/baseline-health.md` — "what structural state are these teams actually in right now?" This needs zero in-app changes, zero LLM cost, and will almost certainly surface real degradation (README §2.1) — the honest starting line before any run or score.
