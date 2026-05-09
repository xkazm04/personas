# Concepts

This folder is only for not-yet-implemented proposals, experiments, and design explorations.

## Active concept docs

| Concept | Status |
| --- | --- |
| [adoption-creation-unification.md](adoption-creation-unification.md) | Proposal |
| [agent-operations-hub.md](agent-operations-hub.md) | Proposal |
| [ambient-context-fusion.md](ambient-context-fusion.md) | Proposal / desktop-gated exploration |
| [claude-code-routines-integration.md](claude-code-routines-integration.md) | Proposal |
| [cli-coordination-active-runs.md](cli-coordination-active-runs.md) | Implemented v1 + v2 priority-five adoption (`/architect`, `/add-template`, `/add-credential`, `/refresh-context`, `/codebase-init`) — long-tail adoption pending |
| [cloud-deployment.md](cloud-deployment.md) | Proposal |
| [in-app-http-service.md](in-app-http-service.md) | Implemented (Langfuse auto-login) — pattern doc for re-use |
| [invisible-apps-p2p.md](invisible-apps-p2p.md) | Proposal |
| [langfuse-observability.md](langfuse-observability.md) | Path A shipped; Path A+ exploration next |
| [langfuse-lab-score-push.md](langfuse-lab-score-push.md) | Backlog — Path A's known gap; Path 2 (synthesize) recommended |
| [mobile.md](mobile.md) | Proposal |
| [personas-as-long-lived-processes.md](personas-as-long-lived-processes.md) | Shelved — kept for future consideration |
| [per-persona-claude-code-skills.md](per-persona-claude-code-skills.md) | Proposal — generalization of in-flight `engine/skills_sidecar/` work |
| [persona-execution-image-attachments.md](persona-execution-image-attachments.md) | Proposal |
| [persona-hub-marketplace.md](persona-hub-marketplace.md) | Shelved — engineering foundation in active backlog; marketplace pending Recipe redesign + adoption signal |
| [recipe-from-template-migration.md](recipe-from-template-migration.md) | Design — Stage B in flight; Phase 1a (schema additions) ready to implement |
| [real-api-testing.md](real-api-testing.md) | Proposal |

## Moved out

- Implemented event routing docs moved to [../features/events/event-routing.md](../features/events/event-routing.md).
- Implemented live roadmap docs moved to [../features/live-roadmap/live-roadmap.md](../features/live-roadmap/live-roadmap.md).
- Implemented Media Studio architecture and render-plan docs moved to [../features/artist/](../features/artist/).
- Persona capability authoring and historical handoffs moved to [../_archive/concepts/persona-capabilities](../_archive/concepts/persona-capabilities).
- Brotherhood implementation/test coverage/protocol notes moved to [../_archive/concepts](../_archive/concepts).

Before adding a file here, confirm the feature is not already represented in `src/features`, `src-tauri/src/commands`, or `docs/features`.
