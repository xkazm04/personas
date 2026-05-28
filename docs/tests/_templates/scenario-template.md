<!--
Canonical shape for an end-to-end scenario doc. Copy this file into ../e2e/,
rename it, and fill every section. Delete this comment and any section that
genuinely does not apply (say WHY in one line rather than leaving it blank).

Conventions:
- One scenario = one purpose. If you need a second purpose, write a second doc.
- Steps are driven through the test-automation bridge — see
  ../strategy/coverage-strategy.md for where E2E sits, and
  ../../development/test-automation.md for the bridge tools + data-testid list.
- "Truth" is the DB, never a command's success:true. Assertions read
  persona_executions / persona_messages / persona_memories (real table names),
  not a UI toast.
-->

# <Scenario name>

One sentence: what user-visible behaviour this scenario proves, and why it's
worth a dedicated regression. Link the feature doc it guards
(e.g. `docs/features/<area>/README.md`).

## Preconditions

- **App:** `npm run tauri:dev:test` (bridge on `http://127.0.0.1:17320`;
  confirm `curl -s http://127.0.0.1:17320/health`).
- **Vault / data:** which credentials or seeded rows must exist for the
  scenario to deliver value (list them; a scenario that "passes" with no real
  input is a method artifact, not a green).
- **Isolation:** if this can't run next to another app session, say so and
  point at `../strategy/parallel-cli-workflow.md`.

## Steps

Each step is a bridge action and the expected observable result. Use
`click_testid` / `fill_field` (route through `__test_respond`), never `/eval`.

| # | Action | Expected |
|---|--------|----------|
| 1 | `navigate("<section>")` | <what renders> |
| 2 | `click_testid("<testid>")` | <what changes> |
| 3 | … | … |

## Hard assertions (deterministic, DB-backed)

Read the database, not the UI. Real tables: `persona_executions`
(`status`, `output_data`, `cost_usd`, `duration_ms`, `tool_steps`),
`persona_messages` (`content`, `execution_id`), `persona_memories`.

```sql
-- e.g. the run completed and did real work
SELECT status, cost_usd, duration_ms
FROM persona_executions
WHERE persona_id = '<id>' ORDER BY started_at DESC LIMIT 1;
```

- [ ] <assertion 1 — terminal status reached>
- [ ] <assertion 2 — real work happened: cost_usd > 0 / ≥1 tool_step>
- [ ] <assertion 3 — expected output/message/memory exists>

## Pass / fail

- **Pass** — every hard assertion holds.
- **Soft-fail** — a recoverable, logged condition (transient rate-limit, a
  `no_input_available` where the agent correctly reached a source and found
  nothing). Classify from `output_data` before calling it a defect.
- **Hard-fail** — structural break (missing tool, never-created row, timeout).

## Cleanup

What the scenario leaves behind and how to reset (or "nothing — retained on
purpose for inspection"). Never `git stash` or delete another session's work.

## Harness entrypoint

- **Driver/spec:** `tools/test-mcp/<file>.py` or `tests/playwright/<file>` —
  the runnable form of this scenario.
- **Command:** the exact invocation, e.g.
  `uvx --with httpx python tools/test-mcp/<file>.py`.
- **Output:** where results land (and confirm it's gitignored if it's run data).
