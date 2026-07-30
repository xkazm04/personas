# Batch 2 Summary — Safe Autonomy (2026-07-30)

> 5 moonshot v1 slices, 5 parallel builders, 7 commits on `vibeman/moonshot-batch2-2026-07-30`
> (stacked off batch-1 tip `5afa655ea`). Gates green at tip.

## Commits

| Commit | Item |
|---|---|
| `1b2d822e2` | batch-2 design doc |
| `b0bb4328b` | Overnight Portfolio Engine v1 — headless nightly tick + budget governor + digest |
| `b8077c351` | Night Shift v1 — approval-gated plan, unattended guidance, ship/park/retry review |
| `048fa452f` | Reversible Agent v1 — change journal, attribution, before-images, conflict-safe undo |
| `98b21f47c` | Zero-Plaintext Broker v1 — proxy grants, minted handles, live blast-radius, kill-switch |
| `810a2e1e1` | Crew Foundry v1 — brief compiler, deficit-mapped crews, fitness instrumentation |
| `f0baff24a` | integration: registrations, 3 migrations, i18n ×14 locales, codegen |

## Verification

| Gate | Baseline (batch-1 tip) | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| cargo check --features desktop,ml | clean | clean |
| eslint (changed files) | clean | clean |
| vitest | 2967/2969 | 2977/2978 (+9 new; sole fail = pre-existing master camelCase ratchet, 0 new violations) |
| i18n coverage + untranslated --strict | clean | clean (broker keys ×13 locales; cs/de "Broker" allowlisted loanword) |
| contracts / events / tiers | clean | clean |

Note: `cargo test` not run — pre-existing machine issue (app_lib test exes
STATUS_ENTRYPOINT_NOT_FOUND; render_plan_proptest E0063 blocks workspace test). Builders' new
Rust unit tests are compile-checked only.

## Package invariants shipped

Branch-only writes everywhere (default-branch commits flagged as breach by the review sweep);
destructive approvals always park; hard pre-dispatch budget governor; every autonomous act
attributed + audited (night ledger, journal, broker audit rows); undo with conflict parking.

## Known follow-ups (Batch-2 tail)

- Overnight Engine: Director verdict gate + KPI measurement loop (deferred by design).
- Night Shift: trust ledger (earned autonomy scopes), multi-night campaigns, per-repo gate
  command registry (git facts used instead), TTS briefing.
- Reversible Agent: point-in-time scrubber; MCP out-of-process writes uncaptured (documented);
  healing-alert recovery wiring.
- Broker: foraging quarantine ("rewrite .env to broker reference"), P2P/multi-device, MCP
  sidecar mint verb (HTTP route covers it).
- Crew Foundry: retune loop (recipe_suggestions deltas), cross-project preset promotion.
- Run builders' Rust unit tests once the machine's cargo-test issue is fixed
  (`npm run ensure:ort-cache` + render_plan_proptest E0063).

## What remains in the campaign

Batches 3–5 per `BATCHES.md`: Self-Improvement (Darwin Mode, Director's Lab, Self-Tuning
Fabric, Self-Evolving Team, Self-Wiring Fabric) → Federation → Capstone.
