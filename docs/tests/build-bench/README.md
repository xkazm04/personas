# build-bench — persona build benchmark (as-is vs to-be)

A reusable harness for judging the persona **build** process side-by-side: it
runs the same fixture through a headless one-shot build under one or more engine
**variants** (`sequential` = today's as-is path, `multiagent` = the orchestrated
to-be path from [build-orchestration-plan.md](../../architecture/build-orchestration-plan.md)),
and reports **speed + quality** so every phase of the rollout can be checked for
real forward progress rather than motion.

- **Docs + fixtures:** here (`docs/tests/build-bench/`).
- **Runnable code:** `tools/test-mcp/buildbench/` (a library) + `tools/test-mcp/run_build_bench.py` (entry).
- **Results:** `docs/tests/results/build-bench/` (gitignored run output; commit fixtures only).

It composes existing infrastructure rather than reinventing it: the
`tools/test-mcp/lib` client + SQLite reader, the `/build/start` + `/build/status`
test-automation routes, and the athena Claude-Code-as-judge convention (no API key).

## What it measures

| Layer | How | Gate? |
|---|---|---|
| **Speed** | wall-clock start→terminal, plus coarse per-phase timing from polling `/build/status`. Precise per-event timing + token/cost arrive with **Phase 0 telemetry** and are read automatically when present. | comparison |
| **Correctness** | the fixture's `expected.hard_assertions` — capability count, web-research caps, Airtable/Notion present in `required_connectors`, credential links resolve, no hallucinated search connector, tool-tests. `gate`-severity checks score; `warn`-severity (vault-dependent) are recorded but don't fail a build. | yes (gate) |
| **Quality** | a per-run markdown **judge bundle** scored by a Claude-Code-as-judge pass against the fixture `rubric` (see [judge-prompt.md](./judge-prompt.md)). | comparison |

The report flags each non-baseline variant **FORWARD** only when it is both faster
*and* does not regress the gate pass rate — the "are our steps really going
forward" test.

## Prerequisites

1. Dev app running with the test-automation feature:
   ```bash
   npm run tauri:dev:test          # lite; tauri:dev:test:full for ML paths
   ```
2. Health: `curl http://127.0.0.1:17320/health`
3. For the two connector reactions to go **green**, the vault needs healthy
   `airtable` and `notion` credentials (one non-empty, not-last-failed row each).
   Without them the build still promotes; the reactions report `credential_missing`
   and those checks record as `warn` rather than failing.

## Run

```bash
# Baseline (lean fixture — completes headless in a few minutes):
uvx --with httpx python tools/test-mcp/run_build_bench.py \
    --fixture lite-web-summary --variant sequential --repeat 3

# As-is/to-be side-by-side once the resolution fan-out lands:
uvx --with httpx python tools/test-mcp/run_build_bench.py \
    --fixture lite-web-summary --variant sequential --variant multiagent --repeat 3
```

Before **Phase 0** (auto-create draft persona) lands, pass an existing draft
persona to build onto: `--persona-id <id>`.

## Selecting the engine variant

The harness sends the variant as an `orchestration` body field on `/build/start`.
The current engine ignores unknown fields, so `sequential` is what actually runs
until **Phase 2** wires the field (and/or the `PERSONAS_BUILD_ORCHESTRATION` env
var read at build time). This keeps the harness contract forward-compatible: the
same command benchmarks as-is today and to-be later.

## The judge (quality) pass

After a run, per-build bundles are written to
`docs/tests/results/build-bench/bundles/<fixture>/<variant>-<n>.md`. Open your
Claude Code session and follow [judge-prompt.md](./judge-prompt.md): read each
bundle, score the rubric dimensions (0–3), and write
`verdicts/<fixture>/<variant>-<n>.json`. This mirrors the athena suite — the
judge is the CLI session itself, no `ANTHROPIC_API_KEY`, no SDK.

## Auto-answer (headless robustness)

A one-shot build occasionally parks in `awaiting_input` (a gate the LLM couldn't
resolve autonomously — often a connector-credential choice). Since the benchmark
measures build **time**, not interaction, the driver **auto-answers** any parked
question: it reads the pending question's `cell_key`, answers with the fixture's
`answers[cell_key]` (optional) or its `default_answer` / a built-in default, and
keeps polling — bounded to 3 answers per cell so an unresolvable gate bails
(`STUCK:<cell>`) instead of looping. The progress line shows `· Nq` for N
questions answered.

## Fixtures

- [`fixtures/lite-web-summary.json`](./fixtures/lite-web-summary.json) — **the
  baseline fixture.** 3 native web-research capabilities, **no connectors**, so it
  promotes headless in ~3-5 min and gives a clean, repeatable number. Use it for
  the baseline and the as-is/to-be A/B.
- [`fixtures/web-research-desk.json`](./fixtures/web-research-desk.json) — the
  **fan-out stress fixture**: 3 web-research capabilities + 2 connector
  tool-reactions (Airtable, Notion), exercising **fan-out #1** (5 independent
  capability resolutions) and **fan-out #2** (2 connector tool-tests). Heavier —
  needs vault creds for the connectors and can exceed a bounded one-shot timeout;
  reach for it once the resolution fan-out lands and you want to see it work at
  scale, not for a quick baseline.

Add a fixture by dropping a `<id>.json` next to it with `intent`, `expected`
(hard assertions), and `rubric` (quality dimensions). See the web-research fixture
for the shape.

## Conventions (inherited)

- UTF-8 stdout (the entry script reconfigures it — Windows console safety).
- Import the `lib` client/DB; never hand-roll HTTP or the personas.db path.
- Honors `PERSONAS_TEST_PORT`.
- Run output is gitignored; only fixtures + these docs are committed.
