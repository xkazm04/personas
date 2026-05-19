# Template Marathon — operator guide

Self-driving 50-template adoption stress test. See
[`docs/tests/template-marathon-plan.md`](../../docs/tests/template-marathon-plan.md)
for the full design rationale; this file is the runbook.

## What it does

For each of 50 templates that match your vault's available connectors,
the driver:

1. Drives the **Glyph-variant** template adoption UI end-to-end (no
   `instant_adopt_template` shortcut — the real questionnaire flow).
2. Builds the persona, promotes it.
3. Executes every (non event-listener) capability on the new persona.
4. Verifies the execution row has `cost_usd > 0`, `tool_steps > 0`, and a
   `completed` status — the minimum signal that the persona's metadata
   is wired to real functionality.
5. Writes a per-template JSON result + appends to a shared state file.

Personas + executions are **never deleted**. After the run your DB will
hold ~50 personas and 80–150 executions. Clean up later if you want.

## Prerequisites

- App running on `:1420` + test-automation bridge on `:17320`:

  ```bash
  npm run tauri:dev:test
  ```

  First start cold-compiles in ~3–5 min. Subsequent starts: ~30 s.

- Your vault has the 21 credentials enumerated in the plan doc. If a
  template requires a connector you don't have, the driver auto-skips
  it during target selection.

## Run

```bash
# Fresh marathon — all 50 templates
node tests/playwright/template-marathon-driver.mjs

# Resume from a paused / partial run — skips already-passed templates
node tests/playwright/template-marathon-driver.mjs --resume

# Smaller scope (good for first dry-run)
node tests/playwright/template-marathon-driver.mjs --target 5

# Specific templates only (comma-separated)
node tests/playwright/template-marathon-driver.mjs --only email-morning-digest,daily-standup-compiler

# Don't pause on hard-fail (log + continue) — useful for an unattended
# overnight pass where you want a full picture of failure modes before
# triage.
node tests/playwright/template-marathon-driver.mjs --continue-on-fail
```

The driver exits with:

- `0` — all templates passed.
- `1` — completed with soft / hard fails.
- `2` — app health check failed before start.
- `3` — paused for triage (default behaviour on unknown hard-fail).
- `99` — driver itself crashed.

## Where output lands

```
tests/results/marathon-state.json     ← run-wide state (resumable)
tests/results/marathon/<id>.json      ← one file per template
```

The state file's `templates_attempted` array lists every template the
driver has touched; `bugs_observed[]` accumulates failures with their
signatures.

## When the driver pauses

By default the driver **pauses on the first hard-fail whose signature
isn't in the known-signatures list** in
`template-marathon-driver.mjs::KNOWN_SIGNATURES`. The console prints
the failing template id + signature + result file path.

To triage:

1. Read the per-template result JSON. Phases array tells you which
   phase failed; `failure_signature` is the canonical symptom string.
2. Reproduce manually if needed (the spec runs ONE template via
   `TEMPLATE_ID=<id> npx playwright test template-marathon.spec.ts`).
3. Fix the bug. If the fix is generally applicable, add a signature
   entry to `KNOWN_SIGNATURES` with `action: 'skip'` (continue without
   re-running) or `action: 'retry'` (rerun once after a transient).
4. Resume: `node tests/playwright/template-marathon-driver.mjs --resume`.

## Known signatures (auto-handled)

| Signature substring | Action | Rationale |
| --- | --- | --- |
| `phase:open:template-card-not-found` | retry | Card lookup occasionally races the list render. |
| `phase:build:awaiting_input` | skip | Build asked an unanswerable follow-up after 60 spec turns. |
| `phase:execute:execution-timeout` | skip | External API rate-limit or slow tool. |
| `phase:verify:empty-execution` | skip | Soft-fail; completed but no tool_steps. |

Extend the list as new failure modes are discovered. Each addition
becomes documentation of "what we learned".

## Caveats

1. **Workers stay at 1.** Playwright config caps parallelism — the app
   is a singleton, the bridge serializes anyway. Don't run the driver
   in parallel with itself.
2. **Spec is best-effort on UI selectors.** The marathon spec uses
   `findText` + `/eval` to click buttons by visible text — fragile on
   i18n changes. If a UI label drifts, the corresponding `findText`
   call needs updating in the spec.
3. **Question answering is "first valid option".** Production iteration
   would pick smarter answers per question. The current pass treats
   the spec as a smoke test, not a thorough behaviour suite.
4. **Event-listener capabilities aren't executed** — they're inherently
   passive. They get a `skipped` outcome. The marathon doesn't catch
   bugs in event-listener handlers; that needs a synthetic event helper
   not built here.
5. **Real money + real rate-limit risk.** Each capability execution
   makes real LLM + connector API calls. Expected spend: $5–$15 per
   run depending on which capabilities exercise paid APIs. Gmail /
   Notion / Sentry rate-limits will hit during the night; the
   `execution-timeout` signature handles them by skipping rather than
   halting.

## Post-marathon

After the run completes (or pauses), you have:

- A per-template ledger of outcomes — read by category to spot which
  template families need work.
- A bug list of paused failures (if any) — each is a bug or design gap
  worth a focused fix.
- ~50 personas + executions in your DB available for manual inspection.

A simple SQL summary:

```sql
SELECT category, COUNT(*) c
FROM personas
WHERE name LIKE 'T: %' AND created_at > <marathon-start-iso>
GROUP BY category;
```

The Overview module's Executions tab + Activity tab will show the
recent run history grouped by persona — useful for spot-checking
"did this template actually do something."
