# onboarding-bench

Mass-scale evaluation of **persona creation / onboarding** — 300 scenarios grounded
in the shipped catalog, driven through the **real running app UI**, scored by
deterministic gates plus a Claude-as-judge quality pass.

Built to evaluate the new (parallel) build engine against vague, real-world prompts:
does it **guide** the user to the business intent, let them **choose the right
connector**, **process their answers**, and compose **sound metadata** — without
assuming, and without interrogating a prompt that was already clear.

- **[DESIGN.md](./DESIGN.md)** — taxonomy, the two axes, evaluation layers, nightly model.
- **[LESSONS.md](./LESSONS.md)** — read first. Hard-won behaviour + UI + environment facts.
- **[judge-prompt.md](./judge-prompt.md)** — the quality rubric and judging convention.
- **[scenarios/index.md](./scenarios/index.md)** — the generated suite at a glance.

Code lives under `tools/test-mcp/onboardingbench/` (repo convention: docs here, harness there).

---

## Prerequisites

1. **App running with test-automation**: `npm run tauri:dev:test` (bridge on `:17320`,
   Vite on `:1420`). Keep the window **foregrounded** — a backgrounded WebView2 drops
   evaluated JS.
2. **`claude` CLI on PATH** — the LLM user-simulator spawns it under *subscription*
   auth (the harness strips `ANTHROPIC_API_KEY` and the `CLAUDE_CODE_*` nesting vars).
3. **A quiet app.** Preflight refuses to run if a build session is in flight. Nothing
   else may touch the app — in particular **do not edit `src-tauri/**`**, since any
   Rust edit recompiles and restarts the app mid-run.
4. **Vault credentials** determine how much of the connector axis can be *proved*.
   With none, connector scenarios still verify the build **asked**; they can't verify
   the user could **choose** (they're marked `degraded`, not failed). To exercise the
   choice gates, install at least two credentials in a tested category (e.g. `gmail`
   **and** `microsoft_outlook`).

---

## First-run smoke checklist

**The UI runner has not yet been executed against a live app** (it was authored
against a source-verified bridge contract while another session owned the running
instance). Before the first batch, validate on one control scenario:

```bash
# 1. one fully-specified control — should converge with ~0 questions
python tools/test-mcp/onboardingbench/runner.py --scenario ctl-hn-digest-zero-ask
```

Confirm, in order:

- [ ] `startBuildFromIntent` returned a `sessionId` (the intent really landed in `agent-intent-input`).
- [ ] The phase loop reached **`draft_ready`** and did *not* spin waiting for `promoted`.
- [ ] `results/runs/ctl-hn-digest-zero-ask.json` has non-empty `metadata.row.system_prompt`.
- [ ] The created persona (`OB-…` / whatever the build named it) was **deleted** at teardown —
      check the personas list is unchanged.
- [ ] Then a connector scenario: `--scenario ctl-email-decoy-outlook` → the transcript shows a
      question with `connector_category: "email"` and `picker_testid_present: true`
      (or `degraded` if you have no email credential).

If `startBuildFromIntent` fails, the compose surface may not be mounted — the bridge
clicks `glyph-compose-summon` first, but confirm `create-persona-entry` is reachable.

---

## Running a nightly batch

```bash
# next 10 pending scenarios, then exit (resumable)
python tools/test-mcp/onboardingbench/runner.py --batch 10

# focus a slice
python tools/test-mcp/onboardingbench/runner.py --only-tier vague --batch 5
python tools/test-mcp/onboardingbench/runner.py --only-kind control          # the 10 traps
python tools/test-mcp/onboardingbench/runner.py --only-area sales --batch 5
```

State lives in `results/state.json`; already-completed scenarios are skipped, so the
suite is walked incrementally night after night. `--reset-state` starts over.

Budget: a vague scenario is one full interactive build (**~400–900 s** today, dominated
by the build asking questions *serially*). ~10–20 scenarios per night is realistic.

## Regenerating the suite

```bash
python tools/test-mcp/onboardingbench/generate_scenarios.py
```

Rebuilds `scenarios/scenarios.json` + `scenarios/index.md` from the live catalog
(recipes, templates, connectors). Hand-written controls/traps live in
`tools/test-mcp/onboardingbench/controls.json` and are merged in verbatim.

## Judging

After a batch, score the emitted bundles per [judge-prompt.md](./judge-prompt.md) and
write verdicts to `results/verdicts/<scenario>.json`. Aggregate `weighted_total` by
**vagueness tier** — that is the headline number: *does quality hold as the prompt
gets vaguer?*

---

## What "good" looks like

| signal | healthy | the measured baseline |
|---|---|---|
| specified tier | ~0 questions | **4 gratuitous** on a fully-specified digest |
| vague tier | ≤2 batched rounds | **5 questions across 5 serial rounds** |
| connector | asks, user picks, decoy absent | bound `gmail` **without asking** the provider |
| safety | asks before auto-sending | ✅ correctly asked ("always review") |
| scope | 1 job → 1–2 capabilities | fan-out invented an unrequested connector |

The suite is designed so that both failure directions — **assuming too much** *and*
**interrogating a clear prompt** — score badly.
