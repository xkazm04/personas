# Concepts

This folder is only for not-yet-implemented proposals, experiments, and design explorations.

> **Doc-rule reminder:** when a concept ships, the doc must move under `docs/features/` or `docs/architecture/` and only future follow-up work stays here. Shipped/partially-shipped docs flagged as "MOVE" below are pending that migration — see [`../BACKLOG.md`](../BACKLOG.md) for the queue.

## Active concept docs

A 2026-06-12 re-audit cross-checked every concept doc against the codebase and
removed those that had fully shipped (captured under `docs/features/`) or were
invalidated/shelved — see **Removed** below. What remains is genuinely unbuilt
or partially-built forward work.

| Concept | Status |
| --- | --- |
| [ambient-context-fusion.md](ambient-context-fusion.md) | **Largely shipped** — Fix A + Fix B/Case 2 live; **Case 1 (build-time connector gate seeding) shipped 2026-06-12** (`dc89c407b`). Cases 3/4 + daemon cross-process injection deferred |
| [capability-audit.md](capability-audit.md) | Phase A (`#[requires]` macro) in-flight (~17%); Phase B (tier-sync CI check) still valid & unbuilt |
| [empirical-model-tiering-harness.md](empirical-model-tiering-harness.md) | Proposal / hand-off — autonomous Template→Persona→Execution→Lab sweep to set per-capability model tiers empirically; documents Lab arena measurement-validity gaps (2026-06-13) |
| [glyph-consolidation.md](glyph-consolidation.md) | Still valid & unbuilt — consolidate 5 sigil renderers into one parametric `<Sigil>` + `ConsolidatedGlyphLayout`. High-risk, design iteration pending |
| [goals-direction-hub.md](goals-direction-hub.md) | Phases 1-3 shipped; Phase 4 (Athena propose/react) blocked on dispatcher refactor |
| [invisible-apps-p2p.md](invisible-apps-p2p.md) | **Phases 1-2 shipped** → see [`features/sharing/README.md`](../features/sharing/README.md). Retained as Phase 3+ (internet P2P, dynamic UI) design archive |
| [local-first-middle-model.md](local-first-middle-model.md) | Plumbing shipped; composer/validator hypothesis unresolved — awaiting a 12-32B model/hardware round |
| [mobile.md](mobile.md) | Proposal — Strategy A vs B undecided; ~30% Strategy B scaffolded; LLM HTTP client + ForegroundService missing |
| [per-persona-claude-code-skills.md](per-persona-claude-code-skills.md) | Connector `skills_sidecar` variant live; domain-skills generalization unbuilt |
| [persona-design-best-practices.md](persona-design-best-practices.md) | Operationalized in Athena doctrine + chat ops; retained as the design-guidance doctrine source |
| [persona-execution-image-attachments.md](persona-execution-image-attachments.md) | Proposal — greenfield, unbuilt |
| [requires-macro-migration.md](requires-macro-migration.md) | In-flight — ~983 commands left to migrate to `#[requires(level)]` |

## Removed (2026-06-12 re-audit)

Deleted from `concepts/` as shipped-and-captured-elsewhere or invalidated. The
four doctrine-referenced ones were also removed from `companion/brain/doctrine.rs`.

- **matrix-retire-glyph-only** — shipped; `gallery/matrix/` deleted, GlyphGrid is the default preview.
- **glyph-convergence** — shipped 2026-06-01 (mid-build template suggestion); see [`../features/personas/README.md`](../features/personas/README.md).
- **recipe-from-template-migration** — shipped (all phases); design now in [`../features/templates/README.md`](../features/templates/README.md).
- **claude-managed-agents-deployment** — shipped (Phases 1-4, `claude` deploy target).
- **cloud-deployment** — shipped; reference lives in [`../features/deployment/README.md`](../features/deployment/README.md). *(was doctrine-referenced)*
- **adoption-creation-unification** — invalidated; superseded by glyph-convergence (the PersonaMatrix layer it targeted was retired). *(was doctrine-referenced)*
- **claude-code-routines-integration** — descoped 2026-04-15, externally blocked (no public creation API); Claude Managed Agents is the chosen cloud-execution path. *(was doctrine-referenced)*
- **real-api-testing** — a doctrine stub already archived to `_archive/`. *(was doctrine-referenced)*
- **personas-as-long-lived-processes** — shelved; full re-architecture, low ROI absent incidents.
- **persona-hub-marketplace** — shelved behind unmet decision gates; only the signing foundation is active.

## Moved out

- **athena-desktop-aware (Phase 1 audit)** — moved 2026-05-11 to [`../architecture/athena-phase1-audit.md`](../architecture/athena-phase1-audit.md). Decision-gate record; preserved verbatim as the foundation reference for Phases 2-6.
- **athena-desktop-aware (daemon bridge, Phase 3 c v3)** — moved 2026-05-11 to [`../features/companion/athena-daemon-bridge.md`](../features/companion/athena-daemon-bridge.md). Doc 2 limitation #1 (file_watcher producer) closed in the same wave (`8b7cdd7d`).
- **athena-desktop-aware (CLI session awareness, Phase 5 v1)** — moved 2026-05-11 to [`../features/companion/athena-cli-session-awareness.md`](../features/companion/athena-cli-session-awareness.md). Persona-editor UI gap (limitation #1) closed in the same wave (`4c08b020`).
- **agent-operations-hub** — moved 2026-05-10 to [`../features/agents/operations-hub.md`](../features/agents/operations-hub.md) (Phase 1 chat ops dispatch shipped; Phases 2-3 tracked under Future work in the new doc).
- **cli-coordination-active-runs** — moved 2026-05-10 to [`../architecture/cli-coordination.md`](../architecture/cli-coordination.md) (v1 + v2 cross-skill adoption + v3 parallel-safety primitives shipped).
- **real-api-testing** — archived 2026-05-28 to [`../_archive/concepts/real-api-testing.md`](../_archive/concepts/real-api-testing.md). The proposal shipped (`test_build_draft` exists in `build_sessions.rs`); kept for history.
- **in-app-http-service** — moved 2026-05-10 to [`../architecture/in-app-http-service.md`](../architecture/in-app-http-service.md) (reusable infrastructure pattern; first consumer is Langfuse auto-login).
- **simple-mode-roadmap** — moved 2026-05-10 from `harness/` to [`../features/interface-modes/simple-mode.md`](../features/interface-modes/simple-mode.md) (all 4 phases shipped).
- Implemented event routing docs moved to [../features/events/event-routing.md](../features/events/event-routing.md).
- Implemented live roadmap docs moved to [../features/live-roadmap/live-roadmap.md](../features/live-roadmap/live-roadmap.md).
- Implemented Media Studio architecture and render-plan docs moved to [../features/artist/](../features/artist/).
- Persona capability authoring and historical handoffs moved to [../_archive/concepts/persona-capabilities](../_archive/concepts/persona-capabilities).
- Brotherhood implementation/test coverage/protocol notes moved to [../_archive/concepts](../_archive/concepts).

Before adding a file here, confirm the feature is not already represented in `src/features`, `src-tauri/src/commands`, or `docs/features`.
