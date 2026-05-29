# Template-Adoption Test Procedure

A runbook for replicating the 50-template adoption stress test at the
quality the 2026-05 session reached. Follow it top to bottom; the
"Known confounds" section is the part that separates a useful run from
a misleading one.

## Purpose

Drive a large batch of templates through the full adoption lifecycle —
**open → questionnaire → build → promote → execute** — against a real
running app, to measure how reliably the build process produces
personas that actually work. The run surfaces real bugs (schema gaps,
connector-binding gaps, ungated promotion) and produces per-template
result JSON for triage.

## Prerequisites

1. **The test app must be running** with the test-automation HTTP
   bridge: `npm run tauri:dev:test` (lite) — exposes the bridge on
   `http://127.0.0.1:17320`. Confirm with
   `curl -s http://127.0.0.1:17320/health` → `{"status":"ok",...}`.
2. The app window must stay open for the whole run — closing it exits
   `tauri dev`.
3. A populated vault helps: templates that need `gmail`/`notion`/`attio`
   etc. only deliver value if those credentials exist and have data.
4. Work in a git worktree if you will edit source mid-run
   (`docs/tests/strategy/parallel-cli-workflow.md`).

## The harness

Lives in `tests/playwright/`:

| File | Role |
| --- | --- |
| `template-marathon-fixtures.ts` | Loads templates from `scripts/templates/`, vault-matches, selects targets, builds adoption answers. |
| `template-marathon-bridge.ts` | HTTP-bridge wrappers — `clickTestId`, `query`, `navigate`, `waitForBuildPhase`, `seedAdoptionAnswers`, …. |
| `template-marathon.spec.ts` | Single-template Playwright spec — the 7-phase contract. Reads `TEMPLATE_ID` env var. |
| `template-marathon-driver.mjs` | Node driver — picks targets, shells the spec per template, signature-matches failures, writes state. |
| `template-marathon-rescore.mjs` | Re-scores result JSON from the real DB executions (see below). |

## The 7-phase contract

`template-marathon.spec.ts` drives each template through seven phases. Each
emits `pass` / `soft-fail` (recoverable, logged) / `hard-fail` (aborts that
template). Per-template outcomes land in `tests/results/marathon/<id>.json`.

1. **Open** — navigate to the template, open its modal, click Adopt, switch the
   wizard to the Glyph (`persona-layout`) variant. *Hard-fail:* Adopt does
   nothing for 5 s (`modal-open-stuck`).
2. **Capability picker** (multi-cap only) — toggle every capability on for full
   coverage; a no-op for single-cap templates. *Hard-fail:* Continue stays
   disabled with caps on (`picker-stuck`).
