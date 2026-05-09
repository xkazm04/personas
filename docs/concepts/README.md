# Concepts

This folder is only for not-yet-implemented proposals, experiments, and design explorations.

> **Doc-rule reminder:** when a concept ships, the doc must move under `docs/features/` or `docs/architecture/` and only future follow-up work stays here. Shipped/partially-shipped docs flagged as "MOVE" below are pending that migration — see [`../BACKLOG.md`](../BACKLOG.md) for the queue.

## Active concept docs

| Concept | Status |
| --- | --- |
| [adoption-creation-unification.md](adoption-creation-unification.md) | Proposal — verify whether `matrixEditSlice` shipped before reclassifying |
| [agent-operations-hub.md](agent-operations-hub.md) | **SHIPPED — pending MOVE** to `docs/features/agents/operations-hub.md` (Phase 1 chat ops dispatch + sidebar panels live in `src/features/agents/sub_chat/`) |
| [ambient-context-fusion.md](ambient-context-fusion.md) | Partial (~60% wired) — signal collection + rules engine + UI panel shipped; `format_for_prompt` not yet called from `assemble_prompt` |
| [claude-code-routines-integration.md](claude-code-routines-integration.md) | Proposal — descoped-reopenable (2026-04-15); blockers tracked |
| [cli-coordination-active-runs.md](cli-coordination-active-runs.md) | **SHIPPED — pending MOVE** to `docs/architecture/cli-coordination.md` (v1 + v2 priority-five adoption — `/architect`, `/add-template`, `/add-credential`, `/refresh-context`, `/codebase-init`); long-tail adoption pending |
| [cloud-deployment.md](cloud-deployment.md) | Proposal — design spec for *optional* server-side orchestrator deployment, not the Desktop app |
| [in-app-http-service.md](in-app-http-service.md) | **SHIPPED — pending MOVE** to `docs/architecture/in-app-http-service.md` (generic in-app HTTP router + Langfuse auto-login route live; pattern reusable for OAuth/webhook callbacks) |
| [invisible-apps-p2p.md](invisible-apps-p2p.md) | **PARTIAL — pending MOVE** to `docs/features/p2p-sharing/` (Phase 1 identity + manifest signing and Phase 2 LAN peer discovery shipped; Phase 3 internet P2P backlog) |
| [langfuse-observability.md](langfuse-observability.md) | **SHIPPED — pending MOVE** to `docs/features/observability/` (Path A closed: managed self-host stack + OTLP exporter + auto-login + lifecycle); Path A+ exploration next |
| [langfuse-lab-score-push.md](langfuse-lab-score-push.md) | Backlog — Path A's known gap; Path 2 (synthesize trace) recommended |
| [mobile.md](mobile.md) | Proposal — Strategy A vs B undecided; ~30% Strategy B scaffolded (Android feature flag, Gradle project, responsive React started); LLM HTTP client + ForegroundService missing |
| [personas-as-long-lived-processes.md](personas-as-long-lived-processes.md) | Shelved — kept for future consideration |
| [per-persona-claude-code-skills.md](per-persona-claude-code-skills.md) | Proposal — generalization of in-flight `engine/skills_sidecar/` work |
| [persona-execution-image-attachments.md](persona-execution-image-attachments.md) | Proposal |
| [persona-hub-marketplace.md](persona-hub-marketplace.md) | Shelved — engineering foundation in active backlog; marketplace pending Recipe redesign + adoption signal |
| [recipe-from-template-migration.md](recipe-from-template-migration.md) | Design — Stage B in flight; Phase 1a (schema additions) ready to implement |
| [real-api-testing.md](real-api-testing.md) | Proposal — Path 2 (synthesize trace) recommended (~4–8h) |

## Moved out

- Implemented event routing docs moved to [../features/events/event-routing.md](../features/events/event-routing.md).
- Implemented live roadmap docs moved to [../features/live-roadmap/live-roadmap.md](../features/live-roadmap/live-roadmap.md).
- Implemented Media Studio architecture and render-plan docs moved to [../features/artist/](../features/artist/).
- Persona capability authoring and historical handoffs moved to [../_archive/concepts/persona-capabilities](../_archive/concepts/persona-capabilities).
- Brotherhood implementation/test coverage/protocol notes moved to [../_archive/concepts](../_archive/concepts).

Before adding a file here, confirm the feature is not already represented in `src/features`, `src-tauri/src/commands`, or `docs/features`.
