# Concepts

This folder is only for not-yet-implemented proposals, experiments, and design explorations.

> **Doc-rule reminder:** when a concept ships, the doc must move under `docs/features/` or `docs/architecture/` and only future follow-up work stays here. Shipped/partially-shipped docs flagged as "MOVE" below are pending that migration — see [`../BACKLOG.md`](../BACKLOG.md) for the queue.

## Active concept docs

| Concept | Status |
| --- | --- |
| [adoption-creation-unification.md](adoption-creation-unification.md) | Proposal — verify whether `matrixEditSlice` shipped before reclassifying |
| [ambient-context-fusion.md](ambient-context-fusion.md) | Partial (~60% wired) — signal collection + rules engine + UI panel shipped; `format_for_prompt` not yet called from `assemble_prompt` |
| [athena-desktop-aware-cli-session-awareness.md](athena-desktop-aware-cli-session-awareness.md) | **Shipped 2026-05-09** (Phase 5 v1) — read-aware persona executions can see the user's interactive Claude CLI session as additional prompt context |
| [athena-desktop-aware-daemon-bridge.md](athena-desktop-aware-daemon-bridge.md) | **Shipped 2026-05-09** (Phase 3 c v3) — `ambient_signal` SQL table bridges in-memory ambient signals from windowed app to the personas-daemon process |
| [athena-desktop-aware-phase1-audit.md](athena-desktop-aware-phase1-audit.md) | Phase 1 audit complete (2026-05-09) — Decision gate **GO** with two scope corrections; Phases 2-6 follow as separate sessions |
| [claude-code-routines-integration.md](claude-code-routines-integration.md) | Proposal — descoped-reopenable (2026-04-15); blockers tracked |
| [cloud-deployment.md](cloud-deployment.md) | Proposal — design spec for *optional* server-side orchestrator deployment, not the Desktop app |
| [invisible-apps-p2p.md](invisible-apps-p2p.md) | **Phases 1-2 shipped** → see [`features/sharing/README.md`](../features/sharing/README.md). Doc retained as Phase 3+ design archive (banner cross-linked 2026-05-10) |
| [langfuse-observability.md](langfuse-observability.md) | **Path A shipped** → see [`features/langfuse.md`](../features/langfuse.md). Doc retained as Path A+ design archive (banner cross-linked 2026-05-10) |
| [langfuse-lab-score-push.md](langfuse-lab-score-push.md) | Backlog — Path A's known gap; Path 2 (synthesize trace) recommended |
| [matrix-retire-glyph-only.md](matrix-retire-glyph-only.md) | Proposal — retire `<PersonaMatrix>` template-preview surface, default to GlyphGrid; reclaims ~25 files |
| [mobile.md](mobile.md) | Proposal — Strategy A vs B undecided; ~30% Strategy B scaffolded (Android feature flag, Gradle project, responsive React started); LLM HTTP client + ForegroundService missing |
| [personas-as-long-lived-processes.md](personas-as-long-lived-processes.md) | Shelved — kept for future consideration |
| [per-persona-claude-code-skills.md](per-persona-claude-code-skills.md) | Proposal — generalization of in-flight `engine/skills_sidecar/` work |
| [persona-execution-image-attachments.md](persona-execution-image-attachments.md) | Proposal |
| [persona-hub-marketplace.md](persona-hub-marketplace.md) | Shelved — engineering foundation in active backlog; marketplace pending Recipe redesign + adoption signal |
| [recipe-from-template-migration.md](recipe-from-template-migration.md) | Design — Stage B in flight; Phase 1a (schema additions) ready to implement |
| [real-api-testing.md](real-api-testing.md) | Proposal — Path 2 (synthesize trace) recommended (~4–8h) |

## Moved out

- **agent-operations-hub** — moved 2026-05-10 to [`../features/agents/operations-hub.md`](../features/agents/operations-hub.md) (Phase 1 chat ops dispatch shipped; Phases 2-3 tracked under Future work in the new doc).
- **cli-coordination-active-runs** — moved 2026-05-10 to [`../architecture/cli-coordination.md`](../architecture/cli-coordination.md) (v1 + v2 cross-skill adoption + v3 parallel-safety primitives shipped).
- **in-app-http-service** — moved 2026-05-10 to [`../architecture/in-app-http-service.md`](../architecture/in-app-http-service.md) (reusable infrastructure pattern; first consumer is Langfuse auto-login).
- **simple-mode-roadmap** — moved 2026-05-10 from `harness/` to [`../features/interface-modes/simple-mode.md`](../features/interface-modes/simple-mode.md) (all 4 phases shipped).
- Implemented event routing docs moved to [../features/events/event-routing.md](../features/events/event-routing.md).
- Implemented live roadmap docs moved to [../features/live-roadmap/live-roadmap.md](../features/live-roadmap/live-roadmap.md).
- Implemented Media Studio architecture and render-plan docs moved to [../features/artist/](../features/artist/).
- Persona capability authoring and historical handoffs moved to [../_archive/concepts/persona-capabilities](../_archive/concepts/persona-capabilities).
- Brotherhood implementation/test coverage/protocol notes moved to [../_archive/concepts](../_archive/concepts).

Before adding a file here, confirm the feature is not already represented in `src/features`, `src-tauri/src/commands`, or `docs/features`.