3. **Questionnaire** — answer each `adoption_question` by type
   (select / boolean / text / dynamic_source). **Vault/connector questions are
   skipped** so the adoption modal's own vault auto-detect binds the user's real
   credential (see Known confounds #1) — never seed a placeholder into a
   connector question. *Hard-fail:* >90 s on a single question.
4. **Build** — Continue to Build, then `waitForBuildPhase(["draft_ready",
   "test_complete", "failed", "cancelled"])` (5-min cap); answer any LLM
   follow-up via `answerPendingBuildQuestions`. *Hard-fail:*
   `failed` / `cancelled` / timeout.
5. **Promote** — promote (force variant if standard rejects); wait for the
   persona to appear in `getAgentCards()`. *Hard-fail:* persona row never
   created.
6. **Execute each capability** — run every non-`event_listener` capability
   (synthesise input from `input_schema` when there's no `sample_input`); wait
   for a terminal `persona_executions` row (3-min cap). `event_listener` caps
   are skipped — they can't be manually triggered.
7. **Verify metadata** — for each completed execution assert real work happened:
   `cost_usd > 0`, `duration_ms > 0`, and ≥1 `tool_steps` entry. An empty
   execution (0 `tool_steps`) is the strongest "metadata not wired" signal.

## Running the marathon

```bash
# Smoke one template first — always.
node tests/playwright/template-marathon-driver.mjs --target 1

# Golden regression subset — 5 curated templates spanning the connector
# classes. The fast pre-release / post-change regression check.
node tests/playwright/template-marathon-driver.mjs --golden

# Full run, don't halt on per-template failures.
node tests/playwright/template-marathon-driver.mjs --target 50 --continue-on-fail

# Re-run specific templates after a fix.
node tests/playwright/template-marathon-driver.mjs --only codebase-health-scanner,demo-recorder
```

## Golden regression subset (`--golden`)

`--golden` runs five curated templates — `ai-environment-posture-audit`,
`email-morning-digest`, `financial-stocks-signaller`, `demo-recorder`,
`research-paper-indexer` — chosen to span the connector classes
(zero-config / credential / global-probe) with **unambiguous** vault
bindings, so the marathon auto-drives them cleanly. All five delivered
business value in the 2026-05 50-template run; a regression in adoption,
build, or promote will surface here in ~12 minutes.

A full marathon needs a live app, real credentials and metered model
runs — it cannot be a per-PR CI gate. **Run `--golden` before any
release** and after any change to the adoption / build / promote path.
The harness's own pure logic *is* CI-gated — see
`tests/playwright/__tests__/template-marathon-fixtures.test.ts`
(`npm run test`).

Per-template results land in `tests/results/marathon/<id>.json`; the
driver state is `tests/results/marathon-state.json`. Budget ~2-3 min
and ~$0.30-0.50 per template.

## Re-scoring from the database (mandatory)

The spec's inline scoring has been wrong before — it once `JSON.parse`'d
an already-parsed array and zeroed every tool-step count, turning 37
healthy runs into false failures. **Always re-score against the real
executions** after a run:

```bash
node tests/playwright/template-marathon-rescore.mjs
```

It reads each persona's executions from the DB and recomputes outcomes.
Trust the re-scored numbers, not the raw driver tally.

## Investigating business outcomes

The DB is at
`C:\Users\<user>\AppData\Roaming\com.personas.desktop\personas.db`.
Key query — outcome distribution:

```sql
SELECT status, COALESCE(business_outcome,'(null)'), COUNT(*)
FROM persona_executions GROUP BY status, business_outcome;
```

`business_outcome` values: `value_delivered`, `no_input_available`,
`precondition_failed`, `partial`, `unknown`. To find genuinely-broken
personas (promoted `ready`, never delivered value):

```sql
SELECT p.name, p.setup_status,
  SUM(pe.business_outcome='value_delivered') val,
  COUNT(pe.id) total
FROM personas p JOIN persona_executions pe ON pe.persona_id=p.id
WHERE p.created_at > '<run-date>'
GROUP BY p.id;
```

Read `persona_executions.output_data` of the not-ready ones — the
agent's own text says precisely why (missing connector, no source
data, missing state file).

## Verification re-runs

A failed outcome is not automatically a bug. Re-run a sample with
realistic intent and read the full `output_data`:

- `no_input_available` where the persona reached a real source and
  correctly found nothing → **healthy persona, test-method artifact**.
- `precondition_failed` citing a missing connector the user HAS in the
  vault → **genuine build gap**.

Classify each from the output before concluding a defect.

## Known confounds — read this before trusting any number

1. **(FIXED 2026-05-21, D4)** `seedAdoptionAnswers` used to poison
   connector binding — it seeded a `marathon-default` placeholder into
   every question, including connector-selection ones, so a
   marathon-built persona recorded fake connectors. `buildAdoptionAnswers`
   now SKIPS vault questions (`isVaultQuestion`); the adoption modal's
   own vault auto-detect resolves them to the user's real credential.
   The marathon now validates real connector binding. Consequence: a
   template whose connector is *ambiguous* in the vault (2+ candidate
   credentials) now correctly blocks the Continue button — the marathon
   cannot auto-drive it (a real user would pick). The `--golden` subset
   is curated to unambiguous-connector templates for this reason.
2. **Tauri `/eval` silently drops scripts mid-session.** Use
   `clickTestId` (routes through `__test_respond`), not `/eval`, for
   click dispatch. Add `data-testid` to any control the harness clicks.
3. **`/find-text` returns tags lowercased** (`"button"`) — match
   case-insensitively.
4. **A persona run with no input is expected, not a failure.** The
   marathon invokes capabilities manually with no real triggering
   event; `no_input_available` is the correct result for many.
5. **`waitForBuildPhase` bridge method caps internally at ~20s** — the
   harness wrapper loops it; real executions run 75s-385s.

## Triage loop

1. Run smoke (`--target 1`). Fix any harness/spec break.
2. Run the full batch with `--continue-on-fail`.
3. Re-score from the DB.
4. For each non-pass: read `output_data`, classify artifact vs defect.
5. Fix genuine defects in a worktree, commit atomically, re-run
   `--only <ids>`.
6. Record findings; update this doc if a new confound appears.

## What "done well" looked like (2026-05 session)

50/50 templates passed the adoption→build→promote→execute pipeline
after fixes. The run found and fixed: a missing `incomplete` value in
the `persona_executions` status CHECK constraint; the connector
mis-classification that wrongly flagged builtin connectors
`needs_credentials`; and the build-readiness gap where `ready` did not
mean "delivers value". See `docs/architecture/connector-classification.md`
and `docs/architecture/build-readiness-redesign.md`.
