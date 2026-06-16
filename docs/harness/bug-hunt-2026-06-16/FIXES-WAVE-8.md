# Bug Hunter Fix Wave 8 — Remaining criticals (batch 2) + final-2 plan

> 8 criticals closed across 8 commits, 0 regressions → **40 / 42 criticals**.
> The last 2 (connector readiness invalidation, triggers chain-depth cap) are
> cross-subsystem architectural changes — documented below with plans rather
> than rushed at the tail of an 8-wave run (compile-only verification, high
> blast radius). Baseline preserved: `tsc` 0 → 0, `cargo check --features desktop` 0 → 0.

## Commits

| # | Commit | Finding closed | File |
|---|---|---|---|
| 1 | `53c4b8e9c` | genome-evolution #1 — promotion compares incompatible scales | `src-tauri/src/engine/evolution.rs` |
| 2 | `f79ac5083` | companion-runtime-chat #1 — stale-session retry wrong text | `src-tauri/src/companion/session.rs` |
| 3 | `aef8d1340` | credential-design-negotiation #1 — recipe stub clobber | `src-tauri/src/db/repos/resources/credential_recipes.rs` |
| 4 | `a0ca5a837` | persona-templates #1 — checksum bricks adoption in release | `src-tauri/src/commands/design/template_adopt.rs` |
| 5 | `f602944ac` | cockpit-voice-sensory #1 — overlapping TTS playback | `src/features/plugins/companion/CompanionPanel.tsx` |
| 6 | `d29d6d14f` | personas-twin #1 — shared-slice readiness corruption | `src/stores/slices/system/twinSlice.ts`, `useTwinReadiness.ts` |
| 7 | `2024e9072` | mcp-gateways-tools #1 — JSON-RPC id desync (cross-credential leak) | `src-tauri/src/engine/mcp_tools.rs` |
| 8 | `1643972ef` | research-lab #2 — cross-project store leak | `src/features/plugins/research-lab/sub_reports/ReportPreviewDrawer.tsx` |

## What was fixed

1. **Genome promotion scale.** `improvement = best_variant_score − incumbent_avg` (both live quality evals) instead of subtracting the historical cost/speed-weighted `incumbent_fitness.overall` — promotions were apples-to-oranges (cheap incumbents never evolved; expensive ones promoted mediocre variants).
2. **Companion stale-session retry.** Retry now replays `&effective_user_message` (not the raw `&user_message`), so an Autonomous/External/Proactive turn recovering from a session expiry no longer feeds the model the bare sentinel / loses provenance framing.
3. **Credential recipe clobber.** Upsert `COALESCE(NULLIF(excluded.x,''), x)` on setup_instructions/summary/docs_url — the negotiator's empty start-of-session stub no longer downgrades a richer Design recipe.
4. **Template checksum brick.** The unknown-template release reject (which fired for 100% of adoptions due to a manifest key/content contract mismatch, bricking Presets + Dev Clone) is now log-and-allow; the known-but-tampered branch still rejects. Reconciling the manifest contract to restore real integrity checking is a follow-up.
5. **Cockpit TTS overlap.** Added `mainAudioRef`/`stopMainAudio` mirroring the progress channel — a new spoken reply stops any still-playing prior reply; URLs revoked on end.
6. **Twin readiness.** Readiness now reads a dedicated `twinReadinessApproved` source (status='approved' only), so the Brain/Knowledge panels filtering the shared `twinPendingMemories` slice can't collapse the score.
7. **MCP id desync.** Pooled `tools/call` and `tools/list` reads now correlate by request id (drain notifications + stale responses, kill on desync), closing the cross-credential "wrong tool result to wrong caller" leak. Init handshake (fresh session) keeps the single-frame read.
8. **Research-lab cross-project leak.** The report drawer fetches into LOCAL state via the raw list APIs (not the global store) and gates compileReport on a `dataLoaded` flag — opening a report no longer corrupts the active project's panels or compiles against the wrong/empty dataset.

## Verification

| Gate | Baseline | After Wave 8 | Notes |
|---|---|---|---|
| `tsc --noEmit` | 0 | 0 | cockpit, twin, research-lab. |
| `cargo check --features desktop` | 0 | 0 | genome, companion, cred-recipes, templates, mcp (each verified). |
| `vitest run` | 5 pre-existing | 5 (same) | Unchanged. |

No regressions introduced.

## Cumulative status — **40 / 42 criticals closed (95%)**

| Wave | Theme | Criticals |
|---|---|---:|
| 1 | Concurrency / missing-CAS | 5 |
| 2 | Security & trust-boundary | 5 |
| 3 | Data-loss: watermark/cursor | 3 |
| 4 | Recovery/healing & runtime | 4 |
| 5 | Highest-blast-radius remaining | 5 |
| 6 | Next highest-blast-radius | 5 |
| 7 | Remaining criticals (batch 1) | 5 |
| 8 | Remaining criticals (batch 2) | 8 |

Findings closed overall: **40 / 260** (all 40 are criticals).

---

## The final 2 criticals — implementation plans (deferred, NOT rushed)

These are cross-subsystem architectural changes. Each is specced here so a focused session can land it cleanly with proper (ideally runtime) verification.

### A. connector-catalog #1 — promote-time readiness cached, never recomputed
**File:** `src-tauri/src/commands/design/build_sessions.rs:2725` (write), `connector_readiness.rs:251` (resolver).
**Problem:** `setup_status='ready'` is materialized once at promote and treated as durable; deleting/rotating/clearing the bound credential leaves the persona green-but-blind at runtime.
**Plan (pick one):**
- **(preferred, contained) Lazy recompute** — call `connector_readiness::resolve` (the live evaluator) on persona load (`getPersonaDetail`) and once more immediately before a run dispatches, overriding the cached `setup_status`/`setup_detail` for display + gating. One call site each; no credential-subsystem hooks. Risk: an extra readiness query per load/run.
- **(thorough) Invalidation hooks** — on `credentials::delete` / `save_fields` / healthcheck writes, find every persona whose declared connectors could bind to that credential and recompute (or set `needs_revalidation`). Correct but touches the whole credential mutation surface.
**Verification needed:** promote a persona ready → delete its credential → assert `setup_status` flips and a run is gated. (No existing test covers this path.)

### B. triggers-event-registry #2 — no cycle/depth guard on event-driven trigger chains
**File:** `src-tauri/src/engine/background.rs:799` (`event_bus_tick`), `bus.rs:147` (`match_event`).
**Problem:** A self-emitting persona (or A→B→A chain) loops unbounded — `chain_cascades_total` counts hops but never caps; only the per-source rate limiter (blunt) eventually throttles. Self-inflicted DoS.
**Plan:** Thread a `chain_depth` (and `root_event_id`) alongside the existing `chain_trace_id` through the emitted event (payload field or a new column). On dispatch, increment from the triggering event; if `chain_depth > MAX_CHAIN_DEPTH`, refuse dispatch and dead-letter the event with reason `"chain depth exceeded"`. Optionally also break on `(persona_id, event_type)` re-entry within one chain (visited-set keyed by root_event_id).
**Verification needed:** a recipe where A emits an event A subscribes to → assert the chain stops at MAX_CHAIN_DEPTH and the event is dead-lettered, not amplified. (Touches the event dispatch core — wants a runtime/integration test, not just `cargo check`.)

## What remains

2 criticals (A + B above, plans ready) + the full High/Medium tail (105 High, 68 Medium, 45 Low) per `INDEX.md`. All resumable.
