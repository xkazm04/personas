# Petal-activation E2E (templates → adopt → simulate → verify outputs)

> Verifies that each template capability's **output petals** (Messages, Events,
> Human Review) actually fire when the persona runs — and flags any petal that
> is **set but ignored**. Bends the existing adoption harness
> (`tools/test-mcp/e2e_30_adoption.py`) into a per-capability output check.

## Harness
`tools/test-mcp/e2e_petal_activation.py` (reuses the `/adopt-template` +
`/bridge-exec` test-automation routes and the app's SQLite DB).

```bash
npm run tauri:dev:test                                   # app + :17320 (test-automation)
python tools/test-mcp/e2e_petal_activation.py            # all 10 targets
python tools/test-mcp/e2e_petal_activation.py --smoke    # first template only
python tools/test-mcp/e2e_petal_activation.py --only router,dev-clone
```

## What it does, per template
1. **Adopt** via `/adopt-template` (seed → build → promote).
2. For each **manual** capability (event_listener triggers are skipped — they
   only fire from upstream emits), **simulate** it via `simulate_use_case`
   (`/bridge-exec` → `invokeCommand`). Simulation is used on purpose: it
   **bypasses the connector-readiness gate** yet still **persists** protocol
   outputs — `persona_messages`, `persona_events`, `persona_manual_reviews` are
   written; only outbound delivery (Slack/email/incident/backlog) is skipped
   (`engine/runner/mod.rs` "simulation runs preserve protocol storage").
3. **Verify** outputs tied to the execution:
   - messages / reviews by `execution_id`; events by `use_case_id` + recency.
   - **"set but ignored"** = a `policy_events` row with `action='dropped'`
     (a configured output suppressed by a policy mismatch) → hard fail.
   - `review_policy.mode == "always"` with 0 reviews → ignored (fail).

## Expectations source
Per-capability expectations are read from the **built** persona's
`design_context.useCases[]` (`generation_settings`, `review_policy`,
`event_subscriptions`, `notification_channels`) — i.e. what promote actually
baked, so a mismatch between "petal set" and "output produced" is meaningful.

## Preconditions / gotchas
- **LLM credits**: simulations run the real model via the app's configured
  Anthropic API key. If executions fail instantly (~2s) with
  `output_data = "Credit balance is too low"`, the API key is out of credits —
  top up or switch the execution auth; it is NOT a product/test failure.
- **Dev stability**: `tauri dev` ties the Rust process to the Vite
  `beforeDevCommand`; under heavy load Vite can die and orphan the app (the
  orphan's Claude-CLI spawn breaks). Prefer a quiet machine; if executions
  start failing with "App restarted while execution was running", restart
  `tauri:dev:test` and re-run the remaining `--only` set.
- Adopted personas are named `T: <template>` — delete them after a run.

## Result interpretation
Each capability prints `status | msg=N evt=N rev=N drops=N -> ok|ISSUES:...`.
A clean run = every manual capability `completed` with the petals its metadata
declares, and `drops=0` everywhere. Results JSON: `docs/tests/results/petal_activation_*.json`.

## Last run (2026-06-11)
Build break fixed (`idea_scanner.rs` `///`-on-params). Templates 1–3
(skill-librarian, ai-document-intelligence-hub, router) **passed** — messages,
events, reviews fired, `drops=0`. Templates 4–10 **blocked by credit
exhaustion** (billing, not code); re-run once credits restored.
