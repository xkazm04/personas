# core-bench — Core × industry generalization bench

**Status (honest): dry-run validated; live L1/L2 pending first execution.**
The harness composes, validates and plans offline today; the live levels run
when an app instance is up. Live verification is a follow-up by standing
operator directive, never a ship gate.

Validates that the living-agent **Core/Responsibility model generalizes across
industries**: N archetype Cores (`scripts/templates/_archetypes.json`, 9) ×
M industry responsibility specs (`domains.json`: 6 focus industries + the
software control row) × 1-2 templates per pair → **126 cells** at the default
`--max-templates 2`. Each cell instantiates a REAL persona through the app's
own adoption door (the archetype supplies the Character, the template supplies
the capabilities), charters it through `create_persona_responsibility`, and is
then asserted deterministically and judged against its archetype's scoring
card (`docs/tests/core-bench/cards/`).

Two levels, chronological:

| Level | Spend | Coverage | What it proves |
|---|---|---|---|
| **L1** | zero execution spend | every cell | the assembled prompt faithfully carries the Core (dials → band prose), the charter (`## Responsibilities`), and the stamp (`core_profile`) in every industry |
| **L2** | live executions, budget-capped | sampled cells | the run behaves in character on a real industry task (onboarding-bench `true_intent` rows) |

## Files

- `domains.json` — template-category → kp role-family mapping + the 7 focus domains.
- `cells.mjs` — pure, deterministic cell composition + payload synthesis + binding validation (no Date.now/Math.random in composition).
- `run.mjs` — the driver (`--dry-run` default / `--l1` / `--l2`).
- `judge-packet.mjs` — offline judge-input builder (card + artifact + fill-in verdict schema). Judging itself is a later agent step; the driver never spawns `claude`.
- `baseline.json` + `gate.mjs` — per-cell regression baseline and the gate that fails on a regression **or on anything unmeasured** (repo law: unmeasured ≠ zero — an unmeasured cell reports `incomplete`, never 0).
- `run.test.mjs` — unit tests over the pure parts.
- Scoring cards: `docs/tests/core-bench/cards/*.md` (schema pinned by `evals/agents/core-cards.eval.test.ts`).
- Results: `docs/tests/core-bench/runs/<ISO>-<mode>/` (`result.json` + per-cell artifacts + `judge/` packets).

## Runbook

### 0. Unit tests (offline, always)

```bash
node --test "scripts/bench/core-bench/*.test.mjs"
```

> Deviation from the WP7 brief's `node --test scripts/bench/core-bench/`:
> on Node 24.14.0 (Windows) a bare **directory** positional is spawned as an
> entry point (`MODULE_NOT_FOUND`) instead of being searched. Use the glob
> form above, or name the file: `node --test scripts/bench/core-bench/run.test.mjs`.
> Note also the repo's `NODE_TEST_CONTEXT` lesson: an inherited
> `NODE_TEST_CONTEXT` env var makes `node --test` print failures yet exit 0 —
> check the `# fail` line, not just the exit code, when running under a
> parent test process.

### 1. Dry-run (offline, no app)

```bash
node scripts/bench/core-bench/run.mjs --dry-run          # add --emit-payloads for full design payloads
```

Composes every cell, validates every synthesized payload's **field names
against the committed ts-rs bindings** (`CreatePersonaResponsibilityInput`,
`ResponsibilityOutcome/Objective/Cadence/Tenure`, `PersonaCore`), and writes
the plan + a result.json in which every cell is `incomplete{not_executed_dry_run}` —
a plan is not a measurement.

### 2. Live L1 (app required, zero execution spend)

```bash
# In another terminal, from the repo root — NOT this worktree if src-tauri differs:
npm run tauri:dev:test          # test-automation HTTP server on 127.0.0.1:17320

node scripts/bench/core-bench/run.mjs --l1 --base http://127.0.0.1:17320
# optional: --limit 5 for a smoke slice, --keep-personas to inspect in the UI
```

Per cell, serially: `/adopt-template` (synthesized design payload; zero-LLM
`instant_adopt_template_inner` stamps `core_profile` from `persona.core`) →
`create_persona_responsibility` via `/bridge-exec invokeCommand` →
`preview_execution` for the assembled prompt → deterministic asserts
(`adopted`, `core_profile_stamped`, `core_dials_match`,
`responsibility_created`, `core_section_present`,
`responsibilities_section_present`, `dial_prose_matches_band`,
`responsibility_title_present`) → prompt artifact for the judge →
`deletePersona` teardown.

App prerequisites: the app window stays up (foreground it once after boot);
do **not** edit `src-tauri/**` mid-run (a rebuild kills the server); recipes
must be seeded (normal app boot does this — adoption hydrates `recipe_ref`s
against the live DB and fails loud otherwise).

### 3. Live L2 (app required, spends real execution money)

```bash
CORE_BENCH_MAX_USD=15 node scripts/bench/core-bench/run.mjs --l2 --sample 8 --base http://127.0.0.1:17320
```

Sampled cells (deterministic stride over the matrix; vary with `--seed`)
re-adopt their persona + charter, then run ONE scenario from
`docs/tests/onboarding-bench/scenarios/scenarios.json` matching the cell's
business area (`true_intent` as the task, `{{CONNECTOR}}/{{DECOY}}`
substituted), poll `get_execution` to a terminal status, and record the
execution row's real `cost_usd`.

**Budget semantics:** `CORE_BENCH_MAX_USD` (default **15**) is a
stop-admitting cap, not a hard kill: a cell may finish over the line, but no
further cell starts once measured spend ≥ cap. Every non-admitted cell
reports `incomplete{reason:"budget_cap"}` — the result never pretends an
unrun cell scored anything. `CORE_BENCH_L2_TIMEOUT_MS` (default 600000) caps
the per-execution poll.

### 4. Judge + gate (offline, after any live run)

```bash
node scripts/bench/core-bench/judge-packet.mjs                  # packets into <run>/judge/
node scripts/bench/core-bench/gate.mjs                          # exit 1 on regression OR unmeasured
node scripts/bench/core-bench/gate.mjs --allow-budget-cap       # L2: accept the cap's incompletes
```

The gate holds an L1 run accountable for the FULL matrix and an L2 run for
the cells its own sampling admitted. `baseline.json` starts with every L1
deterministic assert required for all cells; judge dims are advisory.

## Security — RCE warning (inherited from the driver port)

The test-automation server on **:17320** exists only under
`--features test-automation` and accepts unauthenticated local HTTP that is
**eval'd as JavaScript inside the app WebView** (`/bridge-exec` reaches ANY
Tauri command via `invokeCommand`). Treat a running `tauri:dev:test` instance
as remote-code-execution-equivalent on your user account: run it only on a
dev machine, only against a dev database, never with production credentials
in the vault, and never expose the port beyond localhost.

## Design notes

- **Determinism:** composition is seeded by cell id (fnv1a); no wall clock in
  composition. Run directories are timestamped (bookkeeping, not composition).
- **The archetype is the Core under test; the template supplies capabilities.**
  `synthesizeDesignPayload` substitutes `persona.core` (+ identity, voice,
  principles, constraints, decision_principles) from the archetype and keeps
  the template's goal, use cases, tools, connectors and parameters. The
  living-agent `PersonaCore` additive fields (identity/voice/principles…) are
  folded into `persona.core` so the rendered `## Core` carries the full
  Character.
- **Dial-band prose asserts** are pinned copies of
  `src-tauri/engine/src/prompt/core_section.rs` (cuts `<0.34` / `<0.67`); the
  unit tests pin the cuts, and a Rust prose change must update
  `cells.mjs:DIAL_DIRECTIVES` in the same commit.
- **`/execute-persona` wire shape** is `{name_or_id, input_data, use_case_id}`
  (snake_case; the brief's `{personaId}` spelling doesn't exist on that
  route — `test_automation.rs:761`).
- Charter constants across all cells: scopeRung 0, attention off, $5/month
  budget, owner `operator`, `source` absent (the command stamps `operator`
  itself), refusal classes per domain family (general: ExternalSend +
  CredentialUse; software: credentials_or_permissions +
  delivery_configuration — bare unknown strings are refused at intake).
